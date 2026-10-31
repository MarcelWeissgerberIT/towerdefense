// Generates the 25 level maps -> js/levels_data.js
//   node tools/gen_levels.mjs
// Paths are self-avoiding walks on a coarse grid (cell i -> tile 2i+1), so parallel road
// segments always keep at least one buildable tile between them.
import fs from 'node:fs';
import { LEVEL_SPECS } from '../js/level_specs.js';
import { BIOMES } from '../js/config.js';

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
const K = (x, y) => `${x},${y}`;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function walk(M, start, isGoal, minLen, maxLen, blocked, r, opts = {}) {
  let iters = 0;
  const path = [start];
  const vis = new Set(blocked);
  vis.add(K(...start));
  const maxRun = opts.maxRun || 4;
  function rec(cur, pd, run) {
    if (++iters > 60000) return false;
    if (path.length >= minLen && isGoal(cur, path)) return true;
    if (path.length >= maxLen) return false;
    let order = DIRS.map((d, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    if (pd >= 0) {
      // straight preference while the run is short, turns preferred once it gets long
      order = order.filter(i => i !== pd);
      if (run < maxRun && r() < 0.55) order.unshift(pd); else if (run < maxRun) order.push(pd);
    }
    for (const di of order) {
      const [dx, dy] = DIRS[di];
      const nx = cur[0] + dx, ny = cur[1] + dy;
      if (nx < 0 || ny < 0 || nx >= M || ny >= M) continue;
      const k = K(nx, ny);
      if (vis.has(k)) continue;
      if (opts.avoid && opts.avoid(nx, ny, path)) continue;
      vis.add(k); path.push([nx, ny]);
      if (rec([nx, ny], di, di === pd ? run + 1 : 1)) return true;
      path.pop(); vis.delete(k);
    }
    return false;
  }
  return rec(start, -1, 0) ? path : null;
}

function endpoints(M, orient, r) {
  const m = M - 1;
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  if (orient === 'TB') {
    const s = r() < 0.5 ? [0, ri(0, 2)] : [ri(0, 2), 0];
    const g = r() < 0.5 ? [m, ri(m - 2, m)] : [ri(m - 2, m), m];
    return { s, g, s2: s[0] === 0 ? [ri(2, 4), 0] : [0, ri(2, 4)], s3: [ri(m - 1, m), 0], s4: [0, ri(m - 1, m)] };
  }
  if (orient === 'LR') { // left corner (0,m) -> right corner (m,0)
    const s = r() < 0.5 ? [0, ri(m - 2, m)] : [ri(0, 2), m];
    const g = r() < 0.5 ? [m, ri(0, 2)] : [ri(m - 2, m), 0];
    return { s, g, s2: [0, ri(1, 3)], s3: [ri(1, 3), 0], s4: [m, ri(m - 3, m - 1)] };
  }
  // RL: right corner -> left corner
  const s = r() < 0.5 ? [m, ri(0, 2)] : [ri(m - 2, m), 0];
  const g = r() < 0.5 ? [0, ri(m - 2, m)] : [ri(0, 2), m];
  return { s, g, s2: [ri(1, 3), 0], s3: [0, ri(1, 3)], s4: [ri(m - 3, m - 1), m] };
}

const fineCenter = (c) => [2 * c[0] + 1.5, 2 * c[1] + 1.5];
function compress(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function roadCells(coarse) {
  const cells = [];
  for (let i = 0; i < coarse.length; i++) {
    const [x, y] = coarse[i];
    cells.push([2 * x + 1, 2 * y + 1]);
    if (i + 1 < coarse.length) {
      const [nx, ny] = coarse[i + 1];
      cells.push([x + nx + 1, y + ny + 1]);
    }
  }
  return cells;
}

function genLevel(spec) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const r = rng(spec.seed * 1000 + attempt);
    const M = spec.M;
    const { s, g, s2, s3, s4 } = endpoints(M, spec.orient, r);
    const [lo, hi] = spec.len;
    const main = walk(M, s, (c) => c[0] === g[0] && c[1] === g[1], lo, hi, [], r);
    if (!main) continue;
    const idx = new Map(main.map((c, i) => [K(...c), i]));
    const routes = [main];
    let ok = true;
    const extra = [s2, s3, s4].slice(0, spec.paths - 1);
    const used = new Set(main.map(c => K(...c)));
    // each extra route joins the main route in a different section; longer feeders on bigger maps
    const JOIN = [[0.3, 0.75], [0.4, 0.85], [0.2, 0.6]];
    for (const [ei, st] of extra.entries()) {
      if (used.has(K(...st))) { ok = false; break; }
      const [j0, j1] = JOIN[ei];
      const inJoin = (j) => j !== undefined && j >= main.length * j0 && j <= main.length * j1;
      const isGoal = (c) => {
        for (const [dx, dy] of DIRS) if (inJoin(idx.get(K(c[0] + dx, c[1] + dy)))) return true;
        return false;
      };
      const p = walk(M, st, isGoal, 6, M + 7, [...used], r, { maxRun: 3 });
      if (!p) { ok = false; break; }
      const last = p[p.length - 1];
      let j = -1;
      for (const [dx, dy] of DIRS) {
        const v = idx.get(K(last[0] + dx, last[1] + dy));
        if (inJoin(v)) { j = v; break; }
      }
      const full = [...p, ...main.slice(j)];
      routes.push(full);
      p.forEach(c => used.add(K(...c)));
    }
    if (!ok) continue;
    // spawn gates must not overlap foreign road cells
    const N = 2 * M + 1;
    const grid = Array.from({ length: N }, () => new Array(N).fill(0)); // 0 free 1 road 3 spawn 4 base
    for (const rt of routes) for (const [x, y] of roadCells(rt)) grid[y][x] = 1;
    const block = (c) => [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => [2 * c[0] + 1 + dx, 2 * c[1] + 1 + dy]);
    let clash = false;
    const spawns = routes.map(rt => rt[0]);
    for (const sp of spawns) for (const [x, y] of block(sp)) {
      if (grid[y][x] === 1 && !(x === 2 * sp[0] + 1 && y === 2 * sp[1] + 1)) {
        // allowed only if the cell belongs to this spawn's first connector
        const rt = routes[spawns.indexOf(sp)];
        const own = roadCells(rt.slice(0, 2)).some(([a, b]) => a === x && b === y);
        if (!own) clash = true;
      }
    }
    if (clash) continue;
    for (const sp of spawns) for (const [x, y] of block(sp)) grid[y][x] = 3;
    for (const [x, y] of block(g)) grid[y][x] = 4;
    // count buildable tiles next to the road (quality metric)
    let near = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (grid[y][x] !== 0) continue;
      let n = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (grid[y + dy]?.[x + dx] === 1) n = true;
      if (n) near++;
    }
    // ---- terrain: plateaus (height 1, interior height 2) on free ground, never on roads/gates/HQ ----
    const biome = BIOMES[spec.biome], TH = biome.theme;
    const cheb = (x, y, vals, R) => { let d = 99; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (vals.includes(grid[y + dy]?.[x + dx])) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy))); return d; };
    const H = Array.from({ length: N }, () => new Array(N).fill(0));
    const elig = (x, y) => x >= 0 && y >= 0 && x < N && y < N && grid[y][x] === 0 && cheb(x, y, [3, 4], 1) > 1;
    const nPlat = Math.round(N * N * 0.017 * TH.plateau);
    for (let k = 0; k < nPlat * 6 && H.flat().filter(Boolean).length < N * N * 0.2 * TH.plateau; k++) {
      const sx = Math.floor(r() * N), sy = Math.floor(r() * N);
      if (!elig(sx, sy) || H[sy][sx] || cheb(sx, sy, [1], 1) < 2) continue;
      const size = 5 + Math.floor(r() * (5 + N / 2.5));
      const cells = [[sx, sy]]; H[sy][sx] = 1;
      for (let it = 0; it < 80 && cells.length < size; it++) {
        const [cx, cy] = cells[Math.floor(r() * cells.length)];
        const [dx, dy] = DIRS[Math.floor(r() * 4)];
        const nx = cx + dx, ny = cy + dy;
        if (!elig(nx, ny) || H[ny][nx]) continue;
        H[ny][nx] = 1; cells.push([nx, ny]);
      }
      // a higher core on bigger plateaus: cells whose 4 neighbours are raised and at least 6 of 8 around them
      if (cells.length >= 7) for (const [x, y] of cells) {
        let n8 = 0, n4 = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && H[y + dy]?.[x + dx]) { n8++; if (!dx || !dy) n4++; }
        if (n4 === 4 && n8 >= 6 && cheb(x, y, [1], 2) >= 2 && r() < 0.85) H[y][x] = 2;
      }
    }
    // ---- props with meaning: HQ camp, wrecks at the enemy gates, one landmark, natural clusters ----
    const props = [];
    const roadD = (x, y) => cheb(x, y, [1, 3, 4], 2);
    const free = (x, y) => x >= 0 && y >= 0 && x < N && y < N && grid[y][x] === 0;
    const put = (name, x, y) => { props.push([name, x, y]); grid[y][x] = 2; };
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const around = (cx, cy, R, ok) => {
      const c = [];
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = cx + dx, y = cy + dy; if (free(x, y) && ok(x, y)) c.push([x, y]); }
      return c.sort(() => r() - 0.5);
    };
    // supply crates / barricades beside the HQ (not on cells next to the road)
    const bx = 2 * g[0] + 1, by = 2 * g[1] + 1;
    for (const [x, y] of around(bx + 0.5 | 0, by + 0.5 | 0, 3, (x, y) => cheb(x, y, [4], 2) <= 2 && cheb(x, y, [1], 1) > 1 && !H[y][x]).slice(0, 2)) put(pick(TH.camp), x, y);
    // destroyed vehicles near the enemy gates
    for (const sp of spawns) {
      const gx = 2 * sp[0] + 1, gy = 2 * sp[1] + 1;
      for (const [x, y] of around(gx, gy, 3, (x, y) => cheb(x, y, [3], 3) <= 3 && cheb(x, y, [1], 1) > 1).slice(0, spawns.length > 2 ? 1 : 2)) put(pick(TH.spawn), x, y);
    }
    // landmark on the highest ground away from the road, with its satellites
    let lm = null, lv = -1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!free(x, y) || roadD(x, y) < 2) continue;
      const v = H[y][x] * 3 + Math.min(roadD(x, y), 4) + r();
      if (v > lv) { lv = v; lm = [x, y]; }
    }
    if (lm) {
      put(TH.landmark[0], ...lm);
      for (const [x, y] of around(lm[0], lm[1], 1, (x, y) => roadD(x, y) >= 2).slice(0, 1 + (N > 15 ? 1 : 0))) put(pick(TH.landmark[1]), x, y);
    }
    // natural clusters (forests, rock fields), preferring high ground and the map edge
    const want = Math.round(N * 0.8);
    const seeds = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (free(x, y) && (roadD(x, y) >= 2 || x === 0 || y === 0 || x === N - 1 || y === N - 1)) seeds.push([x, y, H[y][x] * 2 + (x === 0 || y === 0 || x === N - 1 || y === N - 1 ? 1.5 : 0) + r() * 3]);
    seeds.sort((a, b) => b[2] - a[2]);
    for (const [sx, sy] of seeds) {
      if (props.length >= want) break;
      if (!free(sx, sy) || props.some(p => Math.max(Math.abs(p[1] - sx), Math.abs(p[2] - sy)) < 2)) continue;
      const kind = pick(TH.nature);
      put(kind, sx, sy);
      // grow the cluster by 1-2 neighbours of the same kind
      const n = 1 + Math.floor(r() * 2);
      for (const [x, y] of around(sx, sy, 1, (x, y) => roadD(x, y) >= 2 && Math.abs(x - sx) + Math.abs(y - sy) === 1).slice(0, n)) put(r() < 0.75 ? kind : pick(TH.nature), x, y);
    }
    const elev = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (H[y][x]) elev.push([x, y, H[y][x]]);
    return {
      N,
      base: [2 * g[0] + 1, 2 * g[1] + 1],
      paths: routes.map(rt => ({
        spawn: [2 * rt[0][0] + 1, 2 * rt[0][1] + 1],
        pts: compress(rt.map(fineCenter)),
        cells: roadCells(rt),
      })),
      props,
      elev,
      near,
      attempt,
    };
  }
  throw new Error('could not generate ' + spec.name);
}

const maps = LEVEL_SPECS.map((s, i) => {
  const m = genLevel(s);
  const len = m.paths.map(p => p.cells.length);
  console.log(`${String(i + 1).padStart(2)} ${s.name.padEnd(24)} N=${m.N} routes=${m.paths.length} len=${len.join('/')} nearRoad=${m.near} props=${m.props.length} (try ${m.attempt})`);
  delete m.near; delete m.attempt;
  return m;
});
fs.writeFileSync(new URL('../js/levels_data.js', import.meta.url),
  '// Generated by tools/gen_levels.mjs – do not edit by hand.\nexport const LEVEL_MAPS = ' + JSON.stringify(maps) + ';\n');
