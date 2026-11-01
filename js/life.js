// Life in the landscape (render only, no influence on the game): flocks of birds / bats per world, circling
// vultures, drifting cloud shadows and ground fog, and our own troops around the headquarters - soldiers on
// patrol, a jeep and two guard drones.
import { HW, HH, ELEV_PX } from './config.js';
import { toWorld, mulberry32 } from './iso.js';
import { Models, Assets } from './assets.js';

// kind: wing shape / flap; c: colours; s: size (world px); n: flock size; circle: circling birds over the map
const FAUNA = {
  wasteland: { kind: 'bird', c: ['#1b1b1d', '#26221f'], s: 7, n: [5, 9], circle: { c: '#2b2420', s: 12, n: 2 } },
  jungle: { kind: 'bird', c: ['#d8261b', '#1d6fd6', '#2fae3d', '#f2c21a'], s: 6, n: [6, 11] },
  desert: { kind: 'bird', c: ['#3a2d22'], s: 8, n: [3, 6], circle: { c: '#2a211c', s: 13, n: 3 } },
  ice: { kind: 'bird', c: ['#eef2f5', '#d9e1e8'], s: 7, n: [5, 9] },
  volcano: { kind: 'bat', c: ['#140d0c'], s: 6, n: [6, 12] },
  city: { kind: 'bird', c: ['#6b6f78', '#8a8d94', '#4f535b'], s: 6, n: [6, 12] },
  necro: { kind: 'bat', c: ['#0d0d10'], s: 6, n: [7, 13], circle: { c: '#101012', s: 10, n: 3 } },
  inferno: { kind: 'bat', c: ['#2a0806', '#3b0c07'], s: 7, n: [5, 10], glow: true },
};

export class Life {
  constructor(renderer) { this.r = renderer; }

