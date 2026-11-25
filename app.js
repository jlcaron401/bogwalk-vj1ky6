'use strict';
// Bog Road Walk: offline map of 844 Bog Road with GPS, "easement OK" / "keep for us" pins and geotagged photos.
// Everything stays on the phone (IndexedDB); pins move between phones / to the Mac as a .zip via the share sheet.

const D = window.LAYERS;
const $ = (s) => document.querySelector(s);
const FT = 3.28084;
const store = {
  get(k, d) { try { const v = localStorage.getItem('bw.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bw.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPE_LABEL = { in: 'Easement OK', out: 'Keep for us', photo: 'Photo' };
const TYPE_COLOR = { in: '#22c55e', out: '#f97316', photo: '#3d8bff' };

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- IndexedDB ----------
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('bogwalk', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('pins', { keyPath: 'id' }); r.result.createObjectStore('photos', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(storeName, mode, op) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(storeName, mode); const req = op(t.objectStore(storeName));
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
  });
}
const putRec = (s, o) => idb(s, 'readwrite', (st) => st.put(o));
const delRec = (s, id) => idb(s, 'readwrite', (st) => st.delete(id));
const getRec = (s, id) => idb(s, 'readonly', (st) => st.get(id));
const allRec = (s) => idb(s, 'readonly', (st) => st.getAll());
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- map ----------
const bounds = L.latLngBounds(D.bounds);
const map = L.map('map', { zoomControl: false, maxBounds: bounds.pad(0.6), minZoom: 14, maxZoom: 21, tap: true });
L.tileLayer('tiles/{z}/{x}/{y}.jpg', { minZoom: 14, maxZoom: 21, maxNativeZoom: 18, bounds, attribution: 'Imagery USGS/USDA NAIP · lines are not a survey' }).addTo(map);
L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(map);
const view = store.get('view', null);
if (view) map.setView(view.c, view.z); else map.fitBounds(L.polygon(D.parcel).getBounds(), { padding: [20, 20] });
map.on('moveend', () => { const c = map.getCenter(); store.set('view', { c: [c.lat, c.lng], z: map.getZoom() }); });

const pinLayer = L.layerGroup();
const LAYERS = [
  { key: 'parcel', label: 'Property line (tax map)', sw: 'background:#ff3b4e', make: () => L.polygon(D.parcel, { color: '#ff3b4e', weight: 3, fill: false, interactive: false }) },
  { key: 'sent', label: `${D.sent.name} · ~${Math.round(D.sent.acres)} ac`, sw: 'background:#ffb000', make: () => L.polygon(D.sent.polys, { color: '#ffb000', weight: 3, dashArray: '9 6', fillColor: '#ffb000', fillOpacity: 0.12, interactive: false }) },
  { key: 'ideaD', label: `${D.ideaD.name} · ~${Math.round(D.ideaD.acres)} ac`, sw: 'background:#2ee07a', make: () => L.polygon(D.ideaD.polys, { color: '#2ee07a', weight: 3, fillColor: '#2ee07a', fillOpacity: 0.15, interactive: false }) },
  { key: 'brooks', label: 'Brooks', sw: 'background:#6fc3ff', make: () => L.layerGroup(D.brooks.map((l) => L.polyline(l, { color: '#6fc3ff', weight: 2.5, interactive: false }))) },
  { key: 'lots', label: "Lots 39-1, 39-2 and Jake's house", sw: 'background:#34e0ff', make: () => L.layerGroup([
      ...D.lots.map((l, i) => L.polygon(l, { color: i ? '#ff5cc8' : '#34e0ff', weight: 2, fillOpacity: 0.06, interactive: false })),
      L.polygon(D.house, { color: '#fff', weight: 1, fillColor: '#fff', fillOpacity: 0.8, interactive: false })]) },
  { key: 'towers', label: 'Tower spots T1–T3', sw: 'background:#b388ff', make: () => L.layerGroup(D.towers.map(([n, la, lo]) =>
      L.circleMarker([la, lo], { radius: 6, color: '#1d1a16', weight: 1.5, fillColor: '#b388ff', fillOpacity: 1 })
        .bindTooltip(n.split(' ')[0], { permanent: true, direction: 'right', className: 'tlabel' }))) },
  { key: 'pins', label: 'Our pins and photos', sw: 'background:linear-gradient(90deg,#22c55e 33%,#3d8bff 33% 66%,#f97316 66%)', make: () => pinLayer },
];
const shown = Object.assign({ parcel: true, sent: true, ideaD: true, brooks: true, lots: true, towers: true, pins: true }, store.get('layers', {}));
for (const l of LAYERS) { l.layer = l.make(); if (shown[l.key]) l.layer.addTo(map); }
function renderLayerList() {
  $('#layerList').innerHTML = LAYERS.map((l) => `<label><input type="checkbox" data-k="${l.key}" ${shown[l.key] ? 'checked' : ''}><span class="sw" style="${l.sw}"></span>${esc(l.label)}</label>`).join('');
  $('#layerList').querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
    const l = LAYERS.find((x) => x.key === cb.dataset.k); shown[l.key] = cb.checked; store.set('layers', shown);
    if (cb.checked) l.layer.addTo(map); else map.removeLayer(l.layer);
    updateStatus();
  }));
}

