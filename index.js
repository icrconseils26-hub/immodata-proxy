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

function filterPLU(docs) {
  return docs.filter(d =>
    (d.type === 'PLU' || d.type === 'PLUi' || d.type === 'CC') &&
    d.downloadable === true && d.urlFiche && d.legalStatus === 'APPROVED'
  );
}

async function findPLUDoc(codeCommune) {
  const codeDep = codeCommune.substring(0, 2);

  // ETAPE 1 : commune directe avec codeDep
  try {
    const r = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeDep=${codeDep}&codeCommune=${codeCommune}`);
    const docs = await r.json();
    const found = filterPLU(docs);
    if (found.length) return { urlFiche: found[0].urlFiche, name: found[0].originalName };
  } catch(e) {}

  // ETAPE 2 : code EPCI via geo.api.gouv.fr
  try {
    const r2 = await fetch(`https://geo.api.gouv.fr/communes/${codeCommune}?fields=codeEpci`);
    const commune = await r2.json();
    const codeEpci = commune.codeEpci;

    if (codeEpci) {
      // Chercher avec codeCommune=EPCI (sans codeDep)
      const r3 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeCommune=${codeEpci}`);
      const docs3 = await r3.json();
      const found3 = filterPLU(docs3);
      if (found3.length) return { urlFiche: found3[0].urlFiche, name: found3[0].originalName };

      // Chercher avec codeDep + codeCommune=EPCI
      const codeDep2 = codeEpci.substring(0, 2);
      const r4 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeDep=${codeDep2}&codeCommune=${codeEpci}`);
      const docs4 = await r4.json();
      const found4 = filterPLU(docs4);
      if (found4.length) return { urlFiche: found4[0].urlFiche, name: found4[0].originalName };
    }
  } catch(e) {}

  // ETAPE 3 : partition via apicarto
  try {
    const r5 = await fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?code_insee=${codeCommune}&_limit=1`);
    const data5 = await r5.json();
    if (data5.features && data5.features.length > 0) {
      const partition = data5.features[0].properties.partition;
      if (partition) {
        const r6 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?partition=${partition}`);
        const docs6 = await r6.json();
        const found6 = filterPLU(docs6);
        if (found6.length) return { urlFiche: found6[0].urlFiche, name: found6[0].originalName };
      }
    }
  } catch(e) {}

  return null;
}

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

app.get('/', (req, res) => res.json({ status: 'ImmoData proxy OK v3' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
