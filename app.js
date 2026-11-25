'use strict';
// Bog Road Walk: offline field map of 844 Bog Road. Boundaries, terrain, GPS, "Easement OK" / "Keep for us" pins,
// geotagged photos, walk tracks and navigation to a pin. Pins live on the phone and move as a .zip via the share sheet.
// Add ?view to the link for the read-only presentation (no marking tools, no location prompt until asked).
(() => {
const APP_VERSION = '2026.11.25d';
const { store, esc, feet } = BW;
const D = window.LAYERS, SH = window.SHARED || { pins: [], photos: [] };
const $ = (s, r = document) => r.querySelector(s);
const VIEW = /(^|[?&#])view\b/.test(location.search.slice(1) + '&' + location.hash.slice(1));
if (VIEW) document.body.classList.add('view');
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const T = {
  in: { label: 'Easement OK', color: '#2fd27a', icon: 'check' },
  out: { label: 'Keep for us', color: '#ff7a1a', icon: 'home' },
  photo: { label: 'Photo', color: '#3d8bff', icon: 'camera' },
};
const PLANS = D.plans;                                   // oldest first; status reads newest first
const ic = (n, cls = 'ic') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const fmtTime = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const swatch = (p) => `<span class="sw" style="background:${p.dash ? `repeating-linear-gradient(90deg,${p.color} 0 7px,transparent 7px 11px)` : p.color}"></span>`;
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}
const who = () => store.get('who', '') || 'Me';

// ---------- UI state ----------
const UI_KEY = VIEW ? 'uiView' : 'ui';                    // the presentation keeps its own settings
const saved = store.get(UI_KEY, {}) || {};
const S = { base: saved.base || 'aerial', show: Object.assign({ sent: true, draft: true, parcel: true, contours: false, wetlands: VIEW, brooks: true,
  lots: true, towers: !VIEW, pins: true, tracks: true, shared: true, names: true }, saved.show) };
const saveUI = () => store.set(UI_KEY, { base: S.base, show: S.show });

// ---------- map ----------
const bounds = L.latLngBounds(D.bounds), wideBounds = L.latLngBounds(D.wide);
const parcelBounds = L.polygon(D.parcel).getBounds();
const map = L.map('map', { zoomControl: false, maxBounds: wideBounds, maxBoundsViscosity: 0.8, minZoom: 13, maxZoom: 21, zoomSnap: 0.25, zoomDelta: 0.5,
  wheelPxPerZoomLevel: 110, bounceAtZoomLimits: false });
map.attributionControl.setPrefix(false);
L.control.scale({ imperial: true, metric: false, position: 'bottomleft', maxWidth: 110 }).addTo(map);
for (const [name, z] of [['wet', 405], ['plans', 410], ['lines', 420], ['tracks', 430], ['labels', 650]]) map.createPane(name).style.zIndex = z;
map.getPane('labels').style.pointerEvents = 'none';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const tiles = (path, o) => L.tileLayer(path, Object.assign({ bounds, errorTileUrl: BLANK, maxZoom: 21, keepBuffer: 4, zIndex: 1 }, o));
// each base = wide context tiles (z13-16, upscaled when zoomed in) under sharp tiles over the property (z17-18)
const base2 = (name, attribution) => L.layerGroup([
  tiles(`tiles/${name}/{z}/{x}/{y}.jpg`, { bounds: wideBounds, minZoom: 13, maxNativeZoom: 16, zIndex: 1, attribution }),
  tiles(`tiles/${name}_hd/{z}/{x}/{y}.jpg`, { minZoom: 16.75, minNativeZoom: 17, maxNativeZoom: 18, zIndex: 2 }),
]);
const BASES = {
  aerial: { name: 'Aerial', note: 'USDA NAIP photo', layer: base2('aerial', 'Imagery USDA NAIP · USGS') },
  terrain: { name: 'Terrain', note: 'LiDAR relief + contours', layer: base2('terrain', 'Terrain USGS 3DEP LiDAR') },
  usgs: { name: 'USGS Topo', note: 'Classic topo map', layer: tiles('tiles/usgstopo/{z}/{x}/{y}.jpg', { bounds: wideBounds, minZoom: 13, maxNativeZoom: 16, attribution: 'USGS The National Map' }) },
};
function tileOf(lat, lon, z) {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
}
const C = parcelBounds.getCenter(); const [tx16, ty16] = tileOf(C.lat, C.lng, 16);
const thumb = (k) => `tiles/${k === 'usgs' ? 'usgstopo' : k}/16/${tx16}/${ty16}.jpg`;

const lbl = (ll, html, cls = '') => L.marker(ll, { pane: 'labels', interactive: false, keyboard: false,
  icon: L.divIcon({ className: 'lbl-anchor', html: `<div class="lbl ${cls}">${html}</div>`, iconSize: [0, 0] }) });
const OV = {};
for (const p of PLANS) {
  OV[p.key] = L.layerGroup([
    L.polygon(p.polys, { pane: 'plans', color: p.color, weight: 3, dashArray: p.dash, fillColor: p.color, fillOpacity: 0.13, interactive: false }),
    lbl(p.label, `<span style="color:${p.color}">${esc(p.short)}</span><small>${p.acres.toFixed(1)} ac</small>`, 'plan'),
  ]);
}
OV.parcel = L.layerGroup([
  L.polygon(D.parcel, { pane: 'lines', color: '#fff', weight: 5.5, opacity: 0.45, fill: false, interactive: false }),
  L.polygon(D.parcel, { pane: 'lines', color: '#ff4d5e', weight: 2.6, fill: false, interactive: false }),
]);
OV.contours = tiles('tiles/contours/{z}/{x}/{y}.png', { minZoom: 14, minNativeZoom: 15, maxNativeZoom: 18, zIndex: 5 });
OV.wetlands = L.layerGroup(D.wetlands.map((w) => L.polygon(w.polys, { pane: 'wet', color: '#56c1ea', weight: 1.2, fillColor: '#56c1ea', fillOpacity: 0.17 })
  .bindPopup(`<b>${esc(w.type)}</b><br>NWI ${esc(w.code)}${w.regime ? ` · ${esc(w.regime)}` : ''}<br><span style="color:#666">USFWS National Wetlands Inventory (mapped from photos, not delineated)</span>`)));
OV.brooks = L.layerGroup(D.brooks.map((l) => L.polyline(l, { pane: 'lines', color: '#5cc8ff', weight: 2.4, opacity: 0.95, interactive: false })));
OV.lots = L.layerGroup([
  ...D.lots.map((l, i) => L.polygon(l.ring, { pane: 'lines', color: i ? '#ff7ad1' : '#4fe3ff', weight: 2, dashArray: '5 4', fillOpacity: 0.05, interactive: false })),
  ...D.lots.map((l) => lbl(L.polygon(l.ring).getBounds().getCenter(), esc(l.name), 'lot')),
  L.polygon(D.house, { pane: 'lines', color: '#fff', weight: 1, fillColor: '#fff', fillOpacity: 0.85, interactive: false }),
  lbl(L.polygon(D.house).getBounds().getCenter(), "Jake's house site", 'lot'),
]);
if (!VIEW) {
  OV.towers = L.layerGroup(D.towers.flatMap(([n, la, lo]) => [
    L.circleMarker([la, lo], { pane: 'lines', radius: 6, color: '#1d1a16', weight: 1.5, fillColor: '#b99bff', fillOpacity: 1, interactive: false }),
    lbl([la, lo], n, 'tower-lbl')]));
}
OV.names = L.layerGroup(D.names.map(([n, la, lo]) => lbl([la, lo], esc(n).replace(/\n/g, '<br>'), 'place')));
OV.pins = L.layerGroup(); OV.tracks = L.layerGroup(); OV.shared = L.layerGroup();
const PIN_LAYER = OV.pins, TRACK_LAYER = OV.tracks;
if (VIEW) { delete OV.pins; delete OV.tracks; }

function applyLayers() {
  for (const [k, b] of Object.entries(BASES)) { if (k === S.base) b.layer.addTo(map); else map.removeLayer(b.layer); }
  for (const [k, l] of Object.entries(OV)) {
    const want = S.show[k] && !(k === 'contours' && S.base === 'terrain');
    if (want) l.addTo(map); else map.removeLayer(l);
  }
}
function zoomClasses() { const z = map.getZoom(), c = map.getContainer().classList; c.toggle('z17', z >= 17); c.toggle('z18', z >= 18.5); }
map.on('zoomend', zoomClasses);
const fitProperty = (animate) => {
  const wide = innerWidth >= 900;
  const opts = { paddingTopLeft: [wide ? 460 : 16, wide ? 40 : 150], paddingBottomRight: [wide ? 90 : 70, VIEW ? 30 : 110] };
  if (animate) map.flyToBounds(parcelBounds, Object.assign(opts, { duration: 0.8 })); else map.fitBounds(parcelBounds, opts);
};
const view = store.get('view', null);
if (view && !VIEW) map.setView(view.c, view.z); else fitProperty(false);
map.on('moveend', () => { const c = map.getCenter(); store.set('view', { c: [c.lat, c.lng], z: map.getZoom() }); });
applyLayers(); zoomClasses();

// ---------- GPS, compass, HUD ----------
let fix = null, heading = null, follow = false, nav = null, gpsMsg = '', offlineMsg = '', watching = false, editor = null, rec = null;
const meIcon = L.divIcon({ className: 'me', iconSize: [40, 40], iconAnchor: [20, 20],
  html: '<div class="halo"></div><svg class="beam" viewBox="0 0 80 80"><defs><radialGradient id="beamg" cx="50%" cy="50%" r="50%"><stop offset=".2" stop-color="#3d8bff" stop-opacity=".65"/><stop offset="1" stop-color="#3d8bff" stop-opacity="0"/></radialGradient></defs><path d="M40 40 L21 3 A42 42 0 0 1 59 3 Z" fill="url(#beamg)"/></svg><div class="dot"></div>' });
const me = L.marker([0, 0], { icon: meIcon, interactive: false, keyboard: false, zIndexOffset: 3000 });
const accC = L.circle([0, 0], { radius: 1, color: '#3d8bff', weight: 1, opacity: 0.5, fillOpacity: 0.08, interactive: false });
const navLine = L.polyline([], { pane: 'tracks', color: '#3d8bff', weight: 3, dashArray: '2 9', lineCap: 'round', interactive: false });
const curHeading = () => heading ?? (fix && fix.heading != null && !isNaN(fix.heading) ? fix.heading : null);
const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
arrow.setAttribute('class', 'nav-arrow'); arrow.innerHTML = '<use href="#i-nav"/>'; arrow.style.display = 'none';
$('#hudRow').insertBefore(arrow, $('#hudRow').children[1]);

function planStatus(pt) {
  return PLANS.filter((p) => S.show[p.key]).map((p) => ({ p, inside: BW.inPolys(pt, p.polys), d: BW.distToRings(pt, p.polys.flat()) })).reverse();
}
function planChipsHTML() {
  return PLANS.slice().reverse().map((p) => `<button class="chip ${S.show[p.key] ? '' : 'off'}" data-plan="${p.key}"><i style="background:${p.color}"></i>${esc(p.short)} · ${p.acres.toFixed(1)} ac</button>`).join('');
}
function renderHud() {
  const title = $('#hudTitle'), sub = $('#hudSub'), dot = $('#hudDot'), chips = $('#hudChips');
  $('#hud').classList.toggle('nav', !!nav); $('#hudClose').hidden = !nav;
  dot.style.display = nav ? 'none' : ''; arrow.style.display = nav ? '' : 'none';
  if (nav) {
    if (!fix) { title.textContent = 'Waiting for GPS…'; sub.textContent = `to ${nav.name}`; chips.innerHTML = ''; return; }
    const here = [fix.lat, fix.lon], d = BW.dist(here, [nav.lat, nav.lon]), b = BW.bearing(here, [nav.lat, nav.lon]), h = curHeading();
    arrow.style.transform = `rotate(${h != null ? b - h : b}deg)`;
    title.textContent = BW.distLabel(d);
    sub.textContent = `to ${nav.name} · ${BW.compass(b)} ${Math.round(b)}°${h == null ? ' · map is north-up' : ''}`;
    chips.innerHTML = `<span class="chip">GPS ±${feet(fix.acc)}</span>`;
    navLine.setLatLngs([here, [nav.lat, nav.lon]]);
    if (d < Math.max(9, fix.acc) && !nav.arrived) { nav.arrived = true; toast(`You're at ${nav.name}`); }
    return;
  }
  if (!fix) {
    dot.style.background = '';
    title.textContent = '844 Bog Road';
    sub.textContent = offlineMsg || gpsMsg || (VIEW ? `Hillsborough, NH · Tax Map 3, Lot 39 · ${D.parcelAcres} ac` : 'Finding your location…');
    chips.innerHTML = planChipsHTML();
    return;
  }
  const pt = [fix.lat, fix.lon], st = planStatus(pt), onProp = BW.inRing(pt, D.parcel);
  const ins = st.filter((s) => s.inside);
  let t, col;
  if (!onProp) { t = 'Off the property'; col = '#8a948c'; }
  else if (ins.length && ins.length === st.length && st.length > 1) { t = 'Inside both boundaries'; col = ins[0].p.color; }
  else if (ins.length) { t = `Inside ${ins[0].p.key === 'draft' ? 'draft boundary' : 'Nov 4 boundary'}`; col = ins[0].p.color; }
  else if (st.length) { t = 'Outside the easement'; col = '#ff7a1a'; }
  else { t = 'On the property'; col = '#f4f1e8'; }
  title.textContent = t; dot.style.background = col;
  sub.textContent = st.length ? st.map((s) => `${s.p.short} line ${feet(s.d)}`).join(' · ') : 'Boundaries hidden';
  const el = BW.elevAt(fix.lat, fix.lon), h = curHeading();
  chips.innerHTML = [`<span class="chip">GPS ±${feet(fix.acc)}</span>`, el != null ? `<span class="chip">Elev ${Math.round(el).toLocaleString()} ft</span>` : '',
    h != null ? `<span class="chip">Facing ${BW.compass(h)}</span>` : '',
    rec ? `<span class="chip rec"><i></i>${BW.distLabel(rec.dist)} walked</span>` : ''].join('');
}
$('#hudChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-plan]'); if (!b) return;
  S.show[b.dataset.plan] = !S.show[b.dataset.plan]; saveUI(); applyLayers(); renderHud();
});
$('#hudClose').addEventListener('click', () => stopNav());

function onFix(p) {
  fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, alt: p.coords.altitude, t: p.timestamp };
  gpsMsg = '';
  const ll = [fix.lat, fix.lon];
  if (!map.hasLayer(me)) { me.addTo(map); accC.addTo(map); }
  me.setLatLng(ll); accC.setLatLng(ll).setRadius(fix.acc);
  updateBeam();
  if (follow) map.panTo(ll, { animate: true, duration: 0.5 });
  if (rec) addTrackPoint();
  if (editor && editor.place === 'me') editorLoc();
  renderHud();
}
function onGpsErr(e) {
  if (fix && e.code !== 1) return;                                   // keep the last good fix through a timeout
  gpsMsg = e.code === 1 ? 'Location is off: Settings › Privacy › Location Services' : 'Looking for GPS… step into the open';
  renderHud();
}
function startGps() {
  if (watching || !('geolocation' in navigator)) return;
  watching = true; navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function updateBeam() {
  const el = me.getElement(); if (!el) return;
  const b = el.querySelector('.beam'), h = curHeading();
  b.style.display = h == null ? 'none' : 'block'; if (h != null) b.style.transform = `rotate(${h}deg)`;
}
let compassOn = false;
async function enableCompass() {
  if (compassOn) return; compassOn = true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
    }
    let last = 0;
    window.addEventListener('deviceorientation', (e) => {
      if (e.webkitCompassHeading != null) heading = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) heading = (360 - e.alpha) % 360;
      else return;
      updateBeam();
      const now = performance.now(); if (now - last > 250) { last = now; if (nav || fix) renderHud(); }
    }, true);
  } catch (e) { /* no compass on this device */ }
}
document.addEventListener('click', () => { if (!VIEW || watching) enableCompass(); }, { capture: true });

