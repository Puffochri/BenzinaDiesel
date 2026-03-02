/* PRO ULTRA: script.js ottimizzato — ricerca veloce, animazioni, caching, map-move updates */

/* CONFIG */
const API_BASE = "https://benzinaprezzidiesel.christianritucci04.workers.dev/api";
const DEFAULT_RADIUS = 10;
const PAGE_SIZE = 12;
const MAP_DEFAULT = { lat:44.8015, lon:10.3280, zoom:12 };

/* STATE */
let map, markerCluster, currentStations = [], filteredStations = [], currentPage = 1;
const apiCache = new Map(); // in-memory cache for session
const geocodeCacheKey = 'gc_cache_v1'; // localStorage cache key

/* UTIL */
function debounce(fn, wait=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
async function fetchJson(url, opts={}, timeout=12000){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) { clearTimeout(id); throw err; }
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* CACHING: simple localStorage geocode cache */
function loadGeocodeCache(){ try { return JSON.parse(localStorage.getItem(geocodeCacheKey) || '{}'); } catch { return {}; } }
function saveGeocodeCache(obj){ try { localStorage.setItem(geocodeCacheKey, JSON.stringify(obj)); } catch {} }

/* MAP */
function initMap(lat=MAP_DEFAULT.lat, lon=MAP_DEFAULT.lon, zoom=MAP_DEFAULT.zoom){
  if (!map){
    map = L.map('map', { zoomControl:true }).setView([lat, lon], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap' }).addTo(map);
    markerCluster = L.markerClusterGroup({ chunkedLoading:true, maxClusterRadius:50 });
    map.addLayer(markerCluster);
    map.on('moveend', debounce(onMapMove, 350));
  } else map.setView([lat, lon], zoom);
}
function createSvgIcon(fuel){
  const color = (fuel||'').toLowerCase().includes('benzina') ? '#ff6b6b'
    : (fuel||'').toLowerCase().includes('gasolio') ? '#00d4ff'
    : (fuel||'').toLowerCase().includes('gpl') ? '#f59e0b'
    : '#9aa4b2';
  const svg = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 24 24'><path fill='${color}' d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z'/><circle cx='12' cy='9' r='2.2' fill='#fff'/></svg>`);
  return L.icon({ iconUrl: `data:image/svg+xml;charset=utf-8,${svg}`, iconSize:[44,44], iconAnchor:[22,44], popupAnchor:[0,-44] });
}
function addMarker(st){
  if (!st.lat || !st.lon) return;
  const icon = createSvgIcon(st.carburante);
  const price = st.prezzo != null ? `€ ${st.prezzo.toFixed(3)}` : '—';
  const html = `<div style="min-width:220px"><strong>${escapeHtml(st.nome)}</strong><br/><small class="meta">${escapeHtml(st.indirizzo||'')} — ${escapeHtml(st.comune||'')}</small><div style="margin-top:8px"><strong>${escapeHtml(st.carburante)}</strong>: <span style="color:var(--accent-1)">${price}</span></div><div style="margin-top:8px"><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${st.lat},${st.lon}">Apri in Maps</a></div></div>`;
  const m = L.marker([st.lat, st.lon], { icon }).bindPopup(html, { minWidth: 220 });
  markerCluster.addLayer(m);
}

/* RENDER */
function setLoading(on){
  const results = document.getElementById('results');
  if (on){
    results.innerHTML = Array.from({length:6}).map(()=>`<div class="station skeleton" style="height:72px"></div>`).join('');
    markerCluster.clearLayers();
  }
}
function renderStationsPage(page=1){
  const container = document.getElementById('results');
  container.innerHTML = '';
  if (!filteredStations || filteredStations.length===0){ container.innerHTML = `<div class="station"><p class="meta">Nessun distributore trovato.</p></div>`; markerCluster.clearLayers(); return; }
  currentPage = page;
  const start = (page-1)*PAGE_SIZE;
  const pageItems = filteredStations.slice(start, start+PAGE_SIZE);
  markerCluster.clearLayers();
  pageItems.forEach(s => addMarker(s));
  if (pageItems[0] && pageItems[0].lat && pageItems[0].lon) map.flyTo([pageItems[0].lat, pageItems[0].lon], 13, { duration:0.7 });
  pageItems.forEach((s, idx) => {
    const card = document.createElement('article'); card.className='station';
    const price = s.prezzo!=null?`€ ${s.prezzo.toFixed(3)}`:'—';
    card.innerHTML = `<div><h3>${escapeHtml(s.nome)}</h3><div class="meta">${escapeHtml(s.indirizzo||'')} — ${escapeHtml(s.comune||'')}</div></div><div class="actions"><div class="price">${price}</div><div class="meta">${s.distanza!=null? s.distanza.toFixed(2)+' km':''}</div><div style="margin-top:8px"><button onclick="openMaps(${s.lat},${s.lon})">Naviga</button></div></div>`;
    container.appendChild(card);
    // stagger reveal
    requestAnimationFrame(()=> setTimeout(()=> card.classList.add('visible'), idx * 40));
  });
  renderPagination(Math.ceil(filteredStations.length/PAGE_SIZE), page);
}
function renderPagination(totalPages, current){
  const p = document.getElementById('pagination'); p.innerHTML='';
  if (totalPages<=1) return;
  const btn = (label,page,disabled=false)=>{ const b=document.createElement('button'); b.textContent=label; b.disabled=disabled; b.addEventListener('click',()=>renderStationsPage(page)); return b; };
  p.appendChild(btn('«',1,current===1));
  const start=Math.max(1,current-2), end=Math.min(totalPages,current+2);
  for(let i=start;i<=end;i++){ const b=btn(i,i); if(i===current) b.classList.add('chip','active'); p.appendChild(b); }
  p.appendChild(btn('»',totalPages,current===totalPages));
}

/* FILTERS */
function applyFilters({ fuel='', quick='', sort='distance' } = {}){
  let list = currentStations.slice();
  if (fuel) list = list.filter(s => (s.carburante||'').toLowerCase() === fuel.toLowerCase());
  if (quick){ const q=quick.toLowerCase(); list = list.filter(s => (s.nome||'').toLowerCase().includes(q) || (s.indirizzo||'').toLowerCase().includes(q)); }
  if (sort==='price-asc') list.sort((a,b)=> (a.prezzo||Infinity)-(b.prezzo||Infinity));
  else if (sort==='price-desc') list.sort((a,b)=> (b.prezzo||-Infinity)-(a.prezzo||-Infinity));
  else if (sort==='updated') list.sort((a,b)=> new Date(b.aggiornato)-new Date(a.aggiornato));
  else list.sort((a,b)=> (a.distanza||Infinity)-(b.distanza||Infinity));
  filteredStations = list; renderStationsPage(1);
}

/* GEOCODING / REVERSE (with local cache) */
async function reverseGeocodeEnhanced(lat, lon){
  const cache = loadGeocodeCache();
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (cache[key]) return cache[key];
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=it`;
    const res = await fetch(url, { headers:{ 'User-Agent':'PrezziCarburantiApp/1.0' }});
    if (!res.ok) throw new Error('Reverse failed');
    const j = await res.json(); const addr = j.address||{};
    const placeCandidates = [addr.town, addr.village, addr.hamlet, addr.suburb, addr.locality, addr.neighbourhood, addr.city_district, addr.city].filter(Boolean);
    const place = placeCandidates.length?placeCandidates[0]:(j.name||null);
    const municipality = addr.municipality || addr.county || addr.city || addr.town || null;
    const county = addr.county || null;
    let label = place || (j.display_name? j.display_name.split(',')[0] : null);
    if (place && /^taneto$/i.test(place.trim())){
      const ctx = `${(municipality||'')} ${(county||'')}`.toLowerCase();
      if (ctx.includes('gattatico') || ctx.includes('reggio')) label = 'Taneto di Gattatico';
      else if (ctx.includes('parma')) label = 'Taneto di Parma';
      else if (county) label = `Taneto (${county.split(',')[0]})`;
    } else {
      if (place && municipality && !place.toLowerCase().includes(municipality.toLowerCase())) label = `${place}${municipality? ' di ' + municipality : ''}`;
    }
    label = String(label||'').replace(/\s+,/g,',').replace(/\s{2,}/g,' ').trim();
    const out = { label, place, municipality, county, raw:j };
    cache[key] = out; saveGeocodeCache(cache);
    return out;
  } catch (err){ return null; }
}

/* API wrappers with simple in-memory caching */
async function apiCity(city, radius=DEFAULT_RADIUS){
  const key = `city:${city.toLowerCase()}:r${radius}`;
  if (apiCache.has(key)) return apiCache.get(key);
  const data = await fetchJson(`${API_BASE}/city/${encodeURIComponent(city)}?radius=${radius}`);
  apiCache.set(key, data);
  return data;
}
async function apiNear(lat, lon, radius=DEFAULT_RADIUS){
  const key = `near:${lat.toFixed(4)}:${lon.toFixed(4)}:r${Math.round(radius)}`;
  if (apiCache.has(key)) return apiCache.get(key);
  const data = await fetchJson(`${API_BASE}/near?lat=${lat}&lon=${lon}&radius=${radius}`);
  apiCache.set(key, data);
  return data;
}

/* MAP MOVE: aggiorna lista in base alla vista */
async function onMapMove(){
  if (!map) return;
  const bounds = map.getBounds();
  const center = bounds.getCenter();
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const radiusKm = haversineKm(ne.lat, ne.lng, sw.lat, sw.lng) / 2;
  const radius = Math.min(Math.max(radiusKm, 1), 100);
  setLoading(true);
  try {
    const data = await apiNear(center.lat, center.lng, radius);
    currentStations = data || [];
    applyFilters({ fuel: getActiveFuel(), quick: document.getElementById('quickFilter').value, sort: document.getElementById('sortPrice').value });
  } catch (err) {
    console.error('onMapMove error', err);
  } finally {
    setLoading(false);
  }
}
function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* UI actions */
function showLocationBadge(label){ const el=document.getElementById('locationBadge'); if(!el) return; el.style.display='flex'; document.getElementById('locationLabel').textContent=label; }
function clearLocationBadge(){ const el=document.getElementById('locationBadge'); if(el) el.style.display='none'; document.getElementById('cityInput').value=''; }
function openMaps(lat, lon){ window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank'); }
function setError(msg){ document.getElementById('results').innerHTML = `<div class="station"><p class="meta">Errore: ${escapeHtml(msg)}</p></div>`; markerCluster.clearLayers(); }
function getActiveFuel(){ const a=document.querySelector('.chip.active'); return a? a.dataset.fuel : ''; }

/* SEARCH / NEAR handlers */
async function onSearchCity(){
  const raw = document.getElementById('cityInput').value; if(!raw.trim()) return;
  setLoading(true);
  try {
    const radius = Number(document.getElementById('radius').value) || DEFAULT_RADIUS;
    currentStations = await apiCity(raw, radius);
    applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value });
    if (currentStations && currentStations.length>0 && currentStations[0].lat && currentStations[0].lon) {
      map.flyTo([currentStations[0].lat, currentStations[0].lon], 12, { duration: 0.8 });
    }
  } catch (err){ console.error(err); setError('Ricerca fallita'); } finally { setLoading(false); }
}

async function onNearMe(){
  if (!navigator.geolocation){ alert('Geolocalizzazione non supportata'); return; }
  setLoading(true);
  navigator.geolocation.getCurrentPosition(async pos=>{
    try {
      const lat=pos.coords.latitude, lon=pos.coords.longitude;
      initMap(lat, lon, 13);
      const info = await reverseGeocodeEnhanced(lat, lon);
      const label = (info && info.label) ? info.label : 'Posizione corrente';
      document.getElementById('cityInput').value = label;
      showLocationBadge(label);
      const radius = Number(document.getElementById('radius').value) || DEFAULT_RADIUS;
      try { currentStations = await apiCity(label, radius); } catch(e){ currentStations = await apiNear(lat, lon, radius); }
      applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value });
    } catch (err){ console.error(err); setError('Errore posizione'); } finally { setLoading(false); }
  }, err=>{ setLoading(false); alert('Permesso geolocalizzazione negato o errore'); }, { timeout:12000, maximumAge:60000 });
}

/* Autocomplete lightweight with cache */
function initCityAutocomplete(){
  const input = document.getElementById('cityInput');
  const suggestions = document.getElementById('suggestions');
  const cache = {};
  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (!q || q.length < 2) { suggestions.innerHTML=''; suggestions.setAttribute('aria-hidden','true'); return; }
    if (cache[q]) return renderSuggestions(cache[q]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q + ', Italia')}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'PrezziCarburantiApp/1.0' }});
      const items = await res.json();
      cache[q] = items;
      renderSuggestions(items);
    } catch (e) { suggestions.innerHTML=''; suggestions.setAttribute('aria-hidden','true'); }
  }, 180));

  function renderSuggestions(items){
    suggestions.innerHTML = '';
    if (!items || items.length === 0) { suggestions.setAttribute('aria-hidden','true'); return; }
    items.forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suggestion';
      btn.textContent = it.display_name.split(',')[0];
      btn.addEventListener('click', () => {
        input.value = btn.textContent;
        suggestions.innerHTML=''; suggestions.setAttribute('aria-hidden','true');
        onSearchCity();
      });
      suggestions.appendChild(btn);
    });
    suggestions.setAttribute('aria-hidden','false');
  }
}

/* INIT events */
function initEvents(){
  document.getElementById('searchCityBtn').addEventListener('click', ()=>onSearchCity());
  document.getElementById('nearMeBtn').addEventListener('click', ()=>onNearMe());
  document.querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click', ()=>{
    document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active')); ch.classList.add('active');
    applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value });
  }));
  document.getElementById('quickFilter').addEventListener('input', debounce(()=> applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value }), 200));
  document.getElementById('sortPrice').addEventListener('change', ()=> applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value }));
  document.getElementById('radius').addEventListener('input', e=> document.getElementById('radiusValue').textContent = `${e.target.value} km`);
  document.getElementById('clearLocationBtn').addEventListener('click', ()=>{ clearLocationBadge(); currentStations=[]; applyFilters({}); });
  document.getElementById('openFilters').addEventListener('click', ()=> {
    const panelBtn = document.getElementById('openFilters'); const panel = document.getElementById('panelFilters');
    const expanded = panelBtn.getAttribute('aria-expanded') === 'true';
    panelBtn.setAttribute('aria-expanded', String(!expanded));
    panel.style.display = expanded ? 'none' : 'block';
  });
  document.getElementById('themeToggle').addEventListener('click', ()=> {
    const isLight = document.documentElement.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    document.getElementById('themeToggle').setAttribute('aria-pressed', String(isLight));
  });
}

/* INIT */
async function initApp(){
  // theme persist
  if (localStorage.getItem('theme') === 'light') document.documentElement.classList.add('light');

  initMap();
  initEvents();
  initCityAutocomplete();

  // initial load: Parma
  try { setLoading(true); currentStations = await apiCity('Parma', DEFAULT_RADIUS); applyFilters({}); } catch(e){} finally { setLoading(false); }

  // register service worker
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(()=>{});
}

/* helpers for geocode cache */
function loadGeocodeCache(){ try { return JSON.parse(localStorage.getItem(geocodeCacheKey) || '{}'); } catch { return {}; } }
function saveGeocodeCache(obj){ try { localStorage.setItem(geocodeCacheKey, JSON.stringify(obj)); } catch {} }

/* expose */
window.openMaps = openMaps;
window.addEventListener('load', initApp);
