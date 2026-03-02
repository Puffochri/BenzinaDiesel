/* script.js — client ottimizzato: throttle, cache, canvas markers, chunked render, worker filter integration */

const API_BASE = 'https://<YOUR_WORKER_DOMAIN>/api';
const CLIENT_CACHE_TTL = 1000 * 60 * 5;
const clientCache = new Map();
let map, markerCluster, currentStations = [], filterWorker = null;
const PAGE_SIZE = 12;

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cacheKey(lat, lon, radius, limit=150){ return `${lat.toFixed(3)}:${lon.toFixed(3)}:r${Math.round(radius)}:l${limit}`; }
function setLoading(on){ const r=document.getElementById('results'); if (on) r.innerHTML = Array.from({length:6}).map(()=>`<div class="station skeleton"></div>`).join(''); }

async function fetchNearCached(lat, lon, radius, limit=200){
  const key = cacheKey(lat, lon, radius, limit);
  const now = Date.now();
  const cached = clientCache.get(key);
  if (cached && (now - cached.ts) < CLIENT_CACHE_TTL){
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

function fuelColor(fuel){
  if (!fuel) return '#9aa4b2';
  const f = fuel.toLowerCase();
  if (f.includes('benzina')) return '#ff6b6b';
  if (f.includes('gasolio')) return '#00d4ff';
  if (f.includes('gpl')) return '#f59e0b';
  return '#8b8f98';
}
function createCanvasMarker(st){
  if (!st.lat || !st.lon) return null;
  const color = fuelColor(st.carburante);
  const circle = L.circleMarker([st.lat, st.lon], {
    radius: 7, fillColor: color, color: '#111', weight: 0.6, opacity: 0.95, fillOpacity: 0.95, renderer: L.canvas()
  });
  circle.bindTooltip(`<strong>${escapeHtml(st.nome)}</strong><br/><small>${escapeHtml(st.indirizzo||'')}</small>`, { direction:'top' });
  circle.on('click', ()=> showStationDetail(st));
  return circle;
}
async function bulkRenderStations(stations){
  markerCluster.clearLayers();
  const CHUNK = 200;
  for (let i=0;i<stations.length;i+=CHUNK){
    const slice = stations.slice(i, i+CHUNK);
    const layers = slice.map(s => createCanvasMarker(s)).filter(Boolean);
    markerCluster.addLayers(layers);
    await new Promise(r => requestAnimationFrame(r));
  }
}

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

const onMapMoveThrottled = throttle(async () => {
  if (!map) return;
  const center = map.getCenter();
  const radius = computeRadiusFromView(map);
  try {
    setLoading(true);
    const data = await fetchNearCached(center.lat, center.lng, radius, 300);
    currentStations = data;
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

function renderStationsList(stations){
  const container = document.getElementById('results');
  container.innerHTML = '';
  if (!stations || stations.length === 0){ container.innerHTML = `<div class="station"><p class="meta">Nessun distributore trovato.</p></div>`; markerCluster.clearLayers(); return; }
  const pageItems = stations.slice(0, PAGE_SIZE);
  pageItems.forEach((s, idx) => {
    const card = document.createElement('article'); card.className='station visible';
    const price = s.prezzo!=null?`€ ${s.prezzo.toFixed(3)}`:'—';
    card.innerHTML = `<div><h3>${escapeHtml(s.nome)}</h3><div class="meta">${escapeHtml(s.indirizzo||'')} — ${escapeHtml(s.comune||'')}</div></div><div class="actions"><div class="price">${price}</div><div class="meta">${s.distanza!=null? s.distanza.toFixed(2)+' km':''}</div><div style="margin-top:8px"><button onclick="openMaps(${s.lat},${s.lon})">Naviga</button></div></div>`;
    container.appendChild(card);
  });
}

function getActiveFuel(){ const a=document.querySelector('.chip.active'); return a? a.dataset.fuel : ''; }
function applyFiltersUI(){ renderStationsList(currentStations); }

async function onNearMe(){
  if (!navigator.geolocation){ alert('Geolocalizzazione non supportata'); return; }
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
      currentStations = data;
      if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat:lat, centerLon:lon, fuel:getActiveFuel(), quick:'', sort:document.getElementById('sortPrice').value } });
      else { await bulkRenderStations(currentStations); applyFiltersUI(); }
    } catch (err) { console.error(err); setError('Errore posizione'); } finally { setLoading(false); }
  }, err=>{ setLoading(false); alert('Permesso geolocalizzazione negato o errore'); }, { timeout:12000, maximumAge:60000 });
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

