// Asset loading: Meshy model sprite sheets, OpenArt prop sprites, biome textures, VFX.
import { UNIT_PX, BIOMES } from './config.js';

const TAU = Math.PI * 2;
const SPRITES = [
  'base_hq', 'spawn_gate',
  'prop_ruin', 'prop_wreck', 'prop_barrier', 'prop_tree', 'prop_crates', 'prop_scrap',
  'prop_j_tree', 'prop_j_heli', 'prop_j_temple', 'prop_j_bush',
  'prop_i_pine', 'prop_i_ice', 'prop_i_station', 'prop_i_wreck',
  'prop_d_rock', 'prop_d_tank', 'prop_d_pump',
  'prop_v_spire', 'prop_v_rocks', 'prop_v_factory',
];

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

  async load(onProgress) {
    const meta = await fetch('assets/models/models.json').then(r => r.json());
    const names = Object.keys(meta);
    const total = SPRITES.length + names.length + 1;
    let done = 0;
    const tick = () => onProgress && onProgress(++done / total);
    const jobs = [];
    for (const name of names) {
      const m = meta[name];
      jobs.push((async () => {
        const [img, baseImg] = await Promise.all([
          loadImage(`assets/models/${name}.webp`),
          m.base ? loadImage(`assets/models/${name}_base.webp`) : Promise.resolve(null),
        ]);
        const scale = UNIT_PX / m.P;
        Models.data[name] = {
          ...m, img, baseImg, scale,
          centerPx: m.center ? -m.center[1] * scale : 40,
          topPx: m.top ? -m.top[1] * scale : 80,
        };
        tick();
      })());
    }
    for (const name of SPRITES) {
      jobs.push(loadImage(`assets/sprites/${name}.webp`).then((im) => { if (im) this.img[name] = { n: im, w: im.width, h: im.height }; tick(); }));
    }
    jobs.push(loadImage('assets/vfx/explosion.webp').then((im) => { this.vfx.explosion = { img: im, cols: 5, n: 20, size: 160 }; tick(); }));
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
