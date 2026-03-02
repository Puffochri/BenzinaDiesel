/* App avanzata: UI, map, clustering, filtri, debounce, pagination, theme, SW reg. */

/* CONFIG */
const API_BASE = "https://benzinaprezzidiesel.christianrituuci04.workers.dev/api".replace('benzinaprezzidiesel.christianrituuci04','benzinaprezzidiesel.christianritucci04'); // fallback safe
const DEFAULT_RADIUS = 10;
const PAGE_SIZE = 12;
const MAP_DEFAULT = { lat: 44.8015, lon: 10.3280, zoom: 12 };

/* STATE */
let map, markerCluster, markers = [], currentStations = [], filteredStations = [];
let currentPage = 1;

/* UTIL: debounce */
function debounce(fn, wait=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }

/* SAFE fetch JSON */
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

/* MAP init + clustering */
function initMap(lat=MAP_DEFAULT.lat, lon=MAP_DEFAULT.lon, zoom=MAP_DEFAULT.zoom){
  if (!map){
    map = L.map('map', { zoomControl: true }).setView([lat, lon], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    markerCluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
    map.addLayer(markerCluster);
  } else {
    map.setView([lat, lon], zoom);
  }
}

/* Clear markers */
function clearMarkers(){
  markerCluster.clearLayers();
  markers = [];
}

/* Add marker with rich popup */
function addMarker(st){
  if (!st.lat || !st.lon) return;
  const price = st.prezzo != null ? `€ ${st.prezzo.toFixed(3)}` : '—';
  const html = `
    <div style="min-width:200px">
      <strong>${escapeHtml(st.nome)}</strong><br/>
      <small class="meta">${escapeHtml(st.indirizzo || '')} — ${escapeHtml(st.comune || '')}</small>
      <div style="margin-top:8px"><strong>${escapeHtml(st.carburante)}</strong>: <span style="color:var(--accent)">${price}</span></div>
      <div style="margin-top:8px"><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${st.lat},${st.lon}">Apri in Maps</a></div>
    </div>
  `;
  const m = L.marker([st.lat, st.lon], { riseOnHover: true }).bindPopup(html);
  markerCluster.addLayer(m);
  markers.push(m);
}

/* Escape HTML */
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* API wrappers */
async function apiCity(city, radius=DEFAULT_RADIUS){
  const q = encodeURIComponent(city.trim());
  return fetchJson(`${API_BASE}/city/${q}?radius=${radius}`);
}
async function apiNear(lat, lon, radius=DEFAULT_RADIUS){
  return fetchJson(`${API_BASE}/near?lat=${lat}&lon=${lon}&radius=${radius}`);
}

/* Render list with pagination */
function renderStationsPage(page=1){
  const container = document.getElementById('results');
  container.innerHTML = '';
  if (!filteredStations || filteredStations.length === 0){
    container.innerHTML = `<div class="station fade-in"><p class="meta">Nessun distributore trovato.</p></div>`;
    clearMarkers();
    return;
  }

  currentPage = page;
  const start = (page-1)*PAGE_SIZE;
  const pageItems = filteredStations.slice(start, start+PAGE_SIZE);

  clearMarkers();
  pageItems.forEach(s => addMarker(s));
  if (pageItems[0] && pageItems[0].lat && pageItems[0].lon) map.flyTo([pageItems[0].lat, pageItems[0].lon], 13, { duration: 0.7 });

  pageItems.forEach(s => {
    const card = document.createElement('article');
    card.className = 'station fade-in';
    const price = s.prezzo != null ? `€ ${s.prezzo.toFixed(3)}` : '—';
    card.innerHTML = `
      <h3>${escapeHtml(s.nome)}</h3>
      <div class="meta">${escapeHtml(s.indirizzo || '')} — ${escapeHtml(s.comune || '')}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div>
          <div class="price">${price}</div>
          <div class="meta">Carburante: ${escapeHtml(s.carburante)}</div>
        </div>
        <div style="text-align:right">
          <div class="meta">${s.distanza != null ? s.distanza.toFixed(2) + ' km' : ''}</div>
          <div style="margin-top:8px">
            <button onclick="openMaps(${s.lat}, ${s.lon})">Naviga</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  renderPagination(Math.ceil(filteredStations.length / PAGE_SIZE), page);
}

/* Pagination UI */
function renderPagination(totalPages, current){
  const p = document.getElementById('pagination');
  p.innerHTML = '';
  if (totalPages <= 1) return;
  const createBtn = (label, page, disabled=false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', ()=>renderStationsPage(page));
    return b;
  };
  p.appendChild(createBtn('«', 1, current===1));
  const start = Math.max(1, current-2);
  const end = Math.min(totalPages, current+2);
  for (let i=start;i<=end;i++){
    const btn = createBtn(i, i, false);
    if (i===current) btn.classList.add('chip','active');
    p.appendChild(btn);
  }
  p.appendChild(createBtn('»', totalPages, current===totalPages));
}

/* Filters & sort */
function applyFilters({ fuel='', quick='' , sort='distance' } = {}){
  let list = currentStations.slice();
  if (fuel) list = list.filter(s => (s.carburante||'').toLowerCase() === fuel.toLowerCase());
  if (quick) {
    const q = quick.toLowerCase();
    list = list.filter(s => (s.nome||'').toLowerCase().includes(q) || (s.indirizzo||'').toLowerCase().includes(q));
  }
  if (sort === 'price-asc') list.sort((a,b)=> (a.prezzo||Infinity) - (b.prezzo||Infinity));
  else if (sort === 'price-desc') list.sort((a,b)=> (b.prezzo||-Infinity) - (a.prezzo||-Infinity));
  else if (sort === 'updated') list.sort((a,b)=> new Date(b.aggiornato) - new Date(a.aggiornato));
  else list.sort((a,b)=> (a.distanza||Infinity) - (b.distanza||Infinity));
  filteredStations = list;
  renderStationsPage(1);
}

/* UI actions */
async function onSearchCity(){
  const raw = document.getElementById('cityInput').value;
  if (!raw.trim()) return;
  setLoading(true);
  try {
    const radius = Number(document.getElementById('radius').value) || DEFAULT_RADIUS;
    const data = await apiCity(raw, radius);
    currentStations = data || [];
    applyFilters({ fuel: getActiveFuel(), quick: document.getElementById('quickFilter').value, sort: document.getElementById('sortPrice').value });
  } catch (err) { showError(err); }
  finally { setLoading(false); }
}

async function onNearMe(){
  if (!navigator.geolocation) { alert('Geolocalizzazione non supportata'); return; }
  setLoading(true);
  navigator.geolocation.getCurrentPosition(async pos=>{
    try {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      initMap(lat, lon, 13);
      const radius = Number(document.getElementById('radius').value) || DEFAULT_RADIUS;
      const data = await apiNear(lat, lon, radius);
      currentStations = data || [];
      applyFilters({ fuel: getActiveFuel(), quick: document.getElementById('quickFilter').value, sort: document.getElementById('sortPrice').value });
    } catch (err) { showError(err); }
    finally { setLoading(false); }
  }, err => { setLoading(false); alert('Permesso geolocalizzazione negato o errore'); }, { timeout: 10000 });
}

/* Helpers */
function setLoading(on){
  const results = document.getElementById('results');
  if (on) {
    results.innerHTML = Array.from({length:6}).map(()=>`<div class="station"><div class="meta">Caricamento…</div></div>`).join('');
    clearMarkers();
  }
}
function showError(err){
  const results = document.getElementById('results');
  results.innerHTML = `<div class="station"><p class="meta">Errore: ${escapeHtml(String(err.message || err))}</p></div>`;
}
function openMaps(lat, lon){ window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank'); }

/* UI helpers */
function getActiveFuel(){
  const active = document.querySelector('.chip.active');
  return active ? active.dataset.fuel : '';
}

/* Init events */
function initEvents(){
  document.getElementById('searchCityBtn').addEventListener('click', onSearchCity);
  document.getElementById('nearMeBtn').addEventListener('click', onNearMe);

  // chips
  document.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{
      document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      ch.classList.add('active');
      applyFilters({ fuel: getActiveFuel(), quick: document.getElementById('quickFilter').value, sort: document.getElementById('sortPrice').value });
    });
  });

  // quick filter debounce
  document.getElementById('quickFilter').addEventListener('input', debounce(()=> {
    applyFilters({ fuel: getActiveFuel(), quick: document.getElementById('quickFilter').value, sort: document.getElementById('sortPrice').value });
  }, 250));

  // sort & radius
  document.getElementById('sortPrice').addEventListener('change', ()=> applyFilters({ fuel: getActiveFuel(), quick: document.getElementById('quickFilter').value, sort: document.getElementById('sortPrice').value }));
  document.getElementById('radius').addEventListener('input', (e)=> document.getElementById('radiusValue').textContent = `${e.target.value} km`);

  // theme toggle
  const themeBtn = document.getElementById('themeToggle');
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.body.classList.add('dark');
  themeBtn.addEventListener('click', ()=>{
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    themeBtn.setAttribute('aria-pressed', String(isDark));
  });

  // panel toggle
  const panelBtn = document.getElementById('openFilters');
  const panel = document.getElementById('panelFilters');
  panelBtn.addEventListener('click', ()=>{
    const expanded = panelBtn.getAttribute('aria-expanded') === 'true';
    panelBtn.setAttribute('aria-expanded', String(!expanded));
    panel.style.display = expanded ? 'none' : 'block';
  });
}

/* Init app */
async function initApp(){
  initMap();
  initEvents();
  // initial load: Parma
  try {
    setLoading(true);
    const data = await apiCity('Parma', DEFAULT_RADIUS);
    currentStations = data || [];
    applyFilters({ fuel: '', quick: '', sort: 'distance' });
  } catch (e) { /* ignore */ } finally { setLoading(false); }
  // register SW
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(()=>{/* ignore */});
}

/* Start */
window.openMaps = openMaps;
window.addEventListener('load', initApp);
