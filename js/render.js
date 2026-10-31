// Isometric canvas renderer
import { HW, HH, TOWERS, BIOMES, TOWER_SCALE, ELEV_PX, NUKE, POWERUPS } from './config.js';
import { toWorld, toGrid, mulberry32, clamp } from './iso.js';
import { Assets, Models, drawIcon } from './assets.js';
import { CELL } from './game.js';

// convex hull (monotone chain) of {x, y} points, counter-clockwise
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const T0 = 128;         // top-down px per tile for ground composition (small maps)
const DEPTH = 70;       // slab thickness in world px

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = { x: 0, y: 0, zoom: 0.5 };
    this.vw = 1; this.vh = 1; this.dpr = 1;
    this.ground = null;
    this.amb = [];
    this.time = 0;
    this.insets = { top: 56, bottom: 0, left: 0, right: 0 };
    this.biome = BIOMES.wasteland;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.canvas.width = Math.round(this.vw * dpr);
    this.canvas.height = Math.round(this.vh * dpr);
    this.canvas.style.width = this.vw + 'px';
    this.canvas.style.height = this.vh + 'px';
    this.makeBg();
    if (this.game) this.clampCam();
  }
  makeBg() {
    const c = this.biome.bg;
    const g = this.ctx.createLinearGradient(0, 0, 0, this.vh);
    g.addColorStop(0, c[0]); g.addColorStop(0.55, c[1]); g.addColorStop(1, c[2]);
    this.bg = g;
  }

  // ---------- camera ----------
  mapBounds() {
    const N = this.game.N;
    return { x0: -N * HW, x1: N * HW, y0: -60 - 2 * ELEV_PX, y1: 2 * N * HH + DEPTH };
  }
  fitZoom() {
    const b = this.mapBounds();
    const availW = this.vw - this.insets.left - this.insets.right;
    const availH = this.vh - this.insets.top - this.insets.bottom;
    return Math.min(availW / (b.x1 - b.x0 + 30), availH / (b.y1 - b.y0 + 20));
  }
  resetCamera() {
    const b = this.mapBounds();
    const fit = this.fitZoom();
    let z = fit;
    if (this.vw < this.vh) {
      const availH = this.vh - this.insets.top - this.insets.bottom;
      z = Math.min(fit * 1.45, availH / (b.y1 - b.y0 + 160));
    }
    // big maps don't fit a phone screen at a tappable size: start closer (pinch out for the overview)
    const playable = Math.min(this.vw, this.vh) < 500 ? 0.34 : 0.3;
    z = Math.max(z, Math.min(playable, 1));
    this.cam.zoom = clamp(z, 0.16, 1.4);
    this.minZoom = Math.min(fit, 0.9) * 0.9;
    this.maxZoom = 1.7;
    const offX = (this.insets.left - this.insets.right) / 2 / this.cam.zoom;
    const offY = (this.insets.top - this.insets.bottom) / 2 / this.cam.zoom;
    this.cam.x = (b.x0 + b.x1) / 2 - offX;
    this.cam.y = (b.y0 + b.y1) / 2 - offY;
    this.clampCam();
  }
  clampCam() {
    const b = this.mapBounds();
    const z = this.cam.zoom;
    const halfW = this.vw / 2 / z, halfH = this.vh / 2 / z;
    const m = 110;
    const minX = b.x0 - m + halfW - this.insets.left / z, maxX = b.x1 + m - halfW + this.insets.right / z;
    const minY = b.y0 - m + halfH - this.insets.top / z, maxY = b.y1 + m - halfH + this.insets.bottom / z;
    this.cam.x = minX > maxX ? (b.x0 + b.x1) / 2 : clamp(this.cam.x, minX, maxX);
    this.cam.y = minY > maxY ? (b.y0 + b.y1) / 2 - (this.insets.top - this.insets.bottom) / 2 / z : clamp(this.cam.y, minY, maxY);
  }
  screenToWorld(sx, sy) { const z = this.cam.zoom; return { x: (sx - this.vw / 2) / z + this.cam.x, y: (sy - this.vh / 2) / z + this.cam.y }; }
  worldToScreen(wx, wy) { const z = this.cam.zoom; return { x: (wx - this.cam.x) * z + this.vw / 2, y: (wy - this.cam.y) * z + this.vh / 2 }; }
  // tap -> cell, with raised terrain: the plateau surface or cliff that is drawn on top at that point wins
  screenToCell(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const g0 = toGrid(w.x, w.y);
    const gx = Math.floor(g0.x), gy = Math.floor(g0.y);
    let best = null, bk = -Infinity;
    if (this.game) for (let dy = -1; dy <= 4; dy++) for (let dx = -1; dx <= 4; dx++) {
      const x = gx + dx, y = gy + dy, h = this.game.heightAt(x, y);
      if (!h) continue;
      const c = toWorld(x + 0.5, y + 0.5), z = h * ELEV_PX;
      const px = w.x - c.x, py = w.y - c.y, ax = Math.abs(px) / HW;
      if (ax >= 1) continue;
      const edge = HH * (1 - ax);                     // lower diamond edge relative to the centre
      // the wall below the front edge exists only where that neighbour is lower, down to its height
      const zl = (px >= 0 ? this.game.heightAt(x + 1, y) : this.game.heightAt(x, y + 1)) * ELEV_PX;
      let k = null;
      if (Math.abs(py + z) <= edge) k = c.y - HH - 0.6;                     // raised top face
      else if (zl < z && py >= edge - z && py <= edge - zl) k = c.y - 0.5;  // cliff wall
      if (k !== null && k > bk) { bk = k; best = { x, y }; }
    }
    return best || { x: gx, y: gy };
  }
  zoomAt(sx, sy, f) {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * f, this.minZoom || 0.2, this.maxZoom || 1.7);
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
    this.clampCam();
  }
  pan(dx, dy) { this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.clampCam(); }

  // ---------- level ----------
  setGame(game) {
    this.game = game;
    this.biome = BIOMES[game.level.biome];
    this.makeBg();
    if (this.ground) { this.ground.canvas.width = 0; this.ground.canvas.height = 0; this.ground = null; }
    this.buildGround();
    this.buildBlocks();
    this.resetCamera();
    this.amb = [];
    const n = this.biome.ambient === 'snow' ? 90 : this.biome.ambient === 'fireflies' ? 34 : 50;
    for (let i = 0; i < n; i++) this.amb.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.8, v: 0.2 + Math.random() * 0.8, ph: Math.random() * 6 });
  }

  // plateaus: per elevated cell a lifted top face (cut from the ground composition) and its visible cliffs
  buildBlocks() {
    const game = this.game, N = game.N, B = this.biome, gr = this.ground, E = ELEV_PX;
    if (this.blocks) for (const b of this.blocks) { b.top.width = 0; if (b.side) b.side.width = 0; }
    this.blocks = [];
    const rng = mulberry32(N * 31 + game.levelIdx * 7 + 3);
    const s = gr.s;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const h = game.heightAt(x, y);
      if (!h) continue;
      const c = toWorld(x + 0.5, y + 0.5), z = h * E;
      const nb = [game.heightAt(x, y - 1), game.heightAt(x + 1, y), game.heightAt(x, y + 1), game.heightAt(x - 1, y)];
      // top face
      const top = makeCanvas(2 * HW * s, 2 * HH * s), tg = top.getContext('2d');
      tg.scale(s, s);
      tg.beginPath(); tg.moveTo(HW, 0); tg.lineTo(2 * HW, HH); tg.lineTo(HW, 2 * HH); tg.lineTo(0, HH); tg.closePath();
      tg.save(); tg.clip();
      tg.drawImage(gr.canvas, (c.x - HW + gr.ox) * s, (c.y - HH + gr.oy) * s, 2 * HW * s, 2 * HH * s, 0, 0, 2 * HW, 2 * HH);
      tg.fillStyle = `rgba(255,248,230,${0.07 * h})`; tg.fillRect(0, 0, 2 * HW, 2 * HH);
      tg.restore();
      // lit rim where the ground drops away
      const corners = [[HW, 0], [2 * HW, HH], [HW, 2 * HH], [0, HH]];
      tg.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        if (nb[k] >= h) continue;
        const [a, b] = [corners[k], corners[(k + 1) % 4]];
        tg.strokeStyle = B.lip[0];
        tg.globalAlpha = k === 1 || k === 2 ? 0.95 : 0.6;
        tg.lineWidth = k === 1 || k === 2 ? 4 : 2.5;
        tg.beginPath(); tg.moveTo(a[0], a[1]); tg.lineTo(b[0], b[1]); tg.stroke();
        tg.globalAlpha = 1;
      }
      // cliffs on the two camera-facing sides (+x: right-down, +y: left-down)
      let side = null;
      if (nb[1] < h || nb[2] < h) {
        side = makeCanvas(2 * HW * s, (HH + z + 2) * s);
        const g = side.getContext('2d');
        g.scale(s, s);
        const oy = z;  // canvas y of the ground-level centre row
        const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const face = (pts, light) => {
          const [A, Bt, C, D] = pts;            // top-left, top-right, bottom-right, bottom-left
          g.save();
          g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(Bt[0], Bt[1]); g.lineTo(C[0], C[1]); g.lineTo(D[0], D[1]); g.closePath();
          const y0 = Math.min(A[1], Bt[1]), y1 = Math.max(C[1], D[1]);
          const grd = g.createLinearGradient(0, y0, 0, y1);
          const cl = B.cliff || B.slab;
          grd.addColorStop(0, light ? cl[0] : cl[2]); grd.addColorStop(1, light ? cl[1] : cl[3]);
          g.fillStyle = grd; g.fill();
          g.clip();
          // rock strata: bands of varying shade that follow the face
          let t = 0;
          while (t < 1) {
            const th = (4 + rng() * 9) / Math.max(8, D[1] - A[1]);
            const t1 = Math.min(1, t + th);
            const pa = lerp(A, D, t), pb = lerp(Bt, C, t), pc = lerp(Bt, C, t1), pd = lerp(A, D, t1);
            g.beginPath(); g.moveTo(pa[0], pa[1]);
            for (let u = 1; u <= 6; u++) { const q = lerp(pa, pb, u / 6); g.lineTo(q[0], q[1] + (rng() - 0.5) * 2.5); }
            g.lineTo(pc[0], pc[1]); g.lineTo(pd[0], pd[1]); g.closePath();
            g.fillStyle = rng() < 0.45 ? `rgba(255,236,210,${0.04 + rng() * 0.09})` : `rgba(0,0,0,${0.05 + rng() * 0.14})`;
            g.fill();
            t = t1;
          }
          // vertical cracks
          for (let c = 0; c < 3 + Math.floor(rng() * 3); c++) {
            const u = 0.08 + rng() * 0.84;
            let p = lerp(lerp(A, Bt, u), lerp(D, C, u), rng() * 0.25);
            g.beginPath(); g.moveTo(p[0], p[1]);
            const len = (0.35 + rng() * 0.6) * (D[1] - A[1]);
            for (let d = 0; d < len; d += 4) { p = [p[0] + (rng() - 0.5) * 3, p[1] + 4]; g.lineTo(p[0], p[1]); }
            g.strokeStyle = `rgba(0,0,0,${0.25 + rng() * 0.2})`; g.lineWidth = 1 + rng();
            g.stroke();
          }
          // grit
          for (let n = 0; n < 40; n++) {
            g.fillStyle = `rgba(${rng() < 0.5 ? '235,225,205' : '0,0,0'},${0.08 + rng() * 0.2})`;
            g.fillRect(Math.min(A[0], Bt[0]) + rng() * HW, y0 + rng() * (y1 - y0), 1 + rng() * 2, 1 + rng() * 1.5);
          }
          // lit top edge, contact shadow at the foot
          const top = g.createLinearGradient(0, y0, 0, y0 + 8);
          top.addColorStop(0, 'rgba(255,240,220,0.22)'); top.addColorStop(1, 'rgba(255,240,220,0)');
          g.fillStyle = top; g.fillRect(0, y0, 2 * HW, 8 + Math.abs(Bt[1] - A[1]));
          const ao = g.createLinearGradient(0, y1 - 16, 0, y1);
          ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.45)');
          g.fillStyle = ao; g.fillRect(0, y1 - 16, 2 * HW, 16);
          g.restore();
          // biome lip hanging over the edge (moss, snow, sand, ash)
          g.beginPath(); g.moveTo(A[0], A[1]);
          for (let u = 1; u <= 10; u++) { const q = lerp(A, Bt, u / 10); g.lineTo(q[0], q[1]); }
          for (let u = 10; u >= 0; u--) { const q = lerp(A, Bt, u / 10); g.lineTo(q[0], q[1] + 2 + rng() * 5); }
          g.closePath();
          const lg = g.createLinearGradient(0, y0, 0, y0 + 9);
          lg.addColorStop(0, B.lip[0]); lg.addColorStop(1, B.lip[1]);
          g.fillStyle = lg; g.fill();
        };
        // canvas coords: left corner x=0, bottom corner x=HW, right corner x=2HW; ground centre row at y=oy
        if (nb[2] < h) {   // +y side: L -> B
          const zl = nb[2] * E;
          face([[0, oy - z], [HW, oy - z + HH], [HW, oy - zl + HH], [0, oy - zl]], true);
        }
        if (nb[1] < h) {   // +x side: B -> R
          const zl = nb[1] * E;
          face([[HW, oy - z + HH], [2 * HW, oy - z], [2 * HW, oy - zl], [HW, oy - zl + HH]], false);
        }
      }
      this.blocks.push({ x, y, h, z, top, side, cx: c.x, cy: c.y });
    }
  }

  buildGround() {
    const game = this.game, N = game.N, L = game.level, B = this.biome;
    const rng = mulberry32(N * 977 + game.levelIdx * 131 + 7);
    // big maps use a lower composition resolution to stay inside mobile canvas memory limits
    const T = N >= 19 ? 96 : T0;
    const td = makeCanvas(N * T, N * T);
    const g = td.getContext('2d');
    const TS = 512 * T / T0;
    const tex = Assets.tex[B.ground], rtex = Assets.tex[B.road];
    for (let y = 0; y < N * T; y += TS) for (let x = 0; x < N * T; x += TS) {
      if (tex) g.drawImage(tex, x, y, TS, TS); else { g.fillStyle = '#4a4036'; g.fillRect(x, y, TS, TS); }
    }
    g.globalCompositeOperation = 'screen';
    g.fillStyle = B.grade.screen; g.fillRect(0, 0, N * T, N * T);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = B.grade.multiply; g.fillRect(0, 0, N * T, N * T);
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < N * 1.5; i++) {
      const x = rng() * N * T, y = rng() * N * T, r = (1.5 + rng() * 3) * T;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rng() < 0.6;
      grd.addColorStop(0, dark ? 'rgba(10,8,6,0.22)' : 'rgba(255,240,220,0.08)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (L.biome !== 'jungle' && L.biome !== 'ice') {
      for (let i = 0; i < N * 0.5; i++) {
        const cx = Math.floor(rng() * N), cy = Math.floor(rng() * N);
        if (game.cell(cx, cy) !== CELL.FREE) continue;
        const x = (cx + 0.2 + rng() * 0.6) * T, y = (cy + 0.2 + rng() * 0.6) * T, r = T * (0.25 + rng() * 0.35);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(12,9,7,0.5)'); grd.addColorStop(0.5, 'rgba(30,24,18,0.3)'); grd.addColorStop(0.78, 'rgba(150,130,105,0.14)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }
    g.strokeStyle = L.biome === 'ice' ? 'rgba(40,60,90,0.12)' : 'rgba(0,0,0,0.13)';
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i <= N; i++) { g.moveTo(i * T, 0); g.lineTo(i * T, N * T); g.moveTo(0, i * T); g.lineTo(N * T, i * T); }
    g.stroke();
    const polys = game.routes.map(r => r.pts.map(([x, y]) => [x * T, y * T]));
    const strokePolys = (ctx, width, style) => {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = style; ctx.lineWidth = width;
      for (const pl of polys) { ctx.beginPath(); ctx.moveTo(pl[0][0], pl[0][1]); for (let i = 1; i < pl.length; i++) ctx.lineTo(pl[i][0], pl[i][1]); ctx.stroke(); }
    };
    strokePolys(g, T * 1.22, B.roadEdge);
    strokePolys(g, T * 1.08, B.roadEdge);
    const road = makeCanvas(N * T, N * T), rg = road.getContext('2d');
    for (let y = 0; y < N * T; y += TS) for (let x = 0; x < N * T; x += TS) {
      if (rtex) rg.drawImage(rtex, x, y, TS, TS); else { rg.fillStyle = '#2b2b2d'; rg.fillRect(x, y, TS, TS); }
    }
    const mask = makeCanvas(N * T, N * T), mg = mask.getContext('2d');
    strokePolys(mg, T * 0.98, 'rgba(255,255,255,0.35)');
    strokePolys(mg, T * 0.92, 'rgba(255,255,255,0.6)');
    strokePolys(mg, T * 0.86, 'rgba(255,255,255,1)');
    rg.globalCompositeOperation = 'destination-in';
    rg.drawImage(mask, 0, 0);
    g.drawImage(road, 0, 0);
    g.save();
    g.setLineDash([T * 0.35, T * 0.12]);
    for (const off of [-0.2, 0.2]) {
      g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = T * 0.07; g.lineJoin = 'round';
      for (const pl of polys) {
        g.beginPath();
        for (let i = 0; i < pl.length; i++) {
          const [x, y] = pl[i];
          const nn = pl[Math.min(i + 1, pl.length - 1)], p0 = pl[Math.max(i - 1, 0)];
          const dx = nn[0] - p0[0], dy = nn[1] - p0[1], l = Math.hypot(dx, dy) || 1;
          const px = x - dy / l * off * T, py = y + dx / l * off * T;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      }
    }
    g.restore();
    for (const p of L.paths) {
      const x = (p.spawn[0] + 1) * T, y = (p.spawn[1] + 1) * T, r = T * 1.6;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(60,8,4,0.85)'); grd.addColorStop(0.5, 'rgba(25,8,6,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    {
      const [bx, by] = L.base;
      const x = bx * T - 10, y = by * T - 10, s = 2 * T + 20;
      g.fillStyle = 'rgba(105,100,92,1)'; g.fillRect(x, y, s, s);
      if (rtex) { g.globalAlpha = 0.55; g.drawImage(rtex, x, y, s, s); g.globalAlpha = 1; }
      g.save();
      g.beginPath(); g.rect(x, y, s, s); g.rect(x + 16, y + 16, s - 32, s - 32); g.clip('evenodd');
      for (let i = -s; i < s * 2; i += 28) {
        g.fillStyle = (Math.floor(i / 28) % 2) ? 'rgba(230,180,40,0.85)' : 'rgba(25,22,18,0.9)';
        g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i + 14, y); g.lineTo(x + i + 14 - s, y + s); g.lineTo(x + i - s, y + s); g.fill();
      }
      g.restore();
    }
    {
      const c = N * T / 2;
      const grd = g.createRadialGradient(c, c, c * 0.55, c, c, c * 1.5);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.5)');
      g.fillStyle = grd; g.fillRect(0, 0, N * T, N * T);
    }
    const s = N >= 19 ? 1.0 : 1.2, pad = 10;
    const W = 2 * N * HW + pad * 2, H = 2 * N * HH + DEPTH + pad * 2;
    const iso = makeCanvas(W * s, H * s), ig = iso.getContext('2d');
    const ox = N * HW + pad, oy = pad;
    ig.setTransform(s, 0, 0, s, s * ox, s * oy);
    const Lp = [-N * HW, N * HH], Bp = [0, 2 * N * HH], Rp = [N * HW, N * HH];
    const face = (a, b, light) => {
      ig.beginPath();
      ig.moveTo(a[0], a[1]); ig.lineTo(b[0], b[1]); ig.lineTo(b[0], b[1] + DEPTH); ig.lineTo(a[0], a[1] + DEPTH); ig.closePath();
      const grd = ig.createLinearGradient(0, Math.min(a[1], b[1]), 0, Math.max(a[1], b[1]) + DEPTH);
      grd.addColorStop(0, light ? B.slab[0] : B.slab[2]); grd.addColorStop(1, light ? B.slab[1] : B.slab[3]);
      ig.fillStyle = grd; ig.fill();
      ig.save(); ig.clip();
      for (let i = 0; i < 9; i++) {
        const yo = 6 + i * (DEPTH / 9) + (rng() - 0.5) * 4;
        ig.strokeStyle = `rgba(0,0,0,${0.12 + rng() * 0.18})`; ig.lineWidth = 1 + rng() * 2.5;
        ig.beginPath(); ig.moveTo(a[0], a[1] + yo);
        for (let k = 1; k <= 24; k++) { const t = k / 24; ig.lineTo(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + yo + (rng() - 0.5) * 3); }
        ig.stroke();
      }
      if (B.lava) {
        for (let i = 0; i < 6; i++) {
          const t = rng(), yo = 10 + rng() * (DEPTH - 20);
          ig.fillStyle = `rgba(255,${80 + rng() * 80},20,0.7)`;
          ig.fillRect(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + yo, 2 + rng() * 3, 8 + rng() * 20);
        }
      }
      for (let i = 0; i < 140; i++) {
        const t = rng(), yo = rng() * DEPTH;
        ig.fillStyle = `rgba(${rng() < 0.5 ? '200,190,170' : '10,8,6'},${0.15 + rng() * 0.3})`;
        const r = 1 + rng() * 3;
        ig.fillRect(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + yo, r, r * 0.7);
      }
      ig.restore();
    };
    face(Lp, Bp, true);
    face(Bp, Rp, false);
    const k = T0 / T;
    ig.setTransform(s * 0.5 * k, s * 0.25 * k, -s * 0.5 * k, s * 0.25 * k, s * ox, s * oy);
    ig.drawImage(td, 0, 0);
    // plateaus cast soft shadows onto the lower ground (key light from the upper left, like all models)
    if (game.height && game.height.some(Boolean)) {
      const q = 0.25, sc = makeCanvas(iso.width * q, iso.height * q), sg = sc.getContext('2d');
      sg.setTransform(s * q, 0, 0, s * q, s * ox * q, s * oy * q);
      sg.beginPath(); sg.moveTo(0, 0); sg.lineTo(N * HW, N * HH); sg.lineTo(0, 2 * N * HH); sg.lineTo(-N * HW, N * HH); sg.closePath(); sg.clip();
      sg.beginPath();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const h = game.heightAt(x, y);
        if (!h) continue;
        const hu = h * ELEV_PX / 78;                 // height in map units (78 screen px per vertical unit)
        const dx = 0.714 * hu, dy = -0.171 * hu;     // shadow offset along the light direction
        const pts = [];
        for (const [a, b] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) { pts.push(toWorld(a, b)); pts.push(toWorld(a + dx, b + dy)); }
        const hull = convexHull(pts);
        sg.moveTo(hull[0].x, hull[0].y);
        for (const p of hull.slice(1)) sg.lineTo(p.x, p.y);
        sg.closePath();
      }
      sg.fillStyle = 'rgba(10,7,4,0.5)';
      sg.fill('nonzero');
      // the raised tops are cut from this ground: keep their own footprint free of shadow
      sg.globalCompositeOperation = 'destination-out';
      sg.beginPath();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!game.heightAt(x, y)) continue;
        const a = toWorld(x, y), b = toWorld(x + 1, y), c = toWorld(x + 1, y + 1), d = toWorld(x, y + 1);
        sg.moveTo(a.x, a.y); sg.lineTo(b.x, b.y); sg.lineTo(c.x, c.y); sg.lineTo(d.x, d.y); sg.closePath();
      }
      sg.fillStyle = '#000'; sg.fill();
      sg.globalCompositeOperation = 'source-over';
      ig.save();
      ig.setTransform(1, 0, 0, 1, 0, 0);
      ig.imageSmoothingEnabled = true;
      ig.drawImage(sc, 0, 0, iso.width, iso.height);
      ig.restore();
      ig.setTransform(s * 0.5 * k, s * 0.25 * k, -s * 0.5 * k, s * 0.25 * k, s * ox, s * oy);
      sc.width = 0;
    }
    ig.setTransform(s, 0, 0, s, s * ox, s * oy);
    ig.strokeStyle = 'rgba(255,230,200,0.18)'; ig.lineWidth = 2;
    ig.beginPath(); ig.moveTo(Lp[0], Lp[1]); ig.lineTo(Bp[0], Bp[1]); ig.lineTo(Rp[0], Rp[1]); ig.stroke();
    for (const c of [td, road, mask]) { c.width = 0; c.height = 0; }
    this.ground = { canvas: iso, ctx: ig, s, ox, oy, W, H };
  }

  stampDecal(x, y, size) {
    const gr = this.ground;
    if (!gr) return;
    const g = gr.ctx;
    g.setTransform(gr.s, 0, 0, gr.s, gr.s * gr.ox, gr.s * gr.oy);
    g.globalAlpha = 0.55;
    g.drawImage(Assets.fx.dark, x - size / 2, y - size / 4, size, size / 2);
    g.globalAlpha = 1;
  }

  // ---------- frame ----------
  draw(dt, ui) {
    const game = this.game, ctx = this.ctx, dpr = this.dpr;
    this.time += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, this.vw, this.vh);
    if (!game) return;
    for (const d of game.decals) this.stampDecal(d.x, d.y, d.s);
    game.decals.length = 0;

    const z = this.cam.zoom;
    let shx = 0, shy = 0;
    if (game.fx.shake > 0) { const s = Math.min(game.fx.shake, 16); shx = (Math.random() - 0.5) * s * 2; shy = (Math.random() - 0.5) * s * 2; }
    const tx = this.vw / 2 - this.cam.x * z + shx, ty = this.vh / 2 - this.cam.y * z + shy;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * tx, dpr * ty);
    const gr = this.ground;
    ctx.drawImage(gr.canvas, -gr.ox, -gr.oy, gr.W, gr.H);

    const bz = ui.buildCell ? game.heightAt(ui.buildCell.x, ui.buildCell.y) * ELEV_PX : 0;
    if (ui.buildCell && !bz) this.drawBuildPreview(ctx, ui, 0);
    if (ui.selected && !ui.selected.z) this.drawRange(ctx, ui.selected.gx, ui.selected.gy, ui.selected.stats.range, TOWERS[ui.selected.type].color, true, TOWERS[ui.selected.type].minRange);

    const fx = Assets.fx;
    // ground pass: baked 3D shadows (key light from the upper left) for static objects and towers
    ctx.globalAlpha = 0.9;
    for (const p of game.props) if (!p.z) Models.drawShadow(ctx, p.model, p.rot, p.wx, p.wy, p.s);
    for (const p of game.decor) if (!p.z) Models.drawShadow(ctx, p.model, p.rot, p.wx, p.wy, p.s);
    Models.drawShadow(ctx, 'p3d_base_hq', 0, game.baseW.x, game.baseW.y);
    for (const g of game.gates) Models.drawShadow(ctx, 'p3d_spawn_gate', g.rot, g.x, g.y);
    for (const t of game.towers) {
      if (t.z) continue;
      const TS = TOWER_SCALE * (1 + 0.08 * ((t.level || 1) - 1));
      const pop = t.built < 0.3 ? 1 - Math.pow(1 - t.built / 0.3, 3) : 1;
      ctx.globalAlpha = 0.9 * pop;
      if (!Models.drawShadow(ctx, t.def.model, Models.frameFor(t.def.model, t.ang), t.wx, t.wy, TS)) ctx.drawImage(fx.shadow, t.wx - 66, t.wy - 22, 132, 58);
    }
    for (const p of game.puddles) this.drawPuddle(ctx, p);
    for (const z of game.radZones) this.drawRadiation(ctx, z);
    for (const e of game.enemies) {
      const m = Models.meta(e.def.model);
      const s = (m ? m.w * m.scale * 0.6 : 60) * e.def.scale;
      ctx.globalAlpha = e.air ? 0.3 : 0.55;
      const off = e.air ? s * 0.35 : s * 0.08;
      ctx.drawImage(fx.shadow, e.wx - s / 2 + off, e.wy - s * 0.18 + off * 0.4, s, s * 0.4);
    }
    ctx.globalAlpha = 1;

    const list = this._list || (this._list = []);
    list.length = 0;
    for (const p of game.props) list.push({ y: p.wy + (p.z || 0), o: p, k: 0 });
    for (const p of game.decor) list.push({ y: p.wy + (p.z || 0), o: p, k: 0 });
    for (const t of game.towers) list.push({ y: t.wy + (t.z || 0), o: t, k: 1 });
    for (const b of this.blocks) {
      list.push({ y: b.cy - HH - 0.6, o: b, k: 5 });
      if (b.side) list.push({ y: b.cy - 0.5, o: b, k: 6 });
    }
    for (const e of game.enemies) if (!e.air) list.push({ y: e.wy, o: e, k: 2 });
    list.push({ y: game.baseW.y + HH, o: game.baseW, k: 3 });
    for (const g of game.gates) list.push({ y: g.y + HH, o: g, k: 4 });
    list.sort((a, b) => a.y - b.y);
    const gs = this.ground.s;
    for (const it of list) {
      if (it.k === 0) this.drawProp(ctx, it.o);
      else if (it.k === 5) ctx.drawImage(it.o.top, it.o.cx - HW, it.o.cy - HH - it.o.z, 2 * HW, 2 * HH);
      else if (it.k === 6) ctx.drawImage(it.o.side, it.o.cx - HW, it.o.cy - it.o.z, it.o.side.width / gs, it.o.side.height / gs);
      else if (it.k === 1) this.drawTower(ctx, it.o, ui);
      else if (it.k === 2) this.drawEnemy(ctx, it.o);
      else if (it.k === 3) Models.draw(ctx, 'p3d_base_hq', 0, it.o.x, it.o.y);
      else if (it.k === 4) this.drawGate(ctx, it.o);
    }
    // units behind high ground: a faint silhouette on top (drawing a sprite over itself changes nothing where it is visible)
    ctx.globalAlpha = 0.32;
    for (const e of game.enemies) {
      if (e.air) continue;
      const cx = Math.floor(e.gx), cy = Math.floor(e.gy);
      let behind = false;
      for (let j = 0; j <= 3 && !behind; j++) for (let i = 0; i <= 3; i++) if ((i || j) && game.heightAt(cx + i, cy + j)) { behind = true; break; }
      if (behind) this.drawEnemy(ctx, e, true);
    }
    ctx.globalAlpha = 1;
    if (ui.buildCell && bz) this.drawBuildPreview(ctx, ui, bz);
    if (ui.selected && ui.selected.z) this.drawRange(ctx, ui.selected.gx, ui.selected.gy, ui.selected.stats.range, TOWERS[ui.selected.type].color, true, TOWERS[ui.selected.type].minRange, ui.selected.z);
    const air = game.enemies.filter(e => e.air).sort((a, b) => a.wy - b.wy);
    for (const e of air) this.drawEnemy(ctx, e);

    this.drawBeams(ctx, game);
    this.drawShots(ctx, game.shots);
    this.drawStrikes(ctx, game);
    this.drawNukes(ctx, game);
    this.drawDrops(ctx, game);
    game.fx.draw(ctx);
    for (const e of game.enemies) this.drawHp(ctx, e);
    for (const t of game.towers) if (t.hp < t.stats.hp) this.drawTowerHp(ctx, t);
    if (game.lives < game.maxLives * 0.5 && Math.random() < dt * 8) game.fx.smoke(game.baseW.x + (Math.random() - 0.5) * 80, game.baseW.y - 60, 1, 30, 2, true);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawAmbient(ctx, dt);
    this.drawOffscreen(ctx, game);
    if (game.buffs.timestop > 0) {
      const a = Math.min(1, game.buffs.timestop / 0.5, (6 - game.buffs.timestop) / 0.3 + 0.2);
      ctx.fillStyle = `rgba(90,170,255,${0.14 * a})`; ctx.fillRect(0, 0, this.vw, this.vh);
    }
    if (game.fx.whiteout > 0) {
      ctx.fillStyle = `rgba(255,252,240,${Math.min(1, game.fx.whiteout)})`;
      ctx.fillRect(0, 0, this.vw, this.vh);
    }
    if (game.fx.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,170,90,${game.fx.flash * 0.35})`;
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // orbital strike: targeting reticle + beam from the sky that thickens until impact
  drawStrikes(ctx, game) {
    for (const st of game.strikes) {
      const c = toWorld(st.gx, st.gy);
      const k = 1 - st.t / st.dur;
      const rx = 1.7 * HW * Math.SQRT2, ry = 1.7 * HH * Math.SQRT2;
      ctx.save();
      ctx.strokeStyle = `rgba(255,70,50,${0.5 + 0.4 * Math.sin(this.time * 20)})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 10]); ctx.lineDashOffset = -this.time * 60;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, rx * (1.15 - 0.15 * k), ry * (1.15 - 0.15 * k), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(c.x - 30, c.y); ctx.lineTo(c.x + 30, c.y); ctx.moveTo(c.x, c.y - 15); ctx.lineTo(c.x, c.y + 15); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const top = c.y - 1400;
      ctx.globalAlpha = 0.25 + 0.6 * k;
      ctx.strokeStyle = 'rgba(255,90,60,1)'; ctx.lineWidth = 4 + 26 * k * k;
      ctx.beginPath(); ctx.moveTo(c.x, top); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,220,1)'; ctx.lineWidth = 1.5 + 8 * k * k;
      ctx.beginPath(); ctx.moveTo(c.x, top); ctx.lineTo(c.x, c.y); ctx.stroke();
      const g = 60 + 160 * k;
      ctx.drawImage(Assets.fx.red, c.x - g / 2, c.y - g / 2, g, g);
      ctx.restore();
    }
  }

  // nuclear strike countdown: warning zone + warhead falling from the sky
  drawNukes(ctx, game) {
    for (const n of game.nukes) {
      const c = toWorld(n.gx, n.gy);
      const k = 1 - n.t / n.dur;
      const pul = 0.5 + 0.5 * Math.sin(this.time * 18);
      ctx.save();
      for (const [r, a] of [[NUKE.radius, 0.9], [NUKE.outer, 0.45]]) {
        ctx.strokeStyle = `rgba(255,${200 * (1 - pul)},40,${a})`;
        ctx.lineWidth = r === NUKE.radius ? 4 : 2;
        ctx.setLineDash([22, 14]); ctx.lineDashOffset = -this.time * 90;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, r * HW * Math.SQRT2, r * HH * Math.SQRT2, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,60,20,${0.08 + 0.08 * pul})`;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, NUKE.radius * HW * Math.SQRT2, NUKE.radius * HH * Math.SQRT2, 0, 0, Math.PI * 2); ctx.fill();
      // hazard symbol on the ground
      ctx.fillStyle = `rgba(255,220,40,${0.5 + 0.4 * pul})`;
      for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 + i * Math.PI * 2 / 3 - 0.5;
        ctx.beginPath(); ctx.moveTo(c.x, c.y);
        ctx.ellipse(c.x, c.y, 60, 30, 0, a0, a0 + 1);
        ctx.closePath(); ctx.fill();
      }
      // warhead
      const hy = c.y - 1500 * (1 - k * k), hx = c.x + 260 * (1 - k);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,230,200,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx + 120 * (1 - k) + 40, hy - 220); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.drawImage(Assets.fx.orange, hx - 30, hy - 30, 60, 60);
      ctx.drawImage(Assets.fx.white, hx - 12, hy - 12, 24, 24);
      ctx.restore();
    }
  }
  drawRadiation(ctx, z) {
    const c = toWorld(z.gx, z.gy);
    const fade = Math.min(1, z.t / 2, (z.life - z.t) / 0.4);
    const rx = z.r * HW * Math.SQRT2, ry = z.r * HH * Math.SQRT2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade * (0.55 + 0.15 * Math.sin(this.time * 3));
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rx);
    g.addColorStop(0, 'rgba(210,255,60,0.5)'); g.addColorStop(0.7, 'rgba(120,200,20,0.25)'); g.addColorStop(1, 'rgba(60,120,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 10; i++) {
      const ph = (this.time * 0.6 + i * 0.13) % 1;
      const a = i * 2.39;
      ctx.globalAlpha = fade * (1 - ph) * 0.7;
      ctx.drawImage(Assets.fx.green, c.x + Math.cos(a) * rx * 0.7 * ((i % 3) / 3 + 0.3) - 6, c.y + Math.sin(a) * ry * 0.7 - ph * 70 - 6, 12, 12);
    }
    ctx.restore();
  }
  // power-up crate: hovering, glowing, blinking before it expires
  crateImg(type) {
    this._crates = this._crates || {};
    if (this._crates[type]) return this._crates[type];
    const p = POWERUPS[type], c = makeCanvas(84, 84), g = c.getContext('2d');
    const top = [[42, 10], [70, 24], [42, 38], [14, 24]];
    const face = (pts, col) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) g.lineTo(q[0], q[1]); g.closePath(); g.fillStyle = col; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5; g.stroke(); };
    face([[14, 24], [42, 38], [42, 70], [14, 56]], '#2b2f33');
    face([[42, 38], [70, 24], [70, 56], [42, 70]], '#1c1f22');
    face(top, '#3d4247');
    g.strokeStyle = p.color; g.lineWidth = 3;
    g.beginPath(); g.moveTo(14, 40); g.lineTo(42, 54); g.lineTo(70, 40); g.stroke();
    drawIcon(g, p.icon, 42, 22, 30);
    return (this._crates[type] = c);
  }
  drawDrops(ctx, game) {
    for (const d of game.drops) {
      if (d.t < 3 && Math.sin(this.time * 18) < 0) continue;
      const p = POWERUPS[d.type];
      const bob = Math.sin(this.time * 3 + d.id) * 5;
      const x = d.wx, y = d.wy - 46 + bob;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.time * 6 + d.id);
      const spr = { overdrive: 'red', timestop: 'cyan', gold: 'yellow', repair: 'green', atom: 'yellow' }[d.type];
      ctx.drawImage(Assets.fx[spr], x - 50, y - 50, 100, 100);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(Assets.fx[spr], x - 20, d.wy - 10, 40, 20);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.crateImg(d.type), x - 32, y - 32, 64, 64);
      ctx.font = '700 12px "Rajdhani", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(p.name, x, y - 34);
      ctx.fillStyle = p.color; ctx.fillText(p.name, x, y - 34);
    }
  }

  // acid puddle: glowing pool with bubbles, fades out at the end
  drawPuddle(ctx, p) {
    const c = toWorld(p.gx, p.gy);
    const fade = Math.min(1, p.t / 0.6, (p.life - p.t) / 0.15 + 0.2);
    const rx = p.r * HW * Math.SQRT2, ry = p.r * HH * Math.SQRT2;
    ctx.save();
    ctx.globalAlpha = 0.75 * fade;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rx);
    g.addColorStop(0, 'rgba(150,255,60,0.7)'); g.addColorStop(0.6, 'rgba(70,170,20,0.55)'); g.addColorStop(1, 'rgba(40,90,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const ph = (this.time * 1.3 + p.seed + i * 0.37) % 1;
      const bx = c.x + Math.sin(p.seed * 7 + i * 2.1) * rx * 0.55, by = c.y + Math.cos(p.seed * 5 + i * 1.7) * ry * 0.5;
      ctx.globalAlpha = fade * (1 - ph) * 0.8;
      ctx.drawImage(Assets.fx.green, bx - 5 - ph * 6, by - 5 - ph * 6, 10 + ph * 12, 10 + ph * 12);
    }
    ctx.restore();
  }

  // red edge markers pointing at enemies outside the view (big maps)
  drawOffscreen(ctx, game) {
    const ins = this.insets, x0 = ins.left + 18, x1 = this.vw - ins.right - 18, y0 = ins.top + 18, y1 = this.vh - Math.max(ins.bottom, 0) - 18;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const bins = new Map();
    for (const e of game.enemies) {
      const p = this.worldToScreen(e.wx, e.wy - 30);
      if (p.x > x0 - 10 && p.x < x1 + 10 && p.y > y0 - 10 && p.y < y1 + 10) continue;
      const a = Math.atan2(p.y - cy, p.x - cx);
      const k = Math.round(a / (Math.PI / 12));
      const b = bins.get(k);
      if (b) { b.n++; if (e.def.boss) b.boss = true; } else bins.set(k, { a, n: 1, boss: !!e.def.boss });
    }
    if (!bins.size) return;
    const pul = 0.65 + 0.35 * Math.sin(this.time * 6);
    ctx.save();
    for (const b of bins.values()) {
      const dx = Math.cos(b.a), dy = Math.sin(b.a);
      const t = Math.min(dx ? (dx > 0 ? x1 - cx : x0 - cx) / dx : 1e9, dy ? (dy > 0 ? y1 - cy : y0 - cy) / dy : 1e9);
      const x = cx + dx * t, y = cy + dy * t, sz = b.boss ? 15 : 9 + Math.min(5, b.n);
      ctx.translate(x, y); ctx.rotate(b.a);
      ctx.globalAlpha = pul;
      ctx.beginPath(); ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.7, -sz * 0.75); ctx.lineTo(-sz * 0.35, 0); ctx.lineTo(-sz * 0.7, sz * 0.75); ctx.closePath();
      ctx.fillStyle = b.boss ? '#ffb020' : '#ff3b30'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    }
    ctx.restore();
  }

  drawAmbient(ctx, dt) {
    const kind = this.biome.ambient;
    const W = this.vw, H = this.vh, t = this.time;
    for (const a of this.amb) {
      if (kind === 'snow') {
        a.y += a.v * dt * 0.06; a.x += Math.sin(t * 0.8 + a.ph) * dt * 0.012 + dt * 0.01;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath(); ctx.arc(a.x * W, a.y * H, a.s * 0.8, 0, 6.28); ctx.fill();
      } else if (kind === 'embers') {
        a.y -= a.v * dt * 0.05; a.x += Math.sin(t * 1.3 + a.ph) * dt * 0.01;
        ctx.fillStyle = `rgba(255,${(120 + Math.sin(t * 5 + a.ph) * 60) | 0},40,0.8)`;
        ctx.fillRect(a.x * W, a.y * H, a.s, a.s);
        if (a.y < 0) { a.y = 1; a.x = Math.random(); }
      } else if (kind === 'fireflies') {
        a.x += Math.sin(t * 0.5 + a.ph) * dt * 0.01; a.y += Math.cos(t * 0.4 + a.ph * 2) * dt * 0.008;
        const g = 0.35 + 0.35 * Math.sin(t * 3 + a.ph * 5);
        ctx.fillStyle = `rgba(200,255,120,${g})`;
        ctx.beginPath(); ctx.arc(a.x * W, a.y * H, a.s, 0, 6.28); ctx.fill();
      } else if (kind === 'dust') {
        a.x += a.v * dt * 0.08; a.y += Math.sin(t + a.ph) * dt * 0.01;
        ctx.fillStyle = 'rgba(230,190,140,0.35)';
        ctx.fillRect(a.x * W, a.y * H, a.s * 2.4, a.s * 0.8);
      } else {
        a.y += a.v * dt * 0.04; a.x += Math.sin(t * 0.6 + a.ph) * dt * 0.01 + dt * 0.006;
        ctx.fillStyle = 'rgba(220,200,180,0.35)';
        ctx.fillRect(a.x * W, a.y * H, a.s, a.s);
      }
      if (a.y > 1) { a.y = 0; a.x = Math.random(); }
      if (a.x > 1) a.x = 0;
      if (a.x < 0) a.x = 1;
    }
  }

  cellPath(ctx, cx, cy, inset = 0, z = 0) {
    const a = toWorld(cx + inset, cy + inset), b = toWorld(cx + 1 - inset, cy + inset), c = toWorld(cx + 1 - inset, cy + 1 - inset), d = toWorld(cx + inset, cy + 1 - inset);
    ctx.moveTo(a.x, a.y - z); ctx.lineTo(b.x, b.y - z); ctx.lineTo(c.x, c.y - z); ctx.lineTo(d.x, d.y - z); ctx.closePath();
  }
  drawBuildPreview(ctx, ui, z = 0) {
    const { x, y } = ui.buildCell;
    const pulse = 0.25 + 0.1 * Math.sin(this.time * 6);
    ctx.beginPath(); this.cellPath(ctx, x, y, 0.04, z);
    ctx.fillStyle = `rgba(90,255,150,${pulse})`; ctx.fill();
    ctx.strokeStyle = '#6dff9d'; ctx.lineWidth = 2.5; ctx.stroke();
    if (ui.previewType) {
      const def = TOWERS[ui.previewType];
      this.drawRange(ctx, x + 0.5, y + 0.5, this.game.statsFor(ui.previewType, 1, x, y).range, def.color, false, def.minRange, z);
      const w = toWorld(x + 0.5, y + 0.5);
      ctx.globalAlpha = 0.7;
      this.drawTower(ctx, { def, type: ui.previewType, wx: w.x, wy: w.y - z, ang: Math.PI / 4, recoil: 0, built: 1, level: 1, ghost: true }, ui);
      ctx.globalAlpha = 1;
    }
  }
  drawRange(ctx, gx, gy, r, color, strong, minR, z = 0) {
    const c = toWorld(gx, gy);
    c.y -= z;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * HW * Math.SQRT2, r * HH * Math.SQRT2, 0, 0, Math.PI * 2);
    ctx.fillStyle = strong ? 'rgba(120,200,255,0.10)' : 'rgba(120,255,170,0.09)';
    ctx.fill();
    ctx.setLineDash([10, 8]); ctx.lineDashOffset = -this.time * 30;
    ctx.strokeStyle = color; ctx.globalAlpha = 0.85; ctx.lineWidth = 2.5; ctx.stroke();
    if (minR) { ctx.beginPath(); ctx.ellipse(c.x, c.y, minR * HW * Math.SQRT2, minR * HH * Math.SQRT2, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,90,90,0.8)'; ctx.stroke(); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  drawProp(ctx, p) {
    if (p.z) { ctx.globalAlpha = 0.9; Models.drawShadow(ctx, p.model, p.rot, p.wx, p.wy, p.s); ctx.globalAlpha = 1; }
    Models.draw(ctx, p.model, p.rot, p.wx, p.wy, p.s);
  }
  // spawn gate: 3D bunker with a pulsing red glow in its opening (towards the road)
  drawGate(ctx, g) {
    Models.draw(ctx, 'p3d_spawn_gate', g.rot, g.x, g.y);
    const a = g.dir * Math.PI / 2, ox = Math.cos(a) * 0.75, oy = Math.sin(a) * 0.75;
    const x = g.x + (ox - oy) * HW, y = g.y + (ox + oy) * HH - 26;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(this.time * 3);
    ctx.drawImage(Assets.fx.red, x - 60, y - 60, 120, 120);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // level-dependent energy ring under the tower (tower colour)
  drawLevelRing(ctx, t) {
    if (t.ghost || t.level < 2) return;
    const col = TOWERS[t.type].color;
    const pul = 0.5 + 0.5 * Math.sin(this.time * (t.level === 3 ? 4 : 2.5) + t.id);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col;
    ctx.globalAlpha = (t.level === 3 ? 0.55 : 0.32) + 0.25 * pul;
    ctx.lineWidth = t.level === 3 ? 3.5 : 2.5;
    ctx.beginPath(); ctx.ellipse(t.wx, t.wy + 6, 56, 28, 0, 0, Math.PI * 2); ctx.stroke();
    if (t.level === 3) {
      ctx.globalAlpha = 0.25 + 0.2 * pul;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 10]); ctx.lineDashOffset = -this.time * 40;
      ctx.beginPath(); ctx.ellipse(t.wx, t.wy + 6, 66, 33, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawTower(ctx, t, ui) {
    const def = t.def, name = def.model;
    const m = Models.meta(name);
    if (!m) return;
    const pop = !t.ghost && t.built < 0.3 ? 1 - Math.pow(1 - t.built / 0.3, 3) : 1;
    const y = t.wy + (1 - pop) * 30;
    // towers visibly grow with every upgrade
    const TS = TOWER_SCALE * (1 + 0.08 * ((t.level || 1) - 1));
    if (t.z && !t.ghost) { ctx.globalAlpha = 0.9 * pop; Models.drawShadow(ctx, name, Models.frameFor(name, t.ang), t.wx, t.wy, TS); ctx.globalAlpha = 1; }
    this.drawLevelRing(ctx, t);
    if (m.baseImg) Models.drawBase(ctx, name, t.wx, y, TS);
    const f = Models.frameFor(name, t.ang);
    const rc = (t.recoil || 0) * 4;
    const dx = -(Math.cos(t.ang) - Math.sin(t.ang)) * rc * 0.7, dy = -(Math.cos(t.ang) + Math.sin(t.ang)) * rc * 0.35;
    const box = Models.draw(ctx, name, f, t.wx + dx, y + dy, TS);
    if (t.ghost) return;
    const glowA = (ui.selected === t ? 0.16 + 0.08 * Math.sin(this.time * 5) : 0)
      + (t.level === 3 ? 0.08 + 0.05 * Math.sin(this.time * 3 + t.id) : 0)
      + (t.powerUp || 0) * 0.7;
    if (glowA > 0 && box) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, glowA);
      if (m.baseImg) Models.drawBase(ctx, name, t.wx, y, TS);
      Models.draw(ctx, name, f, t.wx + dx, y + dy, TS);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (def.kind === 'emp') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(this.time * 6 + t.id);
      const s = 50 + t.level * 16;
      ctx.drawImage(Assets.fx.violet, t.wx - s / 2, y - m.topPx * TS + 10 - s / 2, s, s);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (t.upgrading) this.drawUpgrade(ctx, t, m, f, y);
    const bf = this.game.buffs;
    if (bf.overdrive > 0) {
      // overdrive: red-hot glow on the gun
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + 0.25 * Math.sin(this.time * 14 + t.id);
      ctx.drawImage(Assets.fx.red, t.wx - 40, y - m.topPx * TS * 0.7 - 40, 80, 80);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (bf.repair > 0) {
      // nano shield bubble
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(120,255,200,${0.35 + 0.2 * Math.sin(this.time * 5 + t.id)})`;
      ctx.fillStyle = 'rgba(80,255,180,0.06)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(t.wx, y - 34, 58, 64, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (t.level > 1) {
      const bx = t.wx + 34, by = t.wy + 18;
      for (let i = 0; i < t.level - 1; i++) {
        const yy = by - i * 7;
        ctx.beginPath();
        ctx.moveTo(bx - 8, yy - 4); ctx.lineTo(bx, yy + 1); ctx.lineTo(bx + 8, yy - 4); ctx.lineTo(bx + 8, yy); ctx.lineTo(bx, yy + 5); ctx.lineTo(bx - 8, yy); ctx.closePath();
        ctx.fillStyle = t.level === 3 ? '#ffd34d' : '#d0d6dc'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    if (t.rank) {
      // veteran stars: bronze, silver, gold, gold with glow
      const col = ['#c98b4a', '#d6dde3', '#ffd34d', '#ffe680'][t.rank - 1];
      const bx = t.wx - 36, by = t.wy + 16;
      for (let i = 0; i < t.rank; i++) {
        const cx = bx - i * 9, cy = by - i * 4;
        ctx.beginPath();
        for (let j = 0; j < 10; j++) { const r = j % 2 ? 2.4 : 5.6, a = -Math.PI / 2 + j * Math.PI / 5; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1; ctx.stroke();
      }
      if (t.rank === 4) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5; ctx.drawImage(Assets.fx.yellow, bx - 30, by - 22, 40, 40); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    }
    if (t.hp < t.stats.hp * 0.4 && Math.random() < 0.08) this.game.fx.smoke(t.wx + (Math.random() - 0.5) * 30, t.wy - 40, 1, 18, 1.4, true);
  }

  // construction: scaffold poles, a hologram of the next stage and a progress bar
  drawUpgrade(ctx, t, m, f, y) {
    const u = t.upgrading;
    const k = Math.min(1, u.t / u.dur);
    const nextTS = TOWER_SCALE * (1 + 0.08 * t.level);
    // hologram of the upgraded tower
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18 + 0.12 * Math.sin(this.time * 10);
    Models.draw(ctx, t.def.model, f, t.wx, y, nextTS);
    ctx.restore();
    // scaffold
    const H = 92;
    const corners = [toWorld(t.cx + 0.1, t.cy + 0.1), toWorld(t.cx + 0.9, t.cy + 0.1), toWorld(t.cx + 0.9, t.cy + 0.9), toWorld(t.cx + 0.1, t.cy + 0.9)];
    if (t.z) for (const c of corners) c.y -= t.z;
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(230,180,40,0.9)';
    ctx.beginPath();
    for (const c of corners) { ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - H); }
    for (const h of [H * 0.35, H * 0.75]) {
      ctx.moveTo(corners[0].x, corners[0].y - h);
      for (let i = 1; i <= 4; i++) { const c = corners[i % 4]; ctx.lineTo(c.x, c.y - h); }
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,30,30,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(corners[3].x, corners[3].y - H * 0.35); ctx.lineTo(corners[2].x, corners[2].y - H * 0.75); ctx.stroke();
    // blinking warning light
    if (Math.sin(this.time * 8) > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(Assets.fx.orange, corners[0].x - 10, corners[0].y - H - 10, 20, 20);
      ctx.globalCompositeOperation = 'source-over';
    }
    // progress bar
    const bw = 64, bx = t.wx - bw / 2, by = t.wy - H - 18;
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 9);
    ctx.fillStyle = t.level === 2 ? '#ffd34d' : '#6dff9d'; ctx.fillRect(bx, by, bw * k, 5);
    ctx.font = '700 12px "Rajdhani", system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const label = `UPGRADE ${t.level === 1 ? 'II' : 'III'} · ${Math.ceil(u.dur - u.t)}s`;
    ctx.strokeText(label, t.wx, by - 5); ctx.fillStyle = '#fff'; ctx.fillText(label, t.wx, by - 5);
  }

  // per-type locomotion: walk-cycle frames (rigged models) or procedural gait / hover / track motion
  enemyPose(e, m) {
    const def = e.def;
    const stride = def.stride || 0.6;
    const ph = e.walk / stride;                 // one step per stride
    let bob = 0, roll = 0, dx = 0;
    switch (def.motion) {
      case 'biped': {
        if (!m.af) { bob = Math.abs(Math.sin(ph * Math.PI)) * 2.2; roll = Math.sin(ph * Math.PI) * 0.035; }
        else bob = 0;
        break;
      }
      case 'walker': {
        // heavy stomp; with animated legs only a slight sway in sync with the footfalls (2 per cycle)
        if (m.af) {
          const s = Math.sin((e.walk / Models.cycleOf(def)) * Math.PI * 2);
          bob = Math.abs(s) * (def.boss ? 2.2 : 1.4);
          roll = s * 0.012;
        } else {
          const s = Math.sin(ph * Math.PI);
          bob = Math.pow(Math.abs(s), 0.7) * (def.boss ? 5 : 3.2);
          roll = s * (def.boss ? 0.025 : 0.04);
        }
        break;
      }
      case 'spider': {
        if (m.af) { bob = 0; roll = 0; break; }
        bob = Math.abs(Math.sin(ph * Math.PI * 2)) * 1.8;
        roll = Math.sin(ph * Math.PI * 2) * 0.05;
        dx = Math.sin(ph * Math.PI * 4) * 0.8;
        break;
      }
      case 'tracks': {
        bob = Math.sin(this.time * 47 + e.id) * 0.5;
        roll = Math.sin(this.time * 31 + e.id) * 0.006;
        break;
      }
      case 'hover': {
        bob = Math.sin(e.anim * 1.6 * Math.PI * 2) * 4;
        roll = Math.max(-0.28, Math.min(0.28, -e.turnRate * 0.11)) + Math.sin(e.anim * 1.1) * 0.025;
        break;
      }
    }
    return { bob, roll, dx };
  }

  // hoarfrost (grows with frost, solid when frozen) and acid corrosion tint on the body
  drawStatus(ctx, e, name, f, x, y) {
    const s = e.def.scale;
    if (e.frozenT > 0) Models.drawTinted(ctx, name, f, x, y, s, 'ice', 0.78);
    else if (e.frost > 4) Models.drawTinted(ctx, name, f, x, y, s, 'ice', e.frost / 100 * 0.6);
    if (e.acidN > 0) Models.drawTinted(ctx, name, f, x, y, s, 'acid', 0.1 + 0.07 * e.acidN + 0.05 * Math.sin(this.time * 6 + e.id));
  }

  drawEnemy(ctx, e, ghost = false) {
    const def = e.def, name = def.model;
    const m = Models.meta(name);
    if (!m) return;
    const f = Models.unitFrame(e);
    const pose = this.enemyPose(e, m);
    const lift = e.air ? def.lift * (e.liftMul ?? 1) + pose.bob : pose.bob;
    const y = e.wy - lift;
    const x = e.wx + pose.dx;
    if (ghost) {
      if (pose.roll) { ctx.save(); ctx.translate(x, y); ctx.rotate(pose.roll); Models.draw(ctx, name, f, 0, 0, def.scale); ctx.restore(); }
      else Models.draw(ctx, name, f, x, y, def.scale);
      return;
    }
    if (def.cloak && !this.game.visible(e)) {
      // optical camouflage: a faint refracting shimmer
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * (0.14 + 0.06 * Math.sin(this.time * 9 + e.id));
      Models.draw(ctx, name, f, x + Math.sin(this.time * 23 + e.id) * 1.5, y, def.scale);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = ga * 0.12;
      Models.drawTinted(ctx, name, f, x, y, def.scale, 'ice', 0.12);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = ga;
      e._top = y - m.topPx * def.scale;
      return;
    }
    if (def.cloak && e.revealT > 0 && Math.random() < 0.25) ctx.globalAlpha = 0.6;
    if (pose.roll) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(pose.roll);
      Models.draw(ctx, name, f, 0, 0, def.scale);
      this.drawStatus(ctx, e, name, f, 0, 0);
      if (e.flash > 0) { ctx.globalCompositeOperation = 'lighter'; Models.draw(ctx, name, f, 0, 0, def.scale, Math.min(1, e.flash / 0.06) * 0.55); ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore();
    } else {
      Models.draw(ctx, name, f, x, y, def.scale);
      this.drawStatus(ctx, e, name, f, x, y);
      if (e.flash > 0) { ctx.globalCompositeOperation = 'lighter'; Models.draw(ctx, name, f, x, y, def.scale, Math.min(1, e.flash / 0.06) * 0.55); ctx.globalCompositeOperation = 'source-over'; }
    }
    if (e.frozenT > 0) {
      // ice crust: frosted block around the legs and a cold glint
      const r = m.w * m.scale * def.scale * 0.36;
      ctx.fillStyle = 'rgba(190,235,255,0.35)';
      ctx.strokeStyle = 'rgba(235,250,255,0.75)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.8, y - r * 0.9); ctx.lineTo(x - r * 0.2, y - r * 1.2); ctx.lineTo(x + r * 0.5, y - r * 1.05); ctx.lineTo(x + r, y - r * 0.4); ctx.lineTo(x + r * 0.7, y + r * 0.35); ctx.lineTo(x - r * 0.6, y + r * 0.4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.time * 7 + e.id);
      ctx.drawImage(Assets.fx.white, x + r * 0.3 - 9, y - r - 9, 18, 18);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    const cy = y - m.centerPx * def.scale;
    if (e.slowT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.time * 20 + e.id);
      const s = m.w * m.scale * def.scale * 0.8;
      ctx.drawImage(Assets.fx.violet, e.wx - s / 2, cy - s / 2, s, s);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (e.shield > 0) {
      const r = m.w * m.scale * def.scale * 0.48;
      const a = 0.25 + 0.35 * Math.min(1, e.shield / Math.max(1, e.maxShield, e.projShield || 0)) + (this.game.time - e.shieldHit < 0.15 ? 0.3 : 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(80,170,255,${a * 0.25})`;
      ctx.strokeStyle = `rgba(150,215,255,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(e.wx, cy, r, r * 1.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    if (def.project) {
      const r = def.project.range, pul = 0.5 + 0.5 * Math.sin(this.time * 3 + e.id);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(110,220,255,${0.18 + 0.15 * pul})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(e.wx, e.wy, r * HW * Math.SQRT2, r * HH * Math.SQRT2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.5 + 0.3 * pul;
      ctx.drawImage(Assets.fx.cyan, e.wx - 22, cy - m.centerPx * def.scale * 0.9 - 22, 44, 44);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (def.heal) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(this.time * 6 + e.id);
      ctx.drawImage(Assets.fx.green, e.wx - 20, cy - 34, 40, 40);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    e._top = y - m.topPx * def.scale;
  }

  drawHp(ctx, e) {
    if (e.def.cloak && !this.game.visible(e)) return;
    if (e.hp >= e.maxHp && e.shield >= e.maxShield && !e.def.boss) return;
    const w = e.def.boss ? 110 : 40;
    const x = e.wx - w / 2, y = (e._top ?? e.wy - 80) - 8;
    const r = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = r > 0.6 ? '#62f06e' : r > 0.3 ? '#ffc23d' : '#ff4a3d'; ctx.fillRect(x, y, w * r, 4);
    if (e.maxShield > 0) { ctx.fillStyle = '#6cc8ff'; ctx.fillRect(x, y - 3, w * Math.max(0, e.shield / e.maxShield), 2.5); }
  }
  drawTowerHp(ctx, t) {
    const w = 46, x = t.wx - w / 2, y = t.wy + 26;
    const r = Math.max(0, t.hp / t.stats.hp);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = r > 0.5 ? '#5fd0ff' : r > 0.25 ? '#ffb02e' : '#ff3b30'; ctx.fillRect(x, y, w * r, 4);
  }

  drawBeams(ctx, game) {
    ctx.globalCompositeOperation = 'lighter';
    for (const t of game.towers) {
      if (!t.firing || t.def.kind !== 'cryo' || !t.target) continue;
      const m = game.muzzle(t), a = game.aimPoint(t.target);
      const lw = 1 + 0.35 * (t.level - 1);
      const wob = Math.sin(this.time * 30 + t.id) * 2;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = 'rgba(120,210,255,1)';
      ctx.lineWidth = 16 * lw;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(a.x, a.y + wob); ctx.stroke();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = 'rgba(190,240,255,1)';
      ctx.lineWidth = 6 * lw;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(a.x, a.y - wob); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,1)';
      ctx.lineWidth = 2 * lw;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(a.x, a.y); ctx.stroke();
      const s = 46 + 10 * t.level;
      ctx.drawImage(Assets.fx.cyan, a.x - s / 2, a.y - s / 2, s, s);
      ctx.drawImage(Assets.fx.white, m.x - 12, m.y - 12, 24, 24);
    }
    for (const t of game.towers) {
      if (!t.firing || t.def.kind !== 'laser' || !t.target) continue;
      const m = game.muzzle(t), a = game.aimPoint(t.target);
      const heat = t.beamT / t.def.rampTime;
      const flick = 0.85 + Math.random() * 0.15;
      ctx.globalAlpha = 0.5 * flick;
      ctx.strokeStyle = `rgba(255,${(60 + heat * 80) | 0},40,1)`;
      const lw = 1 + 0.4 * (t.level - 1);
      ctx.lineWidth = (7 + heat * 6) * lw; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.globalAlpha = flick; ctx.strokeStyle = 'rgba(255,235,220,1)'; ctx.lineWidth = (2 + heat * 1.5) * lw;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(a.x, a.y); ctx.stroke();
      const s = 34 + heat * 30;
      ctx.drawImage(Assets.fx.red, a.x - s / 2, a.y - s / 2, s, s);
      ctx.drawImage(Assets.fx.red, m.x - 14, m.y - 14, 28, 28);
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
  }

  drawShots(ctx, shots) {
    const fx = Assets.fx;
    for (const s of shots) {
      if (s.k === 'missile' || s.k === 'emissile') {
        const a = Math.atan2(s.vy, s.vx);
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a);
        ctx.fillStyle = s.k === 'missile' ? '#d8d8d0' : '#3a3a3e';
        ctx.fillRect(-9, -2.2, 14, 4.4);
        ctx.fillStyle = s.k === 'missile' ? '#c0281e' : '#ff3020';
        ctx.beginPath(); ctx.moveTo(5, -2.2); ctx.lineTo(10, 0); ctx.lineTo(5, 2.2); ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(fx.orange, s.x - Math.cos(a) * 10 - 12, s.y - Math.sin(a) * 10 - 12, 24, 24);
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.k === 'plasma' || s.k === 'eplasma') {
        ctx.globalCompositeOperation = 'lighter';
        const ps = s.size || 1;
        ctx.drawImage(s.k === 'plasma' ? fx.cyan : fx.red, s.x - 26 * ps, s.y - 26 * ps, 52 * ps, 52 * ps);
        ctx.drawImage(fx.white, s.x - 10 * ps, s.y - 10 * ps, 20 * ps, 20 * ps);
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.k === 'ebullet' || s.k === 'flak') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(fx.yellow, s.x - 9, s.y - 9, 18, 18);
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.k === 'bomb') {
        ctx.fillStyle = '#1a1a1c';
        ctx.beginPath(); ctx.ellipse(s.x, s.y, 3.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(fx.red, s.x - 9, s.y - 9, 18, 18);
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.k === 'acid') {
        ctx.fillStyle = '#2d6e10';
        ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(fx.green, s.x - 15, s.y - 15, 30, 30);
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.k === 'shell') {
        ctx.fillStyle = '#1c1c1e';
        ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(s.enemy ? fx.red : fx.orange, s.x - 12, s.y - 12, 24, 24);
        ctx.globalCompositeOperation = 'source-over';
        const k = s.t0 / s.dur;
        ctx.strokeStyle = s.enemy ? `rgba(255,60,40,${0.3 + k * 0.5})` : `rgba(255,200,80,${0.2 + k * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(s.tx, s.ty, 40 * (1.2 - k * 0.5), 20 * (1.2 - k * 0.5), 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
}
