// Core simulation: grid, paths, towers, enemies, projectiles, waves.
import {
  TOWERS, ENEMIES, LEVELS, PROPS, HW, HH, MAX_LEVEL, SELL_RATE, WAVE_COUNT, WAVE_TIPS,
  towerStats, upgradeCost, totalInvested, buildWave, waveHpMul,
} from './config.js';
import { toWorld, rand } from './iso.js';
import { FX } from './fx.js';
import { sfx } from './audio.js';
import { Assets } from './assets.js';

export const CELL = { FREE: 0, ROAD: 1, BLOCK: 2, SPAWN: 3, BASE: 4, TOWER: 5 };

let uid = 1;

function buildPath(spawn, cells, base) {
  const pts = [{ x: spawn[0] + 1, y: spawn[1] + 1 }];
  for (const [cx, cy] of cells) pts.push({ x: cx + 0.5, y: cy + 0.5 });
  pts.push({ x: base[0] + 1, y: base[1] + 1 });
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    seg.push({ a: pts[i], dx: dx / len, dy: dy / len, len, start: total });
    total += len;
  }
  return { pts, seg, total };
}

function pathPos(path, d) {
  const segs = path.seg;
  let s = segs[segs.length - 1];
  for (let i = 0; i < segs.length; i++) {
    if (d < segs[i].start + segs[i].len) { s = segs[i]; break; }
  }
  const t = Math.min(s.len, Math.max(0, d - s.start));
  return { x: s.a.x + s.dx * t, y: s.a.y + s.dy * t, dx: s.dx, dy: s.dy };
}

export class Game {
  constructor(levelIdx) {
    this.levelIdx = levelIdx;
    this.level = LEVELS[levelIdx];
    const L = this.level;
    this.N = L.size;
    this.grid = new Uint8Array(this.N * this.N);
    this.credits = L.credits;
    this.lives = L.lives;
    this.maxLives = L.lives;
    this.wave = 0;               // waves started
    this.time = 0;
    this.queue = [];             // pending spawns
    this.enemies = [];
    this.towers = [];
    this.shots = [];             // projectiles
    this.fx = new FX();
    this.events = [];            // UI events (toast etc.)
    this.state = 'build';        // build | wave | won | lost
    this.breakTimer = -1;
    this.waveBonusPaid = true;
    this.kills = 0;
    this.decals = [];            // pending ground decals for renderer
    this.paths = L.paths.map(p => buildPath(p.spawn, p.cells, L.base));
    this.props = [];
    this.setupGrid();
  }

  idx(x, y) { return y * this.N + x; }
  cell(x, y) {
    if (x < 0 || y < 0 || x >= this.N || y >= this.N) return CELL.BLOCK;
    return this.grid[this.idx(x, y)];
  }
  setCell(x, y, v) {
    if (x < 0 || y < 0 || x >= this.N || y >= this.N) return;
    this.grid[this.idx(x, y)] = v;
  }