$('#fabLocate').addEventListener('click', () => {
  startGps(); enableCompass();
  if (!fix) { toast('Finding you…'); follow = true; $('#fabLocate').classList.add('on'); return; }
  follow = !follow; $('#fabLocate').classList.toggle('on', follow);
  if (follow) map.flyTo([fix.lat, fix.lon], Math.max(map.getZoom(), 18), { duration: 0.6 });
});
map.on('dragstart', () => { follow = false; $('#fabLocate').classList.remove('on'); });
$('#fabFit').addEventListener('click', () => { follow = false; $('#fabLocate').classList.remove('on'); fitProperty(true); });

// ---------- navigate to a pin / spot ----------
function startNav(lat, lon, name) {
  nav = { lat, lon, name }; startGps(); enableCompass();
  navLine.addTo(map); closeSheet(); renderHud();
  if (fix) map.flyToBounds(L.latLngBounds([[fix.lat, fix.lon], [lat, lon]]).pad(0.4), { duration: 0.7, maxZoom: 19 });
}
function stopNav() { nav = null; map.removeLayer(navLine); renderHud(); }

// ---------- sheet ----------
let sheetOpts = null;
function openSheet(title, render, opts = {}) {
  if (sheetOpts && sheetOpts.onClose) { const f = sheetOpts.onClose; sheetOpts = null; f(); }
  $('#cross').hidden = true;
  $('#sheetTitle').textContent = title;
  const body = $('#sheetBody'); body.innerHTML = ''; body.scrollTop = 0; render(body);
  sheetOpts = opts;
  document.body.classList.toggle('place-mode', !!opts.place);
  $('#sheet').classList.add('open'); $('#scrim').classList.add('show');
}
function closeSheet() {
  $('#sheet').classList.remove('open'); $('#scrim').classList.remove('show');
  document.body.classList.remove('place-mode'); $('#cross').hidden = true;
  const o = sheetOpts; sheetOpts = null; if (o && o.onClose) o.onClose();
}
$('#sheetX').addEventListener('click', closeSheet);
$('#scrim').addEventListener('click', closeSheet);
(() => {                                                     // drag the sheet down to close it
  const sh = $('#sheet'); let y0 = null, dy = 0;
  const start = (e) => { if (innerWidth >= 900) return; y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; };
  const move = (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; };
  const end = () => { if (y0 == null) return; sh.style.transition = ''; sh.style.transform = ''; y0 = null; if (dy > 90) closeSheet(); };
  for (const el of [$('.grab'), $('.sheet-head')]) {
    el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: true }); el.addEventListener('touchend', end);
  }
})();
function crossPoint() {
  const r = $('#sheet').getBoundingClientRect();
  if (innerWidth >= 900) return [r.left / 2, innerHeight / 2];
  const top = $('#hud').getBoundingClientRect().bottom;
  return [innerWidth / 2, top + (r.top - top) / 2];
}
function reveal(ll) {                                       // pan so a point sits in the open map area beside / above the sheet
  setTimeout(() => {
    const [x, y] = crossPoint(), p = map.latLngToContainerPoint(ll);
    const r = $('#sheet').getBoundingClientRect(), hidden = innerWidth >= 900 ? p.x > r.left - 30 : p.y > r.top - 30 || p.y < 140;
    if (hidden) map.panBy([p.x - x, p.y - y], { animate: true, duration: 0.4 });
  }, 60);
}
function placeCross() { const [x, y] = crossPoint(); const c = $('#cross'); c.style.left = `${x}px`; c.style.top = `${y}px`; }
addEventListener('resize', () => { if (!$('#cross').hidden) placeCross(); });

