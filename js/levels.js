// Levels: specs (used by tools/gen_levels.mjs to build the maps) + wave generator.
import { ENEMIES, ENEMY_UNLOCK, BIOME_ENEMY } from './config.js';
import { LEVEL_MAPS } from './levels_data.js';
import { LEVEL_SPECS } from './level_specs.js';
export { LEVEL_SPECS };

export const LEVEL_COUNT = LEVEL_SPECS.length;

export function getLevel(i) {
  const spec = LEVEL_SPECS[i];
  // every extra attack route needs its own defence line: more starting credits
  // (and bigger maps need more towers)
  const base = spec.biome === 'city' && !spec.chapter ? spec.credits : Math.max(spec.credits, 360 + 30 * ((spec.power || i + 1) - 1));
  const credits = base + 70 * (spec.paths - 1) + 80 * Math.max(0, spec.M - 7);
  return { ...spec, ...LEVEL_MAPS[i], credits, index: i, number: i + 1, power: spec.power || i + 1 };
}

// --- waves -----------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GAP = { scavenger: 2.2, climber: 0.7, burrower: 2.0, icebreaker: 2.8, magma: 3.0, ram: 2.6, spider: 0.38, android: 0.8, drone: 0.85, mech: 1.7, tank: 2.1, shield: 1.2, repair: 1.6, kamikaze: 0.55, siege: 2.6, boss: 7, mothership: 7, infiltrator: 0.9, brood: 3.2, bomber: 2.6, aegis: 2.4, saboteur: 1.6 };

export function hpMultiplier(levelNum, wave) {
  const n = wave - 1;
  return (1 + 0.05 * n + 0.0016 * n * n) * (1 + 0.056 * (levelNum - 1));
}

// returns [{groups:[{type,count,gap,delay}], boss:bool, tip?}]
export function makeWaves(level) {
  const lv = level.number, pw = level.power || lv;
  const r = rng(level.seed * 7 + 3);
  // area signature machines are not part of the random pool: they come in their own groups (below)
  const pool = Object.keys(ENEMY_UNLOCK).filter(k => ENEMY_UNLOCK[k] <= lv && !ENEMIES[k].biome);
  const sig = BIOME_ENEMY[level.biome];
  const sigOn = sig && ENEMY_UNLOCK[sig] <= lv;
  const ground = pool.filter(k => !ENEMIES[k].air);
  const air = pool.filter(k => ENEMIES[k].air);
  const heavy = pool.filter(k => ['mech', 'tank', 'siege', 'shield', 'brood', 'aegis'].includes(k));
  const waves = [];
  const W = level.waves;
  for (let w = 1; w <= W; w++) {
    const routeMul = [1, 1, 0.84, 0.74, 0.68][level.paths.length] || 0.68;
    const budget = (5 + 2.0 * w + 0.06 * w * w) * (1 + 0.045 * (pw - 1)) * routeMul;
    // only units that are cheap relative to the wave budget (no tanks in wave 1)
    const fits = (arr, share) => { const ok = arr.filter(k => ENEMIES[k].cost <= Math.max(2, budget * share * 0.34)); return ok.length ? ok : arr.filter(k => ENEMIES[k].cost <= 2); };
    const pick = (arr, share = 0.6) => { const a = fits(arr, share); return a[Math.floor(r() * a.length)] || 'android'; };
    const groups = [];
    const last = w === W;
    let tip = null;
    const add = (type, share, delay = 0) => {
      const cost = ENEMIES[type].cost;
      let count = Math.max(1, Math.round(budget * share / cost));
      // support / siege units are capped so a wave never consists of a healing or artillery blob
      const cap = { repair: 2 + Math.floor(lv / 8), siege: 2 + Math.floor(w / 8), shield: 4 + Math.floor(lv / 5), kamikaze: 8 + Math.floor(lv / 2),
        spider: 24 + 2 * Math.floor(lv / 5), brood: 1 + Math.floor(w / 9), aegis: 2 + Math.floor(lv / 12), bomber: 2 + Math.floor(w / 7), infiltrator: 2 + Math.floor(lv / 6) + Math.floor(w / 6), saboteur: 2 + Math.floor(lv / 8) }[type];
      if (cap && count > cap) {
        const rest = (count - cap) * cost;
        count = cap;
        // spend the remaining budget on basic infantry
        const fill = lv >= 3 || type === 'spider' ? 'android' : 'spider';
        groups.push({ type: fill, count: Math.max(1, Math.round(rest / ENEMIES[fill].cost)), gap: GAP[fill], delay: delay + 2 });
      }
      groups.push({ type, count, gap: GAP[type], delay });
    };
    if (last && lv % 5 === 0) {
      // boss finale
      const bosses = lv >= 20 ? ['boss', 'mothership'] : lv >= 18 ? ['mothership'] : ['boss'];
      if (lv === 25) bosses.push('boss', 'mothership');
      if (lv === 30) bosses.push('boss', 'mothership', 'boss');
      if (lv === 35) bosses.push('boss');
      if (lv === 40) bosses.push('boss', 'mothership', 'boss', 'mothership');
      bosses.forEach((b, i) => groups.push({ type: b, count: 1, gap: 1, delay: i * 9 }));
      add(pick(heavy.length ? heavy : ground, 0.5), 0.5, 3);
      add(pick(ground, 0.4), 0.4, 6);
      if (air.length) add(pick(air, 0.3), 0.3, 10);
      tip = bosses.includes('mothership') && bosses.includes('boss') ? 'FINALE: Kolosse und Mutterschiffe greifen an!'
        : bosses.includes('mothership') ? 'WARNUNG: Ein Mutterschiff nähert sich – Flugabwehr bereit machen!'
        : 'WARNUNG: Ein Koloss wurde gesichtet!';
    } else if (w % 5 === 0 && heavy.length && heavy.some(k => ENEMIES[k].cost <= budget * 0.65 * 0.34)) {
      add(pick(heavy, 0.65), 0.65);
      add(pick(ground), 0.35, 4);
      tip = 'Schwere Einheiten im Anmarsch!';
    } else if (w % 4 === 0 && air.length) {
      add(pick(air, 0.7), 0.7);
      add(pick(ground, 0.3), 0.3, 3);
      tip = 'Luftangriff!';
    } else if (w % 7 === 3 && pool.includes('spider')) {
      add('spider', 0.75);
      add(pick(ground, 0.25), 0.25, 4);
      tip = 'Schwarm von Späher-Spinnen!';
    } else {
      const a = pick(ground.filter(k => k !== 'repair'), 0.6);
      const b = pick(pool, 0.4);
      add(a, 0.6);
      add(b, 0.4, 2 + r() * 3);
    }
    // every third wave (from wave 2): a squad of this area's signature machine, the rest of the wave a bit smaller
    if (sigOn && !last && w % 3 === 2) {
      for (const g of groups) if (!ENEMIES[g.type].boss) g.count = Math.max(1, Math.round(g.count * 0.86));
      groups.push({ type: sig, count: Math.max(1, Math.round(budget * 0.16 / ENEMIES[sig].cost)), gap: GAP[sig], delay: 2.5 });
    }
    // a mid boss in long late levels
    if (!last && lv >= 12 && w === Math.round(W * 0.7)) {
      groups.push({ type: lv >= 18 && r() < 0.5 ? 'mothership' : 'boss', count: 1, gap: 1, delay: 5, hpScale: 0.6 });
      tip = 'Ein Boss führt diese Welle an!';
    }
    waves.push({ groups, tip, boss: groups.some(g => ENEMIES[g.type].boss) });
  }
  return waves;
}

