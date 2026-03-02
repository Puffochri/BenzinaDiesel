/* App PRO: map, clustering, autocomplete, reverse enhanced, filters, pagination, animations */

/* CONFIG */
const API_BASE = "https://benzinaprezzidiesel.christianritucci04.workers.dev/api";
const DEFAULT_RADIUS = 10;
const PAGE_SIZE = 12;
const MAP_DEFAULT = { lat:44.8015, lon:10.3280, zoom:12 };

/* STATE */
let map, markerCluster, currentStations = [], filteredStations = [], currentPage = 1;

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

/* MAP */
function initMap(lat=MAP_DEFAULT.lat, lon=MAP_DEFAULT.lon, zoom=MAP_DEFAULT.zoom){
  if (!map){
    map = L.map('map', { zoomControl:true }).setView([lat, lon], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap' }).addTo(map);
    markerCluster = L.markerClusterGroup({ chunkedLoading:true, maxClusterRadius:50 });
    map.addLayer(markerCluster);
  } else map.setView([lat, lon], zoom);
}
function createSvgIcon(fuel){
  const color = (fuel||'').toLowerCase().includes('benzina') ? '#ff6b6b'
    : (fuel||'').toLowerCase().includes('gasolio') ? '#0b84ff'
    : (fuel||'').toLowerCase().includes('gpl') ? '#f59e0b'
    : '#6b7280';
  const svg = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 24 24'><path fill='${color}' d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z'/><circle cx='12' cy='9' r='2.2' fill='#fff'/></svg>`);
  return L.icon({ iconUrl: `data:image/svg+xml;charset=utf-8,${svg}`, iconSize:[36,36], iconAnchor:[18,36], popupAnchor:[0,-36] });
}
function addMarker(st){
  if (!st.lat || !st.lon) return;
  const icon = createSvgIcon(st.carburante);
  const price = st.prezzo != null ? `€ ${st.prezzo.toFixed(3)}` : '—';
  const html = `<div style="min-width:200px"><strong>${escapeHtml(st.nome)}</strong><br/><small class="meta">${escapeHtml(st.indirizzo||'')} — ${escapeHtml(st.comune||'')}</small><div style="margin-top:8px"><strong>${escapeHtml(st.carburante)}</strong>: <span style="color:var(--accent-1)">${price}</span></div><div style="margin-top:8px"><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${st.lat},${st.lon}">Apri in Maps</a></div></div>`;
  const m = L.marker([st.lat, st.lon], { icon }).bindPopup(html);
  markerCluster.addLayer(m);
}

/* RENDER */
function setLoading(on){
  const results = document.getElementById('results');
  if (on){
    results.innerHTML = Array.from({length:6}).map(()=>`<div class="station"><div class="skeleton" style="height:14px;width:60%;margin-bottom:8px"></div><div class="skeleton" style="height:12px;width:40%"></div></div>`).join('');
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
  pageItems.forEach(s=>{
    const card = document.createElement('article'); card.className='station';
    const price = s.prezzo!=null?`€ ${s.prezzo.toFixed(3)}`:'—';
    card.innerHTML = `<div><h3>${escapeHtml(s.nome)}</h3><div class="meta">${escapeHtml(s.indirizzo||'')} — ${escapeHtml(s.comune||'')}</div></div><div class="actions"><div class="price">${price}</div><div class="meta">${s.distanza!=null? s.distanza.toFixed(2)+' km':''}</div><div style="margin-top:8px"><button onclick="openMaps(${s.lat},${s.lon})">Naviga</button></div></div>`;
    container.appendChild(card);
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

/* REVERSE GEOCODING ENHANCED */
async function reverseGeocodeEnhanced(lat, lon){
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=it`;
  try {
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
    return { label, place, municipality, county, raw:j };
  } catch (err){ return null; }
}

/* API wrappers */
async function apiCity(city, radius=DEFAULT_RADIUS){ return fetchJson(`${API_BASE}/city/${encodeURIComponent(city)}?radius=${radius}`); }
async function apiNear(lat, lon, radius=DEFAULT_RADIUS){ return fetchJson(`${API_BASE}/near?lat=${lat}&lon=${lon}&radius=${radius}`); }

/* UI actions */
function showLocationBadge(label){ const el=document.getElementById('locationBadge'); if(!el) return; el.style.display='flex'; document.getElementById('locationLabel').textContent=label; }
function clearLocationBadge(){ const el=document.getElementById('locationBadge'); if(el) el.style.display='none'; document.getElementById('cityInput').value=''; }
function openMaps(lat, lon){ window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank'); }
function setError(msg){ document.getElementById('results').innerHTML = `<div class="station"><p class="meta">Errore: ${escapeHtml(msg)}</p></div>`; markerCluster.clearLayers(); }

async function onSearchCity(){
  const raw = document.getElementById('cityInput').value; if(!raw.trim()) return;
  setLoading(true);
  try {
    const radius = Number(document.getElementById('radius').value) || DEFAULT_RADIUS;
    currentStations = await apiCity(raw, radius);
    applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value });
  } catch (err){ setError(err.message || err); } finally { setLoading(false); }
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
    } catch (err){ setError(err.message || err); } finally { setLoading(false); }
  }, err=>{ setLoading(false); alert('Permesso geolocalizzazione negato o errore'); }, { timeout:12000, maximumAge:60000 });
}

/* Helpers */
function getActiveFuel(){ const a=document.querySelector('.chip.active'); return a? a.dataset.fuel : ''; }

/* Init events */
function initEvents(){
  document.getElementById('searchCityBtn').addEventListener('click', ()=>onSearchCity());
  document.getElementById('nearMeBtn').addEventListener('click', ()=>onNearMe());
  document.querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click', ()=>{
    document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active')); ch.classList.add('active');
    applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value });
  }));
  document.getElementById('quickFilter').addEventListener('input', debounce(()=> applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value }), 250));
  document.getElementById('sortPrice').addEventListener('change', ()=> applyFilters({ fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value }));
  document.getElementById('radius').addEventListener('input', e=> document.getElementById('radiusValue').textContent = `${e.target.value} km`);
  document.getElementById('clearLocationBtn').addEventListener('click', ()=>{ clearLocationBadge(); currentStations=[]; applyFilters({}); });
  const themeBtn = document.getElementById('themeToggle'); if(localStorage.getItem('theme')==='dark') document.body.classList.add('dark');
  themeBtn.addEventListener('click', ()=>{ const isDark = document.body.classList.toggle('dark'); localStorage.setItem('theme', isDark?'dark':'light'); themeBtn.setAttribute('aria-pressed', String(isDark)); });
  const panelBtn = document.getElementById('openFilters'); const panel = document.getElementById('panelFilters');
  panelBtn.addEventListener('click', ()=>{ const expanded = panelBtn.getAttribute('aria-expanded')==='true'; panelBtn.setAttribute('aria-expanded', String(!expanded)); panel.style.display = expanded ? 'none' : 'block'; });
}

/* Init */
async function initApp(){
  initMap();
  initEvents();
  try { setLoading(true); currentStations = await apiCity('Parma', DEFAULT_RADIUS); applyFilters({}); } catch(e){} finally { setLoading(false); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(()=>{});
}
window.openMaps = openMaps;
window.addEventListener('load', initApp);
