// Asset loading: Meshy model sprite sheets (towers, units, props), biome textures, VFX.
import { UNIT_PX, BIOMES } from './config.js';

const TAU = Math.PI * 2;

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function glow(r, g, b, size = 64) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, `rgba(${r},${g},${b},0.95)`);
  grd.addColorStop(0.45, `rgba(${r},${g},${b},0.35)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grd;
  x.fillRect(0, 0, size, size);
  return c;
}
function softCircle(r, g, b, a, size = 64) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${r},${g},${b},${a})`);
  grd.addColorStop(0.6, `rgba(${r},${g},${b},${a * 0.55})`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grd;
  x.fillRect(0, 0, size, size);
  return c;
}

// --- 3D model sprite sheets (rendered offline from Meshy GLBs) ---
export const Models = {
  data: {},
  meta(name) { return this.data[name]; },
  frameFor(name, ang) {
    const m = this.data[name];
    if (!m || m.n <= 1) return 0;
    const dirs = m.af ? m.n / m.af : m.n;   // animated sheets: one row of af frames per direction
    let f = Math.round(ang / TAU * dirs) % dirs;
    if (f < 0) f += dirs;
    return f;
  },
  // draw frame f with the model anchor at (x, y) world px; s = extra scale
  draw(ctx, name, f, x, y, s = 1, alpha = 1) {
    const m = this.data[name];
    if (!m || !m.img) return null;
    const k = m.scale * s;
    const sx = (f % m.cols) * m.w, sy = Math.floor(f / m.cols) * m.h;
    const dx = x - m.ax * k, dy = y - m.ay * k;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(m.img, sx, sy, m.w, m.h, dx, dy, m.w * k, m.h * k);
    if (alpha !== 1) ctx.globalAlpha = 1;
    return { x: dx, y: dy, w: m.w * k, h: m.h * k };
  },
  // distance (map cells) a unit covers per animation cycle: measured stride of the rendered gait,
  // capped at 5 cycles/s so fast units don't strobe
  cycleOf(def) {
    if (def._cycle) return def._cycle;
    const m = this.data[def.model];
    const c = m && m.rootDist ? m.rootDist * def.scale : (def.cycle || 1.1);
    def._cycle = Math.max(c, def.speed / 5);
    return def._cycle;
  },
  // current sprite frame of a unit (direction + walk phase for animated sheets)
  unitFrame(e) {
    const m = this.data[e.def.model];
    let f = this.frameFor(e.def.model, e.ang);
    if (m && m.af) f = f * m.af + (Math.floor((e.walk / this.cycleOf(e.def)) * m.af) % m.af);
    return f;
  },
  _cut: new Map(),
  // splits a frame into jagged pieces (cached) -> [{c: canvas, ox, oy}] offsets relative to the anchor in sprite px
  shards(name, f) {
    const key = name + ':' + f;
    if (this._cut.has(key)) return this._cut.get(key);
    const m = this.data[name];
    const out = [];
    const cols = 3, rows = 3;
    const jx = [], jy = [];
    for (let i = 0; i <= cols; i++) jx.push(i === 0 ? 0 : i === cols ? m.w : (i / cols) * m.w + (Math.random() - 0.5) * m.w * 0.12);
    for (let j = 0; j <= rows; j++) jy.push(j === 0 ? 0 : j === rows ? m.h : (j / rows) * m.h + (Math.random() - 0.5) * m.h * 0.12);
    const sx0 = (f % m.cols) * m.w, sy0 = Math.floor(f / m.cols) * m.h;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x0 = Math.floor(jx[i]), x1 = Math.ceil(jx[i + 1]), y0 = Math.floor(jy[j]), y1 = Math.ceil(jy[j + 1]);
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      // jagged polygon inside the cell
      g.beginPath();
      const pts = [[0, Math.random() * h * 0.25], [w * (0.3 + Math.random() * 0.4), 0], [w, Math.random() * h * 0.3], [w - Math.random() * w * 0.2, h], [Math.random() * w * 0.3, h - Math.random() * h * 0.2]];
      g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.closePath();
      g.clip();
      g.drawImage(m.img, sx0 + x0, sy0 + y0, w, h, 0, 0, w, h);
      // keep only shards that actually contain pixels
      const d = g.getImageData(0, 0, w, h).data;
      let filled = 0;
      for (let k = 3; k < d.length; k += 16) if (d[k] > 40) filled++;
      if (filled > 6) out.push({ c, ox: x0 + w / 2 - m.ax, oy: y0 + h / 2 - m.ay, w, h });
    }
    this._cut.set(key, out);
    return out;
  },
  _wreck: new Map(),
  // charred copy of a frame for wrecks
  wreck(name, f) {
    const key = name + ':' + f;
    if (this._wreck.has(key)) return this._wreck.get(key);
    const m = this.data[name];
    const c = document.createElement('canvas');
    c.width = m.w; c.height = m.h;
    const g = c.getContext('2d');
    g.drawImage(m.img, (f % m.cols) * m.w, Math.floor(f / m.cols) * m.h, m.w, m.h, 0, 0, m.w, m.h);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(22,16,12,0.72)';
    g.fillRect(0, 0, m.w, m.h);
    this._wreck.set(key, c);
    return c;
  },
  // baked ground shadow (key light from the upper left + contact shadow), drawn in the ground pass
  drawShadow(ctx, name, f, x, y, s = 1) {
    const m = this.data[name];
    if (!m || !m.shadowImg) return false;
    const sh = m.shadow, k = m.scale * s;
    ctx.drawImage(m.shadowImg, (f % m.cols) * sh.w, Math.floor(f / m.cols) * sh.h, sh.w, sh.h, x - sh.ax * k, y - sh.ay * k, sh.w * k, sh.h * k);
    return true;
  },
  drawBase(ctx, name, x, y, s = 1) {
    const m = this.data[name];
    if (!m || !m.baseImg) return;
    const k = m.scale * s;
    ctx.drawImage(m.baseImg, x - m.ax * k, y - m.ay * k, m.w * k, m.h * k);
  },
};

