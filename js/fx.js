// Particle / effect system (world space). Video-based explosions + procedural particles.
import { Assets, Models } from './assets.js';
import { rand } from './iso.js';

const MAX_PARTICLES = 900;

export class FX {
  constructor() { this.p = []; this.shake = 0; this.flash = 0; }
  clear() { this.p.length = 0; this.shake = 0; this.flash = 0; }

  add(o) {
    if (this.p.length >= MAX_PARTICLES) this.p.splice(0, 40);
    o.t = 0;
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
    const v = rand(0.85, 1.2);
    this.add({ k: 'boom', x, y, s: size * v, life: life * rand(0.85, 1.15), rot: kind === 'heavy' ? rand(-0.08, 0.08) : rand(-0.35, 0.35), flip: Math.random() < 0.5, kind });
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
  // machine destroyed: kind-specific blast, the sprite splinters into burning pieces, heavy units leave a wreck
  death(e, info) {
    const { x, y, ground, kind, scale, frame } = info;
    const name = e.def.model;
    const m = Models.meta(name);
    const heavy = e.def.cost >= 7 || e.def.boss;
    const s0 = (m ? m.scale : 0.7) * e.def.scale;
    if (kind === 'plasma') {
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
          life: rand(1.1, 1.9), burn: Math.random() < 0.45, trail: 0,
        });
      }
    }
    // charred wreck for heavy ground machines
    if (ground && heavy && m && m.img) {
      this.add({ k: 'wreck', c: Models.wreck(name, frame), x: e.wx, y: e.wy, w: m.w * s0, h: m.h * s0, ax: m.ax * s0, ay: m.ay * s0, life: e.def.boss ? 14 : 8, fire: 0 });
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
  text(x, y, str, color = '#ffd34d') { this.add({ k: 'text', x, y, str, c: color, life: 0.9 }); }
  trail(x, y) { this.add({ k: 'smoke', x, y, vx: rand(-6, 6), vy: rand(-10, -2), s: 9, grow: 22, life: 0.6, a: 0.45 }); }

  update(dt) {
    const p = this.p;
    const spawned = [];
    let w = 0;
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const o = p[i];
      o.t += dt;
      if (o.t >= o.life) continue;
      switch (o.k) {
        case 'spark': o.x += o.vx * dt; o.y += o.vy * dt; o.vy += 380 * dt; break;
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
    for (const o of spawned) if (p.length < MAX_PARTICLES) p.push(o);
    this.shake = Math.max(0, this.shake - dt * 18);
    this.flash = Math.max(0, this.flash - dt * 1.6);
  }

  draw(ctx) {
    const fx = Assets.fx;
    // pass 0: wrecks lie on the ground
    for (const o of this.p) {
      if (o.k !== 'wreck') continue;
      const k = o.t / o.life;
      ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      ctx.drawImage(o.c, o.x - o.ax, o.y - o.ay, o.w, o.h);
    }
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
        case 'debris':
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = o.c;
          ctx.fillRect(o.x - o.s / 2, o.y - o.z - o.s / 2, o.s, o.s);
          break;
        case 'boom': {
          const ex = Assets.vfx[o.kind || 'fire'];
          if (!ex || !ex.img) break;
          const f = Math.min(ex.n - 1, Math.floor(k * ex.n));
          const sx = (f % ex.cols) * ex.size, sy = Math.floor(f / ex.cols) * ex.size;
          ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
          ctx.save();
          ctx.translate(o.x, o.y);
          ctx.rotate(o.rot);
          if (o.flip) ctx.scale(-1, 1);
          ctx.drawImage(ex.img, sx, sy, ex.size, ex.size, -o.s / 2, -o.s * ex.ay, o.s, o.s);
          ctx.restore();
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
        case 'boom': {
          if (k < 0.35) {
            ctx.globalAlpha = (0.35 - k) * 1.4;
            const s = o.s * 1.3;
            ctx.drawImage(o.kind === 'plasma' ? fx.cyan : fx.orange, o.x - s / 2, o.y - s / 2, s, s);
          }
          break;
        }
        case 'shard': {
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
    ctx.globalAlpha = 1;
  }
}