// ---------- geometry helpers ----------
function inRing(pt, ring) {
  const x = pt[1], y = pt[0]; let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0], xj = ring[j][1], yj = ring[j][0];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolys = (pt, polys) => polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));
function distToRings(pt, rings) {                       // metres to the nearest edge
  const k = Math.cos(pt[0] * Math.PI / 180) * 111320, m = 110540;
  let best = Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i++) {
    const ax = (r[i - 1][1] - pt[1]) * k, ay = (r[i - 1][0] - pt[0]) * m, bx = (r[i][1] - pt[1]) * k, by = (r[i][0] - pt[0]) * m;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
const allRings = (polys) => polys.flat();
const feet = (m) => `${Math.round(m * FT).toLocaleString()} ft`;

// ---------- GPS + compass ----------
let fix = null, heading = null, follow = false;
const meIcon = L.divIcon({ className: 'me', html: '<div class="me-arrow"></div><div class="me-dot"></div>', iconSize: [40, 40], iconAnchor: [20, 20] });
const meMarker = L.marker([0, 0], { icon: meIcon, interactive: false, zIndexOffset: 1000 });
const accCircle = L.circle([0, 0], { radius: 1, color: '#3d8bff', weight: 1, fillOpacity: 0.1, interactive: false });
function updateArrow() {
  const el = meMarker.getElement(); if (!el) return;
  const a = el.querySelector('.me-arrow'); const h = heading ?? (fix && fix.heading);
  a.style.display = h == null || isNaN(h) ? 'none' : 'block';
  if (h != null) a.style.transform = `rotate(${h}deg)`;
}
function updateStatus() {
  if (!fix) return;
  const pt = [fix.lat, fix.lon];
  const onProp = inRing(pt, D.parcel);
  const bits = [];
  for (const [k, nm] of [['ideaD', 'Idea D'], ['sent', 'Sent to Matt']]) {
    if (!shown[k]) continue;
    const polys = D[k].polys; const inside = inPolys(pt, polys);
    bits.push(`${inside ? 'IN' : 'out of'} ${nm} (${feet(distToRings(pt, allRings(polys)))} to line)`);
  }
  $('#where').textContent = onProp ? (bits[0] ? bits[0].split(' (')[0].replace(/^IN/, 'Inside').replace(/^out of/, 'Outside') : 'On the property') : 'Off the property (tax-map line)';
  $('#sub').textContent = `±${feet(fix.acc)} GPS · ` + (bits.length ? bits.join(' · ') : 'easement layers hidden');
}
function onFix(p) {
  fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, t: p.timestamp };
  const ll = [fix.lat, fix.lon];
  if (!map.hasLayer(meMarker)) { meMarker.addTo(map); accCircle.addTo(map); }
  meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(fix.acc);
  updateArrow(); updateStatus();
  if (follow) map.panTo(ll, { animate: true });
  if (!sheetState) return;
  if (sheetState.place === 'me') showLoc();
}
function onGpsErr(e) {
  if (fix && e.code !== 1) return;                     // keep the last good fix through a timeout
  $('#where').textContent = e.code === 1 ? 'Location is off for this app' : 'Waiting for GPS…';
  $('#sub').textContent = e.code === 1 ? 'Settings → Privacy → Location Services → Safari Websites → While Using' : 'Step into the open for a better fix';
}
if ('geolocation' in navigator) navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
let compassAsked = false;
async function enableCompass() {
  if (compassAsked) return; compassAsked = true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
    }
    window.addEventListener('deviceorientation', (e) => {
      if (e.webkitCompassHeading != null) heading = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) heading = (360 - e.alpha) % 360;
      updateArrow();
    }, true);
  } catch (e) { /* no compass */ }
}
document.addEventListener('click', enableCompass, { once: true, capture: true });
$('#btnMe').addEventListener('click', () => {
  if (!fix) { toast('No GPS fix yet'); return; }
  follow = !follow; $('#btnMe').classList.toggle('on', follow);
  if (follow) map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), 18));
});
map.on('dragstart', () => { follow = false; $('#btnMe').classList.remove('on'); });

