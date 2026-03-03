/* script.js — client ottimizzato: throttle, cache, canvas markers, chunked render, worker filter integration */

const API_BASE = 'https://benzinaprezzidiesel.christianritucci04.workers.dev/api';
const CLIENT_CACHE_TTL = 1000 * 60 * 5;
const clientCache = new Map();
let map, markerCluster, currentStations = [], filterWorker = null;
const PAGE_SIZE = 12;
let currentPage = 0;

/* ---------- Helpers ---------- */
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cacheKey(lat, lon, radius, limit=150){ return `${lat.toFixed(3)}:${lon.toFixed(3)}:r${Math.round(radius)}:l${limit}`; }
function setLoading(on){
  const r = document.getElementById('results');
  if (!r) return;
  if (on){
    r.innerHTML = Array.from({length:6}).map(()=>`<div class="station skeleton" role="status" aria-busy="true"></div>`).join('');
  } else {
    // leave as is; caller will render results
  }
}
function setError(msg){
  const r = document.getElementById('results');
  if (!r) return;
  r.innerHTML = `<div class="station visible"><p class="meta">Errore: ${escapeHtml(msg)}</p></div>`;
  markerCluster && markerCluster.clearLayers();
}
function showToast(msg, opts = {}){
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.position = 'fixed';
  t.style.right = '16px';
  t.style.bottom = '16px';
  t.style.background = 'rgba(15,23,42,0.95)';
  t.style.color = '#fff';
  t.style.padding = '10px 14px';
  t.style.borderRadius = '10px';
  t.style.zIndex = 9999;
  t.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), opts.duration || 3500);
}

/* ---------- Client cache with background refresh ---------- */
async function fetchNearCached(lat, lon, radius, limit=200){
  const key = cacheKey(lat, lon, radius, limit);
  const now = Date.now();
  const cached = clientCache.get(key);
  if (cached && (now - cached.ts) < CLIENT_CACHE_TTL){
    // background refresh
    fetch(`${API_BASE}/near?lat=${lat}&lon=${lon}&radius=${radius}&limit=${limit}`)
      .then(r => r.json()).then(d => clientCache.set(key, { ts: Date.now(), data: d })).catch(()=>{});
    return cached.data;
  }
  const res = await fetch(`${API_BASE}/near?lat=${lat}&lon=${lon}&radius=${radius}&limit=${limit}`);
  if (!res.ok) throw new Error('API error');
  const data = await res.json();
  clientCache.set(key, { ts: Date.now(), data });
  return data;
}

/* ---------- Map markers (canvas) ---------- */
function fuelColor(fuel){
  if (!fuel) return '#9aa4b2';
  const f = fuel.toLowerCase();
  if (f.includes('benzina')) return '#ff6b6b';
  if (f.includes('gasolio')) return '#00d4ff';
  if (f.includes('gpl')) return '#f59e0b';
  if (f.includes('metano')) return '#7dd3fc';
  return '#8b8f98';
}
function createCanvasMarker(st){
  if (!st || !st.lat || !st.lon) return null;
  const color = fuelColor(st.carburante);
  const circle = L.circleMarker([st.lat, st.lon], {
    radius: 7, fillColor: color, color: '#0b1720', weight: 0.6, opacity: 0.95, fillOpacity: 0.95, renderer: L.canvas()
  });
  circle.bindTooltip(`<strong>${escapeHtml(st.nome)}</strong><br/><small>${escapeHtml(st.indirizzo||'')}</small>`, { direction:'top' });
  circle.on('click', ()=> showStationDetail(st));
  return circle;
}

/* Chunked rendering for markers to avoid jank */
async function bulkRenderStations(stations){
  if (!markerCluster) return;
  markerCluster.clearLayers();
  const CHUNK = 200;
  for (let i=0;i<stations.length;i+=CHUNK){
    const slice = stations.slice(i, i+CHUNK);
    const layers = slice.map(s => createCanvasMarker(s)).filter(Boolean);
    if (layers.length) markerCluster.addLayers(layers);
    // yield to UI
    await new Promise(r => requestAnimationFrame(r));
  }
}

