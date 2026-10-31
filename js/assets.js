// Loads AI generated sprites (OpenArt renders, background removed) and builds variants.

const SPRITES = [
  'tower_gatling', 'tower_missile', 'tower_plasma', 'tower_rail', 'tower_emp',
  'enemy_spider', 'enemy_android', 'enemy_drone', 'enemy_mech', 'enemy_tank', 'enemy_boss',
  'enemy_spider_back', 'enemy_android_back', 'enemy_drone_back', 'enemy_mech_back', 'enemy_tank_back', 'enemy_boss_back',
  'prop_ruin', 'prop_wreck', 'prop_barrier', 'prop_tree', 'prop_crates', 'prop_scrap',
  'base_hq', 'spawn_gate',
];
const TEXTURES = ['ground', 'road'];

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

function flipped(img) {
  const c = makeCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(img, 0, 0);
  return c;
}

function tinted(img, color) {
  const c = makeCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function glow(r, g, b, size = 64, hard = 0.0) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(255,255,255,1)`);
  grd.addColorStop(0.12 + hard, `rgba(${r},${g},${b},0.95)`);
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

export const Assets = {
  img: {},       // name -> {n: normal, f: flipped, wn: white flash, wf: white flash flipped}
  tex: {},
  fx: {},
  ready: false,

  async load(onProgress) {
    const total = SPRITES.length + TEXTURES.length;
    let done = 0;
    const tick = () => onProgress && onProgress(++done / total);
    const jobs = SPRITES.map(async (name) => {
      const im = await loadImage(`assets/sprites/${name}.webp`);
      tick();
      if (!im) return;
      const entry = { n: im, w: im.width, h: im.height };
      if (name.startsWith('enemy_') || name.startsWith('tower_')) entry.f = flipped(im);
      if (name.startsWith('enemy_')) {
        entry.wn = tinted(im, '#ffffff');
        entry.wf = flipped(entry.wn);
      }
      this.img[name] = entry;
    });
    const tjobs = TEXTURES.map(async (name) => {
      this.tex[name] = await loadImage(`assets/tex/${name}.jpg`);
      tick();
    });
    await Promise.all([...jobs, ...tjobs]);
    // back-view fallbacks
    for (const k of Object.keys(this.img)) {
      if (k.startsWith('enemy_') && !k.endsWith('_back') && !this.img[k + '_back']) this.img[k + '_back'] = this.img[k];
    }
    this.fx = {
      orange: glow(255, 150, 40),
      yellow: glow(255, 220, 120),
      cyan: glow(70, 220, 255),
      violet: glow(190, 120, 255),
      red: glow(255, 50, 40),
      white: glow(220, 235, 255),
      smoke: softCircle(70, 66, 62, 0.55),
      dark: softCircle(10, 8, 6, 0.75),
      shadow: softCircle(0, 0, 0, 0.6, 128),
    };
    this.ready = true;
  },
};