// ---------- photos: resize + stamp our own GPS / compass / time EXIF ----------
function exifSegment({ lat, lon, acc, heading: hd, date, desc }) {
  const enc = new TextEncoder();
  const ascii = (s) => enc.encode(String(s).replace(/[^\x20-\x7e]/g, '?') + '\0');
  const be = (n, bytes, fn) => { const b = new Uint8Array(n * bytes); const dv = new DataView(b.buffer); fn(dv); return b; };
  const rat = (pairs) => be(pairs.length, 8, (dv) => pairs.forEach(([a, b], i) => { dv.setUint32(i * 8, a); dv.setUint32(i * 8 + 4, b); }));
  const dms = (v) => { v = Math.abs(v); const d = Math.floor(v); const mf = (v - d) * 60; const m = Math.floor(mf); return [[d, 1], [m, 1], [Math.round((mf - m) * 60 * 10000), 10000]]; };
  const p2 = (n) => String(n).padStart(2, '0');
  const dt = `${date.getFullYear()}:${p2(date.getMonth() + 1)}:${p2(date.getDate())} ${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`;
  const E = (tag, type, val, count) => [tag, type, count ?? (type === 5 ? val.length / 8 : val.length), val];
  const ifdSize = (es) => 2 + 12 * es.length + 4 + es.reduce((a, e) => a + (e[3].length > 4 ? e[3].length + (e[3].length & 1) : 0), 0);
  function ifdBytes(es, start) {
    const b = new Uint8Array(ifdSize(es)); const dv = new DataView(b.buffer); dv.setUint16(0, es.length);
    let data = 2 + 12 * es.length + 4;
    es.forEach(([tag, type, count, val], i) => {
      const o = 2 + 12 * i; dv.setUint16(o, tag); dv.setUint16(o + 2, type); dv.setUint32(o + 4, count);
      if (val.length <= 4) b.set(val, o + 8); else { dv.setUint32(o + 8, start + data); b.set(val, data); data += val.length + (val.length & 1); }
    });
    return b;
  }
  const ptr = () => new Uint8Array(4);
  const ifd0 = [E(0x010e, 2, ascii(desc)), E(0x0131, 2, ascii('Bog Road Walk')), E(0x0132, 2, ascii(dt)), E(0x8769, 4, ptr(), 1), E(0x8825, 4, ptr(), 1)];
  const exif = [E(0x9003, 2, ascii(dt))];
  const gps = [E(0x0000, 1, new Uint8Array([2, 3, 0, 0])), E(0x0001, 2, ascii(lat >= 0 ? 'N' : 'S')), E(0x0002, 5, rat(dms(lat))),
    E(0x0003, 2, ascii(lon >= 0 ? 'E' : 'W')), E(0x0004, 5, rat(dms(lon)))];
  if (hd != null && !isNaN(hd)) gps.push(E(0x0010, 2, ascii('M')), E(0x0011, 5, rat([[Math.round(hd * 100), 100]])));
  if (acc != null) gps.push(E(0x001f, 5, rat([[Math.round(acc * 100), 100]])));
  const exifStart = 8 + ifdSize(ifd0), gpsStart = exifStart + ifdSize(exif);
  new DataView(ifd0[3][3].buffer).setUint32(0, exifStart); new DataView(ifd0[4][3].buffer).setUint32(0, gpsStart);
  const tiff = [new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]), ifdBytes(ifd0, 8), ifdBytes(exif, exifStart), ifdBytes(gps, gpsStart)];
  const tlen = tiff.reduce((a, b) => a + b.length, 0);
  const seg = new Uint8Array(4 + 6 + tlen); const sv = new DataView(seg.buffer);
  sv.setUint16(0, 0xffe1); sv.setUint16(2, 2 + 6 + tlen); seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  let o = 10; for (const b of tiff) { seg.set(b, o); o += b.length; }
  return seg;
}
async function processPhoto(file, info) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const s = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const jpg = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    if (info.lat == null) return { blob: jpg, w: c.width, h: c.height };
    const buf = new Uint8Array(await jpg.arrayBuffer()); const app1 = exifSegment(info);
    const out = new Uint8Array(buf.length + app1.length); out.set(buf.subarray(0, 2), 0); out.set(app1, 2); out.set(buf.subarray(2), 2 + app1.length);
    return { blob: new Blob([out], { type: 'image/jpeg' }), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

// ---------- pins on the map ----------
const markers = new Map();
const urls = new Map();
function photoUrl(ph) { if (!urls.has(ph.id)) urls.set(ph.id, URL.createObjectURL(ph.blob)); return urls.get(ph.id); }
async function popupFor(pin) {
  const el = document.createElement('div'); el.className = 'pop';
  const phs = (await Promise.all((pin.photos || []).map((id) => getRec('photos', id)))).filter(Boolean);
  el.innerHTML = `<b style="color:${TYPE_COLOR[pin.type]}">${TYPE_LABEL[pin.type]}</b>
    <div class="meta">${esc(pin.who || '')} · ${new Date(pin.time).toLocaleString()}${pin.acc != null ? ` · ±${feet(pin.acc)}` : ' · placed by hand'}</div>
    ${pin.note ? `<div>${esc(pin.note)}</div>` : ''}<div>${phs.map((p) => `<img src="${photoUrl(p)}">`).join('')}</div>`;
  const b = document.createElement('button'); b.textContent = 'Edit'; b.onclick = () => { map.closePopup(); openSheet({ pin }); }; el.appendChild(b);
  return el;
}
function drawPin(pin) {
  let m = markers.get(pin.id);
  if (!m) {
    m = L.circleMarker([pin.lat, pin.lon], { radius: 9, weight: 2.5, color: '#fff', fillOpacity: 1 }).addTo(pinLayer);
    m.on('click', async () => { L.popup({ maxWidth: 280, offset: [0, -6] }).setLatLng(m.getLatLng()).setContent(await popupFor(m.pin)).openOn(map); });
    markers.set(pin.id, m);
  }
  m.pin = pin; m.setLatLng([pin.lat, pin.lon]); m.setStyle({ fillColor: TYPE_COLOR[pin.type] });
}
async function loadPins() { (await allRec('pins')).forEach(drawPin); }

// ---------- new / edit sheet ----------
let sheetState = null;
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => s.classList.add('hidden')); $('#cross').classList.add('hidden'); sheetState = null; }
function crossLatLng() {
  const sh = $('#sheet').getBoundingClientRect(); const y = Math.max(60, sh.top / 2);
  return map.containerPointToLatLng([window.innerWidth / 2, y]);
}
function placeCross() { const sh = $('#sheet').getBoundingClientRect(); $('#cross').style.top = `${Math.max(60, sh.top / 2)}px`; }
function showLoc() {
  const s = sheetState; if (!s) return;
  $('#placeRow').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.place === s.place));
  $('#cross').classList.toggle('hidden', s.place !== 'cross');
  if (s.place === 'cross') placeCross();
  if (s.place === 'keep') $('#locLine').textContent = `Saved spot: ${s.pin.lat.toFixed(6)}, ${s.pin.lon.toFixed(6)}`;
  else if (s.place === 'cross') $('#locLine').textContent = 'Drag the map so the crosshair sits on the spot.';
  else $('#locLine').textContent = fix ? `Your spot: ${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)} (±${feet(fix.acc)})` : 'No GPS fix yet. Use the crosshair, or wait a moment.';
}
function renderThumbs() {
  const s = sheetState;
  $('#thumbs').innerHTML = s.photos.map((p, i) => `<div class="t"><img src="${photoUrl(p)}"><button data-i="${i}">✕</button></div>`).join('');
  $('#thumbs').querySelectorAll('button').forEach((b) => b.onclick = () => { const [p] = s.photos.splice(+b.dataset.i, 1); s.removed.push(p.id); renderThumbs(); });
}
function setType(t) { sheetState.type = t; $('#typeRow').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.type === t)); }
async function openSheet({ type = 'in', pin = null, photos = [], place = null }) {
  closeSheets();
  const existing = pin ? (await Promise.all((pin.photos || []).map((id) => getRec('photos', id)))).filter(Boolean) : [];
  sheetState = { pin, isNew: !pin || !!pin._new, type: pin ? pin.type : type, place: place || (pin ? 'keep' : (fix ? 'me' : 'cross')), photos: existing.concat(photos), removed: [] };
  $('#sheetTitle').textContent = sheetState.isNew ? 'New pin' : 'Edit pin';
  $('#note').value = pin ? (pin.note || '') : '';
  $('#deleteBtn').classList.toggle('hidden', sheetState.isNew);
  $('#placeRow').classList.toggle('hidden', !sheetState.isNew);
  setType(sheetState.type); renderThumbs();
  $('#sheet').classList.remove('hidden'); showLoc();
}
$('#typeRow').addEventListener('click', (e) => { const t = e.target.dataset.type; if (t) setType(t); });
$('#placeRow').addEventListener('click', (e) => { const p = e.target.dataset.place; if (p && sheetState) { sheetState.place = p; showLoc(); } });
$('#sheetClose').addEventListener('click', closeSheets);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
$('#btnIn').addEventListener('click', () => openSheet({ type: 'in' }));
$('#btnOut').addEventListener('click', () => openSheet({ type: 'out' }));
map.on('contextmenu', (e) => openSheet({ type: 'in', pin: { _new: true, id: uid(), type: 'in', lat: e.latlng.lat, lon: e.latlng.lng, acc: null } }));