// challenge: waves of bosses with escorts
export function makeBossRush(level, n) {
  const waves = [];
  for (let w = 1; w <= n; w++) {
    const groups = [];
    const nb = 1 + Math.floor(w / 3);
    for (let i = 0; i < nb; i++) groups.push({ type: (w + i) % 3 === 2 ? 'mothership' : 'boss', count: 1, gap: 1, delay: i * 8, hpScale: 0.5 + 0.05 * w });
    groups.push({ type: w > 4 ? 'siege' : 'mech', count: 2 + Math.floor(w / 2), gap: 2, delay: 3 });
    groups.push({ type: 'android', count: 6 + w, gap: 0.8, delay: 5 });
    waves.push({ groups, tip: w === 1 ? 'KOLOSSE: Nur Bosse mit Eskorte!' : null, boss: true });
  }
  return waves;
}

// first appearance tips
export const NEW_ENEMY_TIP = {
  drone: 'Neue Bedrohung: Jäger-Drohnen fliegen – Plasma und Flammen treffen sie nicht.',
  mech: 'Neue Bedrohung: Sturm-Mechs beschießen deine Türme!',
  tank: 'Neue Bedrohung: HK-Panzer – stark gepanzert. Plasma ignoriert Panzerung.',
  repair: 'Neue Bedrohung: Reparatur-Crawler heilen andere Maschinen – zuerst ausschalten!',
  shield: 'Neue Bedrohung: Schild-Androiden – EMP und Plasma brechen Energieschilde.',
  kamikaze: 'Neue Bedrohung: Kamikaze-Drohnen stürzen sich auf deine Türme!',
  siege: 'Neue Bedrohung: Belagerungs-Walker beschießen Türme aus großer Distanz.',
  boss: 'BOSS: Der Koloss – konzentriere dein Feuer!',
  mothership: 'BOSS: Das Mutterschiff setzt Kamikaze-Drohnen aus!',
};