/* ---------- Utilities: radius, throttle, debounce ---------- */
function computeRadiusFromView(map){
  const bounds = map.getBounds();
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const R = 6371;
  const dLat = (ne.lat - sw.lat) * Math.PI / 180;
  const dLon = (ne.lng - sw.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(sw.lat*Math.PI/180)*Math.cos(ne.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  const diagKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.max(1, diagKm / 2);
}
function throttle(fn, wait){
  let last = 0, timer = null;
  return function(...args){
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0){
      if (timer){ clearTimeout(timer); timer = null; }
      last = now;
      fn.apply(this, args);
    } else if (!timer){
      timer = setTimeout(()=>{ last = Date.now(); timer = null; fn.apply(this, args); }, remaining);
    }
  };
}
function debounce(fn, wait=200){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), wait); };
}

/* ---------- Map move handler ---------- */
const onMapMoveThrottled = throttle(async () => {
  if (!map) return;
  const center = map.getCenter();
  const radius = computeRadiusFromView(map);
  try {
    setLoading(true);
    const data = await fetchNearCached(center.lat, center.lng, radius, 300);
    currentStations = Array.isArray(data) ? data : [];
    currentPage = 0;
    if (filterWorker){
      filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat:center.lat, centerLon:center.lng, fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value } });
    } else {
      await bulkRenderStations(currentStations);
      applyFiltersUI();
    }
  } catch (err) {
    console.error('fetchNear error', err);
    setError('Errore caricamento distributori');
  } finally {
    setLoading(false);
  }
}, 600);

/* ---------- Client-side filtering & sorting ---------- */
function getActiveFuel(){ const a=document.querySelector('.chip.active'); return a? a.dataset.fuel : ''; }

