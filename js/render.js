// Isometric canvas renderer
import { HW, HH, TOWERS, PROPS, ENEMIES } from './config.js';
import { toWorld, toGrid, mulberry32, clamp } from './iso.js';
import { Assets } from './assets.js';
import { CELL } from './game.js';

const T = 128;          // top-down px per tile for ground composition
const DEPTH = 70;       // slab thickness in world px
const TOWER_FOOT = 26;  // px below tile centre where a tower sprite's lowest pixel sits

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
    this.ash = [];
    this.time = 0;
    this.insets = { top: 60, bottom: 0, left: 0, right: 0 };
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
    const g = this.ctx.createLinearGradient(0, 0, 0, this.vh);
    g.addColorStop(0, '#2a1d16');
    g.addColorStop(0.55, '#140f0d');
    g.addColorStop(1, '#07080a');
    this.bg = g;
    if (this.game) this.clampCam();
  }

  // ---------- camera ----------
  mapBounds() {
    const N = this.game.N;
    return { x0: -N * HW, x1: N * HW, y0: 0, y1: 2 * N * HH + DEPTH };
  }

  fitZoom() {
    const b = this.mapBounds();
    const availW = this.vw - this.insets.left - this.insets.right;
    const availH = this.vh - this.insets.top - this.insets.bottom;
    return Math.min(availW / (b.x1 - b.x0 + 40), availH / (b.y1 - b.y0 + 40));
  }

  resetCamera() {
    const b = this.mapBounds();
    const fit = this.fitZoom();
    const portrait = this.vw < this.vh;
    // portrait phones: start closer (map wider than screen, pan sideways)
    let z = fit;
    if (portrait) {
      const availH = this.vh - this.insets.top - this.insets.bottom;
      z = Math.min(fit * 1.45, availH / (b.y1 - b.y0 + 160));
    }
    this.cam.zoom = clamp(z, 0.18, 1.4);
    this.minZoom = Math.min(fit, 0.9) * 0.85;
    this.maxZoom = 1.8;
    // centre of the free area
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const offX = (this.insets.left - this.insets.right) / 2 / this.cam.zoom;
    const offY = (this.insets.top - this.insets.bottom) / 2 / this.cam.zoom;
    this.cam.x = cx - offX;
    this.cam.y = cy - offY;
  }

  clampCam() {
    const b = this.mapBounds();
    const z = this.cam.zoom;
    const halfW = this.vw / 2 / z, halfH = this.vh / 2 / z;
    const marginX = 120, marginY = 120;
    const minX = b.x0 - marginX + halfW - (this.insets.left / z), maxX = b.x1 + marginX - halfW + (this.insets.right / z);
    const minY = b.y0 - marginY + halfH - (this.insets.top / z), maxY = b.y1 + marginY - halfH + (this.insets.bottom / z);
    this.cam.x = minX > maxX ? (b.x0 + b.x1) / 2 : clamp(this.cam.x, minX, maxX);
    this.cam.y = minY > maxY ? (b.y0 + b.y1) / 2 - (this.insets.top - this.insets.bottom) / 2 / z : clamp(this.cam.y, minY, maxY);
  }

  screenToWorld(sx, sy) {
    const z = this.cam.zoom;
    return { x: (sx - this.vw / 2) / z + this.cam.x, y: (sy - this.vh / 2) / z + this.cam.y };
  }
  worldToScreen(wx, wy) {
    const z = this.cam.zoom;
    return { x: (wx - this.cam.x) * z + this.vw / 2, y: (wy - this.cam.y) * z + this.vh / 2 };
  }
  screenToCell(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const g = toGrid(w.x, w.y);
    return { x: Math.floor(g.x), y: Math.floor(g.y) };
  }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * factor, this.minZoom || 0.2, this.maxZoom || 1.8);
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCam();
  }
  pan(dx, dy) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.clampCam();
  }

  // ---------- level ground ----------
  setGame(game) {
    this.game = game;
    // iOS Safari has a hard total canvas memory limit: release the previous level's ground
    if (this.ground) { this.ground.canvas.width = 0; this.ground.canvas.height = 0; this.ground = null; }
    this.buildGround();
    this.resetCamera();
    this.ash = [];
    for (let i = 0; i < 40; i++) this.ash.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.6, v: 0.2 + Math.random() * 0.6, ph: Math.random() * 6 });
  }

  buildGround() {
    const game = this.game;
    const N = game.N;
    const L = game.level;
    const rng = mulberry32(N * 977 + game.levelIdx * 131);

    // --- 1. top-down composition ---
    const td = makeCanvas(N * T, N * T);
    const g = td.getContext('2d');
    const tex = Assets.tex.ground;
    const TS = 512;
    for (let y = 0; y < N * T; y += TS) for (let x = 0; x < N * T; x += TS) {
      if (tex) g.drawImage(tex, x, y, TS, TS); else { g.fillStyle = '#4a4036'; g.fillRect(x, y, TS, TS); }
    }
    // warm, slightly brighter grade of the AI ground texture
    g.globalCompositeOperation = 'screen';
    g.fillStyle = 'rgba(62,50,40,0.5)';
    g.fillRect(0, 0, N * T, N * T);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(255,226,200)';
    g.fillRect(0, 0, N * T, N * T);
    g.globalCompositeOperation = 'source-over';
    // large-scale tonal variation
    for (let i = 0; i < N * 1.5; i++) {
      const x = rng() * N * T, y = rng() * N * T, r = (1.5 + rng() * 3) * T;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rng() < 0.6;
      grd.addColorStop(0, dark ? 'rgba(10,8,6,0.28)' : 'rgba(150,120,90,0.12)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // craters & scorch marks on free cells
    for (let i = 0; i < N * 0.6; i++) {
      const cx = Math.floor(rng() * N), cy = Math.floor(rng() * N);
      if (game.cell(cx, cy) !== CELL.FREE) continue;
      const x = (cx + 0.2 + rng() * 0.6) * T, y = (cy + 0.2 + rng() * 0.6) * T, r = T * (0.25 + rng() * 0.35);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(12,9,7,0.5)');
      grd.addColorStop(0.5, 'rgba(30,24,18,0.3)');
      grd.addColorStop(0.78, 'rgba(150,130,105,0.16)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // faint build grid
    g.strokeStyle = 'rgba(0,0,0,0.13)';
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i <= N; i++) { g.moveTo(i * T, 0); g.lineTo(i * T, N * T); g.moveTo(0, i * T); g.lineTo(N * T, i * T); }
    g.stroke();
    g.strokeStyle = 'rgba(255,235,200,0.035)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i <= N; i++) { g.moveTo(i * T + 2, 0); g.lineTo(i * T + 2, N * T); g.moveTo(0, i * T + 2); g.lineTo(N * T, i * T + 2); }
    g.stroke();

    // --- roads ---
    const polys = game.paths.map(p => p.pts.map(pt => [pt.x * T, pt.y * T]));
    const strokePolys = (ctx, width, style) => {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = style; ctx.lineWidth = width;
      for (const pl of polys) {
        ctx.beginPath();
        ctx.moveTo(pl[0][0], pl[0][1]);
        for (let i = 1; i < pl.length; i++) ctx.lineTo(pl[i][0], pl[i][1]);
        ctx.stroke();
      }
    };
    // shoulder
    strokePolys(g, T * 1.22, 'rgba(30,24,18,0.25)');
    strokePolys(g, T * 1.08, 'rgba(30,24,18,0.3)');
    // asphalt via mask
    const road = makeCanvas(N * T, N * T);
    const rg = road.getContext('2d');
    const rtex = Assets.tex.road;
    for (let y = 0; y < N * T; y += TS) for (let x = 0; x < N * T; x += TS) {
      if (rtex) rg.drawImage(rtex, x, y, TS, TS); else { rg.fillStyle = '#2b2b2d'; rg.fillRect(x, y, TS, TS); }
    }
    const mask = makeCanvas(N * T, N * T);
    const mg = mask.getContext('2d');
    strokePolys(mg, T * 0.98, 'rgba(255,255,255,0.35)');
    strokePolys(mg, T * 0.92, 'rgba(255,255,255,0.6)');
    strokePolys(mg, T * 0.86, 'rgba(255,255,255,1)');
    rg.globalCompositeOperation = 'destination-in';
    rg.drawImage(mask, 0, 0);
    g.drawImage(road, 0, 0);
    // tyre tracks / worn lanes
    g.save();
    g.setLineDash([T * 0.35, T * 0.12]);
    for (const off of [-0.2, 0.2]) {
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.lineWidth = T * 0.07;
      for (const pl of polys) {
        g.beginPath();
        for (let i = 0; i < pl.length; i++) {
          const [x, y] = pl[i];
          const n = pl[Math.min(i + 1, pl.length - 1)], p0 = pl[Math.max(i - 1, 0)];
          const dx = n[0] - p0[0], dy = n[1] - p0[1];
          const l = Math.hypot(dx, dy) || 1;
          const px = x - dy / l * off * T, py = y + dx / l * off * T;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      }
    }
    g.restore();
    // rubble along road edges
    for (const pl of polys) {
      for (let i = 0; i < pl.length - 1; i++) {
        const [ax, ay] = pl[i], [bx, by] = pl[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        for (let k = 0; k < len / 18; k++) {
          const t = rng();
          const side = rng() < 0.5 ? -1 : 1;
          const o = (0.42 + rng() * 0.12) * T * side;
          const x = ax + (bx - ax) * t + nx * o, y = ay + (by - ay) * t + ny * o;
          const s = 2 + rng() * 5;
          g.fillStyle = rng() < 0.5 ? 'rgba(120,112,100,0.8)' : 'rgba(30,26,22,0.8)';
          g.fillRect(x - s / 2, y - s / 2, s, s * (0.6 + rng() * 0.6));
        }
      }
    }
    // spawn scorch
    for (const p of L.paths) {
      const x = (p.spawn[0] + 1) * T, y = (p.spawn[1] + 1) * T, r = T * 1.6;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(60,8,4,0.85)');
      grd.addColorStop(0.5, 'rgba(25,8,6,0.6)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // base concrete pad with hazard border
    {
      const [bx, by] = L.base;
      const x = bx * T - 10, y = by * T - 10, s = 2 * T + 20;
      g.fillStyle = 'rgba(105,100,92,1)';
      g.fillRect(x, y, s, s);
      if (rtex) { g.globalAlpha = 0.55; g.drawImage(rtex, x, y, s, s); g.globalAlpha = 1; }
      g.save();
      g.beginPath(); g.rect(x, y, s, s); g.rect(x + 16, y + 16, s - 32, s - 32);
      g.clip('evenodd');
      for (let i = -s; i < s * 2; i += 28) {
        g.fillStyle = (Math.floor(i / 28) % 2) ? 'rgba(230,180,40,0.85)' : 'rgba(25,22,18,0.9)';
        g.beginPath();
        g.moveTo(x + i, y); g.lineTo(x + i + 14, y); g.lineTo(x + i + 14 - s, y + s); g.lineTo(x + i - s, y + s);
        g.fill();
      }
      g.restore();
    }
    // vignette in top-down space
    {
      const c = N * T / 2;
      const grd = g.createRadialGradient(c, c, c * 0.55, c, c, c * 1.5);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = grd;
      g.fillRect(0, 0, N * T, N * T);
    }

    // --- 2. project to isometric ---
    const s = 1.25; // resolution multiplier
    const pad = 10;
    const W = 2 * N * HW + pad * 2, H = 2 * N * HH + DEPTH + pad * 2;
    const iso = makeCanvas(W * s, H * s);
    const ig = iso.getContext('2d');
    const ox = N * HW + pad, oy = pad;
    // slab sides (world coords)
    ig.setTransform(s, 0, 0, s, s * ox, s * oy);
    const Lp = [-N * HW, N * HH], Bp = [0, 2 * N * HH], Rp = [N * HW, N * HH];
    const face = (a, b, light) => {
      ig.beginPath();
      ig.moveTo(a[0], a[1]); ig.lineTo(b[0], b[1]); ig.lineTo(b[0], b[1] + DEPTH); ig.lineTo(a[0], a[1] + DEPTH);
      ig.closePath();
      const grd = ig.createLinearGradient(0, Math.min(a[1], b[1]), 0, Math.max(a[1], b[1]) + DEPTH);
      grd.addColorStop(0, light ? '#5b4a3b' : '#3a2f27');
      grd.addColorStop(1, light ? '#2a221c' : '#17120f');
      ig.fillStyle = grd;
      ig.fill();
      ig.save();
      ig.clip();
      // strata
      for (let i = 0; i < 9; i++) {
        const yo = 6 + i * (DEPTH / 9) + (rng() - 0.5) * 4;
        ig.strokeStyle = `rgba(${light ? '20,15,10' : '0,0,0'},${0.18 + rng() * 0.2})`;
        ig.lineWidth = 1 + rng() * 2.5;
        ig.beginPath();
        ig.moveTo(a[0], a[1] + yo);
        const steps = 24;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          ig.lineTo(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + yo + (rng() - 0.5) * 3);
        }
        ig.stroke();
      }
      // pebbles
      for (let i = 0; i < 160; i++) {
        const t = rng(), yo = rng() * DEPTH;
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t + yo;
        ig.fillStyle = `rgba(${rng() < 0.5 ? '150,130,110' : '10,8,6'},${0.25 + rng() * 0.35})`;
        const r = 1 + rng() * 3;
        ig.fillRect(x, y, r, r * 0.7);
      }
      ig.restore();
    };
    face(Lp, Bp, true);
    face(Bp, Rp, false);
    // ground top
    ig.setTransform(s * 0.5, s * 0.25, -s * 0.5, s * 0.25, s * ox, s * oy);
    ig.drawImage(td, 0, 0);
    // rim highlight
    ig.setTransform(s, 0, 0, s, s * ox, s * oy);
    ig.strokeStyle = 'rgba(255,220,180,0.18)';
    ig.lineWidth = 2;
    ig.beginPath(); ig.moveTo(Lp[0], Lp[1]); ig.lineTo(Bp[0], Bp[1]); ig.lineTo(Rp[0], Rp[1]); ig.stroke();
    ig.strokeStyle = 'rgba(0,0,0,0.35)';
    ig.beginPath(); ig.moveTo(Lp[0], Lp[1]); ig.lineTo(0, 0); ig.lineTo(Rp[0], Rp[1]); ig.stroke();

    // free temporary canvases right away (iOS canvas memory budget)
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
    const game = this.game;
    const ctx = this.ctx;
    this.time += dt;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, this.vw, this.vh);
    if (!game) return;

    for (const d of game.decals) this.stampDecal(d.x, d.y, d.s);
    game.decals.length = 0;

    const z = this.cam.zoom;
    let shx = 0, shy = 0;
    if (game.fx.shake > 0) { shx = (Math.random() - 0.5) * game.fx.shake * 2; shy = (Math.random() - 0.5) * game.fx.shake * 2; }
    const tx = this.vw / 2 - this.cam.x * z + shx, ty = this.vh / 2 - this.cam.y * z + shy;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * tx, dpr * ty);

    // ground
    const gr = this.ground;
    ctx.drawImage(gr.canvas, -gr.ox, -gr.oy, gr.W, gr.H);

    // placement overlay
    if (ui.placing) this.drawPlacementGrid(ctx, ui);

    // selection range under objects
    if (ui.selected) this.drawRange(ctx, ui.selected.gx, ui.selected.gy, ui.selected.stats.range, TOWERS[ui.selected.type].color, true);
    if (ui.ghost) {
      const gh = ui.ghost;
      this.drawCell(ctx, gh.cx, gh.cy, gh.ok ? 'rgba(80,255,140,0.35)' : 'rgba(255,60,60,0.4)', gh.ok ? '#6dff9d' : '#ff5050');
      if (gh.ok) this.drawRange(ctx, gh.cx + 0.5, gh.cy + 0.5, TOWERS[gh.type].range, TOWERS[gh.type].color, false);
    }

    // shadows
    const fx = Assets.fx;
    ctx.globalAlpha = 0.55;
    for (const t of game.towers) ctx.drawImage(fx.shadow, t.wx - 62, t.wy - 22, 124, 56);
    for (const p of game.props) { const w = PROPS[p.kind].width; ctx.drawImage(fx.shadow, p.wx - w * 0.5, p.wy - w * 0.16, w, w * 0.44); }
    for (const e of game.enemies) {
      const s = e.def.size * (e.air ? 0.7 : 0.95);
      const a = e.air ? 0.4 : 0.7;
      ctx.globalAlpha = a;
      ctx.drawImage(fx.shadow, e.wx - s / 2, e.wy - s * 0.2, s, s * 0.42);
    }
    ctx.globalAlpha = 1;

    // depth sorted ground objects
    const list = this._list || (this._list = []);
    list.length = 0;
    for (const p of game.props) list.push({ y: p.wy, o: p, k: 0 });
    for (const t of game.towers) list.push({ y: t.wy, o: t, k: 1 });
    for (const e of game.enemies) if (!e.air) list.push({ y: e.wy, o: e, k: 2 });
    const L = game.level;
    const bw = toWorld(L.base[0] + 1, L.base[1] + 1);
    list.push({ y: bw.y + HH, o: bw, k: 3 });
    for (const p of game.paths) {
      const sp = p.pts[0];
      const w = toWorld(sp.x, sp.y);
      const next = p.pts[1];
      list.push({ y: w.y + HH, o: { x: w.x, y: w.y, flip: (next.x - sp.x) > (next.y - sp.y) }, k: 4 });
    }
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      if (it.k === 0) this.drawProp(ctx, it.o);
      else if (it.k === 1) this.drawTower(ctx, it.o, ui);
      else if (it.k === 2) this.drawEnemy(ctx, it.o);
      else if (it.k === 3) this.drawStructure(ctx, 'base_hq', it.o.x, it.o.y, 236, 70, false);
      else if (it.k === 4) this.drawStructure(ctx, 'spawn_gate', it.o.x, it.o.y, 220, 62, it.o.flip);
    }
    // air units on top
    const air = game.enemies.filter(e => e.air).sort((a, b) => a.wy - b.wy);
    for (const e of air) this.drawEnemy(ctx, e);

    // projectiles
    this.drawShots(ctx, game.shots);
    // effects
    game.fx.draw(ctx);
    // health bars
    for (const e of game.enemies) this.drawHp(ctx, e);
    // ghost tower on top
    if (ui.ghost && ui.ghost.ok) {
      const gh = ui.ghost;
      const w = toWorld(gh.cx + 0.5, gh.cy + 0.5);
      ctx.globalAlpha = 0.65;
      this.drawTower(ctx, { type: gh.type, wx: w.x, wy: w.y, flip: false, recoil: 0, level: 1, built: 1 }, ui, true);
      ctx.globalAlpha = 1;
    }

    // ambient ash (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(220,200,180,0.35)';
    for (const a of this.ash) {
      a.y += a.v * dt * 0.04;
      a.x += Math.sin(this.time * 0.6 + a.ph) * dt * 0.01 + dt * 0.006;
      if (a.y > 1) { a.y = 0; a.x = Math.random(); }
      if (a.x > 1) a.x = 0;
      ctx.fillRect(a.x * this.vw, a.y * this.vh, a.s, a.s);
    }
  }

  drawCell(ctx, cx, cy, fill, stroke) {
    const a = toWorld(cx, cy), b = toWorld(cx + 1, cy), c = toWorld(cx + 1, cy + 1), d = toWorld(cx, cy + 1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  drawPlacementGrid(ctx, ui) {
    const game = this.game;
    const N = game.N;
    const pulse = 0.12 + 0.06 * Math.sin(this.time * 4);
    ctx.beginPath();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (game.cell(x, y) !== CELL.FREE) continue;
      const a = toWorld(x + 0.08, y + 0.08), b = toWorld(x + 0.92, y + 0.08), c = toWorld(x + 0.92, y + 0.92), d = toWorld(x + 0.08, y + 0.92);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    }
    ctx.fillStyle = `rgba(90,255,150,${pulse})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,255,170,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawRange(ctx, gx, gy, r, color, strong) {
    const c = toWorld(gx, gy);
    const rx = r * HW * Math.SQRT2, ry = r * HH * Math.SQRT2;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = strong ? 'rgba(120,200,255,0.10)' : 'rgba(120,255,170,0.08)';
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -this.time * 30;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  drawProp(ctx, p) {
    const def = PROPS[p.kind];
    const img = Assets.img[def.sprite];
    if (!img) return;
    const w = def.width, h = w * img.h / img.w;
    ctx.drawImage(img.n, p.wx - w / 2, p.wy + 22 - h, w, h);
  }

  drawStructure(ctx, name, x, y, w, foot, flip) {
    const img = Assets.img[name];
    if (!img) return;
    const h = w * img.h / img.w;
    if (flip) {
      ctx.save();
      ctx.translate(x, 0); ctx.scale(-1, 1);
      ctx.drawImage(img.n, -w / 2, y + foot - h, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img.n, x - w / 2, y + foot - h, w, h);
    }
    if (name === 'spawn_gate') {
      // pulsing red glow
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.time * 3);
      const s = 150;
      ctx.drawImage(Assets.fx.red, x - s / 2 + (flip ? 30 : -30), y - 40 - s / 2, s, s);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawTower(ctx, t, ui, ghost = false) {
    const def = TOWERS[t.type];
    const img = Assets.img[def.sprite];
    if (!img) return;
    const w = def.width, h = w * img.h / img.w;
    const rec = t.recoil * 3;
    const side = t.flip ? -1 : 1;
    const pop = !ghost && t.built < 0.25 ? 1 - Math.pow(1 - t.built / 0.25, 3) : 1;
    const hh = h * pop;
    const x = t.wx - w / 2 - side * rec * 0.6, y = t.wy + TOWER_FOOT - hh + rec * 0.3;
    ctx.drawImage(t.flip ? img.f : img.n, x, y, w, hh);
    if (ghost) return;
    if (ui.selected === t) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(this.time * 5);
      ctx.drawImage(t.flip ? img.f : img.n, x, y, w, hh);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // emp orb glow / plasma idle glow
    if (t.type === 'emp') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(this.time * 6 + t.id);
      const s = 54 + t.level * 6;
      ctx.drawImage(Assets.fx.violet, t.wx - s / 2, y + h * 0.07 - s / 2, s, s);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // rank chevrons
    if (t.level > 1) {
      const bx = t.wx + w * 0.3, by = t.wy + TOWER_FOOT - 12;
      for (let i = 0; i < t.level - 1; i++) {
        const yy = by - i * 7;
        ctx.beginPath();
        ctx.moveTo(bx - 8, yy - 4); ctx.lineTo(bx, yy + 1); ctx.lineTo(bx + 8, yy - 4); ctx.lineTo(bx + 8, yy); ctx.lineTo(bx, yy + 5); ctx.lineTo(bx - 8, yy);
        ctx.closePath();
        ctx.fillStyle = '#ffcc33';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  drawEnemy(ctx, e) {
    const def = e.def;
    const base = Assets.img['enemy_' + e.type + (e.back ? '_back' : '')] || Assets.img['enemy_' + e.type];
    if (!base) return;
    let drawW = def.size, drawH = def.size * base.h / base.w;
    if (def.tall) { drawH = def.size * 1.75; drawW = drawH * base.w / base.h; }
    const bob = Math.sin(e.anim * def.bobHz * Math.PI * 2) * def.bob;
    const lift = e.air ? def.lift + bob : Math.abs(bob);
    const x = e.wx - drawW / 2, y = e.wy + 6 - drawH - lift;
    const img = e.flip ? base.f : base.n;
    ctx.drawImage(img, x, y, drawW, drawH);
    if (e.flash > 0) {
      ctx.globalAlpha = Math.min(1, e.flash / 0.06) * (def.boss ? 0.3 : 0.5);
      ctx.drawImage(e.flip ? base.wf : base.wn, x, y, drawW, drawH);
      ctx.globalAlpha = 1;
    }
    if (e.slowT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.time * 20 + e.id);
      const s = drawW * 0.9;
      ctx.drawImage(Assets.fx.violet, e.wx - s / 2, y + drawH * 0.5 - s / 2, s, s);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (def.boss || e.type === 'android' || e.type === 'spider') {
      // glowing red eyes accent
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.time * 8 + e.id);
      const s = def.boss ? 90 : 20;
      const ey = def.boss ? y + drawH * 0.45 : e.type === 'android' ? y + drawH * 0.1 : y + drawH * 0.62;
      const ex = def.boss ? e.wx + (e.flip ? -1 : 1) * drawW * 0.1 : e.wx + (e.flip ? -1 : 1) * drawW * (e.type === 'spider' ? 0.06 : 0.12);
      if (!e.back) ctx.drawImage(Assets.fx.red, ex - s / 2, ey - s / 2, s, s);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    e._top = y;
  }

  drawHp(ctx, e) {
    if (e.hp >= e.maxHp && !e.def.boss) return;
    const w = e.def.boss ? 110 : Math.max(34, e.def.size * 0.45);
    const x = e.wx - w / 2, y = (e._top ?? e.wy - 80) - 8;
    const r = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = r > 0.6 ? '#62f06e' : r > 0.3 ? '#ffc23d' : '#ff4a3d';
    ctx.fillRect(x, y, w * r, 4);
    if (e.armor > 0) {
      ctx.fillStyle = '#9fb6c8';
      ctx.fillRect(x, y + 4, w * Math.min(1, e.armor / 12), 1.5);
    }
  }

  drawShots(ctx, shots) {
    const fx = Assets.fx;
    for (const s of shots) {
      if (s.k === 'missile') {
        const a = Math.atan2(s.vy, s.vx);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(a);
        ctx.fillStyle = '#d8d8d0';
        ctx.fillRect(-9, -2.2, 14, 4.4);
        ctx.fillStyle = '#c0281e';
        ctx.beginPath(); ctx.moveTo(5, -2.2); ctx.lineTo(10, 0); ctx.lineTo(5, 2.2); ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(fx.orange, s.x - Math.cos(a) * 10 - 12, s.y - Math.sin(a) * 10 - 12, 24, 24);
        ctx.globalCompositeOperation = 'source-over';
      } else if (s.k === 'plasma') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(fx.cyan, s.x - 26, s.y - 26, 52, 52);
        ctx.drawImage(fx.white, s.x - 10, s.y - 10, 20, 20);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
}