// ---------- pins ----------
const markers = new Map(), urls = new Map();
const photoUrl = (ph) => { if (!urls.has(ph.id)) urls.set(ph.id, URL.createObjectURL(ph.blob)); return urls.get(ph.id); };
function pinIcon(p, shared) {
  const t = T[p.type] || T.photo, n = (p.photos || []).length;
  const cone = p.type === 'photo' && p.heading != null
    ? `<svg class="cone" viewBox="0 0 100 100" style="transform:rotate(${p.heading}deg)"><path d="M50 52 L29 8 A46 46 0 0 1 71 8 Z" fill="${t.color}" fill-opacity=".32" stroke="${t.color}" stroke-opacity=".8" stroke-width="1.5"/></svg>` : '';
  return L.divIcon({ className: 'pin' + (shared ? ' shared' : ''), iconSize: [36, 46], iconAnchor: [18, 44],
    html: `${cone}<svg class="body" viewBox="0 0 36 46"><path d="M18 44.5S3.5 28.5 3.5 17.5a14.5 14.5 0 1 1 29 0c0 11-14.5 27-14.5 27Z" fill="${t.color}" stroke="#fff" stroke-width="2.5"/></svg><span class="pi">${ic(t.icon)}</span>${n ? `<span class="badge">${n}</span>` : ''}` });
}
function drawPin(p, shared = false) {
  const key = (shared ? 's:' : '') + p.id; let m = markers.get(key);
  if (!m) {
    m = L.marker([p.lat, p.lon], { riseOnHover: true }).addTo(shared ? OV.shared : PIN_LAYER);
    m.on('click', () => openDetail(m.pin, shared)); markers.set(key, m);
  }
  m.pin = p; m.setLatLng([p.lat, p.lon]); m.setIcon(pinIcon(p, shared));
}
async function loadPins() {
  if (!VIEW) (await BW.all('pins')).forEach((p) => drawPin(p));
  SH.pins.forEach((p) => drawPin(p, true));
  updateCount();
}
async function updateCount() {
  const n = (await BW.all('pins')).length; const b = $('#pinCount'); b.hidden = !n; b.textContent = n;
}
const pinPhotos = async (pin, shared) => (shared
  ? SH.photos.filter((p) => (pin.photos || []).includes(p.id)).map((p) => Object.assign({ url: 'shared/' + p.file }, p))
  : (await Promise.all((pin.photos || []).map((id) => BW.get('photos', id)))).filter(Boolean).map((p) => Object.assign({ url: photoUrl(p) }, p)));