  setupGrid() {
    const L = this.level;
    for (const p of L.paths) {
      const [sx, sy] = p.spawn;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.setCell(sx + dx, sy + dy, CELL.SPAWN);
      let prev = null;
      for (const c of p.cells) {
        if (prev) {
          const stepX = Math.sign(c[0] - prev[0]), stepY = Math.sign(c[1] - prev[1]);
          let x = prev[0], y = prev[1];
          while (x !== c[0] || y !== c[1]) {
            this.setCell(x, y, CELL.ROAD);
            x += stepX; y += stepY;
          }
        }
        this.setCell(c[0], c[1], CELL.ROAD);
        prev = c;
      }
    }
    const [bx, by] = L.base;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.setCell(bx + dx, by + dy, CELL.BASE);
    for (const [kind, x, y] of L.props) {
      if (this.cell(x, y) !== CELL.FREE) continue;
      this.setCell(x, y, CELL.BLOCK);
      const w = toWorld(x + 0.5, y + 0.5);
      this.props.push({ kind, cx: x, cy: y, wx: w.x, wy: w.y, flip: ((x * 7 + y * 13) % 2) === 1 });
    }
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  // ---------- building ----------
  canBuild(cx, cy) { return this.cell(cx, cy) === CELL.FREE; }

  towerAt(cx, cy) { return this.towers.find(t => t.cx === cx && t.cy === cy); }

  build(type, cx, cy) {
    const def = TOWERS[type];
    if (!this.canBuild(cx, cy)) { this.emit('toast', { text: 'Hier kann nicht gebaut werden', bad: true }); sfx('error'); return null; }
    if (this.credits < def.cost) { this.emit('toast', { text: 'Nicht genug Credits', bad: true }); sfx('error'); return null; }
    this.credits -= def.cost;
    const w = toWorld(cx + 0.5, cy + 0.5);
    const t = {
      id: uid++, type, level: 1, cx, cy, gx: cx + 0.5, gy: cy + 0.5, wx: w.x, wy: w.y,
      cool: 0.2, flip: false, back: false, mode: 'first', recoil: 0, built: 0, kills: 0, spin: 0,
    };
    t.stats = towerStats(type, 1);
    this.towers.push(t);
    this.setCell(cx, cy, CELL.TOWER);
    this.fx.smoke(w.x, w.y + 10, 5, 34, 1.0);
    this.fx.add({ k: 'ring', x: w.x, y: w.y + 14, r0: 20, r1: 80, life: 0.4, c: '200,220,255' });
    sfx('build');
    return t;
  }

  upgrade(t) {
    if (t.level >= MAX_LEVEL) return false;
    const c = upgradeCost(t.type, t.level);
    if (this.credits < c) { this.emit('toast', { text: 'Nicht genug Credits', bad: true }); sfx('error'); return false; }
    this.credits -= c;
    t.level++;
    t.stats = towerStats(t.type, t.level);
    this.fx.add({ k: 'ring', x: t.wx, y: t.wy + 14, r0: 20, r1: 90, life: 0.5, c: '120,255,160' });
    this.fx.sparks(t.wx, t.wy - 30, 12, '#9dffb5', 200);
    sfx('upgrade');
    return true;
  }

  sellValue(t) { return Math.round(totalInvested(t.type, t.level) * SELL_RATE); }

  sell(t) {
    const v = this.sellValue(t);
    this.credits += v;
    this.towers = this.towers.filter(o => o !== t);
    this.setCell(t.cx, t.cy, CELL.FREE);
    this.fx.smoke(t.wx, t.wy, 6, 36, 1.2);
    this.fx.text(t.wx, t.wy - 60, `+${v}`);
    sfx('sell');
  }

  // ---------- waves ----------
  canCallWave() {
    return this.wave < WAVE_COUNT && this.queue.length === 0 && (this.state === 'build' || this.state === 'wave');
  }

  startWave() {
    if (!this.canCallWave()) return;
    let bonus = 0;
    if (this.wave > 0 && this.enemies.length > 0) bonus = 10 + this.wave * 2;
    else if (this.breakTimer > 0) bonus = Math.round(this.breakTimer * 2);
    if (bonus > 0) { this.credits += bonus; this.emit('toast', { text: `Früher Angriff: +${bonus} Credits` }); }
    const list = buildWave(this.wave, this.level);
    this.wave++;
    const hpMul = waveHpMul(this.wave, this.level.hpMul);
    for (const s of list) this.queue.push({ t: this.time + 1.2 + s.t, type: s.type, path: s.path, hpMul });
    this.state = 'wave';
    this.breakTimer = -1;
    this.waveBonusPaid = false;
    this.emit('wave', { n: this.wave });
    const tip = WAVE_TIPS[this.wave];
    if (tip) this.emit('toast', { text: tip, warn: true, long: true });
    sfx(list.some(s => s.type === 'boss') ? 'alarm' : 'wave');
  }

  spawn(type, pathIdx, hpMul) {
    const def = ENEMIES[type];
    const path = this.paths[pathIdx] || this.paths[0];
    const hp = Math.round(def.hp * hpMul);
    const p = pathPos(path, 0);
    const w = toWorld(p.x, p.y);
    const e = {
      id: uid++, type, def, path, d: 0, hp, maxHp: hp, armor: def.armor,
      gx: p.x, gy: p.y, wx: w.x, wy: w.y, rx: w.x, ry: w.y,
      off: rand(-0.17, 0.17), slowT: 0, slowF: 0, flash: 0, flashCd: 0, anim: Math.random() * 10,
      back: false, flip: false, alive: true, air: !!def.air,
    };
    this.enemies.push(e);
  }

  // ---------- damage ----------
  damage(e, raw, ignoreArmor = false) {
    if (!e.alive) return;
    const dmg = ignoreArmor ? raw : Math.max(raw * 0.2, raw - e.armor);
    e.hp -= dmg;
    if (e.flashCd <= 0) { e.flash = 0.06; e.flashCd = 0.22; }
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    e.alive = false;
    this.kills++;
    const reward = e.def.reward;
    this.credits += reward;
    const y = e.wy - (e.air ? e.def.lift : 0);
    const scale = e.def.boss ? 3 : e.type === 'tank' || e.type === 'mech' ? 1.5 : e.type === 'spider' ? 0.7 : 1;
    this.fx.explosion(e.wx, y - e.def.size * 0.2, scale);
    this.fx.text(e.wx, y - e.def.size * 0.6, `+${reward}`);
    this.decals.push({ x: e.wx, y: e.wy, s: e.def.size * (e.air ? 0.7 : 1.1) });
    sfx('explosion', scale > 1.4);
  }

  enemiesInRange(gx, gy, r, air, ground) {
    const r2 = r * r;
    const out = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.air ? !air : !ground) continue;
      const dx = e.gx - gx, dy = e.gy - gy;
      if (dx * dx + dy * dy <= r2) out.push(e);
    }
    return out;
  }

  pickTarget(t, list) {
    if (!list.length) return null;
    let best = null, bv = -Infinity;
    for (const e of list) {
      let v;
      if (t.mode === 'strong') v = e.hp;
      else if (t.mode === 'near') v = -((e.gx - t.gx) ** 2 + (e.gy - t.gy) ** 2);
      else v = e.d - e.path.total; // first: least remaining distance
      if (v > bv) { bv = v; best = e; }
    }
    return best;
  }

  // body centre of an enemy in world px (for aiming / fx)
  aimPoint(e) {
    const lift = e.air ? e.def.lift : 0;
    return { x: e.wx, y: e.wy - lift - e.def.size * (e.def.tall ? 0.55 : 0.32) };
  }

  muzzle(t) {
    const def = TOWERS[t.type];
    const img = Assets.img[def.sprite];
    const w = def.width, h = img ? w * img.h / img.w : w;
    const side = t.flip ? -1 : 1;
    const top = t.wy + 26 - h;
    const m = {
      gatling: [0.36, 0.42], missile: [0.2, 0.3], plasma: [0.36, 0.38], rail: [0.42, 0.62], emp: [0.0, 0.08],
    }[t.type];
    return { x: t.wx + side * w * m[0] * (t.back ? 0.6 : 1), y: top + h * m[1] - (t.back ? 10 : 0) };
  }

  fire(t, target) {
    const s = t.stats;
    const def = TOWERS[t.type];
    const aim = this.aimPoint(target);
    t.flip = aim.x < t.wx;
    t.back = aim.y < t.wy - 40;
    t.recoil = 1;
    const m = this.muzzle(t);
    switch (t.type) {
      case 'gatling': {
        this.damage(target, s.dmg);
        const jx = rand(-6, 6), jy = rand(-6, 6);
        this.fx.tracer(m.x, m.y, aim.x + jx, aim.y + jy);
        this.fx.muzzle(m.x, m.y, 'yellow', 30);
        if (Math.random() < 0.5) this.fx.sparks(aim.x + jx, aim.y + jy, 2, '#ffe3a0', 120);
        sfx('gatling');
        break;
      }
      case 'missile': {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.shots.push({
          k: 'missile', x: m.x + side * 10, y: m.y, vx: (t.flip ? -1 : 1) * 60, vy: -160, sp: 260,
          target, tx: aim.x, ty: aim.y, tgx: target.gx, tgy: target.gy, dmg: s.dmg, splash: s.splash, airBonus: def.airBonus, trail: 0, life: 4,
        });
        this.fx.muzzle(m.x, m.y, 'orange', 34);
        this.fx.smoke(m.x, m.y, 2, 16, 0.8);
        sfx('missile');
        break;
      }
      case 'plasma': {
        this.shots.push({
          k: 'plasma', x: m.x, y: m.y, sp: 560, target, tx: aim.x, ty: aim.y, tgx: target.gx, tgy: target.gy,
          dmg: s.dmg, splash: s.splash, life: 3,
        });
        this.fx.muzzle(m.x, m.y, 'cyan', 60);
        sfx('plasma');
        break;
      }
      case 'rail': {
        // direction in grid space, pierce everything along the line up to range
        let dx = target.gx - t.gx, dy = target.gy - t.gy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const R = s.range;
        let hits = 0;
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const ex = e.gx - t.gx, ey = e.gy - t.gy;
          const along = ex * dx + ey * dy;
          if (along < 0 || along > R + 0.3) continue;
          const perp = Math.abs(ex * dy - ey * dx);
          if (perp <= 0.38 || e === target) {
            this.damage(e, s.dmg * Math.pow(0.9, hits));
            hits++;
          }
        }
        const end = toWorld(t.gx + dx * R, t.gy + dy * R);
        const endY = end.y - 22;
        this.fx.beam(m.x, m.y, end.x, endY);
        this.fx.sparks(aim.x, aim.y, 8, '#cfe9ff', 240);
        this.fx.shake = Math.max(this.fx.shake, 2);
        sfx('rail');
        break;
      }
      case 'emp': {
        const chain = [target];
        const used = new Set([target]);
        let cur = target;
        for (let i = 1; i < s.chain; i++) {
          let best = null, bd = 1.7 * 1.7;
          for (const e of this.enemies) {
            if (!e.alive || used.has(e)) continue;
            const d2 = (e.gx - cur.gx) ** 2 + (e.gy - cur.gy) ** 2;
            if (d2 < bd) { bd = d2; best = e; }
          }
          if (!best) break;
          chain.push(best); used.add(best); cur = best;
        }
        const pts = [[m.x, m.y]];
        for (const e of chain) {
          const a = this.aimPoint(e);
          pts.push([a.x, a.y]);
          e.slowF = Math.max(e.slowF, s.slow);
          e.slowT = Math.max(e.slowT, s.slowDur);
          this.damage(e, s.dmg, true);
        }
        this.fx.bolt(pts);
        sfx('emp');
        break;
      }
    }
  }

  explode(x, y, gx, gy, dmg, splash, opts = {}) {
    const list = this.enemiesInRange(gx, gy, splash, opts.air !== false, true);
    for (const e of list) {
      const d = Math.hypot(e.gx - gx, e.gy - gy);
      const fall = d < splash * 0.5 ? 1 : 1 - 0.5 * (d - splash * 0.5) / (splash * 0.5);
      let v = dmg * fall;
      if (e.air && opts.airBonus) v *= opts.airBonus;
      this.damage(e, v, !!opts.ignoreArmor);
    }
  }

  // ---------- update ----------
  update(dt) {
    if (this.state === 'won' || this.state === 'lost') { this.fx.update(dt); return; }
    this.time += dt;

    // spawn queue
    while (this.queue.length && this.queue[0].t <= this.time) {
      const s = this.queue.shift();
      this.spawn(s.type, s.path, s.hpMul);
    }

    // enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.anim += dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.flashCd > 0) e.flashCd -= dt;
      let sp = e.def.speed;
      if (e.slowT > 0) { e.slowT -= dt; sp *= 1 - e.slowF; if (e.slowT <= 0) e.slowF = 0; }
      e.d += sp * dt;
      if (e.d >= e.path.total) {
        e.alive = false;
        this.lives = Math.max(0, this.lives - e.def.leak);
        const b = toWorld(this.level.base[0] + 1, this.level.base[1] + 1);
        this.fx.explosion(b.x + rand(-30, 30), b.y - 40 + rand(-20, 10), 1.2);
        this.fx.shake = Math.max(this.fx.shake, 6);
        this.emit('baseHit', { n: e.def.leak });
        sfx('baseHit');
        continue;
      }
      const p = pathPos(e.path, e.d);
      // lateral offset for a natural column, faded out near start/end
      const fade = Math.min(1, e.d / 1.2, (e.path.total - e.d) / 1.2);
      const ox = -p.dy * e.off * fade, oy = p.dx * e.off * fade;
      e.gx = p.x + ox; e.gy = p.y + oy;
      const w = toWorld(e.gx, e.gy);
      // smooth render position
      const k = Math.min(1, dt * 14);
      e.rx += (w.x - e.rx) * k; e.ry += (w.y - e.ry) * k;
      e.wx = e.rx; e.wy = e.ry;
      const sx = p.dx - p.dy, sy = p.dx + p.dy; // screen direction
      e.back = sy < -0.01;
      e.flip = sx < -0.01;
    }
    if (this.enemies.some(e => !e.alive)) this.enemies = this.enemies.filter(e => e.alive);

    // towers
    for (const t of this.towers) {
      t.recoil = Math.max(0, t.recoil - dt * 8);
      t.built += dt;
      t.cool -= dt;
      if (t.cool > 0) continue;
      const def = TOWERS[t.type];
      const list = this.enemiesInRange(t.gx, t.gy, t.stats.range, def.air, def.ground);
      const target = this.pickTarget(t, list);
      if (!target) { t.cool = 0.05; continue; }
      t.cool = 1 / t.stats.rate;
      this.fire(t, target);
    }

    // projectiles
    for (const s of this.shots) {
      s.life -= dt;
      if (s.target && s.target.alive) {
        const a = this.aimPoint(s.target);
        s.tx = a.x; s.ty = a.y; s.tgx = s.target.gx; s.tgy = s.target.gy;
      }
      const dx = s.tx - s.x, dy = s.ty - s.y;
      const d = Math.hypot(dx, dy);
      if (s.k === 'missile') {
        s.sp = Math.min(720, s.sp + 900 * dt);
        const turn = Math.min(1, dt * 7);
        s.vx += ((dx / (d || 1)) * s.sp - s.vx) * turn;
        s.vy += ((dy / (d || 1)) * s.sp - s.vy) * turn;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.trail -= dt;
        if (s.trail <= 0) { s.trail = 0.025; this.fx.trail(s.x, s.y); }
        if (d < 16 || s.life <= 0) {
          s.dead = true;
          this.fx.explosion(s.tx, s.ty, 0.75);
          this.explode(s.tx, s.ty, s.tgx, s.tgy, s.dmg, s.splash, { airBonus: s.airBonus });
          sfx('explosion');
        }
      } else if (s.k === 'plasma') {
        const step = s.sp * dt;
        if (d <= step || s.life <= 0) {
          s.dead = true;
          this.fx.plasmaHit(s.tx, s.ty);
          this.explode(s.tx, s.ty, s.tgx, s.tgy, s.dmg, s.splash, { ignoreArmor: true, air: false });
          sfx('hit');
        } else {
          s.x += dx / d * step; s.y += dy / d * step;
        }
      }
    }
    if (this.shots.some(s => s.dead)) this.shots = this.shots.filter(s => !s.dead);

    this.fx.update(dt);

    // wave flow
    if (this.state === 'wave' && this.queue.length === 0 && this.enemies.length === 0) {
      if (!this.waveBonusPaid) {
        this.waveBonusPaid = true;
        const bonus = 20 + this.wave * 4;
        this.credits += bonus;
        if (this.wave < WAVE_COUNT) this.emit('toast', { text: `Welle ${this.wave} abgewehrt! +${bonus} Credits` });
      }
      if (this.wave >= WAVE_COUNT) {
        this.state = 'won';
        this.emit('won', {});
      } else if (this.breakTimer < 0) {
        this.breakTimer = 14;
      }
    }
    if (this.breakTimer > 0 && this.state === 'wave') {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) { this.breakTimer = -1; this.startWave(); }
    }
    if (this.lives <= 0 && this.state !== 'lost') {
      this.state = 'lost';
      this.emit('lost', {});
    }
  }

  stars() {
    const r = this.lives / this.maxLives;
    return r >= 0.9 ? 3 : r >= 0.5 ? 2 : 1;
  }
}

export { pathPos };
