// Headless balance check: a greedy bot plays every level.
//   node tools/balance_sim.mjs [levelFrom] [levelTo]
const { Game, CELL } = await import('../js/game.js');
const C = await import('../js/config.js');

function coverage(g, cx, cy, r) {
  let n = 0;
  for (let y = 0; y < g.N; y++) for (let x = 0; x < g.N; x++) {
    if (g.cell(x, y) !== CELL.ROAD) continue;
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    let cov = 0;
    for (const t of g.towers) if ((x - t.cx) ** 2 + (y - t.cy) ** 2 <= t.stats.range ** 2) cov++;
    n += 1 / (1 + cov);
  }
  return n;
}

// STRAT: 'mix' (fixed rotation, default) | 'counter' (pick by upcoming enemy classes) | 'mono:<tower>'
const STRAT = process.env.STRAT || 'mix';
function counterPick(g, types) {
  // enemy HP of the next three waves by type, valued with each tower's effectiveness per credit
  const want = {};
  for (let w = g.wave; w < Math.min(g.waves.length, g.wave + 3); w++) for (const gr of g.waves[w].groups) want[gr.type] = (want[gr.type] || 0) + gr.count * C.ENEMIES[gr.type].hp;
  const have = {};
  for (const t of g.towers) have[t.type] = (have[t.type] || 0) + 1;
  let best = types[0], bv = -1;
  for (const k of types) {
    let v = 0;
    for (const [e, hp] of Object.entries(want)) v += hp * C.effectOf(k, e);
    v = v / Math.pow(C.TOWERS[k].cost, 0.8) / (1 + 0.25 * (have[k] || 0));   // diminishing returns: keep a mix
    if (v > bv) { bv = v; best = k; }
  }
  return best;
}

function play(levelIdx, skill = 1) {
  const g = new Game(levelIdx);
  const types = C.TOWER_ORDER.filter(k => g.unlocked(k));
  // build order: mix of the unlocked towers, anti-air if drones show up
  const weighted = ['gatling', 'missile', 'plasma', 'gatling', 'emp', 'flak', 'flame', 'missile', 'rail', 'plasma', 'laser', 'mortar', 'flame']
    .filter(k => types.includes(k));
  const order = [];
  for (let i = 0; i < 80; i++) order.push(weighted[i % weighted.length]);
  let k = 0;
  const dt = 1 / 30;
  let t = 0;
  let lost = 0;
  let lw = 0;
  const trace = process.env.TRACE === String(levelIdx + 1);
  if (trace) console.log(g.waves.map((w, i) => (i + 1) + ':' + w.groups.map(x => x.type + 'x' + x.count).join('+')).join('  '));
  while (g.state !== 'won' && g.state !== 'lost' && t < 4000) {
    let type = order[k % order.length];
    if (STRAT.startsWith('mono:')) type = STRAT.slice(5);
    else if (STRAT === 'counter') type = counterPick(g, types);
    // don't stall saving for an expensive tower while upgrades eat the credits: take the next affordable one
    if (C.TOWERS[type].cost > g.credits && C.TOWERS[type].cost >= 280 && g.credits >= 180) { k++; type = order[k % order.length]; }
    const cost = C.TOWERS[type].cost;
    if (g.credits >= cost && g.towers.length < 34) {
      let best = null, bv = -1;
      for (let y = 0; y < g.N; y++) for (let x = 0; x < g.N; x++) {
        if (!g.canBuild(x, y)) continue;
        const v = coverage(g, x, y, Math.min(C.TOWERS[type].range, 3.5)) * skill + Math.random() * (1 - skill) * 6;
        if (v > bv) { bv = v; best = [x, y]; }
      }
      if (best) { g.build(type, best[0], best[1]); k++; }
    } else if (g.towers.length >= 6) {
      const cand = g.towers.filter(o => o.level < 3).sort((a, b) => a.level - b.level)[0];
      if (cand && g.credits >= C.upgradeCost(cand.type, cand.level) + 80) g.upgrade(cand);
    }
    for (const tw of g.towers) if (tw.hp < tw.stats.hp * 0.35 && g.credits > g.repairCost(tw) + 50) g.repair(tw);
    if (g.state === 'build') g.startWave();
    const before = g.towers.length;
    g.update(dt);
    lost += Math.max(0, before - g.towers.length);
    g.events.length = 0; g.decals.length = 0;
    if (trace && g.wave !== lw) { lw = g.wave; console.log(`  w${g.wave} t=${Math.round(t)} credits ${g.credits} towers ${g.towers.length} (lvl ${g.towers.reduce((a, o) => a + o.level, 0)}) lives ${g.lives} lostTowers ${lost} alive ${g.enemies.length}`); }
    t += dt;
  }
  return { L: levelIdx + 1, state: g.state, wave: `${g.wave}/${g.waves.length}`, lives: g.lives, towers: g.towers.length, towersLost: lost, time: Math.round(t) };
}

const from = parseInt(process.argv[2] || '1', 10), to = parseInt(process.argv[3] || '25', 10);
const skills = (process.argv[4] || '1').split(',').map(Number);
for (let i = from - 1; i < to; i++) {
  for (const s of skills) {
    const r = play(i, s);
    console.log(`L${String(r.L).padStart(2)} skill ${s}: ${r.state.padEnd(4)} wave ${r.wave.padEnd(5)} lives ${String(r.lives).padStart(2)} towers ${r.towers} lostTowers ${r.towersLost} t=${r.time}s`);
  }
}
process.exit(0);