function factsHTML(pt, extra = []) {
  const el = BW.elevAt(pt[0], pt[1]);
  return `<div class="card facts">${extra.join('')}
    ${PLANS.slice().reverse().map((p) => `<div><span>${esc(p.name)}</span><span style="color:${p.color}">${BW.inPolys(pt, p.polys) ? 'Inside' : 'Outside'} · ${feet(BW.distToRings(pt, p.polys.flat()))} to line</span></div>`).join('')}
    <div><span>On the property</span><span>${BW.inRing(pt, D.parcel) ? 'Yes' : 'No (tax-map line)'}</span></div>
    ${el != null ? `<div><span>Elevation</span><span>${Math.round(el).toLocaleString()} ft</span></div>` : ''}
    ${fix ? `<div><span>From you</span><span>${BW.distLabel(BW.dist([fix.lat, fix.lon], pt))} ${BW.compass(BW.bearing([fix.lat, fix.lon], pt))}</span></div>` : ''}
    <div><span>Coordinates</span><span><button class="chip" data-copy="${pt[0].toFixed(6)}, ${pt[1].toFixed(6)}">${ic('copy')}${pt[0].toFixed(5)}, ${pt[1].toFixed(5)}</button></span></div></div>`;
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]'); if (!c) return;
  (navigator.clipboard ? navigator.clipboard.writeText(c.dataset.copy) : Promise.reject()).then(() => toast('Coordinates copied'), () => toast(c.dataset.copy, 4000));
});
async function openDetail(pin, shared) {
  const t = T[pin.type] || T.photo, phs = await pinPhotos(pin, shared), pt = [pin.lat, pin.lon];
  openSheet(t.label, (body) => {
    body.innerHTML = `${phs.length ? `<div class="carousel">${phs.map((p, i) => `<img src="${p.url}" data-i="${i}" alt="Photo ${i + 1}">`).join('')}</div>` : ''}
      <span class="tag" style="background:${t.color}">${ic(t.icon)}${t.label}</span>${shared ? ' <span class="chip">Shared field note</span>' : ''}
      ${pin.note ? `<div class="big-note">${esc(pin.note)}</div>` : ''}
      ${factsHTML(pt, [`<div><span>Marked by</span><span>${esc(pin.who || '—')} · ${fmtTime(pin.time)}</span></div>`,
        `<div><span>GPS</span><span>${pin.acc != null ? '±' + feet(pin.acc) : 'Placed on the map'}</span></div>`,
        pin.type === 'photo' && pin.heading != null ? `<div><span>Camera facing</span><span>${BW.compass(pin.heading)} · ${Math.round(pin.heading)}°</span></div>` : ''])}
      <div class="btns"><button class="btn go" id="dNav">${ic('nav')}Navigate</button>${shared || VIEW ? '' : `<button class="btn ghost" id="dEdit">${ic('edit')}Edit</button>`}</div>`;
    body.querySelectorAll('.carousel img').forEach((im) => im.addEventListener('click', () => openViewer(phs, +im.dataset.i, pin)));
    $('#dNav', body).onclick = () => startNav(pin.lat, pin.lon, pin.note ? `“${pin.note.slice(0, 28)}${pin.note.length > 28 ? '…' : ''}”` : `${t.label} pin`);
    const ed = $('#dEdit', body); if (ed) ed.onclick = () => openEditor({ pin });
  });
  reveal(L.latLng(pin.lat, pin.lon));
}

// ---------- photo viewer ----------
function openViewer(phs, i, pin) {
  const strip = $('#viewerStrip');
  strip.innerHTML = phs.map((p) => `<img src="${p.url}" alt="">`).join('');
  const cap = (k) => { const p = phs[k]; if (!p) return; $('#viewerCap').textContent = `${k + 1} of ${phs.length} · ${fmtTime(p.time || pin.time)} · ${p.who || pin.who || ''}${p.heading != null ? ` · facing ${BW.compass(p.heading)} ${Math.round(p.heading)}°` : ''}`; };
  $('#viewer').hidden = false;
  requestAnimationFrame(() => { strip.scrollLeft = i * strip.clientWidth; cap(i); });
  strip.onscroll = () => cap(Math.round(strip.scrollLeft / strip.clientWidth));
}
$('#viewerX').addEventListener('click', () => { $('#viewer').hidden = true; $('#viewerStrip').innerHTML = ''; });

