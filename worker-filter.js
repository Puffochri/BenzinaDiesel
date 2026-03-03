self.onmessage = function(ev){
  const { cmd, stations, filters } = ev.data;
  if (cmd === 'filter'){
    const { centerLat, centerLon, fuel, quick, sort } = filters || {};
    const out = stations.map(s => {
      const d = haversine(centerLat || 0, centerLon || 0, s.lat || 0, s.lon || 0);
      return { ...s, distanza: d };
    }).filter(s => {
      if (fuel && fuel.length && (s.carburante||'').toLowerCase() !== fuel.toLowerCase()) return false;
      if (quick && quick.length){
        const q = quick.toLowerCase();
        return (s.nome||'').toLowerCase().includes(q) || (s.indirizzo||'').toLowerCase().includes(q);
      }
      return true;
    });

    if (sort === 'price-asc') out.sort((a,b)=> (a.prezzo||Infinity)-(b.prezzo||Infinity));
    else if (sort === 'price-desc') out.sort((a,b)=> (b.prezzo||-Infinity)-(a.prezzo||-Infinity));
    else if (sort === 'updated') out.sort((a,b)=> new Date(b.aggiornato)-new Date(a.aggiornato));
    else out.sort((a,b)=> a.distanza - b.distanza);

    postMessage({ cmd:'filtered', data: out });
  }
};

function haversine(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