function filteredStations(){
  const fuel = getActiveFuel();
  const quick = (document.getElementById('quickFilter')?.value || '').toLowerCase().trim();
  const sort = document.getElementById('sortPrice')?.value || 'distance';
  let out = Array.isArray(currentStations) ? currentStations.slice() : [];

  if (fuel) out = out.filter(s => (s.carburante||'').toLowerCase().includes(fuel.toLowerCase()));
  if (quick) out = out.filter(s => ((s.nome||'').toLowerCase().includes(quick) || (s.indirizzo||'').toLowerCase().includes(quick) || (s.comune||'').toLowerCase().includes(quick)));

  // normalize prezzo for sorting
  const priceVal = v => (v == null || isNaN(v)) ? Infinity : Number(v);

  if (sort === 'price-asc') out.sort((a,b)=> priceVal(a.prezzo) - priceVal(b.prezzo));
  else if (sort === 'price-desc') out.sort((a,b)=> priceVal(b.prezzo) - priceVal(a.prezzo));
  else if (sort === 'updated') out.sort((a,b)=> {
    const ta = a.aggiornato ? Date.parse(a.aggiornato.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$2/$1/$3')) : 0;
    const tb = b.aggiornato ? Date.parse(b.aggiornato.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$2/$1/$3')) : 0;
    return tb - ta;
  });
  else { // distance
    out.sort((a,b)=> (a.distanza || Infinity) - (b.distanza || Infinity));
  }

  return out;
}

/* ---------- Render list and pagination ---------- */
function renderStationsList(stations, page = 0){
  const container = document.getElementById('results');
  container.innerHTML = '';
  if (!stations || stations.length === 0){
    container.innerHTML = `<div class="station visible"><p class="meta">Nessun distributore trovato.</p></div>`;
    markerCluster && markerCluster.clearLayers();
    return;
  }
  const start = page * PAGE_SIZE;
  const pageItems = stations.slice(start, start + PAGE_SIZE);
  pageItems.forEach((s) => {
    const card = document.createElement('article');
    card.className='station visible';
    const price = s.prezzo!=null?`€ ${Number(s.prezzo).toFixed(3)}`:'—';
    card.innerHTML = `
      <div style="min-width:0">
        <h3 class="title">${escapeHtml(s.nome)}</h3>
        <div class="meta">${escapeHtml(s.indirizzo||'')} — ${escapeHtml(s.comune||'')}</div>
        <div class="meta-row"><span class="chip">${escapeHtml(s.carburante||'')}</span></div>
      </div>
      <div style="text-align:right">
        <div class="price">${price}</div>
        <div class="meta">${s.distanza!=null? s.distanza.toFixed(2)+' km':''}</div>
        <div style="margin-top:8px"><button class="btn-ghost" data-lat="${s.lat}" data-lon="${s.lon}">Naviga</button></div>
      </div>
    `;
    // attach navigate handler
    card.querySelector('button[data-lat]')?.addEventListener('click', (ev)=>{
      const b = ev.currentTarget;
      openMaps(b.dataset.lat, b.dataset.lon);
    });
    // attach click to fly to marker
    card.addEventListener('click', ()=> {
      if (s.lat && s.lon && map) map.flyTo([s.lat, s.lon], 15, { duration: 0.6 });
    });
    container.appendChild(card);
  });
  renderPagination(Math.ceil(stations.length / PAGE_SIZE), page);
}

function renderPagination(totalPages, current){
  const p = document.getElementById('pagination');
  if (!p) return;
  p.innerHTML = '';
  if (totalPages <= 1) return;
  const prev = document.createElement('button'); prev.className='btn-ghost'; prev.textContent='‹'; prev.disabled = current === 0;
  prev.addEventListener('click', ()=>{ currentPage = Math.max(0, currentPage-1); renderStationsList(filteredStations(), currentPage); });
  p.appendChild(prev);
  const info = document.createElement('div'); info.className='muted'; info.textContent = `Pagina ${current+1} di ${totalPages}`; p.appendChild(info);
  const next = document.createElement('button'); next.className='btn-ghost'; next.textContent='›'; next.disabled = current >= totalPages-1;
  next.addEventListener('click', ()=>{ currentPage = Math.min(totalPages-1, currentPage+1); renderStationsList(filteredStations(), currentPage); });
  p.appendChild(next);
}

/* ---------- Apply filters (UI + markers) ---------- */
async function applyFiltersUI(){
  const filtered = filteredStations();
  currentPage = 0;
  // render markers for filtered subset (but limit to reasonable number to avoid overload)
  const toRender = filtered.slice(0, 2000);
  await bulkRenderStations(toRender);
  renderStationsList(filtered, currentPage);
}

/* ---------- Geolocation & reverse geocode ---------- */
async function onNearMe(){
  if (!navigator.geolocation){ showToast('Geolocalizzazione non supportata'); return; }
  setLoading(true);
  navigator.geolocation.getCurrentPosition(async pos=>{
    try {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      map.flyTo([lat, lon], 13, { duration: 0.8 });
      const info = await reverseGeocode(lat, lon);
      const label = (info && info.label) ? info.label : 'Posizione corrente';
      document.getElementById('cityInput').value = label;
      document.getElementById('locationLabel').textContent = label;
      document.getElementById('locationBadge').style.display = 'flex';
      const radius = Number(document.getElementById('radius').value) || 10;
      const data = await fetchNearCached(lat, lon, radius, 300);
      currentStations = Array.isArray(data) ? data : [];
      currentPage = 0;
      if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat:lat, centerLon:lon, fuel:getActiveFuel(), quick:'', sort:document.getElementById('sortPrice').value } });
      else { await bulkRenderStations(currentStations); applyFiltersUI(); }
    } catch (err) { console.error(err); setError('Errore posizione'); } finally { setLoading(false); }
  }, err=>{ setLoading(false); showToast('Permesso geolocalizzazione negato o errore'); }, { timeout:12000, maximumAge:60000 });
}
async function reverseGeocode(lat, lon){
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=it`;
    const res = await fetch(url, { headers:{ 'User-Agent':'PrezziCarburantiApp/1.0' }});
    if (!res.ok) return null;
    const j = await res.json();
    const addr = j.address||{};
    const place = addr.town || addr.village || addr.city || j.name || null;
    return { label: place };
  } catch { return null; }
}

/* ---------- Station detail / navigation ---------- */
function showStationDetail(st){
  // lightweight detail: toast + flyTo; can be extended to side panel
  if (!st) return;
  if (st.lat && st.lon && map) map.flyTo([st.lat, st.lon], 16, { duration: 0.6 });
  showToast(`${st.nome} — ${st.carburante || ''} — ${st.prezzo != null ? '€ ' + Number(st.prezzo).toFixed(3) : '—'}`, { duration: 3000 });
}
function openMaps(lat, lon){
  if (!lat || !lon) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat + ',' + lon)}`;
  window.open(url, '_blank');
}

