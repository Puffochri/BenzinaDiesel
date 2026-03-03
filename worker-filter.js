// worker-filter.js
// Web Worker per filtrare/ordinare grandi liste di stazioni senza bloccare l'UI.
// Protocollo: postMessage({ cmd: 'filter', stations, filters })
// Risposta: postMessage({ cmd: 'filtered', data, meta })

/* Utility: haversine (km) */
function haversine(lat1, lon1, lat2, lon2){
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Normalize text: lower-case, trim, remove diacritics */
function norm(s){
  if (!s) return '';
  return String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/* Stable sort helper */
function stableSort(arr, compare){
  return arr.map((v,i)=>({v,i})).sort((a,b)=>{
    const r = compare(a.v,b.v);
    return r !== 0 ? r : a.i - b.i;
  }).map(x=>x.v);
}

/* Batch processing helper to avoid long blocking loops */
async function batchMap(items, fn, batchSize = 1000){
  const out = [];
  for (let i = 0; i < items.length; i += batchSize){
    const slice = items.slice(i, i + batchSize);
    for (let j = 0; j < slice.length; j++){
      out.push(fn(slice[j], i + j));
    }
    // yield to event loop so UI thread can remain responsive
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
}

/* Main message handler */
self.onmessage = async function(ev){
  try {
    const { cmd } = ev.data || {};
    if (cmd === 'ping') {
      postMessage({ cmd:'pong' });
      return;
    }
    if (cmd === 'filter'){
      const stations = Array.isArray(ev.data.stations) ? ev.data.stations : [];
      const filters = ev.data.filters || {};
      const centerLat = Number(filters.centerLat) || 0;
      const centerLon = Number(filters.centerLon) || 0;
      const fuelFilter = (filters.fuel || '').toString().trim();
      const quickRaw = (filters.quick || '').toString();
      const quick = norm(quickRaw);
      const sort = (filters.sort || 'distance').toString();
      const limit = Math.max(0, Math.min(5000, parseInt(filters.limit || 0, 10) || 0)); // 0 = no limit
      const offset = Math.max(0, parseInt(filters.offset || 0, 10) || 0);

      // 1) compute distance in batches to avoid blocking
      const withDist = await batchMap(stations, (s) => {
        const lat = Number(s.lat) || 0;
        const lon = Number(s.lon) || 0;
        const distanza = (centerLat || centerLon) ? haversine(centerLat, centerLon, lat, lon) : (s.distanza || 0);
        return Object.assign({}, s, { distanza });
      }, 1000);

      // 2) filter
      const out = withDist.filter(s => {
        if (fuelFilter && fuelFilter.length){
          if (!s.carburante) return false;
          if (norm(s.carburante) !== norm(fuelFilter)) return false;
        }
        if (quick && quick.length){
          const name = norm(s.nome || '');
          const addr = norm(s.indirizzo || '');
          const comune = norm(s.comune || '');
          // quick search: match name, address, comune or carburante
          if (!(name.includes(quick) || addr.includes(quick) || comune.includes(quick) || norm(s.carburante||'').includes(quick))) return false;
        }
        return true;
      });

      // 3) sort (stable)
      let sorted;
      if (sort === 'price-asc'){
        sorted = stableSort(out, (a,b) => ( (a.prezzo == null ? Infinity : Number(a.prezzo)) - (b.prezzo == null ? Infinity : Number(b.prezzo)) ));
      } else if (sort === 'price-desc'){
        sorted = stableSort(out, (a,b) => ( (b.prezzo == null ? -Infinity : Number(b.prezzo)) - (a.prezzo == null ? -Infinity : Number(a.prezzo)) ));
      } else if (sort === 'updated'){
        sorted = stableSort(out, (a,b) => {
          const ta = a.aggiornato ? Date.parse(a.aggiornato.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$2/$1/$3')) : 0;
          const tb = b.aggiornato ? Date.parse(b.aggiornato.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$2/$1/$3')) : 0;
          return tb - ta;
        });
      } else { // distance (default)
        sorted = stableSort(out, (a,b) => ( (a.distanza || Infinity) - (b.distanza || Infinity) ));
      }

      // 4) apply offset/limit
      const sliced = (limit > 0) ? sorted.slice(offset, offset + limit) : sorted.slice(offset);

      // 5) respond with meta
      postMessage({
        cmd: 'filtered',
        data: sliced,
        meta: { totalMatched: sorted.length, returned: sliced.length, offset, limit }
      });
      return;
    }

    // unknown command
    postMessage({ cmd:'error', message: 'Unknown command' });
  } catch (err) {
    postMessage({ cmd:'error', message: String(err) });
  }
};