// ---------- new / edit pin ----------
async function makePhoto(file) {
  const loc = editor && (editor.place === 'cross' || editor.place === 'at') ? null : fix;
  const date = new Date(), hd = curHeading();
  const { blob, w, h } = await BW.processPhoto(file, { lat: loc && loc.lat, lon: loc && loc.lon, acc: loc && loc.acc, heading: hd, date, desc: `844 Bog Road - ${who()}` });
  return { id: BW.uid(), blob, w, h, time: date.toISOString(), lat: loc ? loc.lat : null, lon: loc ? loc.lon : null, acc: loc ? loc.acc : null, heading: hd, who: who() };
}
function editorLoc() {
  const el = $('#edLoc'); if (!el || !editor) return; const ed = editor;
  $('#cross').hidden = ed.place !== 'cross'; if (ed.place === 'cross') { placeCross(); setTimeout(placeCross, 350); }
  document.querySelectorAll('.seg.places button').forEach((b) => b.classList.toggle('on', b.dataset.v === ed.place));
  let txt;
  if (ed.place === 'keep') txt = `Saved spot · ${ed.pin.lat.toFixed(5)}, ${ed.pin.lon.toFixed(5)}`;
  else if (ed.place === 'at') txt = `The spot you picked · ${ed.at.lat.toFixed(5)}, ${ed.at.lon.toFixed(5)}`;
  else if (ed.place === 'cross') txt = 'Drag the map until the ring sits on the spot';
  else txt = fix ? `Right here · GPS ±${feet(fix.acc)}` : 'Waiting for GPS… or pick the spot on the map';
  el.innerHTML = `${ic(ed.place === 'me' ? 'locate' : 'pin')}<span>${txt}</span>`;
}
function renderThumbs() {
  const box = $('#edThumbs'); if (!box || !editor) return;
  box.innerHTML = editor.photos.map((p, i) => `<div class="thumb"><img src="${photoUrl(p)}" alt=""><button data-i="${i}" aria-label="Remove photo">${ic('x')}</button></div>`).join('')
    + `<label class="thumb" for="photoInput" aria-label="Add photo">${ic('camera')}</label>`;
  box.querySelectorAll('button').forEach((b) => b.onclick = () => { const [p] = editor.photos.splice(+b.dataset.i, 1); editor.removed.push(p.id); renderThumbs(); });
}
async function openEditor({ type = 'in', pin = null, photos = [], at = null }) {
  const existing = pin ? (await Promise.all((pin.photos || []).map((id) => BW.get('photos', id)))).filter(Boolean) : [];
  const ed = { pin, type: pin ? pin.type : type, at, place: pin ? 'keep' : at ? 'at' : (fix ? 'me' : 'cross'), photos: existing.concat(photos), removed: [] };
  startGps();
  openSheet(pin ? 'Edit pin' : 'New pin', (body) => {
    body.innerHTML = `<div class="seg types">${['in', 'out', 'photo'].map((k) => `<button data-v="${k}">${ic(T[k].icon)}${T[k].label}</button>`).join('')}</div>
      ${!pin && !at ? `<div class="sec">Where</div><div class="seg places"><button data-v="me">${ic('locate')}Where I'm standing</button><button data-v="cross">${ic('pin')}Pick on map</button></div>` : ''}
      <div class="loc" id="edLoc"></div>
      <div class="sec">Note</div><textarea id="edNote" placeholder="What's here? Why give it or keep it?">${esc(pin ? pin.note || '' : '')}</textarea>
      <div class="sec">Photos</div><div class="thumbs" id="edThumbs"></div>
      <div class="btns"><button class="btn primary" id="edSave">Save pin</button></div>
      ${pin ? `<button class="btn danger" id="edDel">${ic('trash')}Delete pin</button>` : ''}`;
    const setType = (v) => { ed.type = v; body.querySelectorAll('.seg.types button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); };
    body.querySelector('.seg.types').onclick = (e) => { const b = e.target.closest('button'); if (b) setType(b.dataset.v); };
    const pl = body.querySelector('.seg.places'); if (pl) pl.onclick = (e) => { const b = e.target.closest('button'); if (b) { ed.place = b.dataset.v; editorLoc(); } };
    $('#edSave', body).onclick = saveEditor;
    const del = $('#edDel', body); if (del) del.onclick = deletePin;
    setType(ed.type);
  }, { place: true, onClose: () => { editor = null; } });
  editor = ed; editorLoc(); renderThumbs();
}
async function saveEditor() {
  const ed = editor; if (!ed) return;
  let lat, lon, acc = null;
  if (ed.place === 'keep') ({ lat, lon, acc } = ed.pin);
  else if (ed.place === 'at') ({ lat, lon } = ed.at);
  else if (ed.place === 'cross') { const ll = map.containerPointToLatLng(crossPoint()); lat = ll.lat; lon = ll.lng; }
  else { if (!fix) { toast('No GPS yet. Use “Pick on map”.'); return; } ({ lat, lon, acc } = fix); }
  const now = new Date().toISOString();
  const firstHd = ed.photos.find((p) => p.heading != null);
  const base = ed.pin || { id: BW.uid(), time: now, who: who(), heading: firstHd ? firstHd.heading : curHeading() };
  const pin = Object.assign({}, base, { type: ed.type, lat, lon, acc, note: $('#edNote').value.trim(), updated: now, photos: ed.photos.map((p) => p.id) });
  for (const p of ed.photos) { p.pinId = pin.id; if (p.lat == null) { p.lat = lat; p.lon = lon; } await BW.put('photos', p); }
  for (const id of ed.removed) await BW.del('photos', id);
  await BW.put('pins', pin); drawPin(pin); updateCount();
  closeSheet(); toast(`${T[pin.type].label} pin saved`);
}
async function deletePin() {
  const ed = editor; if (!ed || !ed.pin) return;
  if (!confirm('Delete this pin and its photos?')) return;
  for (const id of ed.pin.photos || []) await BW.del('photos', id);
  await BW.del('pins', ed.pin.id);
  const m = markers.get(ed.pin.id); if (m) { PIN_LAYER.removeLayer(m); markers.delete(ed.pin.id); }
  closeSheet(); updateCount(); toast('Pin deleted');
}
map.on('move', () => { if (!$('#cross').hidden) placeCross(); });
$('#actIn').addEventListener('click', () => openEditor({ type: 'in' }));
$('#actOut').addEventListener('click', () => openEditor({ type: 'out' }));
$('#photoInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !editor) return;
  toast('Adding photo…', 1200); editor.photos.push(await makePhoto(f)); renderThumbs();
});
$('#quickPhoto').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const ph = await makePhoto(f);
  await openEditor({ type: 'photo', photos: [ph] });
  if (!fix) toast('No GPS yet: drag the map to the spot', 3500);
});
$('#actPhoto').addEventListener('click', () => { startGps(); enableCompass(); });

// ---------- press and hold anywhere ----------
let spotMark = null;
function openSpot(ll) {
  if (editor) return;
  const pt = [ll.lat, ll.lng];
  openSheet('This spot', (body) => {
    body.innerHTML = factsHTML(pt) + (VIEW ? '' : `<div class="btns"><button class="btn" style="background:var(--ok);color:#fff" id="sIn">${ic('check')}Easement OK</button><button class="btn" style="background:var(--keep);color:#fff" id="sOut">${ic('home')}Keep for us</button></div>`)
      + `<div class="btns"><button class="btn ghost" id="sNav">${ic('nav')}Navigate here</button></div>`;
    const go = (type) => openEditor({ type, at: { lat: ll.lat, lon: ll.lng } });
    if (!VIEW) { $('#sIn', body).onclick = () => go('in'); $('#sOut', body).onclick = () => go('out'); }
    $('#sNav', body).onclick = () => startNav(ll.lat, ll.lng, 'the spot you picked');
  }, { onClose: () => { if (spotMark) { map.removeLayer(spotMark); spotMark = null; } } });
  spotMark = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#3d8bff', fillOpacity: 0.9, interactive: false }).addTo(map);
  reveal(ll);
}
(() => {
  const c = map.getContainer(); let t = null, sx = 0, sy = 0;
  c.addEventListener('touchstart', (e) => {
    clearTimeout(t); if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    t = setTimeout(() => { const r = c.getBoundingClientRect(); openSpot(map.containerPointToLatLng([sx - r.left, sy - r.top])); }, 600);
  }, { passive: true });
  c.addEventListener('touchmove', (e) => { if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) clearTimeout(t); }, { passive: true });
  c.addEventListener('touchend', () => clearTimeout(t)); c.addEventListener('touchcancel', () => clearTimeout(t));
  map.on('contextmenu', (e) => { if (!('ontouchstart' in window)) openSpot(e.latlng); });
})();

// ---------- walk tracks ----------
const recLine = L.polyline([], { pane: 'tracks', color: '#ff5a5a', weight: 4, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false });
let wake = null;
async function wakeOn() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* not allowed */ } }
async function wakeOff() { try { if (wake) await wake.release(); } catch (e) { /* already gone */ } wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (rec || store.get('wake', false))) wakeOn(); });
function drawTracks(list) {
  TRACK_LAYER.clearLayers();
  for (const tr of list) if (tr.pts.length > 1 && (!rec || tr.id !== rec.id)) {
    L.polyline(tr.pts.map((p) => [p[0], p[1]]), { pane: 'tracks', color: '#ffd7d7', weight: 3, opacity: 0.8, dashArray: '1 6', lineCap: 'round', interactive: false }).addTo(TRACK_LAYER);
  }
  recLine.addTo(TRACK_LAYER);
}
function addTrackPoint() {
  if (!rec || fix.acc > 30) return;
  const p = [+fix.lat.toFixed(6), +fix.lon.toFixed(6)], last = rec.pts[rec.pts.length - 1];
  if (last) { const d = BW.dist(last, p); if (d < 5) return; rec.dist += d; }
  rec.pts.push([p[0], p[1], Date.now()]); recLine.addLatLng(p);
  if (rec.pts.length % 5 === 0) BW.put('tracks', rec);
}
function startRec(existing) {
  rec = existing || { id: BW.uid(), who: who(), start: new Date().toISOString(), pts: [], dist: 0 };
  store.set('recId', rec.id); recLine.setLatLngs(rec.pts.map((p) => [p[0], p[1]]));
  $('#fabRec').classList.add('on'); startGps(); wakeOn(); renderHud();
  if (!existing) toast('Recording your walk. Keep the app open.', 3000);
}
async function stopRec() {
  const r = rec; rec = null; store.set('recId', null); $('#fabRec').classList.remove('on');
  if (!store.get('wake', false)) wakeOff();
  if (r.pts.length > 1) { r.end = new Date().toISOString(); await BW.put('tracks', r); toast(`Walk saved · ${BW.distLabel(r.dist)}`); }
  else { await BW.del('tracks', r.id); toast('Walk stopped'); }
  recLine.setLatLngs([]); drawTracks(await BW.all('tracks')); renderHud();
}
$('#fabRec').addEventListener('click', () => (rec ? stopRec() : startRec()));
(async () => {
  const list = await BW.all('tracks'); const rid = store.get('recId', null);
  if (VIEW) return;
  drawTracks(list); const open = rid && list.find((t) => t.id === rid);
  if (open && !VIEW) startRec(open);
})();

// ---------- layers sheet ----------
const tog = (k, sw, name, sub) => `<label class="tog">${sw}<span class="grow">${name}<small>${sub}</small></span><span class="switch"><input type="checkbox" data-k="${k}" ${S.show[k] ? 'checked' : ''}><span></span></span></label>`;
const sq = (bg, extra = '') => `<span class="sw" style="background:${bg};${extra}"></span>`;
function openLayers() {
  const [sent, draft] = PLANS;
  openSheet('Map', (body) => {
    body.innerHTML = `<div class="sec">Base map</div>
      <div class="bases">${Object.entries(BASES).map(([k, b]) => `<button class="base ${S.base === k ? 'on' : ''}" data-base="${k}"><img src="${thumb(k)}" alt=""><span>${b.name}<small>${b.note}</small></span></button>`).join('')}</div>
      <div class="sec">Easement boundaries</div>
      <div class="card">${PLANS.slice().reverse().map((p) => tog(p.key, swatch(p), `${esc(p.name)} · ${p.acres.toFixed(1)} ac`, esc(p.desc))).join('')}</div>
      <p class="note">The draft adds ${(draft.acres - sent.acres).toFixed(1)} ac to the Nov 4 line. Whole property: ${D.parcelAcres} ac.</p>
      <div class="sec">On the map</div>
      <div class="card">
        ${tog('parcel', sq('#ff4d5e', 'height:4px'), 'Property line', 'Town tax map; can be off 20–50 ft')}
        ${tog('contours', sq('#e9d3a1', 'height:4px'), 'Contour lines', '10-ft LiDAR contours over Aerial and USGS (Terrain has them built in)')}
        ${tog('wetlands', sq('rgba(86,193,234,.45)', 'border:1.5px solid #56c1ea'), 'Wetlands (NWI)', 'Mapped wetlands; tap one for its type')}
        ${tog('brooks', sq('#5cc8ff', 'height:4px'), 'Brooks', 'USGS National Hydrography')}
        ${tog('lots', sq('transparent', 'border:2px dashed #4fe3ff'), 'Lots and house site', "Lots 39-1, 39-2 and Jake's planned house")}
        ${OV.towers ? tog('towers', sq('#b99bff', 'border-radius:50%;width:14px;height:14px;margin:0 8px'), 'Tower spots', 'T1–T3 from the view study') : ''}
        ${tog('names', sq('transparent', 'border:1.5px solid rgba(255,255,255,.4)'), 'Place names', 'Roads and the marsh')}
        ${VIEW ? '' : tog('pins', sq(T.in.color, 'border-radius:50% 50% 50% 0'), 'Our pins', 'Easement OK, Keep for us and photos')}
        ${VIEW ? '' : tog('tracks', sq('#ff5a5a', 'height:4px'), 'Walked tracks', 'Recorded walks on this phone')}
        ${SH.pins.length ? tog('shared', sq(T.in.color, 'border-radius:50% 50% 50% 0;opacity:.8'), 'Field notes', `${SH.pins.length} pins from the walks`) : ''}
      </div>
      <p class="note">Boundaries are working drafts for discussion with NRCS, not a survey.</p>`;
    body.querySelectorAll('[data-base]').forEach((b) => b.onclick = () => {
      S.base = b.dataset.base; saveUI(); applyLayers();
      body.querySelectorAll('[data-base]').forEach((x) => x.classList.toggle('on', x === b));
    });
    body.querySelectorAll('input[data-k]').forEach((cb) => cb.onchange = () => { S.show[cb.dataset.k] = cb.checked; saveUI(); applyLayers(); renderHud(); });
  });
}
$('#fabLayers').addEventListener('click', openLayers);

// ---------- pins list ----------
async function openList(filter = 'all') {
  const pins = (await BW.all('pins')).sort((a, b) => b.time.localeCompare(a.time));
  const photos = await BW.all('photos');
  const first = (id) => photos.find((p) => p.pinId === id);
  const count = (k) => pins.filter((p) => p.type === k).length;
  const shown = pins.filter((p) => filter === 'all' || p.type === filter);
  const row = (p, shared) => {
    const t = T[p.type] || T.photo;
    const ph = shared ? SH.photos.find((x) => (p.photos || []).includes(x.id)) : first(p.id);
    const src = ph ? (shared ? 'shared/' + ph.file : photoUrl(ph)) : null;
    const d = fix ? ` · ${BW.distLabel(BW.dist([fix.lat, fix.lon], [p.lat, p.lon]))} away` : '';
    return `<button class="pin-row" data-id="${p.id}" data-shared="${shared ? 1 : ''}"><span class="pic" style="background:${t.color}">${src ? `<img src="${src}" alt="">` : ic(t.icon)}</span>
      <span class="grow"><div class="t">${esc(p.note || t.label)}</div><small>${t.label} · ${esc(p.who || '')} · ${fmtTime(p.time)}${d}</small></span>${ic('chev', 'ic chev')}</button>`;
  };
  openSheet('Pins', (body) => {
    body.innerHTML = `<div class="filters">${[['all', `All ${pins.length}`], ['in', `Easement OK ${count('in')}`], ['out', `Keep for us ${count('out')}`], ['photo', `Photos ${count('photo')}`]]
        .map(([k, l]) => `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${shown.length ? shown.map((p) => row(p, false)).join('') : `<div class="empty">${ic('pin')}<div>${pins.length ? 'Nothing in this group yet.' : 'No pins yet. Walk the line and tap <b>Easement OK</b> or <b>Keep for us</b>.'}</div></div>`}
      ${SH.pins.length && filter === 'all' ? `<div class="sec">Shared field notes</div>${SH.pins.map((p) => row(p, true)).join('')}` : ''}
      <div class="btns"><button class="btn primary" id="lShare">${ic('share')}Share</button><button class="btn ghost" id="lImport">${ic('import')}Import</button></div>
      <p class="note">Share sends one file with every pin, photo and walk. AirDrop it to the other phone or the Mac; it works with no service.</p>`;
    body.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => openList(b.dataset.f));
    body.querySelectorAll('.pin-row').forEach((r) => r.onclick = () => {
      const m = markers.get((r.dataset.shared ? 's:' : '') + r.dataset.id); if (!m) return;
      follow = false; $('#fabLocate').classList.remove('on');
      map.setZoom(Math.max(map.getZoom(), 18), { animate: false }); openDetail(m.pin, !!r.dataset.shared);
    });
    $('#lShare', body).onclick = shareAll; $('#lImport', body).onclick = () => $('#importInput').click();
  });
}
$('#fabPins').addEventListener('click', () => openList());

// ---------- share / import ----------
async function shareAll() {
  const pins = await BW.all('pins'), photos = await BW.all('photos'), tracks = (await BW.all('tracks')).filter((t) => t.pts.length > 1);
  if (!pins.length && !tracks.length) { toast('Nothing to share yet'); return; }
  toast('Packing it up…', 1500);
  const enc = new TextEncoder(), p2 = (n) => String(n).padStart(2, '0');
  const stamp = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };
  const fname = (p) => `photos/${stamp(p.time)}_${p.id.slice(0, 6)}.jpg`;
  const byPin = (id) => photos.filter((p) => p.pinId === id);
  const meta = { app: 'Bog Road Walk', version: APP_VERSION, exported: new Date().toISOString(), who: who(), pins, tracks,
    photos: photos.map(({ blob, ...m }) => Object.assign(m, { file: fname(m) })) };
  const gj = { type: 'FeatureCollection', features: pins.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { type: T[p.type].label, note: p.note, who: p.who, time: p.time, accuracy_ft: p.acc != null ? Math.round(p.acc * BW.FT) : null, photos: byPin(p.id).map(fname) } })) };
  const kml = ['<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>844 Bog Road field notes</name>',
    '<Style id="in"><IconStyle><color>ff7ad22f</color></IconStyle></Style><Style id="out"><IconStyle><color>ff1a7aff</color></IconStyle></Style><Style id="photo"><IconStyle><color>ffff8b3d</color></IconStyle></Style><Style id="trk"><LineStyle><color>ff5a5aff</color><width>3</width></LineStyle></Style>',
    ...pins.map((p) => `<Placemark><name>${esc(T[p.type].label + (p.note ? ': ' + p.note : ''))}</name><styleUrl>#${p.type}</styleUrl><description>${esc(`${p.who || ''} · ${fmtTime(p.time)}${p.acc != null ? ' · ±' + Math.round(p.acc * BW.FT) + ' ft' : ''} ${byPin(p.id).map(fname).join(' ')}`)}</description><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`),
    ...tracks.map((t) => `<Placemark><name>${esc(`Walk · ${t.who} · ${fmtTime(t.start)}`)}</name><styleUrl>#trk</styleUrl><LineString><coordinates>${t.pts.map((q) => `${q[1]},${q[0]},0`).join(' ')}</coordinates></LineString></Placemark>`),
    '</Document></kml>'].join('\n');
  const gpx = ['<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Bog Road Walk" xmlns="http://www.topografix.com/GPX/1/1">',
    ...pins.map((p) => `<wpt lat="${p.lat}" lon="${p.lon}"><time>${p.time}</time><name>${esc(T[p.type].label + (p.note ? ': ' + p.note : ''))}</name></wpt>`),
    ...tracks.map((t) => `<trk><name>${esc(`Walk · ${t.who} · ${fmtTime(t.start)}`)}</name><trkseg>${t.pts.map((q) => `<trkpt lat="${q[0]}" lon="${q[1]}"><time>${new Date(q[2]).toISOString()}</time></trkpt>`).join('')}</trkseg></trk>`),
    '</gpx>'].join('\n');
  const files = [{ name: 'bogwalk.json', data: enc.encode(JSON.stringify(meta, null, 1)) }, { name: 'pins.geojson', data: enc.encode(JSON.stringify(gj)) },
    { name: 'pins_and_walks.kml', data: enc.encode(kml) }, { name: 'pins_and_walks.gpx', data: enc.encode(gpx) }];
  for (const p of photos) files.push({ name: fname(p), data: new Uint8Array(await p.blob.arrayBuffer()) });
  const d = new Date(), name = `844-bog-road-${who().toLowerCase().replace(/\W+/g, '')}-${d.getMonth() + 1}-${d.getDate()}.zip`;
  const file = new File([BW.makeZip(files)], name, { type: 'application/zip' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '844 Bog Road field notes' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
  toast(`Saved ${pins.length} pins, ${photos.length} photos`);
}
$('#importInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    let meta, files = {};
    if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) { files = await BW.readZip(f); meta = JSON.parse(new TextDecoder().decode(files['bogwalk.json'])); }
    else meta = JSON.parse(await f.text());
    let added = 0, updated = 0;
    for (const p of meta.pins || []) {
      const cur = await BW.get('pins', p.id);
      if (cur && (cur.updated || '') >= (p.updated || '')) continue;
      await BW.put('pins', p); drawPin(p); if (cur) updated++; else added++;
    }
    for (const ph of meta.photos || []) {
      if (await BW.get('photos', ph.id)) continue;
      const data = files[ph.file]; if (!data) continue;
      const { file, ...rest } = ph; await BW.put('photos', Object.assign(rest, { blob: new Blob([data], { type: 'image/jpeg' }) }));
    }
    for (const t of meta.tracks || []) if (!(await BW.get('tracks', t.id))) await BW.put('tracks', t);
    drawTracks(await BW.all('tracks')); updateCount();
    toast(`Imported ${added} new and ${updated} updated pins`);
    if ($('#sheet').classList.contains('open') && $('#sheetTitle').textContent === 'Pins') openList();
  } catch (err) { toast(`Couldn't read that file (${err.message})`, 4000); }
});

