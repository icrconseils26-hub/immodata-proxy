const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

async function findPLUDoc(codeCommune) {
  const codeDep = codeCommune.substring(0, 2);

  // ETAPE 1 : Chercher directement par commune
  try {
    const r1 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeDep=${codeDep}&codeCommune=${codeCommune}`);
    const docs1 = await r1.json();
    const found1 = docs1.filter(d =>
      (d.type === 'PLU' || d.type === 'PLUi' || d.type === 'CC') &&
      d.downloadable === true && d.urlFiche && d.legalStatus === 'APPROVED'
    );
    if (found1.length) return { urlFiche: found1[0].urlFiche, name: found1[0].originalName };
  } catch(e) {}

  // ETAPE 2 : Récupérer le code EPCI via geo.api.gouv.fr
  try {
    const r2 = await fetch(`https://geo.api.gouv.fr/communes/${codeCommune}?fields=codeEpci`);
    const commune = await r2.json();
    const codeEpci = commune.codeEpci;

    if (codeEpci) {
      // Chercher le PLU sous le code EPCI
      const r3 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeCommune=${codeEpci}`);
      const docs3 = await r3.json();
      const found3 = docs3.filter(d =>
        (d.type === 'PLU' || d.type === 'PLUi' || d.type === 'CC') &&
        d.downloadable === true && d.urlFiche && d.legalStatus === 'APPROVED'
      );
      if (found3.length) return { urlFiche: found3[0].urlFiche, name: found3[0].originalName };
    }
  } catch(e) {}

  // ETAPE 3 : Via apicarto IGN — récupérer le partition
  try {
    const r4 = await fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?code_insee=${codeCommune}&_limit=1`);
    const data4 = await r4.json();
    if (data4.features && data4.features.length > 0) {
      const partition = data4.features[0].properties.partition;
      if (partition) {
        const r5 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?partition=${partition}`);
        const docs5 = await r5.json();
        const found5 = docs5.filter(d =>
          (d.type === 'PLU' || d.type === 'PLUi' || d.type === 'CC') &&
          d.downloadable === true && d.urlFiche && d.legalStatus === 'APPROVED'
        );
        if (found5.length) return { urlFiche: found5[0].urlFiche, name: found5[0].originalName };
      }
    }
  } catch(e) {}

  return null;
}

// Route PLU
app.get('/plu', async (req, res) => {
  const { codeCommune } = req.query;
  if (!codeCommune) return res.status(400).json({ error: 'codeCommune requis' });

  try {
    const doc = await findPLUDoc(codeCommune);
    if (!doc) return res.json({ found: false });

    const pdfRes = await fetch(doc.urlFiche);
    if (!pdfRes.ok) return res.json({ found: false });

    const buffer = await pdfRes.buffer();
    res.set('Content-Type', 'application/pdf');
    res.set('X-PLU-Name', encodeURIComponent(doc.name || 'PLU'));
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route GPU
app.get('/gpu', async (req, res) => {
  const { codeCommune } = req.query;
  if (!codeCommune) return res.status(400).json({ error: 'codeCommune requis' });
  try {
    const codeDep = codeCommune.substring(0, 2);
    const r = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeDep=${codeDep}&codeCommune=${codeCommune}`);
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route PDF direct
app.get('/pdf', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url requise' });
  try {
    const pdfRes = await fetch(decodeURIComponent(url));
    if (!pdfRes.ok) return res.status(404).json({ error: 'PDF inaccessible' });
    const buffer = await pdfRes.buffer();
    res.set('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug route — voir ce que findPLUDoc trouve
app.get('/debug', async (req, res) => {
  const { codeCommune } = req.query;
  if (!codeCommune) return res.status(400).json({ error: 'codeCommune requis' });
  try {
    const doc = await findPLUDoc(codeCommune);
    res.json(doc || { found: false });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ImmoData proxy OK v2' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
