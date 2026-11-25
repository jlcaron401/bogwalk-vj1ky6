'use strict';
// Helpers for Bog Road Walk: storage, geometry, elevation, photo EXIF and zip. No DOM work here.

const BW = {};
BW.FT = 3.28084;

// ---------- small storage (per phone) ----------
BW.store = {
  get(k, d) { try { const v = localStorage.getItem('bw.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bw.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
BW.uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
BW.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- IndexedDB: pins, photos, tracks ----------
let dbp = null;
BW.db = () => {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('bogwalk', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['pins', 'photos', 'tracks']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
};
async function idb(store, mode, op) {
  const d = await BW.db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const req = op(t.objectStore(store));
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
  });
}
BW.put = (s, o) => idb(s, 'readwrite', (st) => st.put(o));
BW.del = (s, id) => idb(s, 'readwrite', (st) => st.delete(id));
BW.get = (s, id) => idb(s, 'readonly', (st) => st.get(id));
BW.all = (s) => idb(s, 'readonly', (st) => st.getAll());

// ---------- geometry ([lat, lon] everywhere) ----------
BW.inRing = (pt, ring) => {
  const x = pt[1], y = pt[0]; let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0], xj = ring[j][1], yj = ring[j][0];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
BW.inPolys = (pt, polys) => polys.some((p) => BW.inRing(pt, p[0]) && !p.slice(1).some((h) => BW.inRing(pt, h)));
BW.distToRings = (pt, rings) => {               // metres to the nearest edge
  const k = Math.cos(pt[0] * Math.PI / 180) * 111320, m = 110540; let best = Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i++) {
    const ax = (r[i - 1][1] - pt[1]) * k, ay = (r[i - 1][0] - pt[0]) * m, bx = (r[i][1] - pt[1]) * k, by = (r[i][0] - pt[0]) * m;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
};
BW.dist = (a, b) => {                            // metres, short distances
  const k = Math.cos(a[0] * Math.PI / 180) * 111320;
  return Math.hypot((b[1] - a[1]) * k, (b[0] - a[0]) * 110540);
};
BW.bearing = (a, b) => {                         // degrees from true north
  const k = Math.cos(a[0] * Math.PI / 180);
  return (Math.atan2((b[1] - a[1]) * k, b[0] - a[0]) * 180 / Math.PI + 360) % 360;
};
BW.compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
BW.feet = (m) => `${Math.round(m * BW.FT).toLocaleString()} ft`;
BW.distLabel = (m) => (m * BW.FT < 1500 ? BW.feet(m) : `${(m / 1609.34).toFixed(2)} mi`);

// ---------- elevation grid (LiDAR, ft) ----------
BW.elev = { grid: null, meta: null };
BW.loadElev = async (meta) => {
  try {
    const buf = await (await fetch('data/elev.bin')).arrayBuffer();
    BW.elev = { grid: new Uint16Array(buf), meta };
  } catch (e) { /* elevation readout just stays blank */ }
};
BW.elevAt = (lat, lon) => {
  const { grid, meta } = BW.elev; if (!grid) return null;
  const fx = (lon - meta.west) / (meta.east - meta.west) * (meta.w - 1), fy = (meta.north - lat) / (meta.north - meta.south) * (meta.h - 1);
  if (fx < 0 || fy < 0 || fx > meta.w - 1 || fy > meta.h - 1) return null;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, meta.w - 1), y1 = Math.min(y0 + 1, meta.h - 1), tx = fx - x0, ty = fy - y0;
  const v = (x, y) => grid[y * meta.w + x] / 10;
  return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
};

// ---------- photos: resize and stamp GPS / heading / time into the JPEG ----------
BW.exifSegment = ({ lat, lon, acc, heading, date, desc }) => {
  const enc = new TextEncoder();
  const ascii = (s) => enc.encode(String(s).replace(/[^\x20-\x7e]/g, '?') + '\0');
  const rat = (pairs) => { const b = new Uint8Array(pairs.length * 8); const dv = new DataView(b.buffer); pairs.forEach(([a, c], i) => { dv.setUint32(i * 8, a); dv.setUint32(i * 8 + 4, c); }); return b; };
  const dms = (v) => { v = Math.abs(v); const d = Math.floor(v); const mf = (v - d) * 60; const m = Math.floor(mf); return [[d, 1], [m, 1], [Math.round((mf - m) * 60 * 10000), 10000]]; };
  const p2 = (n) => String(n).padStart(2, '0');
  const dt = `${date.getFullYear()}:${p2(date.getMonth() + 1)}:${p2(date.getDate())} ${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`;
  const E = (tag, type, val, count) => [tag, type, count ?? (type === 5 ? val.length / 8 : val.length), val];
  const size = (es) => 2 + 12 * es.length + 4 + es.reduce((a, e) => a + (e[3].length > 4 ? e[3].length + (e[3].length & 1) : 0), 0);
  const bytes = (es, start) => {
    const b = new Uint8Array(size(es)); const dv = new DataView(b.buffer); dv.setUint16(0, es.length);
    let data = 2 + 12 * es.length + 4;
    es.forEach(([tag, type, count, val], i) => {
      const o = 2 + 12 * i; dv.setUint16(o, tag); dv.setUint16(o + 2, type); dv.setUint32(o + 4, count);
      if (val.length <= 4) b.set(val, o + 8); else { dv.setUint32(o + 8, start + data); b.set(val, data); data += val.length + (val.length & 1); }
    });
    return b;
  };
  const ifd0 = [E(0x010e, 2, ascii(desc)), E(0x0131, 2, ascii('Bog Road Walk')), E(0x0132, 2, ascii(dt)), E(0x8769, 4, new Uint8Array(4), 1), E(0x8825, 4, new Uint8Array(4), 1)];
  const exif = [E(0x9003, 2, ascii(dt))];
  const gps = [E(0x0000, 1, new Uint8Array([2, 3, 0, 0])), E(0x0001, 2, ascii(lat >= 0 ? 'N' : 'S')), E(0x0002, 5, rat(dms(lat))),
    E(0x0003, 2, ascii(lon >= 0 ? 'E' : 'W')), E(0x0004, 5, rat(dms(lon)))];
  if (heading != null && !isNaN(heading)) gps.push(E(0x0010, 2, ascii('M')), E(0x0011, 5, rat([[Math.round(heading * 100), 100]])));
  if (acc != null) gps.push(E(0x001f, 5, rat([[Math.round(acc * 100), 100]])));
  const exifStart = 8 + size(ifd0), gpsStart = exifStart + size(exif);
  new DataView(ifd0[3][3].buffer).setUint32(0, exifStart); new DataView(ifd0[4][3].buffer).setUint32(0, gpsStart);
  const tiff = [new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]), bytes(ifd0, 8), bytes(exif, exifStart), bytes(gps, gpsStart)];
  const tlen = tiff.reduce((a, b) => a + b.length, 0);
  const seg = new Uint8Array(10 + tlen); const sv = new DataView(seg.buffer);
  sv.setUint16(0, 0xffe1); sv.setUint16(2, 8 + tlen); seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  let o = 10; for (const b of tiff) { seg.set(b, o); o += b.length; }
  return seg;
};
BW.processPhoto = async (file, info) => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const s = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const jpg = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
    if (info.lat == null) return { blob: jpg, w: c.width, h: c.height };
    const buf = new Uint8Array(await jpg.arrayBuffer()); const app1 = BW.exifSegment(info);
    const out = new Uint8Array(buf.length + app1.length); out.set(buf.subarray(0, 2), 0); out.set(app1, 2); out.set(buf.subarray(2), 2 + app1.length);
    return { blob: new Blob([out], { type: 'image/jpeg' }), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
};

// ---------- zip (stored, no compression) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
BW.makeZip = (files) => {
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
};
BW.readZip = async (blob) => {
  const b = new Uint8Array(await blob.arrayBuffer()); const dv = new DataView(b.buffer); const dec = new TextDecoder();
  let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
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
};
window.BW = BW;
