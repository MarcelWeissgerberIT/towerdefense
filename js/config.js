// Iron Sentinel – game data (towers, enemies, levels, waves)

export const TILE_W = 128;          // iso tile width in world px
export const TILE_H = 64;           // iso tile height in world px
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;

export const MAX_LEVEL = 3;         // tower upgrade levels (1..3)
export const SELL_RATE = 0.7;

export const TOWERS = {
  gatling: {
    name: 'Gatling-MG', key: 'gatling', sprite: 'tower_gatling',
    desc: 'Rotorkanone mit enormer Feuerrate. Trifft Boden- und Luftziele, schwach gegen Panzerung.',
    cost: 100, range: 2.6, rate: 7.5, dmg: 7, ground: true, air: true,
    color: '#ffc04d', width: 118,
  },
  missile: {
    name: 'Raketenwerfer', key: 'missile', sprite: 'tower_missile',
    desc: 'Zielsuchende Raketen mit Flächenschaden. Doppelter Schaden gegen Luftziele.',
    cost: 180, range: 3.7, rate: 0.85, dmg: 36, splash: 0.95, airBonus: 2.0, ground: true, air: true,
    color: '#ff6a3d', width: 112,
  },
  plasma: {
    name: 'Plasmakanone', key: 'plasma', sprite: 'tower_plasma',
    desc: 'Überhitzte Plasmaladung ignoriert Panzerung. Nur Bodenziele.',
    cost: 240, range: 2.9, rate: 0.95, dmg: 80, splash: 0.55, ignoreArmor: true, ground: true, air: false,
    color: '#4fe3ff', width: 120,
  },
  rail: {
    name: 'Railgun', key: 'rail', sprite: 'tower_rail',
    desc: 'Elektromagnetisches Geschoss durchschlägt alles in einer Linie. Extreme Reichweite.',
    cost: 340, range: 5.6, rate: 0.33, dmg: 230, ground: true, air: true,
    color: '#9fd8ff', width: 152,
  },
  emp: {
    name: 'EMP-Turm', key: 'emp', sprite: 'tower_emp',
    desc: 'Kettenblitz springt auf mehrere Maschinen und verlangsamt sie stark.',
    cost: 200, range: 2.5, rate: 1.1, dmg: 13, chain: 4, slow: 0.45, slowDur: 1.6, ground: true, air: true,
    color: '#c58bff', width: 104,
  },
};
export const TOWER_ORDER = ['gatling', 'missile', 'plasma', 'rail', 'emp'];

export function towerStats(type, level) {
  const t = TOWERS[type];
  const l = level - 1;
  return {
    dmg: t.dmg * Math.pow(1.55, l),
    range: t.range * (1 + 0.1 * l),
    rate: t.rate * (1 + 0.12 * l),
    splash: t.splash ? t.splash * (1 + 0.1 * l) : 0,
    chain: t.chain ? t.chain + l : 0,
    slow: t.slow ? Math.min(0.7, t.slow + 0.08 * l) : 0,
    slowDur: t.slowDur || 0,
  };
}
export function upgradeCost(type, level) {
  return Math.round(TOWERS[type].cost * 0.8 * level);
}
export function totalInvested(type, level) {
  let c = TOWERS[type].cost;
  for (let l = 1; l < level; l++) c += upgradeCost(type, l);
  return c;
}

// size: drawn sprite width in world px; lift: flying height
export const ENEMIES = {
  spider:  { name: 'Späher-Spinne', hp: 42,   speed: 1.6,  armor: 0,  reward: 6,   leak: 1,  size: 74,  air: false, bob: 2.2, bobHz: 9 },
  android: { name: 'Endoskelett',   hp: 120,  speed: 0.95, armor: 1,  reward: 9,   leak: 1,  size: 72,  air: false, bob: 2.0, bobHz: 4, tall: true },
  drone:   { name: 'Jäger-Drohne',  hp: 95,   speed: 1.3,  armor: 0,  reward: 12,  leak: 1,  size: 100, air: true,  lift: 58, bob: 4, bobHz: 1.6 },
  mech:    { name: 'Sturm-Mech',    hp: 430,  speed: 0.68, armor: 4,  reward: 22,  leak: 2,  size: 104, air: false, bob: 2.5, bobHz: 2.4 },
  tank:    { name: 'HK-Panzer',     hp: 640,  speed: 0.55, armor: 8,  reward: 30,  leak: 3,  size: 118, air: false, bob: 0.6, bobHz: 14 },
  boss:    { name: 'Koloss',        hp: 3800, speed: 0.36, armor: 12, reward: 260, leak: 8, size: 196, air: false, bob: 3, bobHz: 1.3, boss: true },
};

// ---------- Waves ----------
// group: [type, count, gap(s), startDelay(s)]
const WAVES = [
  [['android', 8, 1.15, 0]],
  [['spider', 14, 0.6, 0]],
  [['android', 10, 1.0, 0], ['spider', 8, 0.55, 5]],
  [['drone', 8, 1.0, 0]],
  [['android', 12, 0.9, 0], ['mech', 2, 3.5, 6]],
  [['spider', 22, 0.42, 0]],
  [['drone', 10, 0.9, 0], ['android', 10, 0.9, 3]],
  [['tank', 3, 3.2, 0], ['android', 12, 0.8, 2]],
  [['mech', 5, 2.4, 0], ['spider', 16, 0.45, 4]],
  [['mech', 6, 2.0, 0], ['drone', 10, 0.9, 3]],
  [['tank', 6, 2.4, 0], ['spider', 22, 0.4, 2]],
  [['drone', 20, 0.6, 0]],
  [['android', 26, 0.55, 0], ['mech', 6, 2.2, 5]],
  [['tank', 8, 2.0, 0], ['drone', 12, 0.8, 4]],
  [['boss', 1, 1, 0], ['android', 14, 0.8, 4]],
  [['spider', 44, 0.28, 0]],
  [['mech', 12, 1.4, 0], ['drone', 16, 0.6, 3]],
  [['tank', 12, 1.5, 0], ['android', 22, 0.55, 2]],
  [['mech', 10, 1.4, 0], ['tank', 9, 1.7, 3], ['drone', 18, 0.5, 6]],
  [['boss', 2, 9, 0], ['tank', 6, 2.2, 3], ['mech', 8, 1.6, 6], ['drone', 14, 0.6, 10]],
];