// ---------- more menu ----------
async function offlineCount() {
  try {
    const keys = (await caches.keys()).filter((k) => k.startsWith('bogwalk-')).sort(); const k = keys.pop();
    const total = (window.TILES || []).length + (window.CORE_COUNT || 0);
    if (!k || !total) return { ok: false, n: 0, total };
    const n = (await (await caches.open(k)).keys()).length;
    return { ok: n >= total, n: Math.min(n, total), total };
  } catch (e) { return { ok: false, n: 0, total: 0 }; }
}
function openMenu() {
  openSheet('More', (body) => {
    body.innerHTML = `${VIEW ? '' : `<div class="card"><button class="row-btn" id="mWho">${ic('user')}<span class="grow">Walking as <b>${esc(who())}</b><small>Your name goes on the pins you add</small></span>${ic('chev', 'ic chev')}</button></div>`}
      <div class="sec">In the field</div>
      <div class="card">
        <label class="tog">${ic('sun')}<span class="grow">Keep screen on<small>Stops the phone locking while you walk</small></span><span class="switch"><input type="checkbox" id="mWake" ${store.get('wake', false) ? 'checked' : ''}><span></span></span></label>
        ${VIEW ? '' : `<button class="row-btn" id="mShare">${ic('share')}<span class="grow">Share pins, photos and walks<small>One file; AirDrop works with no service</small></span>${ic('chev', 'ic chev')}</button>
        <button class="row-btn" id="mImport">${ic('import')}<span class="grow">Import from a file<small>Add the other phone's pins and photos</small></span>${ic('chev', 'ic chev')}</button>`}
      </div>
      <div class="sec">This phone</div>
      <div class="card">
        <div class="row-btn">${ic('cloud')}<span class="grow">Offline map<small id="mOffline">Checking…</small></span></div>
        ${IOS && !STANDALONE ? `<div class="row-btn">${ic('plus')}<span class="grow">Add to Home Screen<small>In Safari tap Share, then “Add to Home Screen”. It opens full screen and works with no service.</small></span></div>` : ''}
      </div>
      <div class="sec">About this map</div>
      <div class="card"><div class="row-btn">${ic('info')}<span class="grow">844 Bog Road · Hillsborough, NH<small>Tax Map 3, Lot 39 · ${D.parcelAcres} acres · Jacob L. Caron and Alyssa B. Caron, Trustees. Boundaries are working drafts for the NRCS ACEP-WRE discussion, not a survey.<br><br>
        Sources: property line, NH GRANIT town tax map; terrain and elevation, USGS 3DEP LiDAR; wetlands, USFWS NWI; brooks, USGS NHD; imagery, USDA NAIP; topo, USGS The National Map.</small></span></div></div>
      <p class="note" style="text-align:center">Bog Road Walk · ${APP_VERSION}</p>`;
    const w = $('#mWho', body); if (w) w.onclick = () => { closeSheet(); showWelcome(true); };
    $('#mWake', body).onchange = (e) => { store.set('wake', e.target.checked); if (e.target.checked) { wakeOn(); toast('Screen stays on while the app is open'); } else if (!rec) wakeOff(); };
    const sh = $('#mShare', body); if (sh) sh.onclick = shareAll;
    const im = $('#mImport', body); if (im) im.onclick = () => $('#importInput').click();
    offlineCount().then((c) => { const el = $('#mOffline'); if (el) el.textContent = c.ok ? `Saved on this phone · ${c.total} files` : c.total ? `Saving… ${c.n} of ${c.total} files` : 'Open once online to save it'; });
  });
}
$('#fabMore').addEventListener('click', openMenu);

// ---------- welcome ----------
function showWelcome(changeWho) {
  const b = $('#welcomeBody');
  if (VIEW) {
    b.innerHTML = `<h1>844 Bog Road</h1><p class="lead">Hillsborough, NH · Tax Map 3, Lot 39 · ${D.parcelAcres} acres. Working map for the ACEP-WRE easement discussion.</p>
      <div class="plans">${PLANS.slice().reverse().map((p) => `<div class="plan-card">${swatch(p)}<div><b>${esc(p.name)} · ${p.acres.toFixed(1)} ac</b><small>${esc(p.desc)}</small></div></div>`).join('')}</div>
      <div class="how">
        <div><span class="b" style="background:#2a342d">${ic('layers')}</span><span>Switch between Aerial, LiDAR Terrain and USGS Topo, and turn layers on or off.</span></div>
        <div><span class="b" style="background:#2a342d">${ic('pin')}</span><span>Tap a wetland or pin for details. Press and hold (or right-click) anywhere for elevation and distance to each line.</span></div>
      </div>
      <button class="btn primary" id="wGo">Explore the map</button>
      <p class="note">Drafts for discussion, not a survey. Jacob L. Caron and Alyssa B. Caron, Trustees.</p>`;
    $('#wGo').onclick = () => { $('#welcome').hidden = true; store.set('welcomedView', true); };
  } else {
    b.innerHTML = `<h1>844 Bog Road</h1><p class="lead">${changeWho ? "Who's using this phone?" : 'Field map for walking the easement lines.'}</p>
      ${changeWho ? '' : `<div class="how">
        <div><span class="b" style="background:var(--ok)">${ic('check')}</span><span><b>Easement OK</b>: ground that's fine to put in the easement.</span></div>
        <div><span class="b" style="background:var(--keep)">${ic('home')}</span><span><b>Keep for us</b>: ground we want to hold onto.</span></div>
        <div><span class="b" style="background:var(--photo)">${ic('camera')}</span><span><b>Photos</b> save where you stood and which way you faced.</span></div>
        <div><span class="b" style="background:#2a342d">${ic('rec')}</span><span><b>Record a walk</b>, navigate back to any pin, and press and hold the map for distances to each line.</span></div>
      </div><div class="sec">Who's walking?</div>`}
      <div class="who"><button class="btn ghost" data-who="Jake">Jake</button><button class="btn ghost" data-who="Alyssa">Alyssa</button></div>
      ${IOS && !STANDALONE && !changeWho ? `<div class="install"><b>Install it first:</b> tap Share at the bottom of Safari, then “Add to Home Screen”. It opens full screen and works with no service.</div>` : ''}`;
    b.querySelectorAll('[data-who]').forEach((x) => x.onclick = () => {
      const n = x.dataset.who;
      store.set('who', n); $('#welcome').hidden = true; toast(`Hi ${n}`); startGps(); enableCompass();
    });
  }
  $('#welcome').hidden = false;
}

// ---------- passcode (field mode only; keeps casual visitors out, it is not real security) ----------
const PASS_HASH = '371c4661c8fdaf272a00e4578ba8d904f55875c7c20971e00bc59fb5add70b8f';
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, '0')).join('');
function showLock(done) {
  const lock = $('#lock'), dotsEl = $('#lockDots'); let code = '', busy = false;
  const dots = () => { dotsEl.innerHTML = [0, 1, 2, 3].map((i) => `<i class="${i < code.length ? 'on' : ''}"></i>`).join(''); };
  const press = async (k) => {
    if (busy) return;
    if (k === 'del') code = code.slice(0, -1); else if (/^\d$/.test(k) && code.length < 4) code += k;
    dots();
    if (code.length < 4) return;
    busy = true;
    if (await sha('bogwalk:' + code) === PASS_HASH) {
      store.set('unlocked', PASS_HASH); lock.classList.add('ok');
      setTimeout(() => { lock.hidden = true; document.removeEventListener('keydown', onKey); done(); }, 280);
    } else {
      dotsEl.classList.remove('shake'); void dotsEl.offsetWidth; dotsEl.classList.add('shake');
      setTimeout(() => { code = ''; dots(); busy = false; }, 420);
    }
  };
  const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
  lock.querySelector('.keys').onclick = (e) => { const b = e.target.closest('button'); if (b) press(b.dataset.k); };
  document.addEventListener('keydown', onKey);
  dots(); lock.hidden = false;
}

// ---------- offline + startup ----------
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(() => {
    const poll = setInterval(async () => {
      const c = await offlineCount();
      offlineMsg = c.ok || !c.total || VIEW ? '' : `Saving map for offline use · ${Math.round(c.n / c.total * 100)}%`;
      if (!fix && !nav) renderHud();
      if (c.ok) { clearInterval(poll); if (!VIEW && !store.get('offlineToast' + APP_VERSION, false)) { store.set('offlineToast' + APP_VERSION, true); toast('Map saved: works with no service'); } }
    }, 1500);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('Updated: close and reopen the app for the new version', 5000); });
}
BW.loadElev(D.elev);
loadPins();
renderHud();
const begin = () => { if (!store.get('who', '')) showWelcome(); else startGps(); };
if (VIEW) { if (!store.get('welcomedView', false)) showWelcome(); }
else if (store.get('unlocked', '') !== PASS_HASH) showLock(begin);
else begin();
window.__bw = { map, onFix, openEditor, openLayers, openList, openMenu, openSpot, openDetail, startNav, stopNav, shareAll, saveEditor, S };
})();
