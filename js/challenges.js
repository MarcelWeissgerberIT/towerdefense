// Challenge missions ("Instanzen"): campaign maps with special rules, medals instead of stars.
import { TOWERS, TOWER_ORDER } from './config.js';

// level: campaign map index (0-based); req: campaign mission that must be cleared first
export const CHALLENGES = [
  { id: 'blitz', name: 'Blitzkrieg', icon: 'speed', level: 7, req: 8, desc: 'Alle Gegner sind 40 % schneller.', mods: { speed: 1.4, credits: 1.15 } },
  { id: 'onelife', name: 'Eiserne Reserve', icon: 'heart', level: 11, req: 12, desc: 'Nur 1 Leben – kein einziger Gegner darf durchkommen.', mods: { lives: 1, credits: 1.3 } },
  { id: 'purist', name: 'Puristen', icon: 'lock', level: 14, req: 15, desc: 'Nur Gatling, Raketenwerfer und Mörser sind erlaubt.', mods: { towers: ['gatling', 'missile', 'mortar'], credits: 1.25 } },
  { id: 'swarm', name: 'Schwarmflut', icon: 'swarm', level: 17, req: 18, desc: 'Doppelt so viele Gegner mit 55 % Lebensenergie.', mods: { count: 2, hp: 0.55 } },
  { id: 'bossrush', name: 'Kolosse', icon: 'skull', level: 19, req: 20, desc: '10 Wellen – nur Bosse mit Eskorte.', mods: { bossRush: 10, credits: 2.4 } },
  { id: 'noreward', name: 'Kein Nachschub', icon: 'gold', level: 21, req: 22, desc: 'Dreifaches Startkapital, aber keine Credits für Abschüsse.', mods: { credits: 3.2, noRewards: true } },
  { id: 'alone', name: 'Auf sich gestellt', icon: 'swords', level: 23, req: 24, desc: 'Keine Spezialfähigkeiten und Power-ups, Gegner stärker gepanzert.', mods: { noAbilities: true, armor: 1.3 } },
  { id: 'endless', name: 'Endlos', icon: 'infinity', level: 24, req: 25, desc: 'Unendliche Wellen, die immer härter werden. Wie lange hältst du durch?', mods: { endless: true } },
];

const DAILY_MODS = [
  { label: 'Gegner 30 % schneller', mods: { speed: 1.3 } },
  { label: 'Gegner mit 30 % mehr Lebensenergie', mods: { hp: 1.3, credits: 1.15 } },
  { label: 'Anderthalbfache Gegnerzahl', mods: { count: 1.5, hp: 0.75 } },
  { label: '25 % weniger Startkapital', mods: { credits: 0.75 } },
  { label: 'Gegner stärker gepanzert', mods: { armor: 1.3 } },
  { label: 'Keine Spezialfähigkeiten', mods: { noAbilities: true } },
  { label: 'Nur 5 Leben', mods: { lives: 5, credits: 1.1 } },
  { label: 'Nur 4 zufällige Turmtypen', towers: 4 },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function todayKey(d = new Date()) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

// same map and rules for everybody on a given day; maps up to the furthest unlocked mission
export function dailyChallenge(maxLevel, key = todayKey()) {
  const r = rng(key * 2654435761);
  const level = 4 + Math.floor(r() * Math.max(1, maxLevel - 4));
  const picks = [];
  while (picks.length < 2) { const m = DAILY_MODS[Math.floor(r() * DAILY_MODS.length)]; if (!picks.includes(m)) picks.push(m); }
  const mods = { credits: 1 };
  for (const p of picks) {
    if (p.towers) {
      const pool = TOWER_ORDER.filter(k => TOWERS[k].unlock <= level + 1);
      const air = pool.filter(k => TOWERS[k].air);
      const set = [air[Math.floor(r() * air.length)]];
      while (set.length < Math.min(p.towers, pool.length)) { const k = pool[Math.floor(r() * pool.length)]; if (!set.includes(k)) set.push(k); }
      mods.towers = set;
      continue;
    }
    for (const [k, v] of Object.entries(p.mods)) mods[k] = k === 'credits' ? mods.credits * v : v;
  }
  const d = String(key);
  return {
    id: 'daily', daily: key, name: `Tages-Challenge ${d.slice(6)}.${d.slice(4, 6)}.`, icon: 'calendar', level,
    desc: picks.map(p => p.label + (p.towers && mods.towers ? ` (${mods.towers.map(k => TOWERS[k].name).join(', ')})` : '')).join(' · '), mods,
  };
}

// 1 bronze, 2 silver, 3 gold
export function medalFor(ch, game, won) {
  if (ch.mods.endless) { const w = game.wave - (won ? 0 : 1); return w >= 40 ? 3 : w >= 25 ? 2 : w >= 12 ? 1 : 0; }
  if (!won) return 0;
  if (ch.mods.lives === 1) return 3;
  const r = game.lives / game.maxLives;
  return r >= 0.9 ? 3 : r >= 0.5 ? 2 : 1;
}
export const MEDAL_NAME = ['', 'BRONZE', 'SILBER', 'GOLD'];