export const WAVE_TIPS = {
  1: 'Endoskelette nähern sich – baue Gatling-MGs an der Straße.',
  4: 'Luftangriff! Jäger-Drohnen – die Plasmakanone kann sie nicht treffen.',
  8: 'Gepanzerte HK-Panzer – Plasma ignoriert Panzerung.',
  12: 'Großer Drohnenschwarm im Anflug!',
  15: 'WARNUNG: Ein Koloss wurde gesichtet!',
  20: 'Letzte Welle – zwei Kolosse greifen an!',
};

export function waveHpMul(w, levelMul) {
  const n = w - 1;
  return (1 + 0.14 * n + 0.009 * n * n) * levelMul;
}

export function buildWave(waveIdx, level) {
  // waveIdx: 0-based. returns list of {t, type, path}
  const groups = WAVES[Math.min(waveIdx, WAVES.length - 1)];
  const spawns = [];
  const nPaths = level.paths.length;
  let gi = 0;
  for (const [type, count0, gap, delay] of groups) {
    const count = Math.round(count0 * (level.countMul || 1));
    for (let i = 0; i < count; i++) {
      const path = nPaths > 1 ? (i + gi) % nPaths : 0;
      spawns.push({ t: delay + i * gap, type, path });
    }
    gi++;
  }
  spawns.sort((a, b) => a.t - b.t);
  return spawns;
}
export const WAVE_COUNT = WAVES.length;

// ---------- Levels ----------
// Grid: x grows to screen bottom-right, y grows to screen bottom-left.
// spawn/base are 2x2 blocks (top-left cell given). Path waypoints are cell coords (axis aligned).
export const LEVELS = [
  {
    id: 'oedland', name: 'Ödland', sub: 'Sektor 7 – Außenposten',
    size: 14, credits: 350, lives: 20, hpMul: 1.1, countMul: 1.0,
    base: [12, 12],
    paths: [
      { spawn: [0, 0], cells: [[2, 1], [11, 1], [11, 4], [3, 4], [3, 8], [9, 8], [9, 12], [11, 12]] },
    ],
    props: [
      ['ruin', 6, 2], ['wreck', 13, 6], ['barrier', 6, 6], ['tree', 1, 10], ['crates', 12, 9], ['tree', 7, 10],
      ['barrier', 0, 5], ['ruin', 5, 12], ['scrap', 13, 2],
    ],
  },
  {
    id: 'ruinen', name: 'Ruinenstadt', sub: 'Die Trümmer von Sektor 3',
    size: 16, credits: 420, lives: 20, hpMul: 1.6, countMul: 1.2,
    base: [14, 13],
    paths: [
      { spawn: [0, 7], cells: [[2, 8], [5, 8], [5, 2], [9, 2], [9, 11], [3, 11], [3, 14], [12, 14], [12, 6], [14, 6], [14, 12]] },
    ],
    props: [
      ['ruin', 1, 2], ['ruin', 12, 2], ['wreck', 7, 5], ['tree', 7, 8], ['barrier', 11, 9], ['crates', 0, 13],
      ['scrap', 15, 3], ['tree', 6, 15], ['ruin', 15, 9], ['wreck', 1, 5], ['barrier', 7, 12], ['scrap', 10, 0],
    ],
  },
  {
    id: 'festung', name: 'Letzte Festung', sub: 'Zangenangriff auf das Hauptquartier',
    size: 16, credits: 900, lives: 20, hpMul: 0.88, countMul: 1.0,
    base: [7, 14],
    paths: [
      { spawn: [0, 0], cells: [[2, 1], [6, 1], [6, 4], [3, 4], [3, 9], [5, 9], [5, 13], [7, 13]] },
      { spawn: [14, 0], cells: [[14, 2], [14, 4], [11, 4], [11, 8], [14, 8], [14, 11], [10, 11], [10, 14], [9, 14]] },
    ],
    props: [
      ['ruin', 9, 2], ['wreck', 0, 13], ['tree', 1, 6], ['barrier', 8, 7], ['crates', 15, 15], ['scrap', 12, 0],
      ['tree', 15, 6], ['ruin', 0, 10], ['wreck', 12, 6], ['barrier', 7, 5],
    ],
  },
];

// Prop sprites: width in world px, cells it blocks are just its own cell
export const PROPS = {
  ruin:    { sprite: 'prop_ruin',    width: 176 },
  wreck:   { sprite: 'prop_wreck',   width: 150 },
  barrier: { sprite: 'prop_barrier', width: 150 },
  tree:    { sprite: 'prop_tree',    width: 128 },
  crates:  { sprite: 'prop_crates',  width: 124 },
  scrap:   { sprite: 'prop_scrap',   width: 134 },
};