/* ---------- City autocomplete ---------- */
function initCityAutocomplete(){
  const input = document.getElementById('cityInput');
  const suggestions = document.getElementById('suggestions');
  if (!input || !suggestions) return;
  const cache = {};
  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (!q || q.length < 2) { suggestions.innerHTML=''; suggestions.setAttribute('aria-hidden','true'); return; }
    if (cache[q]) return renderSuggestions(cache[q]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q + ', Italia')}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'PrezziCarburantiApp/1.0' }});
      if (!res.ok) throw new Error('Nominatim error');
      const items = await res.json();
      cache[q] = items;
      renderSuggestions(items);
    } catch (e) { suggestions.innerHTML=''; suggestions.setAttribute('aria-hidden','true'); }
  }, 140));

  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); document.getElementById('searchCityBtn').click(); } });

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
        document.getElementById('searchCityBtn').click();
      });
      suggestions.appendChild(btn);
    });
    suggestions.setAttribute('aria-hidden','false');
  }
}

/* ---------- Filter worker integration ---------- */
function initFilterWorker(){
  try {
    filterWorker = new Worker('worker-filter.js');
    filterWorker.onmessage = (ev) => {
      if (ev.data && ev.data.cmd === 'filtered'){
        const filtered = ev.data.data || [];
        currentStations = filtered;
        bulkRenderStations(filtered.slice(0, 2000)).then(()=> renderStationsList(filtered));
      }
    };
    filterWorker.onerror = (e) => { console.warn('Filter worker error', e); filterWorker = null; };
  } catch (e){ console.warn('Worker non disponibile', e); filterWorker = null; }
}

/* ---------- Events and UI wiring ---------- */
function initEvents(){
  document.getElementById('searchCityBtn')?.addEventListener('click', onSearchCity);
  document.getElementById('nearMeBtn')?.addEventListener('click', onNearMe);
  document.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{
      document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      ch.classList.add('active');
      if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat: map?.getCenter().lat || 0, centerLon: map?.getCenter().lng || 0, fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value } });
      else applyFiltersUI();
    });
  });
  document.getElementById('quickFilter')?.addEventListener('input', debounce(()=> {
    if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat: map?.getCenter().lat || 0, centerLon: map?.getCenter().lng || 0, fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value } });
    else applyFiltersUI();
  }, 180));
  document.getElementById('sortPrice')?.addEventListener('change', ()=> {
    if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat: map?.getCenter().lat || 0, centerLon: map?.getCenter().lng || 0, fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value } });
    else applyFiltersUI();
  });
  document.getElementById('radius')?.addEventListener('input', e=> {
    document.getElementById('radiusValue').textContent = `${e.target.value} km`;
    document.getElementById('radiusNumber').value = e.target.value;
  });
  document.getElementById('radiusNumber')?.addEventListener('input', e=> {
    const v = Math.max(1, Math.min(50, Number(e.target.value) || 10));
    document.getElementById('radius').value = v;
    document.getElementById('radiusValue').textContent = `${v} km`;
  });
  document.getElementById('clearLocationBtn')?.addEventListener('click', ()=>{ document.getElementById('locationBadge').style.display='none'; document.getElementById('cityInput').value=''; currentStations=[]; applyFiltersUI(); });
  document.getElementById('openFilters')?.addEventListener('click', ()=> toggleFilters(true));
  document.getElementById('panelOverlay')?.addEventListener('click', ()=> toggleFilters(false));
  document.getElementById('themeToggle')?.addEventListener('click', ()=> {
    const isLight = document.documentElement.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    document.getElementById('themeToggle').setAttribute('aria-pressed', String(isLight));
  });
  document.getElementById('btn-refresh')?.addEventListener('click', ()=> {
    if (map) onMapMoveThrottled();
  });
}