export const Assets = {
  img: {},
  tex: {},
  fx: {},
  vfx: {},
  ready: false,

  _meta: null,
  _pending: new Map(),
  // load one model sheet (+ base / shadow layers) into Models.data
  loadModel(name) {
    if (Models.data[name]) return Promise.resolve();
    if (this._pending.has(name)) return this._pending.get(name);
    const m = this._meta[name];
    if (!m) return Promise.resolve();
    const job = (async () => {
      const [img, baseImg, shadowImg] = await Promise.all([
        loadImage(`assets/models/${name}.webp`),
        m.base ? loadImage(`assets/models/${name}_base.webp`) : Promise.resolve(null),
        m.shadow ? loadImage(`assets/models/${name}_shadow.webp`) : Promise.resolve(null),
      ]);
      const scale = UNIT_PX / m.P;
      Models.data[name] = {
        ...m, img, baseImg, shadowImg, scale,
        centerPx: m.center ? -m.center[1] * scale : 40,
        topPx: m.top ? -m.top[1] * scale : 80,
      };
    })();
    this._pending.set(name, job);
    return job;
  },
  // enemy sheets are big: they are loaded per level, only for the types that appear
  loadModels(names) { return Promise.all(names.map(n => this.loadModel(n))); },

  async load(onProgress) {
    const meta = await fetch('assets/models/models.json').then(r => r.json());
    this._meta = meta;
    const names = Object.keys(meta).filter(n => !n.startsWith('enemy_'));
    const total = names.length + 1;
    let done = 0;
    const tick = () => onProgress && onProgress(++done / total);
    const jobs = [];
    for (const name of names) jobs.push(this.loadModel(name).then(tick));
    const VFX = {
      fire: ['explosion', 5, 20, 160, 0.5], plasma: ['explosion_plasma', 5, 20, 160, 0.5],
      heavy: ['explosion_heavy', 6, 24, 192, 0.7], ground: ['explosion_ground', 5, 20, 160, 0.56],
    };
    for (const [k, [file, cols, n, size, ay]] of Object.entries(VFX)) {
      jobs.push(loadImage(`assets/vfx/${file}.webp`).then((im) => { this.vfx[k] = { img: im, cols, n, size, ay }; }));
    }
    await Promise.all(jobs);
    this.fx = {
      orange: glow(255, 150, 40), yellow: glow(255, 220, 120), cyan: glow(70, 220, 255), violet: glow(190, 120, 255),
      red: glow(255, 50, 40), white: glow(220, 235, 255), green: glow(90, 255, 120), lava: glow(255, 90, 20, 96),
      smoke: softCircle(70, 66, 62, 0.55), dark: softCircle(10, 8, 6, 0.75), shadow: softCircle(0, 0, 0, 0.6, 128),
      flakSmoke: softCircle(30, 28, 26, 0.8), snow: softCircle(255, 255, 255, 0.9, 16),
    };
    this.ready = true;
  },

  async loadBiome(id) {
    const b = BIOMES[id];
    const want = [b.ground, b.road].filter(k => !this.tex[k]);
    await Promise.all(want.map(async (k) => { this.tex[k] = await loadImage(`assets/tex/${k}.jpg`); }));
  },
};
