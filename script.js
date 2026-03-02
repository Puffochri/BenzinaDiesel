const API_URL = "https://carburanti.madbob.org";

const cityInput = document.getElementById("citySelect");
const searchByCityBtn = document.getElementById("searchByCityBtn");
const useLocationBtn = document.getElementById("useLocationBtn");
const fuelTypeSelect = document.getElementById("fuelType");
const sortBySelect = document.getElementById("sortBy");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

let lastStations = [];
let lastUserPosition = null;

function setStatus(msg, error = false) {
  statusEl.textContent = msg;
  statusEl.style.color = error ? "red" : "#666";
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) *
    Math.cos(lat2*Math.PI/180) *
    Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function renderStations(list) {
  resultsEl.innerHTML = "";

  list.forEach(s => {
    const card = document.createElement("div");
    card.className = "station-card";

    card.innerHTML = `
      <div class="station-header">
        <div class="station-name">${s.name}</div>
        <div class="station-distance">${s.distance ? s.distance.toFixed(2) + " km" : ""}</div>
      </div>
      <div class="station-address">${s.address}</div>
      <div class="station-prices">
        ${s.benzina ? `<div class="price-pill">Benzina: <b>${s.benzina} €/L</b></div>` : ""}
        ${s.gasolio ? `<div class="price-pill">Diesel: <b>${s.gasolio} €/L</b></div>` : ""}
      </div>
    `;

    resultsEl.appendChild(card);
  });
}

function applyFilters() {
  let list = [...lastStations];
  const fuel = fuelTypeSelect.value;
  const sort = sortBySelect.value;

  if (fuel === "benzina") list = list.filter(s => s.benzina);
  if (fuel === "diesel") list = list.filter(s => s.gasolio);

  list.sort((a, b) => {
    if (sort === "price") {
      const pa = Math.min(a.benzina || 999, a.gasolio || 999);
      const pb = Math.min(b.benzina || 999, b.gasolio || 999);
      return pa - pb;
    }
    return (a.distance || 999) - (b.distance || 999);
  });

  renderStations(list);
}

async function fetchByCity(city) {
  setStatus("Cerco distributori...");
  const url = `${API_URL}/comune/${encodeURIComponent(city)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    lastStations = data.map(s => ({
      name: s.nome,
      address: s.indirizzo,
      lat: s.lat,
      lon: s.lng,
      benzina: s.prezzo_benzina,
      gasolio: s.prezzo_gasolio,
      distance: lastUserPosition ? distanceKm(lastUserPosition.lat, lastUserPosition.lon, s.lat, s.lng) : null
    }));

    setStatus(`Trovati ${lastStations.length} distributori.`);
    applyFilters();
  } catch (e) {
    setStatus("Errore nel recupero dati.", true);
  }
}

async function fetchByPosition(lat, lon) {
  setStatus("Cerco distributori vicino a te...");
  const url = `${API_URL}/points/${lat}/${lon}/5`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    lastStations = data.map(s => ({
      name: s.nome,
      address: s.indirizzo,
      lat: s.lat,
      lon: s.lng,
      benzina: s.prezzo_benzina,
      gasolio: s.prezzo_gasolio,
      distance: distanceKm(lat, lon, s.lat, s.lng)
    }));

    setStatus(`Trovati ${lastStations.length} distributori.`);
    applyFilters();
  } catch (e) {
    setStatus("Errore nel recupero dati.", true);
  }
}

searchByCityBtn.addEventListener("click", () => {
  const city = cityInput.value.trim();
  if (!city) return setStatus("Inserisci una città.", true);
  lastUserPosition = null;
  fetchByCity(city);
});

useLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Geolocalizzazione non supportata.", true);

  setStatus("Ottengo la tua posizione...");
  navigator.geolocation.getCurrentPosition(pos => {
    lastUserPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    fetchByPosition(pos.coords.latitude, pos.coords.longitude);
  }, () => {
    setStatus("Permesso negato o errore GPS.", true);
  });
});

fuelTypeSelect.addEventListener("change", applyFilters);
sortBySelect.addEventListener("change", applyFilters);
