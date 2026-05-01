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

  // ETAPE 1 : commune directe GPU
  try {
    const r = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeDep=${codeDep}&codeCommune=${codeCommune}`);
    const docs = await r.json();
    const found = docs.filter(d =>
      (d.type === 'PLU' || d.type === 'PLUi' || d.type === 'CC') &&
      d.downloadable === true && d.urlFiche && d.legalStatus === 'APPROVED'
    );
    if (found.length) return { urlFiche: found[0].urlFiche, name: found[0].originalName };
  } catch(e) {}

  // ETAPE 2 : apicarto document — retourne gpu_doc_id + partition + name
  try {
    const r2 = await fetch(`https://apicarto.ign.fr/api/gpu/document?code_insee=${codeCommune}`);
    const data2 = await r2.json();

    if (data2.features && data2.features.length > 0) {
      for (const feature of data2.features) {
        const props = feature.properties;
        const partition = props.partition;
        const docId = props.gpu_doc_id;
        const name = props.name;
        const duType = props.du_type;

        if (!partition || !docId || !name) continue;
        if (!['PLU', 'PLUi', 'CC', 'PLUiH', 'PLUI'].includes(duType)) continue;

        // Construire l'URL du règlement
        // Pattern: https://data.geopf.fr/annexes/gpu/documents/{partition}/{docId}/{name}_reglement_{date}.pdf
        // On essaie plusieurs variantes de nom de fichier

        const baseUrl = `https://data.geopf.fr/annexes/gpu/documents/${partition}/${docId}`;

        // Variante 1 : name + _reglement_ + date extraite du name
        const datePart = name.match(/(\d{8})$/)?.[1];
        if (datePart) {
          const formattedDate = datePart.substring(0,4) + datePart.substring(4,6) + datePart.substring(6,8);
          const url1 = `${baseUrl}/${name.replace('_PLUi_', '_').replace('_PLU_', '_')}_reglement_${formattedDate}.pdf`;
          // Essayer avec le nom exact
          const url2 = `${baseUrl}/${name}_reglement_${datePart.substring(0,4)}${datePart.substring(4,6)}${datePart.substring(6,8)}.pdf`;

          // Reconstruire proprement
          const codeDoc = partition.replace('DU_', '');
          const dateFormatted = datePart.substring(0,4) + datePart.substring(4,6) + datePart.substring(6,8);
          const urlFiche = `${baseUrl}/${codeDoc}_reglement_${dateFormatted}.pdf`;

          return { urlFiche, name, partition, docId };
        }

        // Fallback : retourner les infos pour construire l'URL manuellement
        return { partition, docId, name, urlFiche: null };
      }
    }
  } catch(e) {}

  // ETAPE 3 : EPCI via geo.api.gouv.fr
  try {
    const r3 = await fetch(`https://geo.api.gouv.fr/communes/${codeCommune}?fields=codeEpci`);
    const commune = await r3.json();
    const codeEpci = commune.codeEpci;
    if (codeEpci) {
      const r4 = await fetch(`https://www.geoportail-urbanisme.gouv.fr/api/document?codeCommune=${codeEpci}`);
      const docs4 = await r4.json();
      const found4 = docs4.filter(d =>
        (d.type === 'PLU' || d.type === 'PLUi' || d.type === 'CC') &&
        d.downloadable === true && d.urlFiche && d.legalStatus === 'APPROVED'
      );
      if (found4.length) return { urlFiche: found4[0].urlFiche, name: found4[0].originalName };
    }
  } catch(e) {}

  return null;
}

app.get('/plu', async (req, res) => {
  const { codeCommune } = req.query;
  if (!codeCommune) return res.status(400).json({ error: 'codeCommune requis' });
  try {
    const doc = await findPLUDoc(codeCommune);
    if (!doc || !doc.urlFiche) return res.json({ found: false, debug: doc });

    const pdfRes = await fetch(doc.urlFiche);
    if (!pdfRes.ok) return res.json({ found: false, urlTried: doc.urlFiche, status: pdfRes.status });

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

app.get('/', (req, res) => res.json({ status: 'ImmoData proxy OK v4' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
