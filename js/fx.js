// Particle / effect system (world space). Cheap enough for mobile.
import { Assets } from './assets.js';
import { rand } from './iso.js';

const MAX_PARTICLES = 650;

export class FX {
  constructor() {
    this.p = [];
    this.shake = 0;
  }
  clear() { this.p.length = 0; this.shake = 0; }

  add(o) {
    if (this.p.length >= MAX_PARTICLES) {
      // drop oldest cosmetic particle
      this.p.shift();
    }
    o.t = 0;
    this.p.push(o);
    return o;
  }

  // ---- emitters ----
  muzzle(x, y, color = 'yellow', size = 26) {
    this.add({ k: 'glow', x, y, s: size, life: 0.07, spr: color });
  }
  tracer(x1, y1, x2, y2, color = 'rgba(255,210,120,') {
    this.add({ k: 'line', x1, y1, x2, y2, w: 2.2, life: 0.06, c: color });
  }
  sparks(x, y, n = 4, color = '#ffd27a', speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(0.3, 1) * speed;
      this.add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 40, life: rand(0.12, 0.3), c: color });
    }
  }
  smoke(x, y, n = 3, s = 26, life = 1.2) {
    for (let i = 0; i < n; i++) {
      this.add({ k: 'smoke', x: x + rand(-8, 8), y: y + rand(-6, 6), vx: rand(-12, 12), vy: rand(-28, -10), s: s * rand(0.7, 1.2), grow: s * 1.6, life: life * rand(0.7, 1.2), a: rand(0.5, 0.8) });
    }
  }
  explosion(x, y, scale = 1) {
    this.add({ k: 'glow', x, y, s: 90 * scale, life: 0.22, spr: 'orange' });
    this.add({ k: 'glow', x, y, s: 50 * scale, life: 0.12, spr: 'yellow' });
    this.add({ k: 'ring', x, y, r0: 8 * scale, r1: 70 * scale, life: 0.35, c: '255,170,90' });
    for (let i = 0; i < 6 * scale; i++) {
      this.add({ k: 'fire', x: x + rand(-14, 14) * scale, y: y + rand(-10, 6) * scale, vx: rand(-40, 40) * scale, vy: rand(-70, -20) * scale, s: rand(20, 38) * scale, life: rand(0.25, 0.5) });
    }
    this.smoke(x, y - 6 * scale, Math.round(4 * scale), 30 * scale, 1.6);
    this.debris(x, y, Math.round(7 * scale), 220 * Math.sqrt(scale));
    this.sparks(x, y, Math.round(8 * scale), '#ffcf6a', 260 * scale);
    this.shake = Math.max(this.shake, 3 * scale);
  }
  debris(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(0.3, 1) * speed;
      this.add({ k: 'debris', x, y, z: 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: rand(120, 300), life: rand(0.7, 1.3), s: rand(2, 5), c: Math.random() < 0.5 ? '#2a2a2a' : '#7c7c80' });
    }
  }
  plasmaHit(x, y) {
    this.add({ k: 'glow', x, y, s: 110, life: 0.3, spr: 'cyan' });
    this.add({ k: 'ring', x, y, r0: 10, r1: 75, life: 0.35, c: '90,230,255' });
    this.sparks(x, y, 10, '#9ff3ff', 260);
  }
  beam(x1, y1, x2, y2) {
    this.add({ k: 'beam', x1, y1, x2, y2, life: 0.35 });
    this.add({ k: 'glow', x: x1, y: y1, s: 70, life: 0.2, spr: 'white' });
  }
  bolt(pts) {
    // jagged lightning between points
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const segs = 6;
      for (let s = 0; s < segs; s++) {
        const t = s / segs;
        const j = s === 0 ? 0 : 9;
        out.push([ax + (bx - ax) * t + rand(-j, j), ay + (by - ay) * t + rand(-j, j)]);
      }
    }
    out.push(pts[pts.length - 1]);
    this.add({ k: 'bolt', pts: out, life: 0.16 });
    for (let i = 1; i < pts.length; i++) this.add({ k: 'glow', x: pts[i][0], y: pts[i][1], s: 46, life: 0.18, spr: 'violet' });
  }
  text(x, y, str, color = '#ffd34d') {
    this.add({ k: 'text', x, y, str, c: color, life: 0.9 });
  }
  trail(x, y) {
    this.add({ k: 'smoke', x, y, vx: rand(-6, 6), vy: rand(-10, -2), s: 9, grow: 22, life: 0.6, a: 0.45 });
  }

  update(dt) {
    const p = this.p;
    let w = 0;
    for (let i = 0; i < p.length; i++) {
      const o = p[i];
      o.t += dt;
      if (o.t >= o.life) continue;
      if (o.k === 'spark' || o.k === 'smoke' || o.k === 'fire') {
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.k === 'spark') o.vy += 380 * dt;
      } else if (o.k === 'debris') {
        o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; o.vz -= 900 * dt;
        if (o.z < 0) { o.z = 0; o.vz *= -0.35; o.vx *= 0.5; o.vy *= 0.5; }
      } else if (o.k === 'text') {
        o.y -= 34 * dt;
      }
      p[w++] = o;
    }
    p.length = w;
    this.shake = Math.max(0, this.shake - dt * 18);
  }

  draw(ctx) {
    const fx = Assets.fx;
    // normal blended first (smoke, debris), then additive
    for (const o of this.p) {
      const k = o.t / o.life;
      if (o.k === 'smoke') {
        const s = o.s + o.grow * k;
        ctx.globalAlpha = o.a * (1 - k);
        ctx.drawImage(fx.smoke, o.x - s / 2, o.y - s / 2, s, s);
      } else if (o.k === 'debris') {
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = o.c;
        ctx.fillRect(o.x - o.s / 2, o.y - o.z - o.s / 2, o.s, o.s);
      } else if (o.k === 'text') {
        ctx.globalAlpha = 1 - k * k;
        ctx.font = '700 15px "Rajdhani", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(o.str, o.x, o.y);
        ctx.fillStyle = o.c;
        ctx.fillText(o.str, o.x, o.y);
      }
    }
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
          const s = o.s * (1 - k * 0.5);
          ctx.globalAlpha = (1 - k) * 0.9;
          ctx.drawImage(k < 0.4 ? fx.yellow : fx.orange, o.x - s / 2, o.y - s / 2, s, s);
          break;
        }
        case 'spark': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = o.c;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(o.x, o.y);
          ctx.lineTo(o.x - o.vx * 0.03, o.y - o.vy * 0.03);
          ctx.stroke();
          break;
        }
        case 'line': {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = o.c + (1 - k).toFixed(2) + ')';
          ctx.lineWidth = o.w;
          ctx.beginPath();
          ctx.moveTo(o.x1, o.y1);
          ctx.lineTo(o.x2, o.y2);
          ctx.stroke();
          break;
        }
        case 'beam': {
          const a = 1 - k;
          ctx.globalAlpha = a;
          ctx.strokeStyle = 'rgba(80,170,255,0.55)';
          ctx.lineWidth = 14 * a + 2;
          ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
          ctx.strokeStyle = 'rgba(235,248,255,1)';
          ctx.lineWidth = 3.5 * a + 1;
          ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
          break;
        }
        case 'bolt': {
          const a = 1 - k;
          ctx.globalAlpha = a;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(170,110,255,0.6)';
          ctx.lineWidth = 7;
          ctx.beginPath();
          ctx.moveTo(o.pts[0][0], o.pts[0][1]);
          for (let i = 1; i < o.pts.length; i++) ctx.lineTo(o.pts[i][0], o.pts[i][1]);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(245,235,255,1)';
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
        }
        case 'ring': {
          const r = o.r0 + (o.r1 - o.r0) * k;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = `rgba(${o.c},${(1 - k) * 0.8})`;
          ctx.lineWidth = 4 * (1 - k) + 1;
          ctx.beginPath();
          ctx.ellipse(o.x, o.y, r, r * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
