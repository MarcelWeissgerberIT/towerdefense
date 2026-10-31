// Usage: node tools/balance_sim.mjs   (greedy bot plays every level headless)
// Headless balance simulation with a greedy bot.
const G = await import('../js/game.js');
const C = await import('../js/config.js');
const { Game, CELL } = G;
const ORDER = ['gatling', 'gatling', 'missile', 'plasma', 'emp', 'rail', 'missile', 'plasma'];
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
function run(levelIdx, skill) {
  const g = new Game(levelIdx);
  let k = 0;
  const dt = 1 / 30;
  let t = 0;
  while (g.state !== 'won' && g.state !== 'lost' && t < 3600) {
    // build / upgrade
    const type = ORDER[k % ORDER.length];
    const cost = C.TOWERS[type].cost;
    if (g.credits >= cost && g.towers.length < 40) {
      let best = null, bv = -1;
      for (let y = 0; y < g.N; y++) for (let x = 0; x < g.N; x++) {
        if (!g.canBuild(x, y)) continue;
        const v = coverage(g, x, y, C.TOWERS[type].range) * skill + Math.random() * (1 - skill) * 10;
        if (v > bv) { bv = v; best = [x, y]; }
      }
      if (best) { g.build(type, best[0], best[1]); k++; }
    } else if (g.towers.length >= 8) {
      const t2 = g.towers.filter(t => t.level < 3).sort((a, b) => a.level - b.level)[0];
      if (t2 && g.credits >= C.upgradeCost(t2.type, t2.level) + 60) g.upgrade(t2);
    }
    if (g.state === 'build') g.startWave();
    g.update(dt);
    g.events.length = 0; g.decals.length = 0;
    t += dt;
  }
  return { level: levelIdx, state: g.state, wave: g.wave, lives: g.lives, towers: g.towers.length, credits: g.credits, time: Math.round(t), levels: g.towers.reduce((a, t) => a + t.level, 0) };
}
for (let L = 0; L < 3; L++) for (const skill of [1, 0.5]) console.log(skill, JSON.stringify(run(L, skill)));
