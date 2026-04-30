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

// Proxy PLU PDF depuis Géoportail
app.get('/plu', async (req, res) => {
  const { codeCommune } = req.query;
  if (!codeCommune) return res.status(400).json({ error: 'codeCommune requis' });

  try {
    const codeDep = codeCommune.substring(0, 2);
    const url = `https://www.geoportail-urbanisme.gouv.fr/api/document?codeDep=${codeDep}&codeCommune=${codeCommune}`;
    const r = await fetch(url);
    const docs = await r.json();

    const pluDocs = docs.filter(d =>
      (d.type === 'PLU' || d.type === 'CC') &&
      d.downloadable === true &&
      d.urlFiche &&
      d.legalStatus === 'APPROVED'
    );

    if (!pluDocs.length) return res.json({ found: false });

    // Télécharger le PDF
    const pdfUrl = pluDocs[0].urlFiche;
    const pdfRes = await fetch(pdfUrl);
    const buffer = await pdfRes.buffer();

    res.set('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy liste documents GPU
app.get('/gpu', async (req, res) => {
  const { codeCommune } = req.query;
  if (!codeCommune) return res.status(400).json({ error: 'codeCommune requis' });

  try {
    const codeDep = codeCommune.substring(0, 2);
    const url = `https://www.geoportail-urbanisme.gouv.fr/api/document?codeDep=${codeDep}&codeCommune=${codeCommune}`;
    const r = await fetch(url);
    const docs = await r.json();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ImmoData proxy OK' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