function who() {
  let w = store.get('who', '');
  if (!w) { w = (prompt("Who's using this phone? (e.g. Jake or Alyssa)") || '').trim() || 'Me'; store.set('who', w); }
  return w;
}
async function makePhoto(file) {
  const loc = sheetState && sheetState.place === 'cross' ? null : fix;
  const date = new Date();
  const hd = heading ?? (fix && fix.heading);
  const { blob, w, h } = await processPhoto(file, { lat: loc && loc.lat, lon: loc && loc.lon, acc: loc && loc.acc, heading: hd, date, desc: `844 Bog Road - ${who()}` });
  return { id: uid(), blob, w, h, time: date.toISOString(), lat: loc ? loc.lat : null, lon: loc ? loc.lon : null, acc: loc ? loc.acc : null, heading: hd ?? null, who: who() };
}
$('#photoInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !sheetState) return;
  toast('Adding photo…'); sheetState.photos.push(await makePhoto(f)); renderThumbs();
});
$('#quickPhoto').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!fix) toast('No GPS fix: place the pin with the crosshair', 3500);
  const ph = await makePhoto(f);
  await openSheet({ type: 'photo', photos: [ph] });
});
$('#saveBtn').addEventListener('click', async () => {
  const s = sheetState; if (!s) return;
  let lat, lon, acc;
  if (s.place === 'keep') ({ lat, lon, acc } = s.pin);
  else if (s.place === 'cross') { const ll = crossLatLng(); lat = ll.lat; lon = ll.lng; acc = null; }
  else { if (!fix) { toast('No GPS fix yet: use the crosshair'); return; } ({ lat, lon, acc } = fix); }
  const now = new Date().toISOString();
  const base = s.pin && !s.pin._new ? s.pin : { id: (s.pin && s.pin.id) || uid(), time: now, who: who(), heading: heading ?? (fix && fix.heading) ?? null };
  const pin = Object.assign({}, base, { type: s.type, lat, lon, acc, note: $('#note').value.trim(), updated: now, photos: s.photos.map((p) => p.id) });
  delete pin._new;
  for (const p of s.photos) { p.pinId = pin.id; if (p.lat == null) { p.lat = lat; p.lon = lon; } await putRec('photos', p); }
  for (const id of s.removed) await delRec('photos', id);
  await putRec('pins', pin); drawPin(pin);
  closeSheets(); toast(`${TYPE_LABEL[pin.type]} saved`);
});
$('#deleteBtn').addEventListener('click', async () => {
  const s = sheetState; if (!s || !s.pin) return;
  if (!confirm('Delete this pin and its photos?')) return;
  for (const id of s.pin.photos || []) await delRec('photos', id);
  await delRec('pins', s.pin.id);
  const m = markers.get(s.pin.id); if (m) { pinLayer.removeLayer(m); markers.delete(s.pin.id); }
  closeSheets(); toast('Deleted');
});
map.on('move', () => { if (sheetState && sheetState.place === 'cross') placeCross(); });

