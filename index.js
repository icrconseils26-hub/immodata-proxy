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

// Cherche le PLU — gère commune ET intercommunalite
async function findPLUDoc(codeCommune) {
  const codeDep = codeCommune.substring(0, 2);

  // 1. Chercher par commune directe
  const r1 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeDep=${codeDep}&codeCommune=${codeCommune}`);
  const docs1 = await r1.json();
  let pluDocs = docs1.filter(d =>
    (d.type === 'PLU' || d.type === 'PLUi' || d.type === 'CC') &&
    d.downloadable === true && d.urlFiche && d.legalStatus === 'APPROVED'
  );
  if (pluDocs.length) return { urlFiche: pluDocs[0].urlFiche, name: pluDocs[0].originalName };

  // 2. Via apicarto pour trouver le partition intercommunal
  const r3 = await fetch(`https://apicarto.ign.fr/api/gpu/zone-urba?code_insee=${codeCommune}&_limit=1`);
  const data3 = await r3.json();

  if (data3.features && data3.features.length > 0) {
    const partition = data3.features[0].properties.partition;
    if (partition) {
      const r4 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?partition=${partition}`);
      const docs4 = await r4.json();
      const found = docs4.filter(d =>
        (d.type === 'PLU' || d.type === 'PLUi' || d.type === 'CC') &&
        d.downloadable === true && d.urlFiche && d.legalStatus === 'APPROVED'
      );
      if (found.length) return { urlFiche: found[0].urlFiche, name: found[0].originalName };
    }
  }

  return null;
}

// Proxy PLU PDF
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
    res.set('X-PLU-Name', doc.name || 'PLU');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy PDF direct par URL
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

// Proxy GPU
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

app.get('/', (req, res) => res.json({ status: 'ImmoData proxy OK' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