  reset(game) {
    this.game = game;
    const biome = game.level.biome;
    this.F = FAUNA[biome] || FAUNA.wasteland;
    this.rng = mulberry32(game.levelIdx * 97 + 13);
    const N = game.N;
    // map extents (world px)
    this.ext = { x0: -N * HW, x1: N * HW, y0: 0, y1: 2 * N * HH };
    this.flocks = [];
    this.flockT = 3 + this.rng() * 5;
    this.circlers = [];
    const C = this.F.circle;
    if (C) for (let i = 0; i < C.n; i++) {
      const cx = this.ext.x0 * 0.6 + this.rng() * (this.ext.x1 - this.ext.x0) * 0.6, cy = this.ext.y1 * (0.25 + this.rng() * 0.5);
      this.circlers.push({ cx, cy, r: 90 + this.rng() * 90, a: this.rng() * 6.3, v: (0.25 + this.rng() * 0.2) * (this.rng() < 0.5 ? -1 : 1), alt: 230 + this.rng() * 80, ph: this.rng() * 6, s: C.s, c: C.c });
    }
    // cloud shadows (and fog banks in the realm of the dead / snow mist in the arctic)
    this.clouds = [];
    const nc = biome === 'inferno' ? 3 : 4;
    for (let i = 0; i < nc; i++) this.clouds.push({ x: this.ext.x0 + this.rng() * (this.ext.x1 - this.ext.x0), y: this.rng() * this.ext.y1, r: 260 + this.rng() * 260, a: 0.09 + this.rng() * 0.06 });
    this.fog = [];
    if (biome === 'necro' || biome === 'ice') for (let i = 0; i < 9; i++) this.fog.push({ x: this.ext.x0 + this.rng() * (this.ext.x1 - this.ext.x0), y: this.rng() * this.ext.y1, r: 160 + this.rng() * 160, ph: this.rng() * 6 });
    this.wind = { x: 16, y: 5 };
    // patrol around the headquarters (a loop just outside the 2x2 base)
    const [bx, by] = game.level.base;
    const cl = (v) => Math.max(0.35, Math.min(N - 0.35, v));
    const loop = (o) => [[cl(bx - o), cl(by - o)], [cl(bx + 2 + o), cl(by - o)], [cl(bx + 2 + o), cl(by + 2 + o)], [cl(bx - o), cl(by + 2 + o)]];
    const path = (pts) => { const seg = []; let L = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push({ a, b, l, L }); L += l; } return { seg, L }; };
    this.walkPath = path(loop(0.55));
    this.drivePath = path(loop(1.25));
    this.troops = [];
    for (let i = 0; i < 3; i++) this.troops.push({ kind: 'soldier', d: (i / 3) * this.walkPath.L + this.rng() * 0.6, v: 0.32 + this.rng() * 0.06, path: this.walkPath, walk: this.rng() });
    this.troops.push({ kind: 'jeep', d: this.rng() * this.drivePath.L, v: 0.65, path: this.drivePath, walk: 0, puff: 0 });
    const bw = toWorld(bx + 1, by + 1);
    this.drones = [0, 1].map(i => ({ cx: bw.x, cy: bw.y, a: i * Math.PI, v: 0.5 + i * 0.12, r: 120 + i * 40, alt: 80 + i * 18 }));
  }

  // ---- update (render time) ----
  update(dt) {
    if (!this.game || !dt) return;
    const E = this.ext, F = this.F;
    // new flock from a random map edge, flying across
    if ((this.flockT -= dt) <= 0) {
      this.flockT = 9 + Math.random() * 14;
      const n = F.n[0] + Math.floor(Math.random() * (F.n[1] - F.n[0] + 1));
      const fromLeft = Math.random() < 0.5, y = E.y1 * (0.15 + Math.random() * 0.7);
      const sx = fromLeft ? E.x0 - 200 : E.x1 + 200, dir = fromLeft ? 1 : -1;
      const v = (F.kind === 'bat' ? 120 : 95) + Math.random() * 50, vy = (Math.random() - 0.5) * 50;
      const birds = [];
      for (let i = 0; i < n; i++) birds.push({ ox: -dir * (i * 16 + Math.random() * 14), oy: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 11 + (Math.random() - 0.5) * 10, ph: Math.random() * 6.3, f: (F.kind === 'bat' ? 15 : 9) + Math.random() * 3, alt: 150 + Math.random() * 60, c: F.c[Math.floor(Math.random() * F.c.length)], wob: Math.random() * 6.3 });
      this.flocks.push({ x: sx, y, vx: dir * v, vy, birds, t: 0 });
    }
    for (const fl of this.flocks) {
      fl.t += dt; fl.x += fl.vx * dt; fl.y += fl.vy * dt;
      for (const b of fl.birds) b.ph += b.f * dt;
    }
    this.flocks = this.flocks.filter(fl => fl.x > E.x0 - 600 && fl.x < E.x1 + 600 && fl.t < 60);
    for (const c of this.circlers) { c.a += c.v * dt * 0.6; c.ph += dt * 2.2; }
    for (const c of this.clouds) {
      c.x += this.wind.x * dt; c.y += this.wind.y * dt;
      if (c.x - c.r > E.x1) c.x = E.x0 - c.r;
      if (c.y - c.r > E.y1) c.y = -c.r;
    }
    for (const f of this.fog) { f.x += this.wind.x * 0.5 * dt; f.ph += dt * 0.3; if (f.x - f.r > E.x1) f.x = E.x0 - f.r; }
    for (const t of this.troops) {
      t.d = (t.d + t.v * dt) % t.path.L;
      t.walk += t.v * dt;
      const p = this.at(t.path, t.d);
      t.gx = p.x; t.gy = p.y; t.ang = p.ang;
      const w = toWorld(t.gx, t.gy), z = this.game.heightAt(Math.floor(t.gx), Math.floor(t.gy)) * ELEV_PX;
      t.wx = w.x; t.wy = w.y - z;
      if (t.kind === 'jeep' && (t.puff -= dt) <= 0) {
        t.puff = 0.25;
        this.game.fx.add({ k: 'smoke', x: t.wx - Math.cos(t.ang) * 22, y: t.wy - 8, vx: 0, vy: -14, s: 6, grow: 18, life: 0.9, a: 0.3 });
      }
    }
    for (const d of this.drones) d.a += d.v * dt;
  }
  at(path, d) {
    for (const s of path.seg) if (d <= s.L + s.l) {
      const k = (d - s.L) / (s.l || 1);
      return { x: s.a[0] + (s.b[0] - s.a[0]) * k, y: s.a[1] + (s.b[1] - s.a[1]) * k, ang: Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) };
    }
    const s = path.seg[0];
    return { x: s.a[0], y: s.a[1], ang: 0 };
  }

  // ---- ground layer: cloud shadows, fog, bird shadows ----
  drawGround(ctx) {
    if (!this.game) return;
    const fx = Assets.fx;
    for (const c of this.clouds) {
      ctx.globalAlpha = c.a;
      ctx.drawImage(fx.dark, c.x - c.r, c.y - c.r * 0.5, c.r * 2, c.r);
    }
    ctx.globalAlpha = 1;
    // bird shadows (straight below, a little offset by the light)
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (const fl of this.flocks) for (const b of fl.birds) {
      const x = fl.x + b.ox + 18, y = fl.y + b.oy + 8;
      ctx.beginPath(); ctx.ellipse(x, y, this.F.s * 1.25, this.F.s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  drawFog(ctx) {
    if (!this.fog.length) return;
    const g = this.fogSprite || (this.fogSprite = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(225,235,230,0.55)'); gr.addColorStop(1, 'rgba(225,235,230,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return c;
    })());
    for (const f of this.fog) {
      ctx.globalAlpha = 0.16 + 0.06 * Math.sin(f.ph);
      ctx.drawImage(g, f.x - f.r, f.y - f.r * 0.4, f.r * 2, f.r * 0.8);
    }
    ctx.globalAlpha = 1;
  }

  // ---- depth-sorted ground units: soldiers and the jeep ----
  addToList(list) {
    if (!this.game) return;
    for (const t of this.troops) if (t.wx != null && Models.meta('ally_' + t.kind)) list.push({ y: t.wy, o: t, k: 8 });
  }
  drawTroop(ctx, t) {
    const name = 'ally_' + t.kind, m = Models.meta(name);
    if (!m) return;
    let f = Models.frameFor(name, t.ang);
    if (m.af) f = f * m.af + (Math.floor((t.walk / (m.rootDist ? m.rootDist * 0.8 : 0.5)) * m.af) % m.af);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(Assets.fx.shadow, t.wx - 16, t.wy - 5, 32, 10);
    ctx.globalAlpha = 1;
    Models.draw(ctx, name, f, t.wx, t.wy, t.kind === 'jeep' ? 0.85 : 0.8);
  }

  // ---- air layer: drones, birds ----
  drawAir(ctx, drawDrone) {
    if (!this.game) return;
    const T = this.r.time;
    for (const d of this.drones) {
      const x = d.cx + Math.cos(d.a) * d.r, gy = d.cy + Math.sin(d.a) * d.r * 0.5, y = gy - d.alt - Math.sin(T * 2 + d.a) * 4;
      drawDrone(ctx, { x, y, gy, i: d.v > 0.55 ? 1 : 0, weld: false, tx: x, ty: y }, false);
    }
    const F = this.F;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const bird = (x, y, s, ph, c, bat) => {
      const fl = Math.sin(ph), wy = -fl * s * 0.7;
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(1.2, s * 0.3);
      ctx.beginPath();
      if (bat) { ctx.moveTo(x - s, y + wy); ctx.lineTo(x - s * 0.55, y + wy * 0.4 + s * 0.2); ctx.lineTo(x - s * 0.3, y - s * 0.05); ctx.lineTo(x, y); ctx.lineTo(x + s * 0.3, y - s * 0.05); ctx.lineTo(x + s * 0.55, y + wy * 0.4 + s * 0.2); ctx.lineTo(x + s, y + wy); }
      else { ctx.moveTo(x - s, y + wy); ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.35 + wy * 0.3, x, y); ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.35 + wy * 0.3, x + s, y + wy); }
      ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y + s * 0.1, s * 0.22, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    };
    for (const fl of this.flocks) for (const b of fl.birds) {
      const x = fl.x + b.ox + Math.sin(fl.t * 1.7 + b.wob) * 4, y = fl.y + b.oy - b.alt + Math.sin(fl.t * 2.3 + b.wob) * 5;
      bird(x, y, F.s * 1.4, b.ph, b.c, F.kind === 'bat');
      if (F.glow && Math.sin(b.ph * 0.5) > 0.6) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(Assets.fx.orange, x - 5, y - 5, 10, 10); ctx.globalCompositeOperation = 'source-over'; }
    }
    // circling birds glide and flap now and then
    for (const c of this.circlers) {
      const x = c.cx + Math.cos(c.a) * c.r, y = c.cy + Math.sin(c.a) * c.r * 0.5 - c.alt;
      bird(x, y, c.s, Math.sin(c.ph * 0.5) > 0.7 ? c.ph * 4 : 0.35, c.c, false);
    }
  }
}
