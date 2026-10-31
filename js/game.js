// Core simulation: grid, routes, towers (turret aiming), enemies (attack towers), projectiles, waves.
import {
  TOWERS, ENEMIES, BIOMES, EFFECT, FROST, SHATTER, THERMAL, ACID_ARMOR, NUKE, POWERUPS, DROP, HOLE, ELEV_PX, ELEV_RANGE, MAX_LEVEL, TOWER_SCALE, UPGRADE_TIME, WAVE_GAP, SELL_RATE, FULL_REFUND_TIME, towerStats, upgradeCost, totalInvested,
} from './config.js';
import { getLevel, makeWaves, makeBossRush, hpMultiplier } from './levels.js';
import { toWorld, rand, mulberry32 } from './iso.js';
import { FX } from './fx.js';
import { sfx } from './audio.js';
import { Models } from './assets.js';

export const RANKS = [10, 30, 70, 140];
const TALL_DECOR = new Set(['prop_tree', 'prop_j_tree', 'prop_i_pine', 'prop_v_spire']);
export const CELL = { FREE: 0, ROAD: 1, BLOCK: 2, SPAWN: 3, BASE: 4, TOWER: 5 };
const TAU = Math.PI * 2;
let uid = 1;

// Rounds every corner of the road polyline with a circular arc so units walk smooth curves
// instead of pivoting on the spot.
function smoothRoute(pts, r = 0.5) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const d1 = [(bx - ax) / l1, (by - ay) / l1], d2 = [(cx - bx) / l2, (cy - by) / l2];
    const p0 = [bx - d1[0] * rr, by - d1[1] * rr], p2 = [bx + d2[0] * rr, by + d2[1] * rr];
    const steps = 7;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      // quadratic Bezier with the corner as control point (close to a quarter circle)
      out.push([u * u * p0[0] + 2 * u * t * bx + t * t * p2[0], u * u * p0[1] + 2 * u * t * by + t * t * p2[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function buildRoute(pts) {
  const spts = smoothRoute(pts);
  const seg = [];
  let total = 0;
  for (let i = 0; i < spts.length - 1; i++) {
    const [ax, ay] = spts[i], [bx, by] = spts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    seg.push({ ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, len, start: total });
    total += len;
  }
  return { pts, seg, total };
}
export function routePos(route, d) {
  const segs = route.seg;
  let s = segs[segs.length - 1];
  for (let i = 0; i < segs.length; i++) if (d < segs[i].start + segs[i].len) { s = segs[i]; break; }
  const t = Math.min(s.len, Math.max(0, d - s.start));
  return { x: s.ax + s.dx * t, y: s.ay + s.dy * t, dx: s.dx, dy: s.dy };
}
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

export class Game {
  // mods (difficulty, challenges): speed, hp, count, armor, credits, reward, cd, lives, towers[], noRewards, noAbilities, bossRush, endless
  constructor(levelIdx, mods = null) {
    this.levelIdx = levelIdx;
    this.mods = mods || {};
    const M = this.mods;
    this.level = getLevel(levelIdx);
    if (M.endless) this.level = { ...this.level, waves: 150 };
    const L = this.level;
    this.N = L.N;
    this.grid = new Uint8Array(this.N * this.N);
    this.credits = Math.round((L.credits + (L.paths.length - 1) * 150) * (M.credits || 1));
    this.lives = M.lives || 20;
    this.maxLives = this.lives;
    this.waves = M.bossRush ? makeBossRush(L, M.bossRush) : makeWaves(L);
    if (M.count) for (const w of this.waves) for (const g of w.groups) if (!ENEMIES[g.type].boss) { g.count = Math.ceil(g.count * M.count); g.gap /= Math.sqrt(M.count); }
    this.wave = 0;
    this.time = 0;
    this.queue = [];
    this.enemies = [];
    this.towers = [];
    this.shots = [];
    this.fx = new FX();
    this.events = [];
    this.state = 'build';
    this.nextWaveIn = -1;        // countdown to the next automatic wave
    this.waveLeft = {};          // wave number -> enemies not yet dead/leaked
    this.kills = 0;
    this.lost = 0;
    this.decals = [];
    this.seen = new Set();
    this.routes = L.paths.map(p => buildRoute(p.pts));
    // longer routes keep enemies on the field longer: leave more time between automatic waves
    const avgLen = L.paths.reduce((a, p) => a + p.cells.length, 0) / L.paths.length;
    this.waveGap = WAVE_GAP + Math.max(0, avgLen - 40) * 0.12;
    this.props = [];
    this.puddles = [];
    // orbital strike: special ability with cooldown (from mission 2)
    // free play (unlockAll): every tower and ability from the first mission on
    this.orbital = { cd: 25, max: Math.round(85 * (M.cd || 1)), on: (L.number >= 2 || M.unlockAll) && !M.noAbilities };
    this.strikes = [];
    // nuclear strike, charged by kills; power-up crates and active buffs
    this.nuke = { charge: 0, need: Math.round(NUKE.need(L.number) * (M.cd || 1)), on: (L.number >= NUKE.unlock || M.unlockAll) && !M.noAbilities };
    this.nukes = [];
    this.hole = { cd: Math.round(HOLE.first * (M.cd || 1)), max: Math.round(HOLE.cd * (M.cd || 1)), on: (L.number >= HOLE.unlock || M.unlockAll) && !M.noAbilities };
    this.holes = [];
    this.radZones = [];
    this.drops = [];
    this.lastDrop = -99;
    this.buffs = { overdrive: 0, timestop: 0, gold: 0, repair: 0 };
    this.setupGrid();
  }

  idx(x, y) { return y * this.N + x; }
  cell(x, y) { return (x < 0 || y < 0 || x >= this.N || y >= this.N) ? CELL.BLOCK : this.grid[this.idx(x, y)]; }
  setCell(x, y, v) { if (x >= 0 && y >= 0 && x < this.N && y < this.N) this.grid[this.idx(x, y)] = v; }

  setupGrid() {
    const L = this.level;
    this.height = new Uint8Array(this.N * this.N);
    for (const [x, y, h] of L.elev || []) this.height[this.idx(x, y)] = h;
    for (const p of L.paths) for (const [x, y] of p.cells) this.setCell(x, y, CELL.ROAD);
    for (const p of L.paths) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.setCell(p.spawn[0] + dx, p.spawn[1] + dy, CELL.SPAWN);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.setCell(L.base[0] + dx, L.base[1] + dy, CELL.BASE);
    for (const [sprite, x, y] of L.props) {
      if (this.cell(x, y) !== CELL.FREE) continue;
      this.setCell(x, y, CELL.BLOCK);
      const w = toWorld(x + 0.5, y + 0.5);
      // 3D prop: one of 4 baked rotations and a little size variation
      const h = (x * 73856093) ^ (y * 19349663);
      const z = this.heightAt(x, y) * ELEV_PX;
      this.props.push({ model: 'p3d_' + sprite, cx: x, cy: y, wx: w.x, wy: w.y - z, z, rot: (h >>> 3) & 3, s: 0.9 + ((h >>> 7) % 9) / 40 });
    }
    // small non-blocking decoration (bushes, rocks, debris) clustered around props and the map edge;
    // building on a cell clears it
    const B = BIOMES[L.biome], r = mulberry32(L.seed * 31 + 7);
    const tot = B.decor.reduce((a, d) => a + d[3], 0);
    this.decor = [];
    for (let y = 0; y < this.N; y++) for (let x = 0; x < this.N; x++) {
      if (this.cell(x, y) !== CELL.FREE) continue;
      let near = 0, road = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = this.cell(x + dx, y + dy);
        if (c === CELL.BLOCK && x + dx >= 0 && y + dy >= 0 && x + dx < this.N && y + dy < this.N) near++;
        if (c === CELL.ROAD || c === CELL.SPAWN || c === CELL.BASE) road = true;
      }
      const edge = x === 0 || y === 0 || x === this.N - 1 || y === this.N - 1;
      if (r() > B.decorDensity * (1 + near * 1.3 + (edge ? 0.8 : 0)) * (road ? 0.5 : 1)) continue;
      let k = r() * tot, d = B.decor[0];
      for (const it of B.decor) { k -= it[3]; if (k <= 0) { d = it; break; } }
      // tall decoration would hide units on the road: only low items next to it
      if (road && TALL_DECOR.has(d[0])) d = B.decor.find(it => !TALL_DECOR.has(it[0])) || d;
      const w = toWorld(x + 0.5 + (r() - 0.5) * 0.36, y + 0.5 + (r() - 0.5) * 0.36);
      const z = this.heightAt(x, y) * ELEV_PX;
      this.decor.push({ model: 'p3d_' + d[0], cx: x, cy: y, wx: w.x, wy: w.y - z, z, rot: Math.floor(r() * 4), s: d[1] + r() * (d[2] - d[1]) });
    }
    const b = toWorld(L.base[0] + 1, L.base[1] + 1);
    this.baseW = b;
    // spawn gates (2x2 cells), opening turned towards the first road segment
    // gate model: the opening faces grid angle 90° + 90°·frame
    this.gates = L.paths.map((p) => {
      const w = toWorld(p.spawn[0] + 1, p.spawn[1] + 1);
      const r0 = p.pts[0], r1 = p.pts[1];
      const th = Math.round(Math.atan2(r1[1] - r0[1], r1[0] - r0[0]) / (Math.PI / 2));
      const rot = (((th - 1) % 4) + 4) % 4;
      return { x: w.x, y: w.y, rot, dir: th };
    });
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  // ---------------- building ----------------
  unlocked(type) { return (this.mods.unlockAll || TOWERS[type].unlock <= this.level.number) && (!this.mods.towers || this.mods.towers.includes(type)); }
  canBuild(cx, cy) { return this.cell(cx, cy) === CELL.FREE; }
  towerAt(cx, cy) { return this.towers.find(t => t.cx === cx && t.cy === cy); }

  // terrain height of a cell (0 = ground, 1-2 = plateau)
  heightAt(x, y) { return (x < 0 || y < 0 || x >= this.N || y >= this.N) ? 0 : this.height[this.idx(x, y)]; }
  // tower stats incl. the high-ground range bonus
  statsFor(type, level, cx, cy) {
    const s = towerStats(type, level);
    const h = this.heightAt(cx, cy);
    if (h) s.range *= 1 + ELEV_RANGE * h;
    return s;
  }

  build(type, cx, cy) {
    const def = TOWERS[type];
    if (!this.canBuild(cx, cy)) { this.emit('toast', { text: 'Hier kann nicht gebaut werden', bad: true }); sfx('error'); return null; }
    if (this.credits < def.cost) { this.emit('toast', { text: 'Nicht genug Credits', bad: true }); sfx('error'); return null; }
    this.credits -= def.cost;
    const w = toWorld(cx + 0.5, cy + 0.5);
    const stats = this.statsFor(type, 1, cx, cy);
    const z = this.heightAt(cx, cy) * ELEV_PX;
    const t = {
      id: uid++, type, def, level: 1, cx, cy, gx: cx + 0.5, gy: cy + 0.5, wx: w.x, wy: w.y - z, z,
      ang: Math.PI / 4 + rand(-0.4, 0.4), cool: 0.3, target: null, mode: 'first', recoil: 0, built: 0, kills: 0,
      stats, hp: stats.hp, beamT: 0, beamTarget: null, firing: false, lastHit: -99, placedAt: this.time,
    };
    this.towers.push(t);
    this.setCell(cx, cy, CELL.TOWER);
    this.decor = this.decor.filter(d => d.cx !== cx || d.cy !== cy);
    this.fx.dust(w.x, w.y - z + 8, 1.2);
    this.fx.add({ k: 'ring', x: w.x, y: w.y - z + 10, r0: 20, r1: 80, life: 0.4, c: '200,220,255' });
    if (z && !this._elevHint) { this._elevHint = true; this.emit('toast', { text: `Höhenvorteil: +${Math.round(ELEV_RANGE * 100 * this.heightAt(cx, cy))} % Reichweite` }); }
    sfx('build');
    return t;
  }

  // upgrades take time: the tower is under construction and cannot fire meanwhile
  upgrade(t) {
    if (t.level >= MAX_LEVEL || t.upgrading) return false;
    const c = upgradeCost(t.type, t.level);
    if (this.credits < c) { this.emit('toast', { text: 'Nicht genug Credits', bad: true }); sfx('error'); return false; }
    this.credits -= c;
    t.upgrading = { t: 0, dur: UPGRADE_TIME[t.level], cost: c, spark: 0 };
    t.target = null; t.firing = false; t.beamT = 0;
    this.fx.dust(t.wx, t.wy + 6, 0.9);
    sfx('upgradeStart');
    return true;
  }
  finishUpgrade(t) {
    t.upgrading = null;
    t.level++;
    const ratio = t.hp / t.stats.hp;
    t.stats = this.statsFor(t.type, t.level, t.cx, t.cy);
    t.hp = Math.min(t.stats.hp, Math.round(t.stats.hp * ratio) + Math.round(t.stats.hp * 0.3));
    t.powerUp = 1;
    const col = t.level === 3 ? '255,210,90' : '120,255,170';
    this.fx.add({ k: 'ring', x: t.wx, y: t.wy + 10, r0: 20, r1: 120, life: 0.6, c: col });
    this.fx.add({ k: 'ring', x: t.wx, y: t.wy + 10, r0: 10, r1: 70, life: 0.4, c: '255,255,255' });
    this.fx.add({ k: 'glow', x: t.wx, y: t.wy - 40, s: 180, life: 0.45, spr: t.level === 3 ? 'yellow' : 'green' });
    this.fx.sparks(t.wx, t.wy - 40, 24, t.level === 3 ? '#ffe08a' : '#9dffb5', 280);
    this.fx.text(t.wx, t.wy - 95, t.level === 3 ? 'STUFE III' : 'STUFE II', t.level === 3 ? '#ffd34d' : '#8dffb0');
    this.emit('upgraded', { t });
    sfx('upgrade');
  }

  sellValue(t) {
    const inv = totalInvested(t.type, t.level) + (t.upgrading ? t.upgrading.cost : 0);
    return this.time - t.placedAt < FULL_REFUND_TIME && t.level === 1 ? inv : Math.round(inv * SELL_RATE * (0.5 + 0.5 * t.hp / t.stats.hp));
  }
  sell(t) {
    const v = this.sellValue(t);
    this.credits += v;
    this.removeTower(t);
    this.fx.dust(t.wx, t.wy, 1.4);
    this.fx.text(t.wx, t.wy - 60, `+${v}`);
    sfx('sell');
  }
  repairCost(t) { return Math.ceil((1 - t.hp / t.stats.hp) * totalInvested(t.type, t.level) * 0.35); }
  repair(t) {
    const c = this.repairCost(t);
    if (c <= 0) return false;
    if (this.credits < c) { this.emit('toast', { text: 'Nicht genug Credits', bad: true }); sfx('error'); return false; }
    this.credits -= c;
    t.hp = t.stats.hp;
    this.fx.sparks(t.wx, t.wy - 40, 12, '#8dff9a', 180);
    sfx('upgrade');
    return true;
  }
  removeTower(t) {
    this.towers = this.towers.filter(o => o !== t);
    this.setCell(t.cx, t.cy, CELL.FREE);
    for (const e of this.enemies) if (e.atkTarget === t) e.atkTarget = null;
  }

  damageTower(t, dmg) {
    if (!this.towers.includes(t)) return;
    if (this.buffs.repair > 0) { if (Math.random() < 0.3) this.fx.add({ k: 'glow', x: t.wx, y: t.wy - 40, s: 90, life: 0.2, spr: 'cyan' }); return; }
    t.hp -= dmg;
    t.lastHit = this.time;
    if (t.hp <= 0) {
      this.removeTower(t);
      this.fx.bigExplosion(t.wx, t.wy - 10, 1.6, 'heavy');
      this.fx.boom(t.wx, t.wy + 10, 200, 1.1, 'ground');
      this.fx.debris(t.wx, t.wy - 20, 18, 320);
      this.decals.push({ x: t.wx, y: t.wy, s: 150 });
      this.emit('toast', { text: `${t.def.name} wurde zerstört!`, bad: true });
      this.emit('towerLost', { t });
      sfx('explosion', true);
    }
  }

  // ---------------- waves ----------------
  canCallWave() { return this.wave < this.waves.length && this.queue.length === 0 && (this.state === 'build' || this.state === 'wave'); }

  startWave() {
    if (!this.canCallWave()) return;
    // calling early pays a bonus for every second skipped
    let bonus = 0;
    if (this.wave > 0) {
      bonus = Math.round(Math.max(0, this.nextWaveIn) * 2.5 * (this.mods.reward || 1));
    }
    if (bonus > 0) { this.credits += bonus; this.emit('toast', { text: `Früher Angriff: +${bonus} Credits` }); }
    const wv = this.waves[this.wave];
    this.wave++;
    const hpMul = hpMultiplier(this.level.number, this.wave) * (this.mods.hp || 1);
    const rewardMul = (1 + 0.05 * (this.wave - 1)) * (1 + 0.025 * (this.level.number - 1));
    const nR = this.routes.length;
    let k = 0;
    const tips = [];
    const fresh = [];
    const n = this.wave;
    this.waveLeft[n] = 0;
    // a called-early wave starts right after the previous one finished spawning
    const t0 = Math.max(this.time, this.queue.length ? this.queue[this.queue.length - 1].t + 1.5 : this.time) + 1.2;
    for (const g of wv.groups) {
      for (let i = 0; i < g.count; i++) {
        this.queue.push({ t: t0 + g.delay + i * g.gap, type: g.type, route: (k++) % nR, hpMul: hpMul * (g.hpScale || 1), rewardMul, wave: n });
        this.waveLeft[n]++;
      }
      if (!this.seen.has(g.type)) { this.seen.add(g.type); fresh.push(g.type); if (ENEMIES[g.type].spawns) fresh.push(ENEMIES[g.type].spawns.type); }
    }
    if (fresh.length) this.emit('newTypes', { types: fresh });
    this.queue.sort((a, b) => a.t - b.t);
    this.state = 'wave';
    this.nextWaveIn = -1;
    this.emit('wave', { n: this.wave });
    const tip = tips[0] || wv.tip;
    if (tip) this.emit('toast', { text: tip, warn: true, long: true });
    sfx(wv.boss ? 'alarm' : 'wave');
  }

  // all enemies of a wave are gone -> bonus + field repairs
  waveDone(n) {
    if (!(n in this.waveLeft)) return;
    if (--this.waveLeft[n] > 0) return;
    delete this.waveLeft[n];
    const bonus = Math.round((25 + n * 6) * (this.mods.reward || 1));
    this.credits += bonus;
    for (const t of this.towers) t.hp = Math.min(t.stats.hp, t.hp + t.stats.hp * 0.3);
    if (n < this.waves.length) this.emit('toast', { text: `Welle ${n} abgewehrt! +${bonus} Credits` });
  }

  spawn(type, routeIdx, hpMul, rewardMul, startD = 0) {
    const def = ENEMIES[type];
    const route = this.routes[routeIdx] || this.routes[0];
    const hp = Math.round(def.hp * hpMul);
    const p = routePos(route, startD);
    const w = toWorld(p.x, p.y);
    const e = {
      id: uid++, type, def, route, d: startD, hp, maxHp: hp, armor: def.armor,
      shield: def.shield ? Math.round(def.shield * hpMul) : 0, maxShield: def.shield ? Math.round(def.shield * hpMul) : 0, shieldHit: -9,
      gx: p.x, gy: p.y, wx: w.x, wy: w.y, rx: w.x, ry: w.y, ang: Math.atan2(p.dy, p.dx),
      off: rand(-0.16, 0.16), slowT: 0, slowF: 0, burnT: 0, burnDps: 0, flash: 0, flashCd: 0, anim: Math.random() * 10,
      frost: 0, frozenT: 0, freezeImm: 0, acidN: 0, acidT: 0, acidDps: 0, acidSrc: null, puddleCd: 0,
      alive: true, air: !!def.air, atkCool: rand(0.5, 1.5), atkTarget: null, reward: Math.round(def.reward * rewardMul),
      spawnT: def.spawns ? def.spawns.every : 0, diving: null, healT: 0, hpMul, walk: Math.random() * 3, turnRate: 0,
      cloakT: Math.random() * 2, cloaked: !!def.cloak, revealT: 0, bombT: def.bomb ? def.bomb.every * 0.6 : 0, projT: 1,
      speedMul: this.mods.speed || 1,
    };
    if (this.mods.armor) e.armor = Math.round(def.armor * this.mods.armor + (def.armor ? 1 : 0));
    this.enemies.push(e);
    return e;
  }

  // ---------------- damage to enemies ----------------
  damage(e, raw, opts = {}) {
    if (!e.alive) return 0;
    if (e.cloaked && !opts.dot) e.revealT = Math.max(e.revealT, 0.8);
    // tower effectiveness against the enemy class (light / armoured / heavy / air)
    const src = opts.src;
    let mult = src && src.type && EFFECT[src.type] ? (EFFECT[src.type][e.def.cls] ?? 1) : 1;
    if (src && src.rank) mult *= 1 + 0.08 * src.rank;            // veteran towers
    if (e.frozenT > 0 && src && SHATTER.towers.includes(src.type)) {
      mult *= SHATTER.mul;                                          // frozen machines shatter
      if (this.time > (e.shatterFx || 0)) { e.shatterFx = this.time + 0.6; this.fx.text(e.wx, this.bodyY(e) - 50, 'ZERSCHMETTERT', '#bff0ff'); this.fx.sparks(e.wx, this.bodyY(e), 10, '#e6fbff', 200); }
    }
    let dmg = raw * mult;
    if (src && (mult >= 1.35 || mult <= 0.6) && this.time > (src.fbT || 0) && this.time > (this._fbG || 0)) {
      src.fbT = this.time + 7; this._fbG = this.time + 0.9;
      const good = mult >= 1.35;
      this.fx.text(e.wx, this.bodyY(e) - 34, good ? '▲ EFFEKTIV' : '▼ SCHWACH', good ? '#ffb43c' : '#9aa4ad');
    }
    if (e.shield > 0) {
      const sMul = opts.shieldMul || 1;
      const sd = Math.min(e.shield, dmg * sMul);
      e.shield -= sd;
      e.shieldHit = this.time;
      dmg -= sd / sMul;
      if (e.shield <= 0) { this.fx.shieldBreak(e.wx, this.bodyY(e)); sfx('hit'); }
      if (dmg <= 0) return sd;
    }
    const armor = Math.max(0, e.armor - e.acidN * ACID_ARMOR);     // acid eats the armour
    dmg = opts.ignoreArmor ? dmg : Math.max(dmg * 0.2, dmg - armor);
    if (opts.acid) this.corrode(e, opts.acid, opts.src);
    e.hp -= dmg;
    if (e.flashCd <= 0) { e.flash = 0.06; e.flashCd = 0.2; }
    if (e.hp <= 0) this.kill(e, opts.src);
    return dmg;
  }

  // frost build-up: slows, at 100 % the machine freezes solid (bosses only slow down)
  chill(e, amt) {
    if (!e.alive || e.frozenT > 0) return;
    e.frost = Math.min(FROST.max, e.frost + amt * (e.freezeImm > 0 ? 0.4 : 1));
    e.frostHit = this.time;
    if (e.frost >= FROST.max && !e.def.boss && e.freezeImm <= 0) {
      e.frozenT = FROST.freeze;
      this.fx.add({ k: 'ring', x: e.wx, y: e.wy, r0: 10, r1: 60, life: 0.35, c: '190,240,255' });
      this.fx.sparks(e.wx, this.bodyY(e), 10, '#dff7ff', 160);
      sfx('freeze');
    }
  }
  // acid corrosion: stacks reduce armour and burn over time
  corrode(e, dps, src, stacks = 1) {
    e.acidN = Math.min(src && src.def ? src.def.acidMax || 5 : 5, e.acidN + stacks);
    e.acidT = src && src.def ? src.def.acidDur || 4 : 4;
    e.acidDps = Math.max(e.acidDps, dps);
    e.acidSrc = src || e.acidSrc;
  }

  kill(e, src) {
    e.alive = false;
    this.kills++;
    if (e.def.burst && !e.air) {
      const b = e.def.burst, ri = this.routes.indexOf(e.route);
      for (let i = 0; i < b.count; i++) { const c = this.spawn(b.type, ri, e.hpMul * 0.7, 0.4, Math.max(0, e.d - 0.15 - i * 0.12)); c.off = rand(-0.35, 0.35); }
      this.fx.add({ k: 'glow', x: e.wx, y: e.wy - 30, s: 140, life: 0.4, spr: 'orange' });
    }
    if (src) {
      src.kills++;
      // veterans: rank up at 10 / 30 / 70 / 140 kills (+8 % damage per rank)
      if (src.def && this.towers.includes(src)) {
        const rank = RANKS.filter(k => src.kills >= k).length;
        if (rank > (src.rank || 0)) {
          src.rank = rank;
          this.fx.text(src.wx, src.wy - 100, 'RANG ' + '★'.repeat(rank), '#ffd34d');
          this.fx.add({ k: 'ring', x: src.wx, y: src.wy + 8, r0: 16, r1: 90, life: 0.5, c: '255,210,90' });
          this.emit('rankUp', { t: src, rank });
          sfx('rankUp');
        }
      }
    }
    const gain = this.mods.noRewards ? 0 : Math.max(1, Math.round(e.reward * (this.mods.reward || 1))) * (this.buffs.gold > 0 ? 3 : 1);
    this.credits += gain;
    if (this.buffs.gold > 0) this.fx.text(e.wx, this.bodyY(e) - 50, `+${gain} ×3`, '#ffd34d');
    if (this.nuke.on && !this._nuking) this.nuke.charge = Math.min(this.nuke.need, this.nuke.charge + e.reward);
    // power-up crate: bosses always, others rarely (spaced out)
    if (!e.air || e.def.boss) {
      if (!this.mods.noAbilities && (e.def.boss || (Math.random() < DROP.chance && this.time - this.lastDrop > DROP.gap && this.drops.length < 2))) this.spawnDrop(e.gx, e.gy);
    }
    const y = this.bodyY(e);
    const big = e.def.boss ? 3.0 : e.def.cost >= 10 ? 1.7 : e.def.cost >= 5 ? 1.3 : e.type === 'spider' ? 0.8 : 1;
    // explosion style depends on what killed the machine
    const sk = src && src.def ? src.def.kind : null;
    const kind = e.frozenT > 0 || sk === 'cryo' ? 'ice' : sk === 'acid' || (!sk && e.acidT > 0) ? 'acid'
      : sk === 'plasma' || sk === 'emp' || sk === 'laser' || sk === 'rail' ? 'plasma' : (!sk && e.burnT > 0) || sk === 'flame' ? 'burn' : 'fire';
    this.fx.death(e, { x: e.wx, y, ground: !e.air, kind, scale: big, frame: Models.unitFrame(e) });
    this.fx.text(e.wx, y - 30 * big, `+${e.reward}`);
    if (!e.air) this.decals.push({ x: e.wx, y: e.wy, s: 70 * Math.min(big, 2.4) });
    sfx('explosion', big >= 1.6);
    if (e.def.boss) { this.emit('toast', { text: `${e.def.name} vernichtet! +${e.reward}`, warn: false }); this.fx.shake = Math.max(this.fx.shake, 14); }
  }

  bodyY(e) { return e.wy - (e.air ? e.def.lift : 0) - (Models.meta(e.def.model)?.centerPx ?? 30) * e.def.scale; }
  aimPoint(e) { return { x: e.wx, y: this.bodyY(e) }; }

  // cloak cycle: on for `on` seconds, flickers off for `off` seconds
  cloakOff(e) { const c = e.def.cloak; return !c || (e.cloakT % (c.on + c.off)) > c.on; }
  visible(e) { return !e.cloaked || e.revealT > 0 || this.cloakOff(e); }
  enemiesInRange(gx, gy, r, air, ground, minR = 0) {
    const r2 = r * r, m2 = minR * minR, out = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.air ? !air : !ground) continue;
      const d2 = (e.gx - gx) ** 2 + (e.gy - gy) ** 2;
      if (d2 <= r2 && d2 >= m2) out.push(e);
    }
    return out;
  }

  pickTarget(t, list) {
    let best = null, bv = -Infinity;
    for (const e of list) {
      let v;
      if (t.mode === 'strong') v = e.hp + e.shield;
      else if (t.mode === 'near') v = -((e.gx - t.gx) ** 2 + (e.gy - t.gy) ** 2);
      else v = e.d - e.route.total;
      if (e.def.boss && t.mode === 'first') v += 0.5;
      if (v > bv) { bv = v; best = e; }
    }
    return best;
  }

  // world position of the barrel tip for the current turret frame
  muzzle(t) {
    const m = Models.meta(t.def.model);
    if (!m || !m.muzzles) return { x: t.wx, y: t.wy - 60 };
    const f = Models.frameFor(t.def.model, t.ang);
    const [mx, my] = m.muzzles[f];
    const s = m.scale * TOWER_SCALE;
    return { x: t.wx + mx * s, y: t.wy + my * s };
  }

  // ---------------- towers ----------------
  updateTower(t, dt) {
    t.recoil = Math.max(0, t.recoil - dt * 7);
    t.built += dt;
    const odm = this.buffs.overdrive > 0 ? 2 : 1;      // OVERDRIVE: double fire rate
    t.cool -= dt * odm;
    if (t.powerUp > 0) t.powerUp = Math.max(0, t.powerUp - dt * 0.8);
    if (t.upgrading) {
      const u = t.upgrading;
      u.t += dt;
      u.spark -= dt;
      if (u.spark <= 0) {
        // welding sparks somewhere on the tower
        u.spark = 0.09 + Math.random() * 0.12;
        const x = t.wx + rand(-34, 34), y = t.wy - rand(10, 70);
        this.fx.sparks(x, y, 4, Math.random() < 0.5 ? '#9fe8ff' : '#ffd27a', 150);
        this.fx.add({ k: 'glow', x, y, s: 26, life: 0.08, spr: 'white' });
      }
      if (u.t >= u.dur) this.finishUpgrade(t);
      t.firing = false;
      return;
    }
    // passive regeneration when not under fire
    if (this.time - t.lastHit > 3 && t.hp < t.stats.hp) t.hp = Math.min(t.stats.hp, t.hp + t.stats.hp * 0.035 * dt);
    const def = t.def;
    const s = t.stats;
    // retarget
    if (!t.target || !t.target.alive || ((t.target.gx - t.gx) ** 2 + (t.target.gy - t.gy) ** 2) > s.range * s.range || (def.minRange && ((t.target.gx - t.gx) ** 2 + (t.target.gy - t.gy) ** 2) < def.minRange ** 2)) {
      t.target = null;
    }
    // EMP towers expose cloaked infiltrators in their range
    if (def.kind === 'emp') for (const e of this.enemiesInRange(t.gx, t.gy, s.range, true, true)) if (e.cloaked) e.revealT = Math.max(e.revealT, 0.4);
    if (t.target && t.target.cloaked && t.target.revealT <= 0 && !this.cloakOff(t.target)) t.target = null;
    if (!t.target || t.retarget <= 0) {
      const list = this.enemiesInRange(t.gx, t.gy, s.range, def.air, def.ground, def.minRange || 0).filter(e => !e.cloaked || e.revealT > 0 || this.cloakOff(e));
      const nt = this.pickTarget(t, list);
      if (nt !== t.target) { t.target = nt; t.beamT = 0; }
      t.retarget = 0.25;
    }
    t.retarget = (t.retarget || 0) - dt;
    t.firing = false;
    const target = t.target;
    if (!target) {
      if (!def.static) t.ang += Math.sin(this.time * 0.35 + t.id) * 0.35 * dt; // idle scan
      t.beamT = 0;
      return;
    }
    let aimOk = true;
    if (!def.static) {
      let want = Math.atan2(target.gy - t.gy, target.gx - t.gx);
      if (def.kind === 'mortar') { /* lob: aim at target */ }
      const d = angDiff(t.ang, want);
      const step = def.turn * dt;
      t.ang += Math.abs(d) <= step ? d : Math.sign(d) * step;
      aimOk = Math.abs(angDiff(t.ang, want)) < (def.kind === 'flame' || def.kind === 'laser' || def.kind === 'cryo' ? 0.35 : 0.22);
    }
    if (!aimOk) { t.beamT = Math.max(0, t.beamT - dt); return; }

    // continuous weapons
    if (def.kind === 'laser') {
      t.firing = true;
      t.beamT = Math.min(def.rampTime, t.beamT + dt);
      const mul = 1 + (def.ramp - 1) * (t.beamT / def.rampTime);
      this.damage(target, s.dps * mul * dt * odm, { src: t });
      if (Math.random() < dt * 20) { const a = this.aimPoint(target); this.fx.sparks(a.x, a.y, 1, '#ff9a8a', 120); }
      sfx('laser');
      return;
    }
    if (def.kind === 'cryo') {
      t.firing = true;
      this.damage(target, s.dps * dt * odm, { src: t });
      this.chill(target, s.frost * dt * odm);
      // upgraded cryo spreads the cold around the target
      if (t.level >= 2) for (const e of this.enemiesInRange(target.gx, target.gy, 0.45 + 0.2 * t.level, true, true)) if (e !== target) this.chill(e, s.frost * 0.35 * dt);
      if (Math.random() < dt * 14) { const a = this.aimPoint(target); this.fx.frostMist(a.x + rand(-10, 10), a.y + rand(-8, 8)); }
      sfx('cryo');
      return;
    }
    if (def.kind === 'flame') {
      t.firing = true;
      const cone = def.cone;
      for (const e of this.enemiesInRange(t.gx, t.gy, s.range, false, true)) {
        const a = Math.atan2(e.gy - t.gy, e.gx - t.gx);
        if (Math.abs(angDiff(t.ang, a)) <= cone / 2 + 0.12) {
          this.damage(e, s.dps * dt * odm, { src: t });
          e.burnT = def.burnDur; e.burnDps = Math.max(e.burnDps, s.burn);
          // thermal shock: fire on a deep-frozen machine cracks it open
          if (e.alive && (e.frost >= THERMAL.frost || e.frozenT > 0) && this.time > (e.thermalCd || 0)) {
            e.thermalCd = this.time + 4;
            const bonus = e.maxHp * (e.def.boss ? THERMAL.bossFrac : THERMAL.hpFrac);
            e.frost = 0; e.frozenT = 0; e.freezeImm = FROST.immune;
            this.fx.thermalShock(e.wx, this.bodyY(e));
            this.fx.text(e.wx, this.bodyY(e) - 46, 'THERMOSCHOCK', '#ffe0b0');
            this.damage(e, bonus, { ignoreArmor: true, src: t });
            sfx('freeze');
          }
        }
      }
      const m = this.muzzle(t);
      const dir = toWorld(Math.cos(t.ang), Math.sin(t.ang));
      const len = Math.hypot(dir.x, dir.y);
      this.fx.flame(m.x, m.y, dir.x / len, dir.y / len, s.range * 64 * 1.25, t.level);
      sfx('flame');
      return;
    }

    if (t.cool > 0) return;
    t.cool = 1 / s.rate;
    t.recoil = 1;
    const m = this.muzzle(t);
    const aim = this.aimPoint(target);
    switch (def.kind) {
      case 'hitscan': {
        this.damage(target, s.dmg, { src: t });
        const jx = rand(-6, 6), jy = rand(-6, 6);
        this.fx.tracer(m.x, m.y, aim.x + jx, aim.y + jy, undefined, 2.2 + t.level * 0.6);
        if (t.level >= 2) this.fx.tracer(m.x + 4, m.y - 3, aim.x - jx, aim.y - jy, undefined, 1.8 + t.level * 0.5);
        if (t.level >= 3) this.fx.tracer(m.x - 4, m.y + 3, aim.x + jy, aim.y + jx, 'rgba(255,140,60,', 2);
        this.fx.muzzle(m.x, m.y, 'yellow', 26 + t.level * 8);
        if (Math.random() < 0.5) this.fx.sparks(aim.x + jx, aim.y + jy, 2, '#ffe3a0', 120);
        sfx('gatling');
        break;
      }
      case 'missile': {
        // salvo size grows with the level (1 / 2 / 3 missiles), damage is split across the salvo
        const n = t.level, per = s.dmg / n * (1 + 0.12 * (n - 1));
        for (let i = 0; i < n; i++) {
          const spread = (i - (n - 1) / 2) * 0.55;
          this.shots.push({ k: 'missile', x: m.x + spread * 10, y: m.y - Math.abs(spread) * 4, vx: Math.cos(t.ang - Math.PI / 4 + spread) * 110, vy: -150 - i * 25, sp: 240 - i * 20, target, tx: aim.x, ty: aim.y, tgx: target.gx, tgy: target.gy, dmg: per, splash: s.splash, airBonus: def.airBonus, trail: 0, life: 4, src: t, big: n });
        }
        this.fx.muzzle(m.x, m.y, 'orange', 34 + n * 8);
        this.fx.smoke(m.x, m.y, 2, 16, 0.8);
        sfx('missile');
        break;
      }
      case 'plasma': {
        this.shots.push({ k: 'plasma', x: m.x, y: m.y, sp: 560, target, tx: aim.x, ty: aim.y, tgx: target.gx, tgy: target.gy, dmg: s.dmg, splash: s.splash, life: 3, src: t, size: 1 + 0.35 * (t.level - 1) });
        this.fx.muzzle(m.x, m.y, 'cyan', 56 + t.level * 14);
        sfx('plasma');
        break;
      }
      case 'flak': {
        // fast flak shell: burst at target after a short delay
        const lead = 0.18;
        const p = routePos(target.route, target.d + target.def.speed * lead);
        const w = toWorld(p.x, p.y);
        const nb = t.level, per = s.dmg / nb * (1 + 0.12 * (nb - 1));
        for (let i = 0; i < nb; i++) {
          const ox = i === 0 ? 0 : rand(-22, 22), oy = i === 0 ? 0 : rand(-14, 14);
          this.shots.push({ k: 'flak', x: m.x, y: m.y, t0: -i * 0.05, dur: lead, sx: m.x, sy: m.y, tx: w.x + rand(-10, 10) + ox, ty: w.y - target.def.lift - 20 + rand(-10, 10) + oy, tgx: p.x, tgy: p.y, dmg: per, splash: s.splash, src: t });
        }
        this.fx.muzzle(m.x, m.y, 'yellow', 28);
        sfx('flak');
        break;
      }
      case 'rail': {
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
          if (Math.abs(ex * dy - ey * dx) <= 0.38 || e === target) { this.damage(e, s.dmg * Math.pow(0.9, hits), { src: t, shieldMul: 1.5 }); hits++; }
        }
        const end = toWorld(t.gx + dx * R, t.gy + dy * R);
        this.fx.beam(m.x, m.y, end.x, end.y - 24, 1 + 0.45 * (t.level - 1));
        this.fx.sparks(aim.x, aim.y, 8, '#cfe9ff', 240);
        this.fx.shake = Math.max(this.fx.shake, 2);
        sfx('rail');
        break;
      }
      case 'emp': {
        const chain = [target], used = new Set([target]);
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
        const top = { x: t.wx, y: t.wy - (Models.meta(def.model)?.topPx ?? 110) * TOWER_SCALE + 10 };
        const pts = [[top.x, top.y]];
        for (const e of chain) {
          const a = this.aimPoint(e);
          pts.push([a.x, a.y]);
          e.slowF = Math.max(e.slowF, s.slow);
          e.slowT = Math.max(e.slowT, def.slowDur);
          this.damage(e, s.dmg, { ignoreArmor: true, shieldMul: 4, src: t });
        }
        this.fx.bolt(pts, t.level);
        sfx('emp');
        break;
      }
      case 'acid': {
        const flight = 0.75;
        const p = routePos(target.route, target.d + target.def.speed * (1 - target.slowF) * flight);
        const w = toWorld(p.x, p.y);
        const n = t.level >= 3 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const ox = i ? rand(-0.35, 0.35) : 0, oy = i ? rand(-0.35, 0.35) : 0;
          const w2 = toWorld(p.x + ox, p.y + oy);
          this.shots.push({ k: 'acid', sx: m.x, sy: m.y, x: m.x, y: m.y, tx: w2.x, ty: w2.y, tgx: p.x + ox, tgy: p.y + oy, t0: -i * 0.08, dur: flight, arc: 70, dmg: s.dmg / n * (n > 1 ? 1.2 : 1), splash: s.splash, acid: s.acid, src: t, lvl: t.level });
        }
        this.fx.muzzle(m.x, m.y, 'green', 34);
        sfx('acid');
        break;
      }
      case 'mortar': {
        const flight = 1.25;
        const p = routePos(target.route, target.d + target.def.speed * (1 - target.slowF) * flight);
        const w = toWorld(p.x, p.y);
        this.shots.push({ k: 'shell', sx: m.x, sy: m.y, x: m.x, y: m.y, tx: w.x, ty: w.y, tgx: p.x, tgy: p.y, t0: 0, dur: flight, arc: 170, dmg: s.dmg, splash: s.splash, src: t, friendly: true, big: 1 + 0.25 * (t.level - 1) });
        this.fx.muzzle(m.x, m.y, 'orange', 70);
        this.fx.smoke(m.x, m.y, 4, 26, 1.2);
        this.fx.shake = Math.max(this.fx.shake, 2.5);
        sfx('mortar');
        break;
      }
    }
  }

  // splash damage at a grid position
  explode(gx, gy, dmg, splash, opts = {}) {
    const list = this.enemiesInRange(gx, gy, splash, opts.air !== false, opts.ground !== false);
    for (const e of list) {
      const d = Math.hypot(e.gx - gx, e.gy - gy);
      const fall = d < splash * 0.5 ? 1 : 1 - 0.5 * (d - splash * 0.5) / (splash * 0.5);
      let v = dmg * fall;
      if (e.air && opts.airBonus) v *= opts.airBonus;
      this.damage(e, v, opts);
    }
  }
  damageTowersArea(gx, gy, dmg, splash) {
    for (const t of [...this.towers]) {
      const d = Math.hypot(t.gx - gx, t.gy - gy);
      if (d <= splash) this.damageTower(t, dmg * (d < splash * 0.5 ? 1 : 0.6));
    }
  }

  // ---------------- enemies ----------------
  updateEnemy(e, dt) {
    e.anim += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.flashCd > 0) e.flashCd -= dt;
    const def = e.def;
    if (e.burnT > 0) {
      e.burnT -= dt;
      this.damage(e, e.burnDps * dt, { ignoreArmor: true });
      if (Math.random() < dt * 10) this.fx.burn(e.wx + rand(-10, 10), this.bodyY(e) + rand(-8, 8));
      if (!e.alive) return;
    }
    if (e.shield < e.maxShield && this.time - e.shieldHit > 2.5) e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.15 * dt);
    // acid: damage over time per corrosion stack
    if (e.acidT > 0) {
      e.acidT -= dt;
      this.damage(e, e.acidN * e.acidDps * dt, { ignoreArmor: true, src: e.acidSrc, dot: true });
      if (Math.random() < dt * 6 * e.acidN) this.fx.acidDrip(e.wx + rand(-12, 12), this.bodyY(e) + rand(-10, 14));
      if (e.acidT <= 0) { e.acidN = 0; e.acidDps = 0; }
      if (!e.alive) return;
    }
    // acid puddles on the road
    if (!e.air && this.puddles.length) {
      e.puddleCd -= dt;
      if (e.puddleCd <= 0) for (const p of this.puddles) {
        if ((e.gx - p.gx) ** 2 + (e.gy - p.gy) ** 2 <= p.r * p.r) { this.corrode(e, p.dps, p.src); e.puddleCd = 0.8; break; }
      }
    }
    // frost thaws, a freeze wears off into short immunity
    if (e.freezeImm > 0) e.freezeImm -= dt;
    if (e.frozenT > 0) {
      e.frozenT -= dt;
      if (e.frozenT <= 0) { e.frost = 35; e.freezeImm = FROST.immune; this.fx.sparks(e.wx, this.bodyY(e), 6, '#dff7ff', 120); }
    } else if (e.frost > 0 && this.time - (e.frostHit || 0) > 0.25) e.frost = Math.max(0, e.frost - FROST.decay * dt);

    if (e.vortex) { if (this.holes.includes(e.vortex.h)) { this.updateVortex(e, dt); return; } e.vortex = null; }
    // kamikaze dive
    if (def.dive) {
      if (!e.diving) {
        let best = null, bd = def.dive.range * def.dive.range;
        for (const t of this.towers) {
          const d2 = (t.gx - e.gx) ** 2 + (t.gy - e.gy) ** 2;
          if (d2 < bd) { bd = d2; best = t; }
        }
        if (best) { e.diving = best; sfx('dive'); }
      }
      if (e.diving) {
        const t = e.diving;
        if (!this.towers.includes(t)) { e.diving = null; }
        else {
          const dx = t.gx - e.gx, dy = t.gy - e.gy;
          const d = Math.hypot(dx, dy);
          const sp = 3.2 * dt;
          e.ang = Math.atan2(dy, dx);
          if (d <= sp + 0.05) {
            e.alive = false;
            const dmg = def.dive.dmg * Math.pow(e.hpMul, 0.3);
            this.damageTowersArea(t.gx, t.gy, dmg, def.dive.splash);
            this.fx.bigExplosion(t.wx, t.wy - 40, 1.2);
            sfx('explosion', true);
            return;
          }
          e.gx += dx / d * sp; e.gy += dy / d * sp;
          const w = toWorld(e.gx, e.gy);
          e.wx = e.rx = w.x; e.wy = e.ry = w.y;
          e.liftMul = Math.max(0.15, Math.min(1, d / 1.2));
          return;
        }
      }
    }

    let sp = def.speed * e.speedMul;
    let slow = 0;
    if (e.slowT > 0) { e.slowT -= dt; slow = e.slowF; if (e.slowT <= 0) e.slowF = 0; }
    slow = Math.max(slow, (e.frost / FROST.max) * (def.boss ? FROST.bossSlow : FROST.slow));
    sp *= 1 - slow;
    if (e.frozenT > 0) sp = 0;
    if (this.buffs.timestop > 0) sp *= def.boss ? 0.3 : 0;
    if (e.holeSlow) { sp *= 1 - e.holeSlow; e.holeSlow = 0; }
    e.d += sp * dt;
    // footfalls: two per animation cycle (or per configured stride for unanimated gaits)
    const stepLen = Models.meta(def.model)?.af ? Models.cycleOf(def) / 2 : (def.stride || 0.6);
    const prevStep = Math.floor(e.walk / stepLen);
    e.walk += sp * dt;
    e.turnRate = 0;
    if (!e.air) {
      if ((def.motion === 'walker' || def.motion === 'biped') && Math.floor(e.walk / stepLen) !== prevStep) {
        const heavy = def.motion === 'walker';
        if (heavy || Math.random() < 0.25) this.fx.footDust(e.wx, e.wy, heavy ? (def.boss ? 1.8 : 1) : 0.5);
        if (def.boss) this.fx.shake = Math.max(this.fx.shake, 2.2);
      } else if (def.motion === 'tracks' && Math.random() < dt * 7) {
        this.fx.footDust(e.wx - Math.cos(e.ang) * 18, e.wy - Math.sin(e.ang) * 9, 0.55);
      }
    }
    if (e.d >= e.route.total) {
      e.alive = false;
      this.lives = Math.max(0, this.lives - def.leak);
      this.lost += def.leak;
      const b = this.baseW;
      this.fx.bigExplosion(b.x + rand(-30, 30), b.y - 50 + rand(-20, 10), 1.3);
      this.fx.shake = Math.max(this.fx.shake, 8);
      this.emit('baseHit', { n: def.leak });
      sfx('baseHit');
      return;
    }
    const p = routePos(e.route, e.d);
    const fade = Math.min(1, e.d / 1.2, (e.route.total - e.d) / 1.2);
    e.gx = p.x - p.dy * e.off * fade; e.gy = p.y + p.dx * e.off * fade;
    const w = toWorld(e.gx, e.gy);
    const k = Math.min(1, dt * 14);
    e.rx += (w.x - e.rx) * k; e.ry += (w.y - e.ry) * k;
    e.wx = e.rx; e.wy = e.ry;
    const want = Math.atan2(p.dy, p.dx);
    const da = angDiff(e.ang, want);
    const step = Math.abs(da) < 6 * dt ? da : Math.sign(da) * 6 * dt;
    e.ang += step;
    e.turnRate = step / dt;

    // healing aura
    if (def.heal) {
      e.healT -= dt;
      if (e.healT <= 0) {
        e.healT = 0.5;
        for (const o of this.enemies) {
          if (!o.alive || o.hp >= o.maxHp) continue;
          if ((o.gx - e.gx) ** 2 + (o.gy - e.gy) ** 2 > def.healRange ** 2) continue;
          o.hp = Math.min(o.maxHp, o.hp + def.heal * 0.5 * e.hpMul ** 0.5);
          if (o !== e) this.fx.healBeam(e.wx, this.bodyY(e), o.wx, this.bodyY(o));
        }
      }
    }
    // cloak
    if (def.cloak) { e.cloakT += dt; if (e.revealT > 0) e.revealT -= dt; }
    const stopped = e.frozenT > 0 || (this.buffs.timestop > 0 && !def.boss);
    // bomber: carpet of bombs on towers below
    if (def.bomb && !stopped) {
      e.bombT -= dt;
      if (e.bombT <= 0) {
        let best = null, bd = def.bomb.range * def.bomb.range;
        for (const t of this.towers) { const d2 = (t.gx - e.gx) ** 2 + (t.gy - e.gy) ** 2; if (d2 < bd) { bd = d2; best = t; } }
        if (best) {
          e.bombT = def.bomb.every;
          const dmg = def.bomb.dmg * Math.pow(e.hpMul, 0.3);
          for (let i = 0; i < 3; i++) this.shots.push({ k: 'bomb', x: e.wx + rand(-14, 14), y: e.wy - def.lift + i * 4, tx: best.wx + rand(-24, 24), ty: best.wy + rand(-10, 10), t0: -i * 0.12, dur: 0.55, sx: e.wx, sy: e.wy - def.lift, tgx: best.gx, tgy: best.gy, dmg: dmg / 3, splash: def.bomb.splash, enemy: true });
          sfx('dive');
        } else e.bombT = 0.3;
      }
    }
    // shield projector: recharges the shields of nearby machines
    if (def.project && !stopped) {
      e.projT -= dt;
      if (e.projT <= 0) {
        e.projT = def.project.every;
        const amt = Math.round(def.project.shield * Math.pow(e.hpMul, 0.6));
        for (const o of this.enemiesInRange(e.gx, e.gy, def.project.range, true, true)) {
          o.shield = Math.min(Math.max(o.maxShield, amt * 1.5), o.shield + amt);
          o.projShield = Math.max(o.projShield || 0, amt * 1.5);
          if (o !== e) this.fx.add({ k: 'line', x1: e.wx, y1: this.bodyY(e) - 20, x2: o.wx, y2: this.bodyY(o), w: 2.5, life: 0.35, c: 'rgba(110,220,255,' });
        }
        this.fx.add({ k: 'ring', x: e.wx, y: e.wy, r0: 10, r1: def.project.range * 90, life: 0.5, c: '110,220,255' });
      }
    }
    // carrier spawns
    if (def.spawns && !stopped) {
      e.spawnT -= dt;
      if (e.spawnT <= 0) {
        e.spawnT = def.spawns.every;
        for (let i = 0; i < def.spawns.count; i++) {
          const c = this.spawn(def.spawns.type, this.routes.indexOf(e.route), e.hpMul * 0.8, 0.5, Math.max(0, e.d - 0.2 - i * 0.3));
          c.off = rand(-0.3, 0.3);
        }
        this.fx.muzzle(e.wx, e.wy - def.lift, 'red', 80);
      }
    }
    // attack towers
    if (def.atk && e.frozenT <= 0 && !(this.buffs.timestop > 0 && !def.boss)) {
      e.atkCool -= dt;
      if (e.atkCool <= 0) {
        const a = def.atk;
        let best = null, bd = a.range * a.range;
        for (const t of this.towers) {
          const d2 = (t.gx - e.gx) ** 2 + (t.gy - e.gy) ** 2;
          if (d2 < bd) { bd = d2; best = t; }
        }
        if (best) {
          e.atkCool = 1 / a.rate * rand(0.85, 1.15);
          this.enemyFire(e, best, a);
        } else e.atkCool = 0.3;
      }
    }
  }

  enemyFire(e, t, a) {
    const from = { x: e.wx, y: this.bodyY(e) };
    const to = { x: t.wx + rand(-12, 12), y: t.wy - 40 + rand(-12, 8) };
    const dmg = a.dmg * Math.pow(e.hpMul, 0.3);
    switch (a.kind) {
      case 'laser':
        this.damageTower(t, dmg);
        this.fx.tracer(from.x, from.y, to.x, to.y, 'rgba(255,70,50,');
        this.fx.muzzle(from.x, from.y, 'red', 22);
        this.fx.sparks(to.x, to.y, 2, '#ff9070', 100);
        sfx('enemyShot');
        break;
      case 'cannon':
      case 'plasma':
        this.shots.push({ k: a.kind === 'plasma' ? 'eplasma' : 'ebullet', x: from.x, y: from.y, tx: to.x, ty: to.y, sp: a.kind === 'plasma' ? 420 : 620, tower: t, dmg, life: 2 });
        this.fx.muzzle(from.x, from.y, a.kind === 'plasma' ? 'red' : 'orange', 34);
        sfx('enemyCannon');
        break;
      case 'missile':
        this.shots.push({ k: 'emissile', x: from.x, y: from.y, vx: rand(-60, 60), vy: -120, sp: 220, tx: to.x, ty: to.y, tower: t, dmg, trail: 0, life: 3 });
        sfx('missile');
        break;
      case 'shell':
        this.shots.push({ k: 'shell', sx: from.x, sy: from.y, x: from.x, y: from.y, tx: t.wx, ty: t.wy, tgx: t.gx, tgy: t.gy, t0: 0, dur: 1.5, arc: 200, dmg, splash: a.splash, enemy: true });
        this.fx.muzzle(from.x, from.y, 'orange', 60);
        this.fx.smoke(from.x, from.y, 3, 22, 1);
        sfx('mortar');
        break;
    }
  }

  // ---------------- update ----------------
  // ---- cinematic time: real-time phases [pre (normal), freeze, slow motion, ramp back] ----
  startCinematic(o = {}) { this.cine = { t: 0, pre: 0.55, freeze: 0.9, slow: 2.6, scale: 0.12, ramp: 1.6, ...o }; }
  timeScale() {
    const c = this.cine;
    if (!c) return 1;
    let t = c.t;
    if ((t -= c.pre) < 0) return 1;
    if ((t -= c.freeze) < 0) return 0;
    if ((t -= c.slow) < 0) return c.scale;
    if ((t -= c.ramp) < 0) { const k = 1 + t / c.ramp; return c.scale + (1 - c.scale) * k * k; }
    return 1;
  }
  advanceCinematic(realDt) {
    const c = this.cine;
    if (!c) return;
    c.t += realDt;
    if (c.t > c.pre + c.freeze + c.slow + c.ramp + 0.1) this.cine = null;
  }

  // ---- nuclear strike ----
  nukeReady() { return this.nuke.on && this.nuke.charge >= this.nuke.need; }
  nukeStrike(gx, gy) {
    if (!this.nukeReady()) return false;
    this.nuke.charge = 0;
    this.nukes.push({ gx, gy, t: NUKE.delay, dur: NUKE.delay });
    sfx('siren');
    return true;
  }
  updateNukes(dt) {
    for (const n of this.nukes) {
      n.t -= dt;
      if (n.t > 0) continue;
      n.done = true;
      const w = toWorld(n.gx, n.gy);
      const hpm = Math.pow(hpMultiplier(this.level.number, Math.max(1, this.wave)), 0.9);
      this._nuking = true;
      for (const e of this.enemiesInRange(n.gx, n.gy, NUKE.outer, true, true)) {
        const d = Math.hypot(e.gx - n.gx, e.gy - n.gy);
        const k = d <= NUKE.radius ? 1 : 0.4;
        const dmg = e.def.boss ? e.maxHp * NUKE.bossFrac * k + NUKE.dmg * 0.2 * hpm : NUKE.dmg * hpm * k;
        this.damage(e, dmg, { ignoreArmor: true });
      }
      for (const t of [...this.towers]) {
        const d = Math.hypot(t.gx - n.gx, t.gy - n.gy);
        if (d <= NUKE.towerRadius) this.damageTower(t, t.stats.hp * NUKE.towerDmg * (1 - 0.4 * d / NUKE.towerRadius));
      }
      this._nuking = false;
      this.radZones.push({ gx: n.gx, gy: n.gy, r: NUKE.radR, t: NUKE.radT, life: NUKE.radT });
      this.fx.nuke(w.x, w.y);
      this.startCinematic();
      this.decals.push({ x: w.x, y: w.y, s: 420 });
      this.emit('nukeHit', {});
      sfx('nuke');
    }
    if (this.nukes.some(n => n.done)) this.nukes = this.nukes.filter(n => !n.done);
    for (const z of this.radZones) {
      z.t -= dt;
      for (const e of this.enemiesInRange(z.gx, z.gy, z.r, false, true)) this.damage(e, e.maxHp * NUKE.radDps * (e.def.boss ? 0.3 : 1) * dt, { ignoreArmor: true });
    }
    if (this.radZones.some(z => z.t <= 0)) this.radZones = this.radZones.filter(z => z.t > 0);
  }
  // ---- black hole ----
  holeStrike(gx, gy) {
    if (!this.hole.on || this.hole.cd > 0) return false;
    this.hole.cd = this.hole.max;
    this.holes.push({ gx, gy, t: 0, dur: HOLE.dur, id: uid++ });
    sfx('holeOpen');
    return true;
  }
  updateHoles(dt) {
    if (this.hole.on && this.wave > 0 && this.hole.cd > 0) this.hole.cd = Math.max(0, this.hole.cd - dt);
    for (const h of this.holes) {
      h.t += dt;
      const w = toWorld(h.gx, h.gy);
      const open = Math.min(1, h.t / 0.8) * Math.min(1, (h.dur - h.t) / 0.5 + 0.2);
      h.str = Math.max(0, open);
      // debris and light streaming into the vortex
      if (Math.random() < dt * 40 * h.str) this.fx.orbit(w.x, w.y - 70, rand(70, 190) * h.str, Math.random() < 0.3);
      for (const e of this.enemiesInRange(h.gx, h.gy, HOLE.radius, true, true)) {
        if (e.def.boss) {
          e.holeSlow = HOLE.bossSlow;
          this.damage(e, e.maxHp * HOLE.bossDps * dt, { ignoreArmor: true, dot: true });
          continue;
        }
        if (!e.vortex) {
          const a = Math.atan2(e.gy - h.gy, e.gx - h.gx);
          e.vortex = { h, k: 0, a, r: Math.hypot(e.gx - h.gx, e.gy - h.gy), spin: 0, sq: 1 };
        }
      }
      if (h.t >= h.dur) {
        h.done = true;
        this.fx.holeCollapse(w.x, w.y - 70);
        this.fx.shake = Math.max(this.fx.shake, 12);
        for (const e of this.enemies) if (e.vortex && e.vortex.h === h) {
          this.damage(e, e.maxHp * HOLE.collapse, { ignoreArmor: true });
          e.vortex = null;
        }
        sfx('holeCollapse');
      }
    }
    if (this.holes.some(h => h.done)) this.holes = this.holes.filter(h => !h.done);
  }
  // a captured machine spirals into the core, shrinking and spinning, crushed by tidal forces
  updateVortex(e, dt) {
    const v = e.vortex, h = v.h;
    v.k = Math.min(1, v.k + dt / HOLE.pull);
    const str = h.str ?? 1;
    v.r = Math.max(0, v.r - dt * (0.25 + 0.55 * v.k) * str);
    v.a += dt * (1.2 + 5 * (1 - v.r / HOLE.radius)) * str;
    v.spin += dt * (2 + 9 * v.k);
    v.sq = 0.35 + 0.65 * Math.min(1, v.r / HOLE.radius + 0.25);
    e.gx = h.gx + Math.cos(v.a) * v.r;
    e.gy = h.gy + Math.sin(v.a) * v.r;
    const w = toWorld(e.gx, e.gy);
    const lift = (1 - v.r / HOLE.radius) * 60 * v.k;
    e.wx = e.rx = w.x; e.wy = e.ry = w.y - lift;
    this.damage(e, (e.maxHp * HOLE.dps + HOLE.flat * Math.sqrt(e.hpMul)) * dt * v.k, { ignoreArmor: true, dot: true });
    if (e.alive && v.r < 0.18) {
      this.fx.add({ k: 'glow', x: e.wx, y: e.wy - 20, s: 90, life: 0.25, spr: 'violet' });
      this.damage(e, e.hp + e.shield + 1, { ignoreArmor: true });
    }
  }

  // ---- power-up crates ----
  spawnDrop(gx, gy) {
    const pool = Object.entries(POWERUPS).filter(([k]) => k !== 'atom' || this.nuke.on);
    let r = Math.random() * pool.reduce((a, [, p]) => a + p.w, 0), type = pool[0][0];
    for (const [k, p] of pool) { r -= p.w; if (r <= 0) { type = k; break; } }
    const w = toWorld(gx, gy);
    this.drops.push({ type, gx, gy, wx: w.x, wy: w.y, t: DROP.life, life: DROP.life, id: uid++ });
    this.lastDrop = this.time;
    this.fx.add({ k: 'ring', x: w.x, y: w.y, r0: 6, r1: 50, life: 0.4, c: '255,240,160' });
    sfx('dropSpawn');
  }
  collect(drop) {
    if (!this.drops.includes(drop)) return false;
    this.drops = this.drops.filter(d => d !== drop);
    const p = POWERUPS[drop.type];
    if (drop.type === 'atom') this.nuke.charge = Math.min(this.nuke.need, this.nuke.charge + this.nuke.need * 0.5);
    else this.buffs[drop.type] = p.dur;
    if (drop.type === 'repair') for (const t of this.towers) { t.hp = t.stats.hp; this.fx.add({ k: 'glow', x: t.wx, y: t.wy - 40, s: 120, life: 0.5, spr: 'green' }); }
    this.fx.add({ k: 'glow', x: drop.wx, y: drop.wy - 30, s: 220, life: 0.45, spr: 'white' });
    this.fx.add({ k: 'ring', x: drop.wx, y: drop.wy, r0: 10, r1: 160, life: 0.5, c: '255,240,180' });
    this.emit('powerup', { pu: drop.type });
    sfx('powerup');
    return true;
  }
  updateDrops(dt) {
    for (const k in this.buffs) if (this.buffs[k] > 0) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    for (const d of this.drops) d.t -= dt;
    if (this.drops.some(d => d.t <= 0)) this.drops = this.drops.filter(d => d.t > 0);
  }

  // orbital strike at grid point: a targeting beam, then a huge blast (ground and air)
  orbitalStrike(gx, gy) {
    if (!this.orbital.on || this.orbital.cd > 0) return false;
    this.orbital.cd = this.orbital.max;
    this.strikes.push({ gx, gy, t: 1.15, dur: 1.15 });
    sfx('orbital');
    return true;
  }
  updateStrikes(dt) {
    if (this.orbital.on && this.wave > 0 && this.orbital.cd > 0) this.orbital.cd = Math.max(0, this.orbital.cd - dt);
    for (const s of this.strikes) {
      s.t -= dt;
      if (s.t > 0) continue;
      s.done = true;
      const w = toWorld(s.gx, s.gy);
      const dmg = 420 * Math.pow(hpMultiplier(this.level.number, Math.max(1, this.wave)), 0.85);
      for (const e of this.enemiesInRange(s.gx, s.gy, 1.7, true, true)) {
        const d = Math.hypot(e.gx - s.gx, e.gy - s.gy);
        this.damage(e, dmg * (d < 0.8 ? 1 : 0.6) * (e.air ? 0.6 : 1), { ignoreArmor: true });
      }
      this.fx.bigExplosion(w.x, w.y - 30, 2.4, 'heavy');
      this.fx.boom(w.x, w.y + 10, 320, 1.1, 'ground');
      this.fx.add({ k: 'ring', x: w.x, y: w.y, r0: 20, r1: 260, life: 0.6, c: '255,230,200' });
      this.fx.add({ k: 'glow', x: w.x, y: w.y - 40, s: 420, life: 0.35, spr: 'white' });
      this.fx.flash = Math.max(this.fx.flash, 0.7);
      this.fx.shake = Math.max(this.fx.shake, 16);
      this.decals.push({ x: w.x, y: w.y, s: 200 });
      sfx('explosion', true);
    }
    if (this.strikes.some(s => s.done)) this.strikes = this.strikes.filter(s => !s.done);
  }

  update(dt) {
    if (this.state === 'won' || this.state === 'lost') { this.fx.update(dt); return; }
    this.time += dt;
    this.updateStrikes(dt);
    this.updateNukes(dt);
    this.updateHoles(dt);
    this.updateDrops(dt);
    while (this.queue.length && this.queue[0].t <= this.time) {
      const s = this.queue.shift();
      const e = this.spawn(s.type, s.route, s.hpMul, s.rewardMul);
      e.wave = s.wave;
    }
    for (let i = 0; i < this.enemies.length; i++) { const e = this.enemies[i]; if (e.alive) this.updateEnemy(e, dt); }
    if (this.enemies.some(e => !e.alive)) {
      for (const e of this.enemies) if (!e.alive && e.wave) this.waveDone(e.wave);
      this.enemies = this.enemies.filter(e => e.alive);
    }
    for (const t of [...this.towers]) this.updateTower(t, dt);
    this.updateShots(dt);
    this.fx.update(dt);

    if (this.state === 'wave') {
      // automatic waves: once everything of the current wave has spawned, count down to the next one
      if (this.wave < this.waves.length && this.queue.length === 0) {
        if (this.nextWaveIn < 0) this.nextWaveIn = this.waveGap;
        this.nextWaveIn -= dt;
        if (this.nextWaveIn <= 0) { this.nextWaveIn = -1; this.startWave(); }
      }
      if (this.wave >= this.waves.length && this.queue.length === 0 && this.enemies.length === 0) { this.state = 'won'; this.emit('won', {}); }
    }
    if (this.lives <= 0 && this.state !== 'lost') { this.state = 'lost'; this.emit('lost', {}); }
  }

  updateShots(dt) {
    for (const s of this.shots) {
      switch (s.k) {
        case 'missile': case 'emissile': {
          s.life -= dt;
          if (s.k === 'missile' && s.target && s.target.alive) { const a = this.aimPoint(s.target); s.tx = a.x; s.ty = a.y; s.tgx = s.target.gx; s.tgy = s.target.gy; }
          const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy) || 1;
          s.sp = Math.min(720, s.sp + 900 * dt);
          const turn = Math.min(1, dt * 7);
          s.vx += (dx / d * s.sp - s.vx) * turn; s.vy += (dy / d * s.sp - s.vy) * turn;
          s.x += s.vx * dt; s.y += s.vy * dt;
          s.trail -= dt;
          if (s.trail <= 0) { s.trail = 0.025; this.fx.trail(s.x, s.y); }
          if (d < 16 || s.life <= 0) {
            s.dead = true;
            const onGround = s.k === 'missile' && s.target && !s.target.air;
            this.fx.explosion(s.tx, s.ty, s.k === 'missile' ? 0.65 + 0.12 * (s.big || 1) : 0.6, onGround && Math.random() < 0.5 ? 'ground' : 'fire');
            if (s.k === 'missile') this.explode(s.tgx, s.tgy, s.dmg, s.splash, { airBonus: s.airBonus, src: s.src });
            else this.damageTower(s.tower, s.dmg);
            sfx('explosion');
          }
          break;
        }
        case 'plasma': case 'ebullet': case 'eplasma': {
          s.life -= dt;
          if (s.k === 'plasma' && s.target && s.target.alive) { const a = this.aimPoint(s.target); s.tx = a.x; s.ty = a.y; s.tgx = s.target.gx; s.tgy = s.target.gy; }
          const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
          const step = s.sp * dt;
          if (d <= step || s.life <= 0) {
            s.dead = true;
            if (s.k === 'plasma') {
              this.fx.plasmaHit(s.tx, s.ty, s.size || 1);
              this.explode(s.tgx, s.tgy, s.dmg, s.splash, { ignoreArmor: true, air: false, shieldMul: 2, src: s.src });
              sfx('hit');
            } else {
              this.fx.explosion(s.tx, s.ty, 0.45);
              this.damageTower(s.tower, s.dmg);
            }
          } else { s.x += dx / d * step; s.y += dy / d * step; }
          break;
        }
        case 'flak': {
          s.t0 += dt;
          const k = Math.max(0, Math.min(1, s.t0 / s.dur));
          s.x = s.sx + (s.tx - s.sx) * k; s.y = s.sy + (s.ty - s.sy) * k;
          if (k >= 1) {
            s.dead = true;
            this.fx.flakBurst(s.tx, s.ty);
            this.explode(s.tgx, s.tgy, s.dmg, s.splash, { ground: false, src: s.src });
          }
          break;
        }
        case 'bomb': {
          s.t0 += dt;
          const k = Math.max(0, Math.min(1, s.t0 / s.dur));
          s.x = s.sx + (s.tx - s.sx) * k; s.y = s.sy + (s.ty - s.sy) * k * k;
          if (k >= 1) {
            s.dead = true;
            this.fx.explosion(s.tx, s.ty - 10, 0.7, 'ground');
            this.decals.push({ x: s.tx, y: s.ty, s: 60 });
            this.damageTowersArea(s.tgx, s.tgy, s.dmg, s.splash);
            sfx('explosion');
          }
          break;
        }
        case 'acid': {
          s.t0 += dt;
          const k = Math.max(0, Math.min(1, s.t0 / s.dur));
          s.x = s.sx + (s.tx - s.sx) * k;
          s.y = s.sy + (s.ty - s.sy) * k - Math.sin(k * Math.PI) * s.arc;
          if (k >= 1) {
            s.dead = true;
            this.fx.acidSplash(s.tx, s.ty, 1 + 0.2 * (s.lvl - 1));
            this.explode(s.tgx, s.tgy, s.dmg, s.splash, { air: false, src: s.src, acid: s.acid });
            this.puddles.push({ gx: s.tgx, gy: s.tgy, r: 0.42 + 0.08 * s.lvl, t: s.src.def.puddle, life: s.src.def.puddle, dps: s.acid * 0.6, src: s.src, seed: Math.random() * 10 });
            sfx('acidHit');
          }
          break;
        }
        case 'shell': {
          s.t0 += dt;
          const k = Math.min(1, s.t0 / s.dur);
          s.x = s.sx + (s.tx - s.sx) * k;
          s.y = s.sy + (s.ty - s.sy) * k - Math.sin(k * Math.PI) * s.arc;
          s.trail = (s.trail || 0) - dt;
          if (s.trail <= 0) { s.trail = 0.04; this.fx.trail(s.x, s.y); }
          if (k >= 1) {
            s.dead = true;
            this.fx.boom(s.tx, s.ty + 6, 150 * (s.enemy ? 1 : 1.1 * (s.big || 1)), 1.0, 'ground');
            this.fx.explosion(s.tx, s.ty - 14, s.enemy ? 0.7 : 0.8 * (s.big || 1), 'fire');
            this.fx.add({ k: 'ring', x: s.tx, y: s.ty, r0: 10, r1: 110 * (s.big || 1), life: 0.4, c: '230,200,150' });
            this.decals.push({ x: s.tx, y: s.ty, s: 90 });
            if (s.enemy) this.damageTowersArea(s.tgx, s.tgy, s.dmg, s.splash);
            else this.explode(s.tgx, s.tgy, s.dmg, s.splash, { air: false, src: s.src });
            sfx('explosion', true);
          }
          break;
        }
      }
    }
    if (this.shots.some(s => s.dead)) this.shots = this.shots.filter(s => !s.dead);
    for (const p of this.puddles) p.t -= dt;
    if (this.puddles.some(p => p.t <= 0)) this.puddles = this.puddles.filter(p => p.t > 0);
  }

  stars() {
    const r = this.lives / this.maxLives;
    return r >= 0.9 ? 3 : r >= 0.5 ? 2 : 1;
  }
}
