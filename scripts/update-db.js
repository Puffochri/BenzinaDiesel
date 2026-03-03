// scripts/update-db.js
// Node 18+
// npm install node-fetch pg
const fetch = require('node-fetch');
const { Client } = require('pg');

const URL_PREZZI = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';
const URL_IMPIANTI = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
const BATCH_SIZE = 1000;
const MAX_RETRIES = 2;

function parseCSV(text){
  // rimuove BOM e split robusto
  const clean = text.replace(/^\uFEFF/, '');
  return clean.split(/\r?\n/).slice(1).map(l => l.trim()).filter(Boolean).map(l => l.split('|'));
}

async function fetchText(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${url} ${res.status}`);
  return res.text();
}

async function upsertBatch(client, rows){
  const queryText = `
    INSERT INTO stazioni (id,nome,indirizzo,comune,carburante,prezzo,aggiornato,lat,lon,geom)
    VALUES ${rows.map((_,i)=>`($${i*9+1},$${i*9+2},$${i*9+3},$${i*9+4},$${i*9+5},$${i*9+6},$${i*9+7},$${i*9+8},$${i*9+9}, ST_SetSRID(ST_MakePoint($${i*9+9},$${i*9+8}),4326))`).join(',')}
    ON CONFLICT (id, carburante) DO UPDATE SET
      nome = EXCLUDED.nome,
      indirizzo = EXCLUDED.indirizzo,
      comune = EXCLUDED.comune,
      prezzo = EXCLUDED.prezzo,
      aggiornato = EXCLUDED.aggiornato,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      geom = EXCLUDED.geom;
  `;
  const params = [];
  for (const r of rows){
    params.push(r.id, r.nome, r.indirizzo, r.comune, r.carburante, r.prezzo, r.aggiornato, r.lat, r.lon);
  }
  await client.query(queryText, params);
}

(async ()=>{
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL env var (Postgres connection string).');
    process.exit(1);
  }

  console.log('Scarico CSV...');
  const [csvPrezziRaw, csvImpiantiRaw] = await Promise.all([fetchText(URL_PREZZI), fetchText(URL_IMPIANTI)]);
  const prezzi = parseCSV(csvPrezziRaw);
  const impianti = parseCSV(csvImpiantiRaw);

  console.log('Parsing CSV completato. Righe prezzi:', prezzi.length, 'righe impianti:', impianti.length);

  const impMap = {};
  for (const cols of impianti){
    if (cols.length < 10) continue;
    const id = cols[0];
    const lat = parseFloat(cols[8]) || null;
    const lon = parseFloat(cols[9]) || null;
    impMap[id] = { nome: cols[1], indirizzo: cols[2], comune: cols[3], lat, lon };
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let processed = 0, skippedNoImp = 0, skippedBadCoords = 0;
  const rowsToInsert = [];

  for (const cols of prezzi){
    if (cols.length < 5) continue;
    const id = cols[0];
    const carburante = cols[1];
    const prezzo = parseFloat(cols[2]) || null;
    const aggiornato = cols[4] || null;
    const imp = impMap[id];
    if (!imp) { skippedNoImp++; continue; }
    if (!imp.lat || !imp.lon) { skippedBadCoords++; continue; }
    rowsToInsert.push({
      id, nome: imp.nome, indirizzo: imp.indirizzo, comune: imp.comune,
      carburante, prezzo, aggiornato, lat: imp.lat, lon: imp.lon
    });
  }

  console.log('Totale righe candidate per insert:', rowsToInsert.length, 'skippedNoImp:', skippedNoImp, 'skippedBadCoords:', skippedBadCoords);

  // batch upsert
  try {
    let idx = 0;
    while (idx < rowsToInsert.length){
      const batch = rowsToInsert.slice(idx, idx + BATCH_SIZE);
      let attempt = 0;
      while (true){
        try {
          await client.query('BEGIN');
          await upsertBatch(client, batch);
          await client.query('COMMIT');
          processed += batch.length;
          break;
        } catch (err) {
          await client.query('ROLLBACK').catch(()=>{});
          attempt++;
          console.error(`Batch error attempt ${attempt}`, err.message);
          if (attempt > MAX_RETRIES) throw err;
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
      idx += BATCH_SIZE;
      console.log(`Progress: ${processed}/${rowsToInsert.length}`);
    }
    console.log('DB aggiornato con successo. Inserite/aggiornate:', processed);
  } catch (err) {
    console.error('Errore durante upsert:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