// ---------- layers + list sheets ----------
$('#btnLayers').addEventListener('click', () => { closeSheets(); renderLayerList(); $('#layersSheet').classList.remove('hidden'); });
$('#btnList').addEventListener('click', async () => { closeSheets(); await renderList(); $('#listSheet').classList.remove('hidden'); });
async function renderList() {
  const pins = (await allRec('pins')).sort((a, b) => b.time.localeCompare(a.time));
  const n = (t) => pins.filter((p) => p.type === t).length;
  $('#counts').textContent = `${n('in')} easement OK · ${n('out')} keep for us · ${n('photo')} photo pins`;
  $('#pinList').innerHTML = pins.map((p) => `<div class="p" data-id="${p.id}"><span class="dot ${p.type}"></span><div><div>${esc(p.note || TYPE_LABEL[p.type])}${p.photos && p.photos.length ? ` · 📷${p.photos.length}` : ''}</div>
      <div class="meta">${esc(p.who || '')} · ${new Date(p.time).toLocaleString()}${fix ? ` · ${feet(map.distance([fix.lat, fix.lon], [p.lat, p.lon]))} away` : ''}</div></div></div>`).join('') || '<p class="small">No pins yet.</p>';
  $('#pinList').querySelectorAll('.p').forEach((r) => r.onclick = () => {
    const m = markers.get(r.dataset.id); closeSheets(); follow = false; $('#btnMe').classList.remove('on');
    if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 18)); m.fire('click'); }
  });
  const cached = await offlineCount();
  $('#about').textContent = `This phone: ${store.get('who', '?')} · map stored for offline: ${cached.ok ? 'yes' : `${cached.n}/${cached.total} files`}`;
}
$('#whoBtn').addEventListener('click', () => { store.set('who', ''); who(); renderList(); });

