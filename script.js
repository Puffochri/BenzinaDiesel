const API_BASE = "https://benzinaprezzidiesel.christianritucci04.workers.dev/api";

let map;
let markers = [];

function initMap(lat = 44.76, lon = 10.33) {
  if (!map) {
    map = L.map('map').setView([lat, lon], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
  } else {
    map.setView([lat, lon], 12);
  }
}

function clearMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
}

function addMarker(station) {
  const marker = L.marker([station.lat, station.lon]).addTo(map);
  marker.bindPopup(`
    <b>${station.nome}</b><br>
    ${station.indirizzo}<br>
    ${station.carburante}: € ${station.prezzo}<br>
    <a href="https://www.google.com/maps?q=${station.lat},${station.lon}" target="_blank">Naviga</a>
  `);
  markers.push(marker);
}

async function apiCity(city) {
  const res = await fetch(`${API_BASE}/city/${encodeURIComponent(city)}`);
  return res.json();
}

async function apiNear(lat, lon, radius = 5) {
  const res = await fetch(`${API_BASE}/near?lat=${lat}&lon=${lon}&radius=${radius}`);
  return res.json();
}

function renderStations(list) {
  const container = document.getElementById("results");
  container.innerHTML = "";

  if (!list || list.length === 0) {
    container.innerHTML = "<p>Nessun distributore trovato.</p>";
    return;
  }

  clearMarkers();

  list.forEach(s => {
    addMarker(s);

    const div = document.createElement("div");
    div.className = "station";

    div.innerHTML = `
      <h3>${s.nome}</h3>
      <p>${s.indirizzo} – ${s.comune}</p>
      <p><strong>${s.carburante}</strong>: € ${s.prezzo}</p>
      <p>Distanza: ${s.distanza.toFixed(2)} km</p>
      <button onclick="openMaps(${s.lat}, ${s.lon})">Naviga</button>
    `;

    container.appendChild(div);
  });
}

function openMaps(lat, lon) {
  window.open(`https://www.google.com/maps?q=${lat},${lon}`, "_blank");
}

function filterStations(list, fuel) {
  if (!fuel) return list;
  return list.filter(s => s.carburante === fuel);
}

function sortStations(list, mode) {
  if (mode === "asc") return list.sort((a, b) => a.prezzo - b.prezzo);
  if (mode === "desc") return list.sort((a, b) => b.prezzo - a.prezzo);
  return list;
}

document.getElementById("searchCityBtn").addEventListener("click", async () => {
  const city = document.getElementById("cityInput").value.trim();
  if (!city) return;

  const data = await apiCity(city);
  const fuel = document.getElementById("fuelFilter").value;
  const sort = document.getElementById("sortPrice").value;

  let filtered = filterStations(data, fuel);
  filtered = sortStations(filtered, sort);

  if (filtered.length > 0) {
    initMap(filtered[0].lat, filtered[0].lon);
  }

  renderStations(filtered);
});

document.getElementById("nearMeBtn").addEventListener("click", () => {
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    initMap(lat, lon);

    const data = await apiNear(lat, lon, 5);
    const fuel = document.getElementById("fuelFilter").value;
    const sort = document.getElementById("sortPrice").value;

    let filtered = filterStations(data, fuel);
    filtered = sortStations(filtered, sort);

    renderStations(filtered);
  });
});

document.getElementById("themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
});