function showStationDetail(st){ /* implementa pannello laterale o popup avanzato */ }
function openMaps(lat, lon){ window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank'); }
function setError(msg){ document.getElementById('results').innerHTML = `<div class="station"><p class="meta">Errore: ${escapeHtml(msg)}</p></div>`; markerCluster.clearLayers(); }

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

function debounce(fn, wait=220){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }

function initFilterWorker(){
  try {
    filterWorker = new Worker('worker-filter.js');
    filterWorker.onmessage = (ev) => {
      if (ev.data.cmd === 'filtered'){
        const filtered = ev.data.data;
        currentStations = filtered;
        bulkRenderStations(filtered).then(()=> renderStationsList(filtered));
      }
    };
  } catch (e){ console.warn('Worker non disponibile', e); filterWorker = null; }
}

function initEvents(){
  document.getElementById('searchCityBtn').addEventListener('click', onSearchCity);
  document.getElementById('nearMeBtn').addEventListener('click', onNearMe);
  document.querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click', ()=>{
    document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active')); ch.classList.add('active');
    if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat: map.getCenter().lat, centerLon: map.getCenter().lng, fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value } });
    else applyFiltersUI();
  }));
  document.getElementById('quickFilter').addEventListener('input', debounce(()=> {
    if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat: map.getCenter().lat, centerLon: map.getCenter().lng, fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value } });
    else applyFiltersUI();
  }, 180));
  document.getElementById('sortPrice').addEventListener('change', ()=> {
    if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat: map.getCenter().lat, centerLon: map.getCenter().lng, fuel:getActiveFuel(), quick:document.getElementById('quickFilter').value, sort:document.getElementById('sortPrice').value } });
    else applyFiltersUI();
  });
  document.getElementById('radius').addEventListener('input', e=> {
    document.getElementById('radiusValue').textContent = `${e.target.value} km`;
    document.getElementById('radiusNumber').value = e.target.value;
  });
  document.getElementById('radiusNumber').addEventListener('input', e=> {
    const v = Math.max(1, Math.min(50, Number(e.target.value) || 10));
    document.getElementById('radius').value = v;
    document.getElementById('radiusValue').textContent = `${v} km`;
  });
  document.getElementById('clearLocationBtn').addEventListener('click', ()=>{ document.getElementById('locationBadge').style.display='none'; document.getElementById('cityInput').value=''; currentStations=[]; applyFiltersUI(); });
  document.getElementById('openFilters').addEventListener('click', ()=> toggleFilters(true));
  document.getElementById('panelOverlay').addEventListener('click', ()=> toggleFilters(false));
  document.getElementById('themeToggle').addEventListener('click', ()=> {
    const isLight = document.documentElement.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    document.getElementById('themeToggle').setAttribute('aria-pressed', String(isLight));
  });
}

function toggleFilters(open){
  const panel = document.getElementById('panelFilters');
  const overlay = document.getElementById('panelOverlay');
  if (open){
    panel.classList.remove('hidden'); panel.setAttribute('aria-hidden','false');
    overlay.classList.add('show'); overlay.hidden = false;
    document.getElementById('openFilters').setAttribute('aria-expanded','true');
  } else {
    panel.classList.add('hidden'); panel.setAttribute('aria-hidden','true');
    overlay.classList.remove('show'); overlay.hidden = true;
    document.getElementById('openFilters').setAttribute('aria-expanded','false');
  }
}

async function onSearchCity(){
  const raw = document.getElementById('cityInput').value; if(!raw.trim()) return;
  setLoading(true);
  try {
    const radius = Number(document.getElementById('radius').value) || 10;
    const data = await fetch(`${API_BASE}/city/${encodeURIComponent(raw)}?radius=${radius}`).then(r=>r.json());
    currentStations = data;
    if (filterWorker) filterWorker.postMessage({ cmd:'filter', stations: currentStations, filters: { centerLat: data[0]?.lat || map.getCenter().lat, centerLon: data[0]?.lon || map.getCenter().lng, fuel:getActiveFuel(), quick:'', sort:document.getElementById('sortPrice').value } });
    else { await bulkRenderStations(currentStations); applyFiltersUI(); if (data[0] && data[0].lat) map.flyTo([data[0].lat, data[0].lon], 12); }
  } catch (err) { console.error(err); setError('Ricerca fallita'); } finally { setLoading(false); }
}

function initApp(){
  if (localStorage.getItem('theme') === 'light') document.documentElement.classList.add('light');
  initFilterWorker();
  initMap();
  initEvents();
  initCityAutocomplete();
  (async ()=>{ setLoading(true); try { const data = await fetchNearCached(44.8015, 10.3280, 10, 200); currentStations = data; await bulkRenderStations(data); renderStationsList(data); } catch{} finally{ setLoading(false); } })();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(()=>{});
}

function initMap(){
  map = L.map('map', { preferCanvas: true, zoomControl:true }).setView([44.8015, 10.3280], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap' }).addTo(map);
  markerCluster = L.markerClusterGroup({ chunkedLoading:true, maxClusterRadius:50 });
  map.addLayer(markerCluster);
  map.on('moveend', onMapMoveThrottled);
}

window.openMaps = openMaps;
window.addEventListener('DOMContentLoaded', initApp);
