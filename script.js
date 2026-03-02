/* App principale: mappa, API, UI, filtri, tema, service worker registration */

/* CONFIG */
const API_BASE = "https://benzinaprezzidiesel.christianritucci04.workers.dev/api";
const DEFAULT_RADIUS = 10;
const MAP_DEFAULT = { lat: 44.8015, lon: 10.3280, zoom: 12 }; // Parma center as fallback

/* STATO */
let map, markers = [], currentStations = [];

/* UTIL: fetch JSON with timeout */
async function fetchJson(url, opts = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    return await res.json();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/* MAP */
function initMap(lat = MAP_DEFAULT.lat, lon = MAP_DEFAULT.lon, zoom = MAP_DEFAULT.zoom) {
  if (!map) {
    map = L.map('map', { zoomControl: true }).setView([lat, lon], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
  } else {
    map.setView([lat, lon], zoom);
  }
}

function clearMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
}

function addMarker(station) {
  if (!station.lat || !station.lon) return;
  const m = L.marker([station.lat, station.lon], { riseOnHover: true });
  const price = station.prezzo != null ? `€ ${station.prezzo.toFixed(3)}` : "—";
  const popup = `
    <div style="min-width:180px">
      <strong>${escapeHtml(station.nome)}</strong><br/>
      <small class="meta">${escapeHtml(station.indirizzo || "")} — ${escapeHtml(station.comune || "")}</small>
      <div style="margin-top:8px"><strong>${escapeHtml(station.carburante)}</strong>: <span style="color:var(--accent)">${price}</span></div>
      <div style="margin-top:8px"><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${station.lat},${station.lon}">Apri in Maps</a></div>
    </div>
  `;
  m.bindPopup(popup);
  m.addTo(map);
  markers.push(m);
}

/* ESCAPE HTML */
function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* API wrappers */
async function apiCity(city, radius = DEFAULT_RADIUS) {
  const q = encodeURIComponent(city.trim());
  return fetchJson(`${API_BASE}/city/${q}?radius=${radius}`);
}
async function apiNear(lat, lon, radius = DEFAULT_RADIUS) {
  return fetchJson(`${API_BASE}/near?lat=${lat}&lon=${lon}&radius=${radius}`);
}

/* RENDER */
function renderStations(list) {
  const container = document.getElementById('results');
  container.innerHTML = "";
  if (!list || list.length === 0) {
    container.innerHTML = `<div class="station fade-in"><p class="meta">Nessun distributore trovato.</p></div>`;
    clearMarkers();
    return;
  }

  clearMarkers();
  list.forEach(s => addMarker(s));

  // center map on first result
  if (list[0] && list[0].lat && list[0].lon) {
    map.flyTo([list[0].lat, list[0].lon], 13, { duration: 0.8 });
  }

  // cards
  list.forEach(s => {
    const card = document.createElement('article');
    card.className = 'station fade-in';
    const price = s.prezzo != null ? `€ ${s.prezzo.toFixed(3)}` : "—";
    card.innerHTML = `
      <h3>${escapeHtml(s.nome)}</h3>
      <div class="meta">${escapeHtml(s.indirizzo || "")} — ${escapeHtml(s.comune || "")}</div>
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
}

/* Helpers: filter & sort */
function filterByFuel(list, fuel) {
  if (!fuel) return list;
  return list.filter(s => (s.carburante || "").toLowerCase() === fuel.toLowerCase());
}
function sortList(list, mode) {
  if (!mode) return list;
  if (mode === 'price-asc') return list.slice().sort((a,b)=> (a.prezzo||Infinity) - (b.prezzo||Infinity));
  if (mode === 'price-desc') return list.slice().sort((a,b)=> (b.prezzo||-Infinity) - (a.prezzo||-Infinity));
  return list;
}

/* UI actions */
async function onSearchCity() {
  const raw = document.getElementById('cityInput').value;
  if (!raw.trim()) return;
  setLoading(true);
  try {
    const radius = Number(document.getElementById('radius').value) || DEFAULT_RADIUS;
    const data = await apiCity(raw, radius);
    currentStations = data || [];
    applyFiltersAndRender();
  } catch (err) {
    showError(err);
  } finally { setLoading(false); }
}

async function onNearMe() {
  if (!navigator.geolocation) { alert("Geolocalizzazione non supportata"); return; }
  setLoading(true);
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      initMap(lat, lon, 13);
      const radius = Number(document.getElementById('radius').value) || DEFAULT_RADIUS;
      const data = await apiNear(lat, lon, radius);
      currentStations = data || [];
      applyFiltersAndRender();
    } catch (err) { showError(err); }
    finally { setLoading(false); }
  }, err => { setLoading(false); alert("Permesso geolocalizzazione negato o errore"); }, { timeout: 10000 });
}

function applyFiltersAndRender() {
  const fuel = document.getElementById('fuelFilter').value;
  const sort = document.getElementById('sortPrice').value;
  let list = filterByFuel(currentStations, fuel);
  list = sortList(list, sort);
  renderStations(list);
}

/* UI small helpers */
function setLoading(on) {
  const results = document.getElementById('results');
  if (on) results.innerHTML = `<div class="station"><p class="meta">Caricamento…</p></div>`;
}
function showError(err) {
  const results = document.getElementById('results');
  results.innerHTML = `<div class="station"><p class="meta">Errore: ${escapeHtml(String(err.message || err))}</p></div>`;
}
function openMaps(lat, lon) {
  window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank');
}

/* Theme toggle */
function initTheme() {
  const btn = document.getElementById('themeToggle');
  const saved = localStorage.getItem('theme') || 'auto';
  if (saved === 'dark') document.body.classList.add('dark');
  btn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });
}

/* Radius UI */
function initRadius() {
  const r = document.getElementById('radius');
  const v = document.getElementById('radiusValue');
  r.addEventListener('input', () => v.textContent = r.value);
  v.textContent = r.value;
}

/* Panel toggle */
function initPanelToggle() {
  const btn = document.getElementById('openFilters');
  const panel = document.getElementById('panelFilters');
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    panel.style.display = expanded ? '' : 'block';
  });
}

/* Event wiring */
function initEvents() {
  document.getElementById('searchCityBtn').addEventListener('click', onSearchCity);
  document.getElementById('nearMeBtn').addEventListener('click', onNearMe);
  document.getElementById('fuelFilter').addEventListener('change', applyFiltersAndRender);
  document.getElementById('sortPrice').addEventListener('change', applyFiltersAndRender);
}

/* Init app */
async function initApp() {
  initMap();
  initTheme();
  initRadius();
  initPanelToggle();
  initEvents();

  // Try to load default city (Parma) on start
  try {
    setLoading(true);
    const data = await apiCity('Parma', DEFAULT_RADIUS);
    currentStations = data || [];
    applyFiltersAndRender();
  } catch (e) {
    // ignore initial error
  } finally { setLoading(false); }

  // register service worker if available
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(()=>{/* ignore */});
  }
}

/* Start */
window.addEventListener('load', initApp);