// ---------- share (zip) / import ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name); const crc = crc32(f.data); const len = f.data.length;
    const lh = new Uint8Array(30 + nm.length); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(12, 0x21, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, len, true); dv.setUint32(22, len, true); dv.setUint16(26, nm.length, true); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, len, true); cv.setUint32(24, len, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, off, true); ch.set(nm, 46);
    parts.push(lh, f.data); central.push(ch); off += lh.length + len;
  }
  const cd = central.reduce((a, c) => a + c.length, 0); const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cd, true); ev.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
async function readZip(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()); const dv = new DataView(b.buffer); const dec = new TextDecoder();
  let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true); const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    let data = b.subarray(start, start + csize);
    if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else if (method !== 0) continue;
    out[name] = data;
  }
  return out;
}
const kmlEsc = (s) => esc(s).replace(/'/g, '&apos;');
async function buildExport() {
  const pins = await allRec('pins'); const photos = await allRec('photos'); const enc = new TextEncoder();
  const byPin = (id) => photos.filter((p) => p.pinId === id);
  const p2 = (n) => String(n).padStart(2, '0');
  const name = (p) => { const d = new Date(p.time); return `photos/${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}_${p.id.slice(0, 6)}.jpg`; };
  const meta = { app: 'Bog Road Walk', exported: new Date().toISOString(), who: store.get('who', ''), pins,
    photos: photos.map(({ blob, ...m }) => Object.assign(m, { file: name(m) })) };
  const gj = { type: 'FeatureCollection', features: pins.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { type: TYPE_LABEL[p.type], note: p.note, who: p.who, time: p.time, accuracy_ft: p.acc != null ? Math.round(p.acc * FT) : null, photos: byPin(p.id).map(name) } })) };
  const kml = ['<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>844 Bog Road pins</name>',
    ...Object.entries({ in: 'ff5ec522', out: 'ff1673f9', photo: 'ffff8b3d' }).map(([k, c]) => `<Style id="${k}"><IconStyle><color>${c}</color></IconStyle></Style>`),
    ...pins.map((p) => `<Placemark><name>${kmlEsc(TYPE_LABEL[p.type] + (p.note ? ': ' + p.note : ''))}</name><styleUrl>#${p.type}</styleUrl><description>${kmlEsc(`${p.who || ''} ${p.time}${p.acc != null ? ' ±' + Math.round(p.acc * FT) + ' ft' : ''} ${byPin(p.id).map(name).join(' ')}`)}</description><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`),
    '</Document></kml>'].join('\n');
  const files = [{ name: 'bogwalk.json', data: enc.encode(JSON.stringify(meta, null, 1)) }, { name: 'pins.geojson', data: enc.encode(JSON.stringify(gj)) }, { name: 'pins.kml', data: enc.encode(kml) }];
  for (const p of photos) files.push({ name: name(p), data: new Uint8Array(await p.blob.arrayBuffer()) });
  return { zip: makeZip(files), n: pins.length, np: photos.length };
}
$('#shareBtn').addEventListener('click', async () => {
  const { zip, n, np } = await buildExport();
  if (!n) { toast('No pins yet'); return; }
  const d = new Date(); const fname = `bogwalk-${(store.get('who', 'me') || 'me').toLowerCase()}-${d.getMonth() + 1}-${d.getDate()}.zip`;
  const file = new File([zip], fname, { type: 'application/zip' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '844 Bog Road pins' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname; a.click();
  toast(`Saved ${n} pins, ${np} photos`);
});
$('#importBtn').addEventListener('click', () => $('#importInput').click());
$('#importInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    let meta, files = {};
    if (/\.zip$/i.test(f.name) || f.type.includes('zip')) { files = await readZip(f); meta = JSON.parse(new TextDecoder().decode(files['bogwalk.json'])); }
    else meta = JSON.parse(await f.text());
    let added = 0, updated = 0;
    for (const p of meta.pins || []) {
      const cur = await getRec('pins', p.id);
      if (cur && (cur.updated || '') >= (p.updated || '')) continue;
      await putRec('pins', p); drawPin(p); cur ? updated++ : added++;
    }
    for (const ph of meta.photos || []) {
      if (await getRec('photos', ph.id)) continue;
      const data = files[ph.file]; if (!data) continue;
      const { file, ...rest } = ph; await putRec('photos', Object.assign(rest, { blob: new Blob([data], { type: 'image/jpeg' }) }));
    }
    toast(`Imported ${added} new, ${updated} updated pins`); renderList();
  } catch (err) { toast("Couldn't read that file: " + err.message, 4000); }
});

// ---------- offline cache ----------
async function offlineCount() {
  try {
    const keys = await caches.keys(); const k = keys.filter((x) => x.startsWith('bogwalk-')).sort().pop();
    const total = (window.TILES || []).length + 10;
    if (!k) return { ok: false, n: 0, total };
    const n = (await (await caches.open(k)).keys()).length;
    return { ok: n >= total, n, total };
  } catch (e) { return { ok: false, n: 0, total: 0 }; }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => {
    const poll = setInterval(async () => {
      const c = await offlineCount();
      if (!fix) $('#sub').textContent = c.ok ? 'Map saved on this phone: works with no service' : `Saving map for offline… ${c.n}/${c.total}`;
      if (c.ok) clearInterval(poll);
    }, 1500);
  }).catch(() => {});
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('App updated: close and reopen to use the new version', 5000); });
}

loadPins();
if (!store.get('who', '')) setTimeout(who, 600);
