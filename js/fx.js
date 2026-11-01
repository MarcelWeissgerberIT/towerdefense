// Particle / effect system (world space). Video-based explosions + procedural particles.
import { Assets, Models } from './assets.js';
import { NUKE } from './config.js';
import { rand } from './iso.js';

const MAX_PARTICLES = 900;

export class FX {
  constructor() { this.splats = []; this.p = []; this.shake = 0; this.flash = 0; this.whiteout = 0; this.blind = null; this.lightning = 0; this.grainN = 0; }
  clear() { this.splats = []; this.p.length = 0; this.shake = 0; this.flash = 0; this.whiteout = 0; this.blind = null; this.lightning = 0; this.grainN = 0; }

  add(o) {
    if (this.p.length >= MAX_PARTICLES) {
      // drop the 40 oldest particles, but never key effects (mushroom cloud, big flashes)
      let n = 0;
      this.p = this.p.filter(q => q.keep || n++ >= 40);
    }
    o.t = 0;
    if (this.rtMode) o.rt = true;
    this.p.push(o);
    return o;
  }

  // ---- emitters ----
  muzzle(x, y, color = 'yellow', size = 26) { this.add({ k: 'glow', x, y, s: size, life: 0.07, spr: color }); }
  tracer(x1, y1, x2, y2, color = 'rgba(255,210,120,', w = 2.2) { this.add({ k: 'line', x1, y1, x2, y2, w, life: 0.06, c: color }); }
  sparks(x, y, n = 4, color = '#ffd27a', speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(0.3, 1) * speed;
      this.add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 40, life: rand(0.12, 0.32), c: color });
    }
  }
  smoke(x, y, n = 3, s = 26, life = 1.2, dark = false) {
    for (let i = 0; i < n; i++) {
      this.add({ k: 'smoke', x: x + rand(-8, 8), y: y + rand(-6, 6), vx: rand(-12, 12), vy: rand(-30, -10), s: s * rand(0.7, 1.2), grow: s * 1.7, life: life * rand(0.7, 1.2), a: rand(0.5, 0.8), dark });
    }
  }
  dust(x, y, scale = 1) {
    for (let i = 0; i < 8 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({ k: 'smoke', x: x + Math.cos(a) * 20, y: y + Math.sin(a) * 10, vx: Math.cos(a) * 50, vy: Math.sin(a) * 20 - 8, s: 22 * scale, grow: 40 * scale, life: 0.9, a: 0.5 });
    }
  }
  footDust(x, y, scale = 1) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({ k: 'smoke', x: x + Math.cos(a) * 10 * scale, y: y + Math.sin(a) * 5 * scale, vx: Math.cos(a) * 18 * scale, vy: Math.sin(a) * 8 - 6, s: 12 * scale, grow: 22 * scale, life: 0.7, a: 0.32 });
    }
  }
  // video fireball (sprite sheet) + procedural layers
  // video explosion; kind = fire | plasma | heavy | ground, randomly varied in size, speed, rotation and mirroring
  boom(x, y, size, life = 0.95, kind = 'fire') {
    const nuke = kind === 'nuke';
    const v = nuke ? 1 : rand(0.85, 1.2);
    return this.add({ k: 'boom', x, y, s: size * v, life: nuke ? life : life * rand(0.85, 1.15), rot: nuke ? 0 : kind === 'heavy' ? rand(-0.08, 0.08) : rand(-0.35, 0.35), flip: Math.random() < 0.5, kind, keep: nuke });
  }
  later(ms, fn) { setTimeout(fn, ms); }
  explosion(x, y, scale = 1, kind = 'fire') {
    this.boom(x, y - 10 * scale, 120 * scale, 0.7 + 0.15 * scale, kind);
    this.add({ k: 'glow', x, y, s: 110 * scale, life: 0.18, spr: 'orange' });
    this.sparks(x, y, Math.round(6 * scale), '#ffcf6a', 230 * scale);
    this.debris(x, y, Math.round(4 * scale), 180 * Math.sqrt(scale));
    this.smoke(x, y - 8 * scale, Math.round(2 * scale), 24 * scale, 1.3, true);
    this.shake = Math.max(this.shake, 2 * scale);
  }
  bigExplosion(x, y, scale = 1.5, kind = 'heavy') {
    // the "fat" one: big video blast, secondary fireballs, shockwave, flash, burning debris, smoke column
    if (kind === 'heavy') this.boom(x, y + 10 * scale, 190 * scale, 1.5, 'heavy');
    else this.boom(x, y - 20 * scale, 170 * scale, 1.05, kind);
    for (let i = 0; i < Math.round(1 + scale); i++) {
      this.later(70 + i * 110 + rand(0, 80), () => this.boom(x + rand(-45, 45) * scale, y - rand(0, 45) * scale, rand(80, 125) * scale, 0.9, Math.random() < 0.7 ? 'fire' : kind));
    }
    this.add({ k: 'glow', x, y, s: 260 * scale, life: 0.3, spr: 'orange' });
    this.add({ k: 'glow', x, y, s: 120 * scale, life: 0.14, spr: 'white' });
    this.add({ k: 'ring', x, y: y + 20 * scale, r0: 20 * scale, r1: 150 * scale, life: 0.45, c: '255,190,120' });
    this.add({ k: 'ring', x, y: y + 20 * scale, r0: 10 * scale, r1: 95 * scale, life: 0.3, c: '255,255,230' });
    this.sparks(x, y, Math.round(14 * scale), '#ffd27a', 360 * scale);
    for (let i = 0; i < 5 * scale; i++) {
      const a = rand(-Math.PI, 0), v = rand(180, 380) * Math.sqrt(scale);
      this.add({ k: 'ember', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.9, life: rand(0.8, 1.4), trail: 0 });
    }
    this.debris(x, y, Math.round(10 * scale), 280 * Math.sqrt(scale));
    this.smoke(x, y - 20 * scale, Math.round(5 * scale), 40 * scale, 2.4, true);
    this.shake = Math.max(this.shake, 6 * scale);
    this.flash = Math.max(this.flash, Math.min(0.5, 0.15 * scale));
  }
  debris(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(0.3, 1) * speed;
      this.add({ k: 'debris', x, y, z: 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rand(140, 340), life: rand(0.8, 1.4), s: rand(2, 6), c: Math.random() < 0.5 ? '#2a2a2a' : '#7c7c80' });
    }
  }
  // creatures bleed: drops fly in an arc, fall to the ground (floor = world y of the ground under the unit) and
  // leave a small stain there; bones / stone shatter into chips, ghosts spill glowing ectoplasm, angels lose feathers
  // B = def.blood: { c: colour, c2: second colour, glow, chips: colour (no stains), feathers: colour }
  blood(x, y, floor, B, n = 4, dirX = 0, power = 1) {
    if (!B) return;
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), v = rand(60, 210) * power;
      const c = B.chips || (B.c2 && Math.random() < 0.35 ? B.c2 : B.c);
      this.add({ k: 'drop', x: x + rand(-5, 5), y: y + rand(-6, 6), vx: Math.cos(a) * v * 0.9 + dirX * rand(40, 140), vy: Math.sin(a) * v - 40,
        floor: floor + rand(-7, 7), life: 2.2, r: B.chips ? rand(1.4, 2.8) : rand(1.3, 2.6), c, glow: B.glow, chip: !!B.chips });
    }
    if (B.glow) this.add({ k: 'glow', x, y, s: 26 + 6 * n, life: 0.2, spr: B.glow });
    if (B.feathers && Math.random() < 0.5 + 0.1 * n) {
      for (let i = 0; i < Math.max(1, n >> 1); i++) this.add({ k: 'feather', x: x + rand(-14, 14), y: y + rand(-14, 6), vx: rand(-50, 50), vy: rand(-70, -20), floor: floor + rand(-5, 5), life: rand(2.4, 3.6), rot: rand(0, 6.3), vr: rand(-4, 4), c: B.feathers });
    }
  }
  // machine destroyed: kind-specific blast, the sprite splinters into burning pieces, heavy units leave a wreck
  death(e, info) {
    const { x, y, ground, kind, scale, frame } = info;
    const name = e.def.model;
    const m = Models.meta(name);
    const heavy = e.def.cost >= 7 || e.def.boss;
    const s0 = (m ? m.scale : 0.7) * e.def.scale;
    if (kind === 'ember') {
      // demon / fallen angel: burns away into glowing embers that rise into the sky
      this.add({ k: 'glow', x, y, s: 110 * Math.min(scale, 2), life: 0.55, spr: 'orange' });
      if (m && m.img) this.disintegrate(e, { mode: 'nuke', frame, s0, from: { x: x + rand(-20, 20), y: y + 260 }, hold: 0.12 });
      if (e.def.boss) this.bigExplosion(x, y, scale, 'fire');
      return;
    }
    if (kind === 'nuke' || kind === 'rad') {
      // caught by the nuclear blast / killed by radiation: the machine glows and crumbles to dust
      const nuke = kind === 'nuke';
      this.add({ k: 'glow', x, y, s: (nuke ? 130 : 90) * Math.min(scale, 2), life: nuke ? 0.6 : 0.5, spr: nuke ? 'orange' : 'green' });
      if (m && m.img) this.disintegrate(e, { mode: kind, frame, s0, from: info.from, hold: info.hold || 0 });
      if (e.def.boss) this.bigExplosion(x, y, scale, 'heavy');
      return;
    }
    if (kind === 'ice') {
      // frozen machine bursts into ice
      this.boom(x, y, 100 * scale, 0.6, 'plasma');
      this.add({ k: 'glow', x, y, s: 170 * scale, life: 0.3, spr: 'white' });
      this.add({ k: 'ring', x, y, r0: 10, r1: 90 * scale, life: 0.35, c: '200,245,255' });
      for (let i = 0; i < 18 * scale; i++) this.add({ k: 'spark', x, y, vx: rand(-260, 260) * scale, vy: rand(-300, 40), c: Math.random() < 0.5 ? '#ffffff' : '#bfefff', life: rand(0.4, 0.8) });
      for (let i = 0; i < 4; i++) this.add({ k: 'mist', x: x + rand(-20, 20), y: y + rand(-10, 10), vx: rand(-20, 20), vy: rand(-20, -5), s: 22, grow: 40, life: 1.1 });
    } else if (kind === 'acid') {
      this.boom(x, y - 6, 100 * scale, 0.8, 'fire');
      this.add({ k: 'glow', x, y, s: 140 * scale, life: 0.35, spr: 'green' });
      for (let i = 0; i < 12 * scale; i++) this.add({ k: 'drip', x, y, vx: rand(-150, 150), vy: rand(-200, -40), life: rand(0.4, 0.7) });
      for (let i = 0; i < 5; i++) this.add({ k: 'gsmoke', x: x + rand(-18, 18), y: y + rand(-10, 6), vx: rand(-10, 10), vy: rand(-30, -10), s: 18, grow: 40, life: 1.2 });
    } else if (kind === 'plasma') {
      this.boom(x, y, 130 * scale, 0.75, 'plasma');
      this.add({ k: 'glow', x, y, s: 150 * scale, life: 0.25, spr: 'cyan' });
      this.sparks(x, y, Math.round(12 * scale), '#aef0ff', 300 * scale);
      if (heavy) this.later(120, () => this.boom(x + rand(-20, 20), y - 10, 150 * scale, 1.1, 'fire'));
    } else if (kind === 'burn') {
      this.boom(x, y - 10, 110 * scale, 0.9, 'fire');
      for (let i = 0; i < 8 * scale; i++) this.burn(x + rand(-20, 20) * scale, y + rand(-15, 10) * scale);
    } else if (heavy) {
      this.bigExplosion(x, y, scale, 'heavy');
    } else {
      this.explosion(x, y, scale, Math.random() < 0.25 ? 'heavy' : 'fire');
    }
    // splinters of the machine itself
    if (m && m.img) {
      const shards = Models.shards(name, frame);
      const lift = e.air ? e.def.lift : 0;
      for (const sh of shards) {
        const a = Math.atan2(sh.oy, sh.ox) + rand(-0.5, 0.5);
        const v = rand(80, 220) * (heavy ? 0.8 : 1.1);
        this.add({
          k: 'shard', c: sh.c, w: sh.w * s0, h: sh.h * s0,
          x: e.wx + sh.ox * s0, y: e.wy + sh.oy * s0 - lift, z: 0, base: e.wy + rand(-8, 10),
          vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rand(160, 380), rot: 0, vr: rand(-9, 9),
          life: rand(1.1, 1.9), burn: kind !== 'ice' && kind !== 'acid' && Math.random() < 0.45, ice: kind === 'ice', acid: kind === 'acid', trail: 0,
        });
      }
    }
    // charred wreck for heavy ground machines: burns for a moment, then crumbles to dust
    if (ground && heavy && m && m.img && kind !== 'ice') {
      this.disintegrate(e, { mode: 'wreck', frame, s0, hold: e.def.boss ? 5 : rand(2.2, 2.8), img: Models.wreck(name, frame) });
    }
    if (heavy) {
      // chain of secondary detonations
      const n = e.def.boss ? 7 : 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this.later(180 + i * rand(120, 260), () => {
          const ox = rand(-40, 40) * scale, oy = rand(-30, 10) * scale;
          this.boom(x + ox, y + oy, rand(60, 110) * Math.sqrt(scale), 0.8, Math.random() < 0.3 ? 'ground' : 'fire');
          this.sparks(x + ox, y + oy, 6, '#ffd27a', 220);
          this.shake = Math.max(this.shake, 2.5);
        });
      }
    }
  }
  // a machine falls apart into dust: a front sweeps across the sprite along (dx, dy); everything behind it has
  // turned into grains that drift off. mode 'nuke' = glowing hot, blown away from ground zero; 'rad' = green
  // glow, rising; 'wreck' = charred hull crumbling from the top down after burning for `hold` seconds.
  disintegrate(e, { mode, frame, s0, from = null, hold = 0, img = null }) {
    const name = e.def.model, m = Models.meta(name);
    if (!m || !m.img) return;
    const lift = e.air ? e.def.lift : 0;
    const x = e.wx, y = e.wy - lift;
    const budget = this.grainN > 4500 ? 0.3 : this.grainN > 2500 ? 0.55 : 1;
    const G = Models.grains(name, frame, Math.max(20, Math.round((e.def.boss ? 260 : mode === 'wreck' ? 130 : 120) * budget)));
    const n = G.pts.length / 2;
    if (!n) return;
    let dx = 0, dy = 1;
    if (mode === 'nuke') {
      const a0 = Math.random() * Math.PI * 2;
      dx = from ? x - from.x : Math.cos(a0); dy = from ? y - from.y : Math.sin(a0);
      const l = Math.hypot(dx, dy);
      if (l > 6) { dx /= l; dy /= l; } else { dx = Math.cos(a0); dy = Math.sin(a0); }
    } else if (mode === 'rad') { const a = rand(-2.6, -0.5); dx = Math.cos(a); dy = Math.sin(a); }
    const T = mode === 'wreck' ? 1.3 : mode === 'rad' ? 1.1 : 0.9;
    const g = new Float32Array(n * 6);
    let p0 = Infinity, p1 = -Infinity;
    for (let i = 0; i < n; i++) { const pr = G.pts[2 * i] * s0 * dx + G.pts[2 * i + 1] * s0 * dy; if (pr < p0) p0 = pr; if (pr > p1) p1 = pr; }
    const span = Math.max(1, p1 - p0), px = -dy, py = dx;
    for (let i = 0; i < n; i++) {
      const ox = G.pts[2 * i] * s0, oy = G.pts[2 * i + 1] * s0, j = i * 6;
      g[j] = ox; g[j + 1] = oy;
      g[j + 2] = hold + T * ((ox * dx + oy * dy) - p0) / span + rand(-0.05, 0.05);
      if (mode === 'nuke') {
        const v = rand(40, 170), side = rand(-40, 40);
        g[j + 3] = dx * v + px * side; g[j + 4] = dy * v + py * side - rand(10, 60); g[j + 5] = rand(0.8, 1.5);
      } else if (mode === 'rad') {
        g[j + 3] = dx * rand(5, 30) + rand(-18, 18); g[j + 4] = dy * rand(5, 30) - rand(25, 60); g[j + 5] = rand(0.9, 1.6);
      } else {
        g[j + 3] = rand(-32, 32); g[j + 4] = rand(-30, 0); g[j + 5] = rand(0.9, 1.5);
      }
    }
    this.add({ k: 'disint', mode, name, f: frame, img, x, y, s0, dx, dy, p0, p1, hold, T, g, n, gs: Math.max(2, G.cell * s0 * 1.05), life: hold + T + 1.7, keep: true, fire: 0 });
    this.grainN += n;
  }
  plasmaHit(x, y, k = 1) {
    this.add({ k: 'glow', x, y, s: 120 * k, life: 0.3, spr: 'cyan' });
    this.add({ k: 'ring', x, y, r0: 10, r1: 80 * k, life: 0.35, c: '90,230,255' });
    this.sparks(x, y, Math.round(10 * k), '#9ff3ff', 260 * k);
  }
  flakBurst(x, y) {
    this.add({ k: 'glow', x, y, s: 60, life: 0.12, spr: 'yellow' });
    this.add({ k: 'smoke', x, y, vx: 0, vy: -6, s: 26, grow: 30, life: 0.9, a: 0.85, dark: true });
    this.sparks(x, y, 5, '#fff0b0', 200);
  }
  shieldBreak(x, y) {
    this.add({ k: 'ring', x, y, r0: 20, r1: 70, life: 0.35, c: '120,200,255' });
    this.add({ k: 'glow', x, y, s: 90, life: 0.25, spr: 'cyan' });
    this.sparks(x, y, 10, '#aee6ff', 220);
  }
  healBeam(x1, y1, x2, y2) { this.add({ k: 'line', x1, y1, x2, y2, w: 2.5, life: 0.25, c: 'rgba(110,255,140,' }); this.add({ k: 'glow', x: x2, y: y2, s: 30, life: 0.3, spr: 'green' }); }
  burn(x, y) { this.add({ k: 'fire', x, y, vx: rand(-10, 10), vy: rand(-50, -25), s: rand(12, 20), life: rand(0.25, 0.45) }); }
  flame(x, y, dx, dy, len, lvl = 1) {
    for (let i = 0; i < 2 + lvl; i++) {
      const sp = rand(0.75, 1.1) * len / 0.42, spread = rand(-0.22, 0.22);
      const vx = (dx * Math.cos(spread) - dy * Math.sin(spread)) * sp, vy = (dx * Math.sin(spread) + dy * Math.cos(spread)) * sp;
      this.add({ k: 'fire', x, y, vx, vy: vy - 10, s: rand(10, 16) * (1 + 0.2 * (lvl - 1)), grow: 34 * (1 + 0.25 * (lvl - 1)), life: rand(0.32, 0.45) });
    }
    if (Math.random() < 0.3) this.add({ k: 'smoke', x: x + dx * len * 0.8, y: y + dy * len * 0.8 - 10, vx: dx * 30, vy: -30, s: 18, grow: 30, life: 0.9, a: 0.4, dark: true });
  }
  beam(x1, y1, x2, y2, w = 1) {
    this.add({ k: 'beam', x1, y1, x2, y2, life: 0.35, w });
    this.add({ k: 'glow', x: x1, y: y1, s: 80, life: 0.2, spr: 'white' });
  }
  bolt(pts, lvl = 1) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      for (let s = 0; s < 6; s++) {
        const t = s / 6, j = s === 0 ? 0 : 9;
        out.push([ax + (bx - ax) * t + rand(-j, j), ay + (by - ay) * t + rand(-j, j)]);
      }
    }
    out.push(pts[pts.length - 1]);
    this.add({ k: 'bolt', pts: out, life: 0.16, w: 1 + 0.4 * (lvl - 1) });
    for (let i = 1; i < pts.length; i++) this.add({ k: 'glow', x: pts[i][0], y: pts[i][1], s: 46, life: 0.18, spr: 'violet' });
  }
  // nuclear detonation: white-out, mushroom cloud, shock waves, a ring of dust and burning debris
  // nuclear detonation, part 1: the flash - X-ray and white-out are drawn by the renderer (real time);
  // random white frames and glitches make the X-ray flicker
  nuke(x, y) {
    const flick = [];
    for (let t = 0.5; t < NUKE.xray[1] - 0.2; t += rand(0.3, 0.75)) flick.push([t, rand(0.04, 0.09), Math.random() < 0.55 ? 'w' : 'g']);
    this.blind = { t: 0, x, y: y - 120, flick };
    this.flash = 1;
    this.shake = 22;
  }
  // part 2, when the light fades: fireball, mushroom cloud, shock rings, debris - in real time, so the
  // mushroom cloud rises at full speed no matter how slow the world around it runs
  nukeBlast(x, y) {
    const rt = (fn) => { this.rtMode = true; try { fn(); } finally { this.rtMode = false; } };
    this.shake = 36;
    this.flash = Math.max(this.flash, 0.8);
    rt(() => {
      this.boom(x, y + 20, 820, 6.5, Assets.vfx.nuke ? 'nuke' : 'heavy');
      this.add({ k: 'glow', x, y: y - 60, s: 900, life: 0.9, spr: 'white', keep: true });
      this.add({ k: 'glow', x, y: y - 40, s: 600, life: 1.6, spr: 'orange', keep: true });
      for (const [r1, life, c] of [[1100, 1.4, '255,255,255'], [800, 1.1, '255,200,120'], [520, 0.8, '255,150,60']]) this.add({ k: 'ring', x, y, r0: 30, r1, life, c, keep: true });
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2, v = rand(160, 420);
        this.add({ k: 'smoke', x: x + Math.cos(a) * 40, y: y + Math.sin(a) * 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, s: rand(30, 50), grow: 120, life: rand(1.6, 2.6), a: 0.7, dark: Math.random() < 0.6 });
      }
      for (let i = 0; i < 40; i++) this.add({ k: 'ember', x: x + rand(-60, 60), y: y - rand(0, 80), vx: rand(-420, 420), vy: rand(-620, -120), trail: 0, life: rand(1.0, 1.8) });
      this.debris(x, y, 30, 520);
    });
    this.later(450, () => rt(() => this.add({ k: 'ring', x, y, r0: 60, r1: 1300, life: 1.8, c: '220,200,180' })));
    for (let i = 0; i < 10; i++) this.later(300 + i * 160, () => rt(() => {
      const a = Math.random() * Math.PI * 2, r = rand(120, 360);
      this.boom(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.5, rand(110, 190), 1.0, Math.random() < 0.5 ? 'ground' : 'fire');
      this.shake = Math.max(this.shake, 8);
    }));
  }
  // light and debris orbiting into a black hole (cx, cy = core)
  orbit(cx, cy, r, debris = false) {
    this.add({ k: 'orbit', cx, cy, r, a: Math.random() * Math.PI * 2, va: rand(2.5, 4.5), vr: r / rand(0.9, 1.6), debris, c: debris ? '#2a2630' : Math.random() < 0.5 ? '#ffd6a0' : '#d9a8ff', life: 1.6, x: cx, y: cy });
  }
  holeCollapse(x, y) {
    this.flash = Math.max(this.flash, 0.6);
    this.add({ k: 'glow', x, y, s: 520, life: 0.5, spr: 'violet', keep: true });
    this.add({ k: 'glow', x, y, s: 260, life: 0.35, spr: 'white', keep: true });
    for (const [r1, life, c] of [[700, 0.9, '220,170,255'], [420, 0.6, '255,255,255']]) this.add({ k: 'ring', x, y: y + 70, r0: 20, r1, life, c, keep: true });
    for (let i = 0; i < 40; i++) this.add({ k: 'spark', x, y, vx: rand(-420, 420), vy: rand(-380, 200), c: Math.random() < 0.5 ? '#e7c8ff' : '#ffffff', life: rand(0.4, 0.9) });
  }
  frostMist(x, y) {
    this.add({ k: 'mist', x, y, vx: rand(-14, 14), vy: rand(-18, -6), s: rand(14, 24), grow: 26, life: rand(0.5, 0.9) });
    if (Math.random() < 0.5) this.add({ k: 'spark', x, y, vx: rand(-60, 60), vy: rand(-90, -20), c: '#eafcff', life: rand(0.25, 0.45) });
  }
  acidDrip(x, y) {
    this.add({ k: 'drip', x, y, vx: rand(-10, 10), vy: rand(-20, 10), life: rand(0.35, 0.6) });
    if (Math.random() < 0.3) this.add({ k: 'gsmoke', x, y, vx: rand(-6, 6), vy: rand(-22, -10), s: 10, grow: 18, life: 0.7 });
  }
  acidSplash(x, y, k = 1) {
    this.add({ k: 'glow', x, y, s: 90 * k, life: 0.3, spr: 'green' });
    this.add({ k: 'ring', x, y, r0: 8, r1: 60 * k, life: 0.3, c: '150,255,80' });
    for (let i = 0; i < 10 * k; i++) this.add({ k: 'drip', x, y: y - 6, vx: rand(-110, 110), vy: rand(-160, -40), life: rand(0.35, 0.6) });
    for (let i = 0; i < 3; i++) this.add({ k: 'gsmoke', x: x + rand(-14, 14), y: y - rand(0, 10), vx: rand(-8, 8), vy: rand(-26, -10), s: 16, grow: 30, life: 0.9 });
  }
  thermalShock(x, y) {
    this.add({ k: 'glow', x, y, s: 150, life: 0.3, spr: 'white' });
    this.add({ k: 'ring', x, y, r0: 10, r1: 90, life: 0.35, c: '255,230,200' });
    for (let i = 0; i < 7; i++) this.add({ k: 'smoke', x: x + rand(-16, 16), y: y + rand(-12, 8), vx: rand(-40, 40), vy: rand(-60, -20), s: 18, grow: 46, life: rand(0.8, 1.2), a: 0.75 });
    this.sparks(x, y, 12, '#fff2dc', 260);
  }
  text(x, y, str, color = '#ffd34d') { this.add({ k: 'text', x, y, str, c: color, life: 0.9 }); }
  trail(x, y) { this.add({ k: 'smoke', x, y, vx: rand(-6, 6), vy: rand(-10, -2), s: 9, grow: 22, life: 0.6, a: 0.45 }); }

  // rt = true advances only the real-time particles (nuclear blast), false only the normal ones
  update(dt, rt = false) {
    const p = this.p;
    const spawned = [];
    let w = 0;
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const o = p[i];
      if (!!o.rt !== rt) { p[w++] = o; continue; }
      o.t += dt;
      if (o.t >= o.life) { if (o.k === 'disint') this.grainN -= o.n; continue; }
      switch (o.k) {
        case 'disint':
          if (o.mode === 'wreck' && o.t < o.hold) {
            o.fire -= dt;
            if (o.fire <= 0) {
              o.fire = 0.14;
              const m = Models.meta(o.name), hw = m ? m.w * o.s0 * 0.25 : 20, hh = m ? m.h * o.s0 : 40;
              spawned.push({ k: 'smoke', x: o.x + rand(-hw, hw), y: o.y - hh * 0.25, vx: rand(-6, 6), vy: -26, s: 16, grow: 40, life: 1.6, a: 0.45, dark: true, t: 0 });
              if (Math.random() < 0.5) spawned.push({ k: 'fire', x: o.x + rand(-hw * 0.8, hw * 0.8), y: o.y - rand(5, hh * 0.35), vx: rand(-6, 6), vy: rand(-40, -20), s: rand(10, 18), life: rand(0.3, 0.5), t: 0 });
            }
          }
          break;
        case 'spark': o.x += o.vx * dt; o.y += o.vy * dt; o.vy += 380 * dt; break;
        case 'drop':
          o.x += o.vx * dt; o.y += o.vy * dt; o.vy += 720 * dt;
          if (o.vy > 0 && o.y >= o.floor) {
            if (!o.chip && this.splats.length < 300) this.splats.push({ x: o.x, y: o.floor, r: o.r * rand(1.7, 3.0), c: o.c, glow: o.glow });
            o.t = o.life;                              // gone (the stain stays on the ground)
          }
          break;
        case 'feather':
          o.vx *= 1 - dt * 1.8; o.vy = Math.min(o.vy + 120 * dt, 34); o.x += (o.vx + Math.sin(o.t * 5 + o.rot) * 26) * dt; o.y += o.vy * dt; o.rot += o.vr * dt;
          if (o.y >= o.floor) { o.y = o.floor; o.vx = 0; o.vy = 0; o.vr = 0; }
          break;
        case 'smoke': case 'fire': o.x += o.vx * dt; o.y += o.vy * dt; if (o.k === 'fire') { o.vx *= 1 - dt * 2.5; o.vy *= 1 - dt * 2.5; o.vy -= 40 * dt; } break;
        case 'debris':
          o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; o.vz -= 900 * dt;
          if (o.z < 0) { o.z = 0; o.vz *= -0.35; o.vx *= 0.5; o.vy *= 0.5; }
          break;
        case 'ember':
          o.x += o.vx * dt; o.y += o.vy * dt; o.vy += 420 * dt;
          o.trail -= dt;
          if (o.trail <= 0) { o.trail = 0.04; spawned.push({ k: 'smoke', x: o.x, y: o.y, vx: 0, vy: -8, s: 8, grow: 18, life: 0.7, a: 0.5, dark: true, t: 0 }); }
          break;
        case 'text': o.y -= 34 * dt; break;
        case 'mist': case 'gsmoke': o.x += o.vx * dt; o.y += o.vy * dt; o.vx *= 1 - dt * 1.5; break;
        case 'orbit':
          o.a += o.va * dt * (1 + 60 / (o.r + 20));
          o.r = Math.max(0, o.r - o.vr * dt);
          o.x = o.cx + Math.cos(o.a) * o.r; o.y = o.cy + Math.sin(o.a) * o.r * 0.42;
          if (o.r <= 2) o.t = o.life;
          break;
        case 'drip': o.x += o.vx * dt; o.y += o.vy * dt; o.vy += 520 * dt; break;
        case 'shard':
          o.x += o.vx * dt; o.y += o.vy * dt;
          if (o.z > 0 || o.vz > 0) {
            o.z += o.vz * dt; o.vz -= 900 * dt; o.rot += o.vr * dt;
            if (o.z < 0) { o.z = 0; o.vz = o.vz < -120 ? -o.vz * 0.3 : 0; o.vx *= 0.4; o.vy *= 0.4; o.vr *= 0.4; }
          } else { o.vx *= 1 - dt * 6; o.vy *= 1 - dt * 6; }
          if (o.burn) { o.trail -= dt; if (o.trail <= 0 && o.t < o.life * 0.7) { o.trail = 0.05; spawned.push({ k: 'smoke', x: o.x, y: o.y - o.z, vx: 0, vy: -12, s: 8, grow: 20, life: 0.7, a: 0.45, dark: true, t: 0 }); } }
          break;
        case 'wreck':
          o.fire -= dt;
          if (o.fire <= 0 && o.t < o.life * 0.75) {
            o.fire = 0.12;
            spawned.push({ k: 'smoke', x: o.x + rand(-o.w * 0.25, o.w * 0.25), y: o.y - o.h * 0.25, vx: rand(-6, 6), vy: -26, s: 16, grow: 40, life: 1.8, a: 0.5, dark: true, t: 0 });
            if (Math.random() < 0.5) spawned.push({ k: 'fire', x: o.x + rand(-o.w * 0.2, o.w * 0.2), y: o.y - rand(5, o.h * 0.35), vx: rand(-6, 6), vy: rand(-40, -20), s: rand(10, 18), life: rand(0.3, 0.5), t: 0 });
          }
          break;
      }
      p[w++] = o;
    }
    // particles added by add() during this frame (after index n) are kept as well
    for (let i = n; i < p.length; i++) p[w++] = p[i];
    p.length = w;
    for (const o of spawned) if (p.length < MAX_PARTICLES) { if (rt) o.rt = true; p.push(o); }
    if (!this.realtimeScreen) this.screen(dt);
  }

  // screen-space effects decay in real time (they keep fading while the world is frozen / in slow motion)
  // nuclear flash phases (real time): white flashes alternating with an X-ray negative, then the burn-out
  blindState() {
    const b = this.blind;
    if (!b) return null;
    const t = b.t, [x0, x1] = NUKE.xray, we = NUKE.whiteEnd;
    let xray = t > x0 && t < x1, glitch = false;
    let white = xray ? 0 : t < 0.08 ? 1 : t < x0 ? 0.55 : t < we ? 1 : Math.pow(Math.max(0, 1 - (t - we) / 1.1), 1.6);
    if (xray && b.flick) for (const [a, d, k] of b.flick) if (t >= a && t < a + d) { if (k === 'w') { xray = false; white = 0.85; } else glitch = true; }
    const beat = xray && NUKE.heartbeats.some(h => t >= h && t < h + 0.09);
    return { t, x: b.x, y: b.y, xray, beat, glitch, white, glow: t < we ? 0 : 0.95 * Math.pow(Math.max(0, 1 - (t - we + 0.4) / 3.2), 1.3) };
  }
  screen(dt) {
    this.shake = Math.max(0, this.shake - dt * 18);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.whiteout = Math.max(0, this.whiteout - dt * 1.6);
    if (this.blind && (this.blind.t += dt) > NUKE.whiteEnd + 3) this.blind = null;
    this.lightning = Math.max(0, this.lightning - dt * 4);
  }

  draw(ctx) {
    const fx = Assets.fx;
    // pass 0: wrecks lie on the ground, machines that are crumbling
    let nukeBoom = null;
    for (const o of this.p) {
      if (o.k === 'wreck') {
        const k = o.t / o.life;
        ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        ctx.drawImage(o.c, o.x - o.ax, o.y - o.ay, o.w, o.h);
      } else if (o.k === 'disint') this.drawIntact(ctx, o);
    }
    ctx.globalAlpha = 1;
    for (const o of this.p) if (o.k === 'disint') this.drawGrains(ctx, o);
    // pass 1: normal blending (smoke, debris, shards, video explosions, text)
    for (const o of this.p) {
      const k = o.t / o.life;
      switch (o.k) {
        case 'shard': {
          ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
          ctx.save();
          ctx.translate(o.x, o.y - o.z);
          ctx.rotate(o.rot);
          ctx.drawImage(o.c, -o.w / 2, -o.h / 2, o.w, o.h);
          ctx.restore();
          break;
        }
        case 'smoke': {
          const s = o.s + o.grow * k;
          ctx.globalAlpha = o.a * (1 - k) * (o.dark ? 1 : 0.9);
          ctx.drawImage(o.dark ? fx.flakSmoke : fx.smoke, o.x - s / 2, o.y - s / 2, s, s);
          break;
        }
        case 'orbit':
          if (o.debris) { ctx.globalAlpha = Math.min(1, o.r / 30); ctx.fillStyle = o.c; ctx.fillRect(o.x - 2.5, o.y - 2.5, 5, 5); }
          break;
        case 'drip':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = '#7dff2e';
          ctx.fillRect(o.x - 1.6, o.y - 1.6, 3.2, 3.2);
          break;
        case 'gsmoke': {
          const s = o.s + o.grow * k;
          ctx.globalAlpha = 0.45 * (1 - k);
          ctx.drawImage(fx.smoke, o.x - s / 2, o.y - s / 2, s, s);
          break;
        }
        case 'debris':
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = o.c;
          ctx.fillRect(o.x - o.s / 2, o.y - o.z - o.s / 2, o.s, o.s);
          break;
        case 'drop': {
          ctx.globalAlpha = 1;
          ctx.fillStyle = o.c;
          // stretched along the flight direction
          const sp = Math.hypot(o.vx, o.vy) || 1, st = Math.min(2.6, 1 + sp / 260);
          ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r * st, o.r, Math.atan2(o.vy, o.vx), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'feather':
          ctx.globalAlpha = Math.min(1, (1 - k) * 3);
          ctx.fillStyle = o.c;
          ctx.beginPath(); ctx.ellipse(o.x, o.y, 4.5, 1.5, o.rot, 0, Math.PI * 2); ctx.fill();
          break;
        case 'boom': {
          // the mushroom cloud is drawn last, on top of all smoke and explosions
          if (o.kind === 'nuke') { (nukeBoom || (nukeBoom = [])).push(o); break; }
          this.drawBoom(ctx, o, k);
          break;
        }
        case 'text':
          ctx.globalAlpha = 1 - k * k;
          ctx.font = '700 15px "Rajdhani", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.strokeText(o.str, o.x, o.y);
          ctx.fillStyle = o.c;
          ctx.fillText(o.str, o.x, o.y);
          break;
      }
    }
    // pass 2: additive light
    ctx.globalCompositeOperation = 'lighter';
    for (const o of this.p) {
      const k = o.t / o.life;
      switch (o.k) {
        case 'glow': {
          const s = o.s * (0.7 + 0.3 * (1 - k));
          ctx.globalAlpha = 1 - k;
          ctx.drawImage(fx[o.spr], o.x - s / 2, o.y - s / 2, s, s);
          break;
        }
        case 'fire': {
          const s = o.s + (o.grow || 0) * k;
          ctx.globalAlpha = (1 - k) * 0.85;
          ctx.drawImage(k < 0.35 ? fx.yellow : fx.orange, o.x - s / 2, o.y - s / 2, s, s);
          break;
        }
        case 'ember': {
          ctx.globalAlpha = 1 - k;
          ctx.drawImage(fx.orange, o.x - 9, o.y - 9, 18, 18);
          break;
        }
        case 'mist': {
          const s = o.s + o.grow * k;
          ctx.globalAlpha = 0.32 * (1 - k);
          ctx.drawImage(fx.cyan, o.x - s / 2, o.y - s / 2, s, s);
          ctx.globalAlpha = 0.2 * (1 - k);
          ctx.drawImage(fx.white, o.x - s / 3, o.y - s / 3, s / 1.5, s / 1.5);
          break;
        }
        case 'gsmoke': {
          const s = (o.s + o.grow * k) * 0.8;
          ctx.globalAlpha = 0.25 * (1 - k);
          ctx.drawImage(fx.green, o.x - s / 2, o.y - s / 2, s, s);
          break;
        }
        case 'drip':
          ctx.globalAlpha = 0.6 * (1 - k);
          ctx.drawImage(fx.green, o.x - 6, o.y - 6, 12, 12);
          break;
        case 'orbit': {
          if (o.debris) break;
          const s = 6 + o.r * 0.05;
          ctx.globalAlpha = Math.min(1, o.r / 40) * 0.9;
          ctx.strokeStyle = o.c; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.cx + Math.cos(o.a - 0.25) * (o.r + 6), o.cy + Math.sin(o.a - 0.25) * (o.r + 6) * 0.42); ctx.stroke();
          ctx.drawImage(fx.violet, o.x - s, o.y - s, s * 2, s * 2);
          break;
        }
        case 'boom': {
          if (k < 0.35) {
            ctx.globalAlpha = (0.35 - k) * 1.4;
            const s = o.s * 1.3;
            ctx.drawImage(o.kind === 'plasma' ? fx.cyan : fx.orange, o.x - s / 2, o.y - s / 2, s, s);
          }
          break;
        }
        case 'shard': {
          if ((o.ice || o.acid) && k < 0.8) {
            ctx.globalAlpha = (0.8 - k) * 0.7;
            const s = Math.max(o.w, o.h) * 0.9;
            ctx.drawImage(o.ice ? fx.cyan : fx.green, o.x - s / 2, o.y - o.z - s / 2, s, s);
          }
          if (o.burn && k < 0.75) {
            ctx.globalAlpha = (0.75 - k) * 0.9;
            const s = Math.max(o.w, o.h) * 0.9;
            ctx.drawImage(fx.orange, o.x - s / 2, o.y - o.z - s / 2, s, s);
          }
          break;
        }
        case 'spark':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = o.c;
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x - o.vx * 0.03, o.y - o.vy * 0.03); ctx.stroke();
          break;
        case 'line':
          ctx.globalAlpha = 1;
          ctx.strokeStyle = o.c + (1 - k).toFixed(2) + ')';
          ctx.lineWidth = o.w;
          ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
          break;
        case 'beam': {
          const a = 1 - k;
          ctx.globalAlpha = a;
          const bw = o.w || 1;
          ctx.strokeStyle = 'rgba(80,170,255,0.55)';
          ctx.lineWidth = (14 * a + 2) * bw;
          ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
          ctx.strokeStyle = 'rgba(235,248,255,1)';
          ctx.lineWidth = (3.5 * a + 1) * bw;
          ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
          break;
        }
        case 'bolt': {
          ctx.globalAlpha = 1 - k;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(170,110,255,0.6)';
          ctx.lineWidth = 7 * (o.w || 1);
          ctx.beginPath();
          ctx.moveTo(o.pts[0][0], o.pts[0][1]);
          for (let i = 1; i < o.pts.length; i++) ctx.lineTo(o.pts[i][0], o.pts[i][1]);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(245,235,255,1)';
          ctx.lineWidth = 2 * (o.w || 1);
          ctx.stroke();
          break;
        }
        case 'ring': {
          const r = o.r0 + (o.r1 - o.r0) * k;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = `rgba(${o.c},${(1 - k) * 0.8})`;
          ctx.lineWidth = 4 * (1 - k) + 1;
          ctx.beginPath(); ctx.ellipse(o.x, o.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (nukeBoom) for (const o of nukeBoom) this.drawBoom(ctx, o, o.t / o.life);
    ctx.globalAlpha = 1;
  }

  drawBoom(ctx, o, k) {
    const ex = Assets.vfx[o.kind || 'fire'];
    if (!ex || !ex.img) return;
    const fp = Math.min(ex.n - 1, k * ex.n);
    const f = Math.floor(fp);
    const a0 = k > 0.8 ? (1 - k) / 0.2 : 1;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);
    if (o.flip) ctx.scale(-1, 1);
    const frameAt = (fi, a) => {
      const sx = (fi % ex.cols) * ex.size, sy = Math.floor(fi / ex.cols) * ex.size;
      ctx.globalAlpha = a;
      ctx.drawImage(ex.img, sx, sy, ex.size, ex.size, -o.s / 2, -o.s * ex.ay, o.s, o.s);
    };
    // slow, long effects (mushroom cloud) blend between frames so they stay smooth
    if (o.kind === 'nuke' && f < ex.n - 1) { const fr = fp - f; frameAt(f, a0); frameAt(f + 1, a0 * fr); }
    else frameAt(f, a0);
    ctx.restore();
  }

  // the part of a crumbling machine that is still in one piece (clipped at the sweeping front)
  drawIntact(ctx, o) {
    const u = (o.t - o.hold) / o.T;
    if (u >= 1) return;
    const m = Models.meta(o.name);
    if (!m || !m.img) return;
    const s = o.s0, cut = o.p0 + (o.p1 - o.p0) * Math.max(0, u) - 1;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (u > 0) {
      const L = 1500, dx = o.dx, dy = o.dy, cx = dx * cut, cy = dy * cut, px = -dy * L, py = dx * L;
      ctx.beginPath();
      ctx.moveTo(cx + px, cy + py); ctx.lineTo(cx - px, cy - py);
      ctx.lineTo(cx - px + dx * L, cy - py + dy * L); ctx.lineTo(cx + px + dx * L, cy + py + dy * L);
      ctx.closePath(); ctx.clip();
    }
    const x0 = -m.ax * s, y0 = -m.ay * s, w = m.w * s, h = m.h * s;
    if (o.img) { ctx.globalAlpha = 1; ctx.drawImage(o.img, x0, y0, w, h); }
    else {
      ctx.globalAlpha = 1;
      ctx.drawImage(m.img, (o.f % m.cols) * m.w, Math.floor(o.f / m.cols) * m.h, m.w, m.h, x0, y0, w, h);
      // glowing hot / glowing green, building up in the first moments
      ctx.globalAlpha = Math.min(1, 0.45 + o.t * 2.5) * (o.mode === 'rad' ? 0.75 : 0.9);
      ctx.drawImage(Models.tinted(o.name, o.f, o.mode === 'rad' ? 'radglow' : 'heat'), x0, y0, w, h);
    }
    ctx.restore();
  }

  // the dust: computed from the start values (no per-frame state), drawn in colour buckets by age
  drawGrains(ctx, o) {
    if (o.t < o.hold) return;
    const pal = GRAIN_PAL[o.mode], B = pal.length, g = o.g, t = o.t, nuke = o.mode === 'nuke', wreck = o.mode === 'wreck';
    const acc = nuke ? 240 : o.mode === 'rad' ? 20 : 0, grav = nuke ? -25 : o.mode === 'rad' ? -18 : 260;
    if (grainBuf.length < o.n * 3) grainBuf = new Float32Array(o.n * 3 + 600);
    let cnt = 0;
    for (let i = 0; i < o.n; i++) {
      const j = i * 6, a = t - g[j + 2];
      if (a <= 0 || a >= g[j + 5]) continue;
      let x = g[j] + g[j + 3] * a + 0.5 * acc * o.dx * a * a;
      let y = g[j + 1] + g[j + 4] * a + 0.5 * (acc * o.dy + grav) * a * a;
      if (wreck) { const gy = (i % 7) - 1; if (y > gy) { y = gy; x = g[j] + g[j + 3] * a * 0.6; } }
      grainBuf[cnt * 3] = o.x + x; grainBuf[cnt * 3 + 1] = o.y + y; grainBuf[cnt * 3 + 2] = Math.min(B - 1, Math.floor(a / g[j + 5] * B));
      cnt++;
    }
    if (!cnt) return;
    for (let b = 0; b < B; b++) {
      const [col, al, sz] = pal[b];
      ctx.fillStyle = col; ctx.globalAlpha = al;
      const s = o.gs * sz, h = s / 2;
      for (let c = 0; c < cnt; c++) if (grainBuf[c * 3 + 2] === b) ctx.fillRect(grainBuf[c * 3] - h, grainBuf[c * 3 + 1] - h, s, s);
    }
    ctx.globalAlpha = 1;
  }
}

// colour, alpha and size of dust grains over their lifetime
const GRAIN_PAL = {
  nuke: [['#fff4d0', 1, 1], ['#ffd27a', 1, 1], ['#ff9d45', 1, 0.95], ['#e8622a', 0.95, 0.9], ['#a8482a', 0.9, 0.85], ['#6e4636', 0.85, 0.8], ['#5c5450', 0.75, 0.75], ['#6f6a66', 0.6, 0.7], ['#7d7874', 0.42, 0.65], ['#86817c', 0.22, 0.6]],
  rad: [['#e9ffd8', 1, 1], ['#b6ff8a', 1, 1], ['#7fe85a', 0.95, 0.95], ['#5cc046', 0.9, 0.9], ['#4f9440', 0.85, 0.85], ['#4d6e43', 0.75, 0.8], ['#58604f', 0.6, 0.75], ['#686d62', 0.45, 0.7], ['#73766e', 0.3, 0.65], ['#7b7d77', 0.15, 0.6]],
  wreck: [['#ff9a4a', 1, 0.95], ['#a8542e', 1, 0.95], ['#3e2f28', 1, 0.9], ['#3a322d', 0.95, 0.9], ['#4a423c', 0.9, 0.85], ['#5a524b', 0.8, 0.8], ['#69625b', 0.65, 0.75], ['#756e67', 0.5, 0.7], ['#7d7770', 0.32, 0.65], ['#847e77', 0.15, 0.6]],
};
let grainBuf = new Float32Array(3000);