/* ---------- Filters panel toggle ---------- */
function toggleFilters(open){
  const panel = document.getElementById('panelFilters');
  const overlay = document.getElementById('panelOverlay');
  if (!panel || !overlay) return;
  if (open){
    panel.classList.remove('hidden'); panel.setAttribute('aria-hidden','false');
    overlay.classList.add('show'); overlay.hidden = false;
    document.getElementById('openFilters')?.setAttribute('aria-expanded','true');
    // focus first input for accessibility
    setTimeout(()=> document.getElementById('cityInput')?.focus(), 120);
  } else {
    panel.classList.add('hidden'); panel.setAttribute('aria-hidden','true');
    overlay.classList.remove('show'); overlay.hidden = true;
    document.getElementById('openFilters')?.setAttribute('aria-expanded','false');
  }
}

/* ---------- Search city handler ---------- */
async function onSearchCity(){
  const raw = document.getElementById('cityInput')?.value || '';
  if(!raw.trim()) return;
  setLoading(true);
  try {
    const radius = Number(document.getElementById('radius').value) || 10;
    const res = await fetch(`${API_BASE}/city/${encodeURIComponent(raw)}?radius=${radius}`);
    if (!res.ok) throw new Error('City API error');
    const data = await res.json();
    currentStations = Array.isArray(data) ? data : [];
    currentPage = 0;
    if (currentStations.length && currentStations[0].lat && currentStations[0].lon && map){
      map.flyTo([currentStations[0].lat, currentStations[0].lon], 12, { duration: 0.8 });
    }
    if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat: currentStations[0]?.lat || map?.getCenter().lat || 0, centerLon: currentStations[0]?.lon || map?.getCenter().lng || 0, fuel:getActiveFuel(), quick:'', sort:document.getElementById('sortPrice').value } });
    else { await bulkRenderStations(currentStations); applyFiltersUI(); }
  } catch (err) { console.error(err); setError('Ricerca fallita'); } finally { setLoading(false); }
}

/* ---------- Init map and app ---------- */
function initMap(){
  map = L.map('map', { preferCanvas: true, zoomControl:true }).setView([44.8015, 10.3280], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap' }).addTo(map);
  markerCluster = L.markerClusterGroup({ chunkedLoading:true, maxClusterRadius:50 });
  map.addLayer(markerCluster);
  map.on('moveend', onMapMoveThrottled);
}

function initApp(){
  if (localStorage.getItem('theme') === 'light') document.documentElement.classList.add('light');
  initFilterWorker();
  initMap();
  initEvents();
  initCityAutocomplete();
  (async ()=>{ setLoading(true); try { const data = await fetchNearCached(44.8015, 10.3280, 10, 200); currentStations = Array.isArray(data) ? data : []; await bulkRenderStations(currentStations); renderStationsList(currentStations); } catch(e){ console.warn(e); } finally{ setLoading(false); } })();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(()=>{});
}

/* ---------- Expose helpers for templates / debug ---------- */
window.openMaps = openMaps;
window.showStationDetail = showStationDetail;
window.addEventListener('DOMContentLoaded', initApp);
