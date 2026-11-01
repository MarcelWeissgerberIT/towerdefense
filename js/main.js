// Iron Sentinel – app controller: screens, HUD, build drawer, tower menu, game loop.
import { BAR, ION, ROD, NAPALM, TOWERS, ENEMIES, TOWER_ORDER, MAX_LEVEL, BIOMES, BIOME_ORDER, UPGRADE_TIME, ELEV_RANGE, CLASS_NAME, EFFECT, POWERUPS, NUKE, HOLE, DIFFICULTY, SPECS, PERKS, PERK_COST, WEATHER, TOWER_DMG, SHATTER, FROST, specCost, effectOf, upgradeCost, towerStats } from './config.js';
import { LEVEL_SPECS, LEVEL_COUNT, getLevel, makeWaves, hpMultiplier } from './levels.js';
import { CHAPTERS } from './level_specs.js';
import { Assets, Models, drawIcon } from './assets.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { CHALLENGES, dailyChallenge, medalFor, MEDAL_NAME, todayKey } from './challenges.js';
import { toWorld, toGrid } from './iso.js';
import { sfx, unlockAudio, setSound, soundOn, music, musicPreload, musicLevel, setMusic, musicOn } from './audio.js';

const $ = (id) => document.getElementById(id);
const STORE = 'ironsentinel.v2';
const save = (() => {
  let data = { stars: {}, sound: true, rotateHintSeen: false };
  try { Object.assign(data, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { /* private mode */ }
  return { data, write() { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* ignore */ } } };
})();

// running mission: saved every few seconds and when the app goes to the background, so an iOS tab
// reload (call, app switch) does not lose it; cleared when the mission ends or a new one starts
const RUN_KEY = 'ironsentinel.run';
let runSaveT = 0;
function loadRun() {
  try { const r = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); return r && r.snap ? r : null; } catch (e) { return null; }
}
function saveRun() {
  if (!game || replay) return;
  let snap = null;
  try { snap = game.snapshot(); } catch (e) { console.warn('snapshot failed', e); }
  if (!snap) return;
  const meta = { level: game.level.number, name: game.level.name, wave: game.wave, waves: game.waves.length, ch: challenge ? challenge.name : null, diff: challenge ? null : game.mods.diff || 0 };
  try { localStorage.setItem(RUN_KEY, JSON.stringify({ at: Date.now(), ch: challenge, meta, snap })); } catch (e) { /* storage full / private mode */ }
}
function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch (e) { /* ignore */ } updateResumeBtn(); }
function updateResumeBtn() {
  const r = loadRun(), b = $('btn-resume');
  b.classList.toggle('hidden', !r);
  $('btn-play').classList.toggle('primary', !r);
  if (!r) return;
  const m = r.meta || {};
  $('resume-sub').textContent = `${m.ch ? m.ch : 'Einsatz ' + m.level + (m.name ? ' · ' + m.name : '')} · Welle ${m.wave}/${m.waves}`;
}
async function resumeRun() {
  const r = loadRun();
  let g = null;
  try { g = r && Game.restore(r.snap); } catch (e) { console.warn('restore failed', e); }
  if (!g) { clearRun(); toast('Der gespeicherte Einsatz konnte nicht geladen werden', 'bad', 3000); return; }
  await startLevel(g.levelIdx, r.ch || null, g);
}

const canvas = $('game');
const renderer = new Renderer(canvas);
let game = null;
let paused = false;
let speed = 1;
const ui = { buildCell: null, previewType: null, selected: null };
const icons = {};

// ---------------- screens ----------------
function showScreen(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id); }
function hideScreens() { for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden'); }
function setInGameUI(on) {
  for (const id of ['hud', 'btn-wave']) $(id).classList.toggle('hidden', !on);
  if (!on) { closeBuildMenu(); closeTowerMenu(); endAim(); closeArsenal(); $('nuke-flash').style.opacity = 0; hudCache.nukeFlash = 0; setXray(false); camTween = null; endNukeCam(false); if (replay) endReplay(); $('btn-replay').classList.add('hidden'); $('boss-bar').classList.add('hidden'); document.body.classList.remove('boss'); hudCache.bossOn = false; }
}
function starsHTML(n) { let s = ''; for (let i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>'; return s; }

// free play (default): everything is available without unlocking it first
const freePlay = () => save.data.free !== false;
// campaign difficulty (0 easy, 1 medium, 2 hard) and the hardest one each mission was won on
const diffIdx = () => Math.max(0, Math.min(2, save.data.diff | 0));
function updateDiffBar() {
  const d = diffIdx();
  for (const b of document.querySelectorAll('#diff-bar button')) b.classList.toggle('on', +b.dataset.d === d);
  $('diff-bar').dataset.d = d;
  $('diff-desc').textContent = DIFFICULTY[d].desc;
}
for (const b of document.querySelectorAll('#diff-bar button')) b.onclick = () => {
  save.data.diff = +b.dataset.d; save.write(); sfx('click'); updateDiffBar(); renderLevels();
};
function levelUnlocked(i) { return freePlay() || i === 0 || (save.data.stars[i - 1] || 0) > 0; }
function levelTile(L, i, showBiome) {
  const stars = save.data.stars[i] || 0;
  const dw = (save.data.diffWon || {})[i];
  const locked = !levelUnlocked(i);
  const btn = document.createElement('button');
  btn.className = 'ltile' + (locked ? ' locked' : '') + (stars ? ' done' : '');
  const n = 2 * L.M + 1;
  btn.innerHTML = `<div class="lnum">${locked ? '🔒' : i + 1}</div><div class="lname">${L.name}</div>`
    + `<div class="lmeta">${showBiome ? BIOMES[L.biome].name + ' · ' : `${n}×${n} · `}${L.paths} ${L.paths === 1 ? 'Pfad' : 'Pfade'}</div><div class="stars small">${starsHTML(stars)}</div>`
    + (dw > 0 ? `<div class="ldiff d${dw}">${DIFFICULTY[dw].name}</div>` : '');
  btn.onclick = () => {
    if (locked) { sfx('error'); toast('Schließe zuerst den vorherigen Einsatz ab', 'bad'); return; }
    sfx('click'); startLevel(i);
  };
  return { btn, stars };
}
function renderLevels() {
  const list = $('level-list');
  list.innerHTML = '';
  let total = 0;
  for (const bid of BIOME_ORDER) {
    const b = BIOMES[bid];
    const sec = document.createElement('div');
    sec.className = 'biome-sec';
    sec.innerHTML = `<div class="biome-head" style="background-image:url(assets/tex/${b.ground}.jpg)"><span>${b.name.toUpperCase()}</span></div>`;
    const row = document.createElement('div');
    row.className = 'lrow';
    LEVEL_SPECS.forEach((L, i) => {
      if (L.biome !== bid || L.chapter) return;
      const t = levelTile(L, i, false);
      total += t.stars;
      row.appendChild(t.btn);
    });
    sec.appendChild(row);
    list.appendChild(sec);
  }
  for (const [cid, ch] of Object.entries(CHAPTERS)) {
    const sec = document.createElement('div');
    sec.className = 'biome-sec';
    sec.innerHTML = `<div class="biome-head" style="background-image:url(assets/tex/${BIOMES[ch.tex].ground}.jpg)"><span>${ch.name.toUpperCase()}</span><small>${ch.desc}</small></div>`;
    const row = document.createElement('div');
    row.className = 'lrow';
    LEVEL_SPECS.forEach((L, i) => { if (L.chapter === cid) { const t = levelTile(L, i, true); total += t.stars; row.appendChild(t.btn); } });
    sec.appendChild(row);
    list.appendChild(sec);
  }
  $('total-stars').innerHTML = `★ ${total} / ${LEVEL_COUNT * 3}`;
  updateDiffBar();
  // scroll to the first unfinished level
  const next = [...list.querySelectorAll('.ltile')].find(t => !t.classList.contains('done') && !t.classList.contains('locked'));
  if (next) setTimeout(() => next.scrollIntoView({ block: 'center' }), 30);
}

function toast(text, kind = '', ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  const box = $('toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
}

// tower icons (base + turret frame rendered into a small canvas)
function makeIcons() {
  for (const k of TOWER_ORDER) {
    const def = TOWERS[k], m = Models.meta(def.model);
    if (!m) continue;
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    const g = c.getContext('2d');
    const s = Math.min(78 / m.h, 92 / m.w) / m.scale;
    const sc = m.scale * s;
    const x = 48, y = 48 + (m.ay - m.h / 2) * sc;
    if (m.baseImg) g.drawImage(m.baseImg, x - m.ax * sc, y - m.ay * sc, m.w * sc, m.h * sc);
    const f = Models.frameFor(def.model, Math.PI / 4 - 0.3);
    g.drawImage(m.img, (f % m.cols) * m.w, Math.floor(f / m.cols) * m.h, m.w, m.h, x - m.ax * sc, y - m.ay * sc, m.w * sc, m.h * sc);
    icons[k] = c.toDataURL('image/png');
  }
  const bm = Models.meta('p3d_prop_barrier');
  if (bm) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    const g = c.getContext('2d'), sc = Math.min(88 / bm.w, 80 / bm.h);
    g.drawImage(bm.img, 0, 0, bm.w, bm.h, 48 - bm.w * sc / 2, 48 - bm.h * sc / 2, bm.w * sc, bm.h * sc);
    icons.barricade = c.toDataURL('image/png');
  }
}

// ---------------- build drawer (bottom sheet) ----------------
let bmButtons = [];
const ROLE = {
  gatling: 'Boden + Luft · Schnellfeuer', missile: 'Boden + Luft · Fläche', plasma: 'Boden · ignoriert Panzer', emp: 'Boden + Luft · verlangsamt',
  flak: 'nur Luft · Fläche', flame: 'Boden · Kegel + Brand', rail: 'Boden + Luft · Durchschlag', laser: 'Boden + Luft · heizt auf', mortar: 'Boden · Artillerie',
  acid: 'Boden · zerfrisst Panzerung', cryo: 'Boden + Luft · friert ein',
};
function openBuildMenu(cx, cy) {
  closeTowerMenu();
  ui.buildCell = { x: cx, y: cy };
  ui.previewType = null;
  const box = $('bd-cards');
  box.innerHTML = '';
  bmButtons = [];
  if (game.canBarricade(cx, cy)) {
    // road: only a barricade fits here - shown right away with the routes the machines would then take
    ui.buildCell.road = true;
    const b = document.createElement('button');
    b.className = 'bd-card';
    b.innerHTML = `<img src="${icons.barricade || ''}" alt=""><span class="bd-name">Barrikade</span><span class="bd-cost">${IC('credits')}${game.barricadeCost()}</span>`;
    b.onclick = (e) => { e.stopPropagation(); chooseTower('barricade'); };
    box.appendChild(b);
    bmButtons.push({ el: b, k: 'barricade' });
    $('builddrawer').classList.remove('hidden');
    closeArsenal();
    for (const id of ['btn-wave', 'btn-arsenal', 'arsenal']) $(id).classList.add('under-drawer');
    chooseTower('barricade');
    requestAnimationFrame(() => ensureCellVisible(cx, cy));
    return;
  }
  for (const k of TOWER_ORDER.filter(k => game.unlocked(k))) {
    const def = TOWERS[k];
    const b = document.createElement('button');
    b.className = 'bd-card';
    b.innerHTML = `<img src="${icons[k] || ''}" alt=""><span class="bd-name">${def.name}</span><span class="bd-cost">${IC('credits')}${def.cost}</span>`;
    b.onclick = (e) => { e.stopPropagation(); chooseTower(k); };
    attachHold(b, () => showTowerInfo(k));
    box.appendChild(b);
    bmButtons.push({ el: b, k });
  }
  $('bd-info').innerHTML = '<span class="bd-hint">Turm wählen – die Reichweite wird auf der Karte angezeigt</span>';
  $('bd-build').classList.add('hidden');
  $('builddrawer').classList.remove('hidden');
  closeArsenal();
  for (const id of ['btn-wave', 'btn-arsenal', 'arsenal']) $(id).classList.add('under-drawer');
  requestAnimationFrame(() => ensureCellVisible(cx, cy));
  sfx('click');
}
// "strong vs / weak vs" for a tower, by enemy class
function vsLine(k) {
  const e = EFFECT[k], def = TOWERS[k];
  const good = [], bad = [];
  for (const c of ['light', 'armored', 'heavy', 'air']) {
    if (c === 'air' ? !def.air : !def.ground) continue;
    if (e[c] >= 1.2) good.push(CLASS_NAME[c]); else if (e[c] <= 0.6) bad.push(CLASS_NAME[c]);
  }
  if (!def.air) bad.push('trifft keine Luftziele');
  if (!def.ground) bad.push('nur Luftziele');
  const special = {
    cryo: `${IC('frost')} friert ein · Kombo: Railgun, Mörser, Raketen ×1,6 · Feuer = Thermoschock`,
    acid: `${IC('acid')} zerfrisst Panzerung · Säurepfützen`,
    emp: `${IC('lives')} Schilde ×4 · verlangsamt`,
    plasma: `${IC('armor')} ignoriert Panzerung · Schilde ×2`,
  }[k];
  return (good.length ? `<span class="vs-good">▲ ${good.join(', ')}</span>` : '') + (special ? `<span class="vs-fx">${special}</span>` : '') + (bad.length ? `<span class="vs-bad">▼ ${bad.join(', ')}</span>` : '');
}
function chooseBarricade() {
  const { x, y } = ui.buildCell;
  if (ui.previewType === 'barricade' && ui.barricadeShown) { buildChosen(); return; }   // second tap builds
  ui.previewType = 'barricade'; ui.barricadeShown = true;
  bmButtons.forEach(o => o.el.classList.add('sel'));
  const pr = game.previewRoutes(x, y), cost = game.barricadeCost(), n = game.barricades.length;
  const hp = Math.round(BAR.hp * (1 + BAR.hpLvl * (game.level.power - 1)));
  $('bd-info').innerHTML = `<b>Barrikade</b> <span class="bd-role">Bodentruppen umleiten oder aufhalten</span><br>` +
    `<small>${pr.through ? '<b class="vs-bad">Kein Umweg:</b> die Maschinen bleiben davor stehen und müssen sie zerstören – Flugeinheiten fliegen drüber.'
      : '<b class="vs-good">Umweg frei:</b> die Maschinen nehmen den grün markierten Weg.'}</small>` +
    `<div class="bd-chips"><span>${IC('armor')} ${hp}</span><span>${n}/${BAR.max} gebaut</span></div>`;
  const bb = $('bd-build');
  bb.innerHTML = `BAUEN · ${IC('credits')}${cost}`;
  bb.disabled = game.credits < cost || n >= BAR.max;
  bb.classList.remove('hidden');
}
function chooseTower(k) {
  if (!game || !ui.buildCell) return;
  if (k === 'barricade') { chooseBarricade(); sfx('click'); return; }
  const def = TOWERS[k];
  if (ui.previewType === k) { buildChosen(); return; }   // second tap on the same card builds
  ui.previewType = k;
  bmButtons.forEach(o => o.el.classList.toggle('sel', o.k === k));
  const s = game.statsFor(k, 1, ui.buildCell.x, ui.buildCell.y);
  const hgt = game.heightAt(ui.buildCell.x, ui.buildCell.y);
  const dmg = def.dps ? `${Math.round(s.dps)}/s` : def.kind === 'hitscan' || def.kind === 'flak' ? `${Math.round(s.dmg * s.rate)}/s` : Math.round(s.dmg);
  $('bd-info').innerHTML = `<b>${def.name}</b> <span class="bd-role">${ROLE[k]}</span><br><small>${def.desc}</small>` +
    `<div class="bd-chips"><span>${IC('damage')} ${dmg}</span><span>${IC('range')} ${s.range.toFixed(1)}${hgt ? ` <em class="hg">▲+${Math.round(hgt * ELEV_RANGE * 100)}%</em>` : ''}</span><span>${IC('armor')} ${s.hp}</span></div>` +
    `<div class="bd-vs">${vsLine(k)}</div>`;
  const bb = $('bd-build');
  bb.innerHTML = `BAUEN · ${IC('credits')}${def.cost}`;
  bb.disabled = game.credits < def.cost;
  bb.classList.remove('hidden');
  requestAnimationFrame(() => ui.buildCell && ensureCellVisible(ui.buildCell.x, ui.buildCell.y));
  sfx('click');
}
function buildChosen() {
  if (!game || !ui.buildCell || !ui.previewType) return;
  const k = ui.previewType;
  if (k === 'barricade') { if (game.buildBarricade(ui.buildCell.x, ui.buildCell.y)) closeBuildMenu(); return; }
  if (game.credits < TOWERS[k].cost) { sfx('error'); toast('Nicht genug Credits', 'bad', 1200); return; }
  const t = game.build(k, ui.buildCell.x, ui.buildCell.y);
  if (t) closeBuildMenu();
}
function closeBuildMenu() {
  ui.buildCell = null; ui.previewType = null; ui.barricadeShown = false;
  $('builddrawer').classList.add('hidden');
  for (const id of ['btn-wave', 'btn-arsenal', 'arsenal']) $(id).classList.remove('under-drawer');
}
$('bd-build').onclick = (e) => { e.stopPropagation(); buildChosen(); };
$('bd-close').onclick = (e) => { e.stopPropagation(); closeBuildMenu(); sfx('click'); };
// keep the chosen tile visible above the drawer
function ensureCellVisible(cx, cy) {
  const w = toWorld(cx + 0.5, cy + 0.5);
  const p = renderer.worldToScreen(w.x, w.y);
  // the tower preview reaches ~80 px above the tile centre and the tile ~30 px below
  const drawerTop = window.innerHeight - ($('builddrawer').offsetHeight || 170) - 12;
  const bottom = p.y + 34 * renderer.cam.zoom;
  if (bottom > drawerTop) renderer.pan(0, drawerTop - bottom);
  if (p.y < 70) renderer.pan(0, 70 - p.y);
}

// ---------------- tower menu ----------------
function openTowerMenu(t) {
  closeBuildMenu();
  ui.selected = t;
  $('towermenu').classList.remove('hidden');
  updateTowerMenu(true);
  positionMenus();
  sfx('click');
}
function closeTowerMenu() { ui.selected = null; $('towermenu').classList.add('hidden'); }

const MODES = { first: 'Erster', strong: 'Stärkster', near: 'Nächster' };
let tmCache = '';
function updateBarricadeMenu(b, force) {
  const rc = game.barricadeRepairCost(b), sv = game.barricadeSellValue(b);
  const key = ['bar', b.id, Math.round(b.hp), rc, sv, game.credits >= rc].join('|');
  if (!force && key === tmCache) return;
  tmCache = key;
  setHTML($('tm-name'), 'Barrikade');
  $('tm-level').textContent = '';
  $('tm-specs').classList.add('hidden');
  $('tm-hpfill').style.width = `${Math.max(0, b.hp / b.maxHp) * 100}%`;
  const blocked = game.enemies.filter(e => e.blocked).length;
  setHTML($('tm-stats'), `<span>${IC('armor')} ${Math.ceil(b.hp)} / ${b.maxHp}</span>` + (blocked ? `<span class="tm-eff bad">${IC('damage')} ${blocked} Gegner rammen sie</span>` : `<span>rot: Weg der Maschinen</span>`));
  $('tm-upgrade').classList.add('hidden');
  $('tm-mode').classList.add('hidden');
  $('tm-repair-all').classList.add('hidden');
  const rp = $('tm-repair');
  rp.classList.toggle('hidden', rc <= 0);
  setHTML(rp, `${IC('wrench')} ${rc}`);
  rp.disabled = game.credits < rc;
  setHTML($('tm-sell'), `${IC('sell')} ABREISSEN +${sv}`);
}
function updateTowerMenu(force) {
  const t = ui.selected;
  if (!t || !game) return;
  if (t.kind === 'barricade') { updateBarricadeMenu(t, force); return; }
  $('tm-upgrade').classList.remove('hidden');
  const def = TOWERS[t.type];
  const s = t.stats, maxed = t.level >= MAX_LEVEL;
  const cost = maxed ? 0 : upgradeCost(t.type, t.level);
  const rc = game.repairCost(t);
  const prog = t.upgrading ? Math.floor(t.upgrading.t / t.upgrading.dur * 100) : -1;
  const sc = SPECS[t.type] ? specCost(t.type) : 0;
  const key = [t.id, t.level, t.mode, game.credits >= cost, maxed, game.sellValue(t), rc, Math.round(t.hp), prog, t.kills, t.rank, t.spec, game.credits >= sc, t.repairing ? Math.floor(t.repairing.t / t.repairing.dur * 20) : -1, repairAllCost()].join('|');
  if (!force && key === tmCache) return;
  tmCache = key;
  const spec = t.spec && SPECS[t.type].find(x => x.id === t.spec);
  setHTML($('tm-name'), spec ? `${def.name} <small class="tm-spec">◆ ${spec.name}</small>` : def.name);
  // level III: choose a specialization (the buttons stay the same elements while the menu is open; too
  // expensive ones stay tappable and say so instead of silently ignoring the tap)
  const box = $('tm-specs');
  const choose = maxed && !t.spec && !t.upgrading && SPECS[t.type];
  box.classList.toggle('hidden', !choose);
  if (choose) {
    setHTML(box, `<div class="tm-spec-head">SPEZIALISIERUNG · ${IC('credits')} ${sc}</div>` + SPECS[t.type].map(x =>
      `<button class="tm-spec-btn" data-spec="${x.id}"><b>${x.name}</b><span>${x.desc}</span></button>`).join(''));
    for (const b of box.querySelectorAll('[data-spec]')) b.classList.toggle('poor', game.credits < sc);
  }
  $('tm-level').textContent = ['I', 'II', 'III'][t.level - 1];
  $('tm-hpfill').style.width = `${Math.max(0, t.hp / s.hp) * 100}%`;
  const next = maxed ? null : game.statsFor(t.type, t.level + 1, t.cx, t.cy);
  const dmg = def.dps ? `${Math.round(s.dps)}/s` : def.kind === 'hitscan' || def.kind === 'flak' ? `${Math.round(s.dmg)}×${s.rate.toFixed(1)}` : Math.round(s.dmg);
  const ndmg = next ? (def.dps ? Math.round(next.dps) : Math.round(next.dmg)) : null;
  const eff = Math.round(game.towerEff(t) * 100);
  setHTML($('tm-stats'), `<span>${IC('damage')} ${dmg}${ndmg ? `<em>→${ndmg}</em>` : ''}</span><span>${IC('range')} ${s.range.toFixed(1)}</span><span>${IC('kills')} ${t.kills}${t.rank ? ` <em class="rank">${IC('star').repeat(t.rank)}</em>` : ''}</span>`
    + (eff < 99 ? `<span class="tm-eff ${eff < 70 ? 'bad' : ''}">${IC('wrench')} Kampfkraft ${eff} %</span>` : ''));
  const up = $('tm-upgrade');
  up.disabled = maxed || game.credits < cost || !!t.upgrading;
  setElText(up, t.upgrading ? `⏳ ${prog} %` : maxed ? (t.spec ? '◆ MAX' : 'MAX') : `▲ ${cost} · ${Math.round(UPGRADE_TIME[t.level] * (1 - 0.12 * Math.round(game.perk.repair / 0.35)))} s`);
  up.classList.toggle('hidden', !!choose);
  const rp = $('tm-repair');
  rp.classList.toggle('hidden', rc <= 0 && !t.repairing);
  setHTML(rp, t.repairing ? `${IC('wrench')} ${Math.floor(t.repairing.t / t.repairing.dur * 100)} %` : `${IC('wrench')} ${rc}`);
  rp.disabled = !!t.repairing || game.credits < rc;
  const ra = repairAllCost(), others = game.towers.filter(o => o !== t && game.repairCost(o) > 0).length;
  $('tm-repair-all').classList.toggle('hidden', !others);
  setHTML($('tm-repair-all'), `${IC('wrench')} ALLE ${ra}`);
  setHTML($('tm-mode'), `${IC('target')} ${MODES[t.mode]}`);
  $('tm-mode').classList.toggle('hidden', !!def.static && def.kind !== 'emp');
  setHTML($('tm-sell'), `${IC('sell')} +${game.sellValue(t)}`);
}
// only touch the DOM when the content really changed: iOS Safari drops a tap when the element under the
// finger is replaced while the finger is down (the menu re-renders all the time while the tower takes hits)
function setHTML(el, html) { if (el._html !== html) { el._html = html; el.innerHTML = html; } }
function setElText(el, txt) { if (el._html !== txt) { el._html = txt; el.textContent = txt; } }
$('tm-upgrade').onclick = (e) => { e.stopPropagation(); if (ui.selected && !ui.selected.kind && game.upgrade(ui.selected)) updateTowerMenu(true); };
// specialization: act on lifting the finger (pointerup) - more robust on iPhones than waiting for the
// click; the click that follows (or a click from a mouse/keyboard) is only a fallback
let specDown = null, specDone = 0;
function chooseSpec(id, viaPointer) {
  specDone = performance.now();
  // the menu changes under the finger: the click that follows must not hit e.g. the sell button now there
  if (viaPointer) ghostUntil = specDone + 700;
  if (ui.selected && game.specialize(ui.selected, id)) updateTowerMenu(true);
}
$('tm-specs').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-spec]');
  specDown = b ? { id: b.dataset.spec, x: e.clientX, y: e.clientY } : null;
});
$('tm-specs').addEventListener('pointerup', (e) => {
  const d = specDown; specDown = null;
  if (!d || holdSuppress || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 20) return;
  const el = document.elementFromPoint(e.clientX, e.clientY), b = el && el.closest('[data-spec]');
  if (b && b.dataset.spec === d.id) chooseSpec(d.id, true);
});
$('tm-specs').addEventListener('pointercancel', () => { specDown = null; });
$('tm-specs').onclick = (e) => {
  e.stopPropagation();
  const b = e.target.closest('[data-spec]');
  if (b && performance.now() - specDone > 700) chooseSpec(b.dataset.spec);
};
function repairAllCost() { return game ? game.towers.reduce((a, o) => a + game.repairCost(o), 0) : 0; }
$('tm-repair-all').onclick = (e) => { e.stopPropagation(); if (game) { const n = game.repairAll(); if (n) toast(`${n} Türme werden repariert`, '', 1500); updateTowerMenu(true); } };
$('tm-repair').onclick = (e) => {
  e.stopPropagation();
  const t = ui.selected; if (!t) return;
  if (t.kind === 'barricade' ? game.repairBarricade(t) : game.repair(t)) updateTowerMenu(true);
};
$('tm-mode').onclick = (e) => {
  e.stopPropagation();
  const t = ui.selected; if (!t) return;
  const order = ['first', 'strong', 'near'];
  t.mode = order[(order.indexOf(t.mode) + 1) % order.length];
  t.target = null;
  sfx('click'); updateTowerMenu(true);
};
$('tm-sell').onclick = (e) => {
  e.stopPropagation();
  const t = ui.selected; if (!t) return;
  if (t.kind === 'barricade') game.sellBarricade(t); else game.sell(t);
  closeTowerMenu();
};

function positionMenus() {
  if (!game) return;
  const pad = 8;
  if (ui.selected) {
    const t = ui.selected;
    const p = renderer.worldToScreen(t.wx, t.wy - 40);
    const m = $('towermenu');
    const mw = m.offsetWidth || 210, mh = m.offsetHeight || 120;
    const gap = 60 * Math.max(0.5, renderer.cam.zoom) + 8;
    // beside the tower: right if there is room, otherwise left
    let x = p.x + gap;
    if (x + mw > window.innerWidth - pad) x = p.x - gap - mw;
    let y = p.y - mh / 2;
    x = Math.max(pad, Math.min(window.innerWidth - mw - pad, x));
    y = Math.max(52, Math.min(window.innerHeight - mh - pad, y));
    m.style.transform = `translate(${x}px, ${y}px)`;
  }
}

// ---------------- icons (OpenArt set) ----------------
const IC = (n) => `<i class="ic ic-${n}"></i>`;
function installIconCss() {
  const m = Assets.ui && Assets.ui.meta;
  if (!m) return;
  const rows = Math.ceil(m.names.length / m.cols);
  let css = `.ic{background-size:${m.cols * 100}% ${rows * 100}%}`;
  m.names.forEach((n, i) => { css += `.ic-${n}{background-position:${(i % m.cols) / (m.cols - 1) * 100}% ${Math.floor(i / m.cols) / (rows - 1) * 100}%}`; });
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}

// ---------------- enemy intel ----------------
const enemyIcons = {};
function enemyIcon(type) {
  if (enemyIcons[type]) return enemyIcons[type];
  const def = ENEMIES[type], m = Models.meta(def.model);
  if (!m) return '';
  const c = document.createElement('canvas');
  c.width = 132; c.height = 132;
  const g = c.getContext('2d');
  const sc = Math.min(116 / m.h, 124 / m.w);
  let f = Models.frameFor(def.model, Math.PI / 4 - 0.25);
  if (m.af) f = f * m.af + 2;
  const x = 66 - (m.w / 2 - m.ax) * sc, y = 66 + (m.h / 2 - (m.h - m.ay)) * sc;
  g.drawImage(m.img, (f % m.cols) * m.w, Math.floor(f / m.cols) * m.h, m.w, m.h, x - m.ax * sc, y - m.ay * sc, m.w * sc, m.h * sc);
  return (enemyIcons[type] = c.toDataURL('image/png'));
}
const SPEED_WORD = (v) => v < 0.6 ? 'langsam' : v < 1.0 ? 'mittel' : v < 1.5 ? 'schnell' : 'sehr schnell';
function intelHTML(type) {
  const def = ENEMIES[type];
  const lv = game ? game.level.power : 1, wv = game ? Math.max(1, game.wave) : 1;
  const hp = Math.round(def.hp * hpMultiplier(lv, wv) / 10) * 10;
  const ab = [];
  if (def.air) ab.push(`${IC('wave')}Fliegt – nur Türme mit Luftabwehr können sie treffen`);
  if (def.cloak) ab.push(`${IC('lock')}Getarnt – nur EMP-Türme decken ihn auf, Flächenschaden trifft trotzdem`);
  if (def.shield) ab.push(`${IC('lives')}Energieschild (${def.shield}) – EMP ×4, Plasma ×2 gegen den Schild`);
  if (def.project) ab.push(`${IC('lives')}Lädt die Schilde aller Maschinen im Umkreis auf`);
  if (def.heal) ab.push(`${IC('repair')}Repariert Maschinen im Umkreis`);
  if (def.dive) ab.push(`${IC('damage')}Stürzt sich auf Türme und explodiert`);
  if (def.bomb) ab.push(`${IC('damage')}Wirft Bombenteppiche auf Türme unter sich`);
  if (def.spawns) ab.push(`${IC('swarm')}Setzt laufend ${ENEMIES[def.spawns.type].name}n aus`);
  if (def.burst) ab.push(`${IC('swarm')}Zerplatzt beim Tod in ${def.burst.count} ${ENEMIES[def.burst.type].name}n`);
  if (def.atk) ab.push(`${IC('target')}Beschießt Türme (Reichweite ${String(def.atk.range).replace('.', ',')})`);
  if (def.scrap) ab.push(`${IC('swarm')}Sammelt Wracks im Umkreis: alle ${def.scrap.need} Abschüsse baut er ${def.scrap.count} Späher-Spinnen und repariert sich`);
  if (def.climb) ab.push(`${IC('fast')}Klettert über Barrikaden, statt einen Umweg zu nehmen`);
  if (def.burrow) ab.push(`${IC('lock')}Gräbt sich alle ${def.burrow.every} s für ${String(def.burrow.dur).replace('.', ',')} s ein: schneller, für Türme unerreichbar (Spezialwaffen treffen) – untertunnelt Barrikaden`);
  if (def.frostImmune) ab.push(`${IC('frost')}Lässt sich nicht einfrieren, Kryo wirkt kaum`);
  if (def.thaw) ab.push(`${IC('frost')}Taut eingefrorene Maschinen in seiner Nähe auf`);
  if (def.burnImmune) ab.push(`${IC('damage')}Hitzefest: brennt nicht, Flammenwerfer machen kaum Schaden`);
  if (def.heat) ab.push(`${IC('damage')}Seine Hitze beschädigt Türme in ${String(def.heat.range).replace('.', ',')} Feldern Abstand`);
  if (def.ram) ab.push(`${IC('damage')}Nimmt den direkten Weg und zerlegt Barrikaden in Sekunden`);
  if (def.biome) ab.push(`${IC('target')}Kommt nur hier vor: ${BIOMES[def.biome].name}`);
  if (def.boss) ab.push(`${IC('skull')}Boss – durchbricht er die Linie, kostet das viele Leben`);
  const unlocked = TOWER_ORDER.filter(k => !game || game.unlocked(k));
  const num = (v) => String(v).replace('.', ',');
  const vs = unlocked.map(k => {
    const m = effectOf(k, type);
    // shield breakers: EMP x4 / plasma x2 against energy shields
    const sh = def.shield && m ? ({ emp: 4, plasma: 2 })[k] : 0;
    return { k, m, sh, rank: sh ? Math.max(m, 1.2 + sh / 10) : m };
  });
  const chip = (o) => `<span class="vs-t"><img src="${icons[o.k] || ''}" alt=""><b>${TOWERS[o.k].name}</b><i>${!o.m ? 'trifft nicht' : o.sh ? (o.m !== 1 ? '×' + num(o.m) + ' · ' : '') + 'Schild ×' + o.sh : '×' + num(o.m)}</i></span>`;
  const good = vs.filter(o => o.rank >= 1.2).sort((a, b) => b.rank - a.rank);
  const bad = vs.filter(o => o.m <= 0.6).sort((a, b) => a.m - b.m);
  return `<div class="intel">
    <img class="intel-img" src="${enemyIcon(type)}" alt="">
    <div class="intel-body">
      <div class="intel-name">${def.name} <span class="cls cls-${def.cls}">${CLASS_NAME[def.cls]}</span></div>
      <div class="intel-desc">${def.info}</div>
      <div class="intel-stats"><span>${IC('heart')} ${hp}</span><span>${IC('armor')} ${def.armor}</span><span>${IC('fast')} ${SPEED_WORD(def.speed)}</span><span>${IC('reward')} +${def.reward}</span></div>
    </div>
  </div>
  ${ab.length ? `<ul class="intel-abil">${ab.map(a => `<li>${a}</li>`).join('')}</ul>` : ''}
  <div class="intel-vs">
    ${good.length ? `<div class="vs-row good"><div class="vs-h">EFFEKTIV</div>${good.map(chip).join('')}</div>` : ''}
    ${bad.length ? `<div class="vs-row bad"><div class="vs-h">SCHWACH</div>${bad.map(chip).join('')}</div>` : ''}
  </div>`;
}
// queue of intel cards; the game pauses while one is open
const intelQueue = [];
let intelOpen = false;
function showIntel(type, fresh, onClose) {
  intelQueue.push({ type, fresh, onClose });
  if (!intelOpen) nextIntel();
}
async function nextIntel() {
  const it = intelQueue.shift();
  if (!it) { intelOpen = false; return; }
  intelOpen = true;
  await Assets.loadModel(ENEMIES[it.type].model);
  const wasPaused = paused;
  paused = true;
  sfx(it.fresh ? 'alarm' : 'click');
  modal(it.fresh ? 'NEUE BEDROHUNG' : 'FEINDAUFKLÄRUNG', it.fresh ? 'warn intel-title' : 'intel-title', intelHTML(it.type), 0, [
    [it.fresh ? 'VERSTANDEN' : 'OK', 'primary', () => {
      closeModal();
      paused = intelQueue.length ? true : (it.fresh ? false : wasPaused);
      if (it.onClose) it.onClose();
      nextIntel();
    }],
  ]);
  $('modal').classList.add('intel-modal');
}
function enemyAt(p) {
  let best = null, bd = Math.max(26, 44 * renderer.cam.zoom);
  for (const e of game.enemies) {
    if (!e.alive) continue;
    const s = renderer.worldToScreen(e.wx, game.bodyY(e));
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function openCatalog() {
  const seen = Object.keys(ENEMIES).filter(k => save.data.intel && save.data.intel[k]);
  Assets.loadModels(seen.map(k => ENEMIES[k].model)).then(() => {
    modal('FEINDKATALOG', 'intel-title', seen.length
      ? `<div class="catalog">${seen.map(k => `<button class="cat-item" data-k="${k}"><img src="${enemyIcon(k)}" alt=""><span>${ENEMIES[k].name}</span><i class="cls cls-${ENEMIES[k].cls}">${CLASS_NAME[ENEMIES[k].cls]}</i></button>`).join('')}</div>`
      : 'Noch keine Gegner aufgeklärt.', 0, [['ZURÜCK', 'primary', () => openPause()]]);
    $('modal').classList.add('intel-modal');
    for (const b of document.querySelectorAll('.cat-item')) b.onclick = () => { sfx('click'); closeModal(); showIntel(b.dataset.k, false, () => openCatalog()); };
  });
}

// ---------------- map interaction ----------------
function onTap(p) {
  unlockAudio();
  if (replay || performance.now() - holdFired < 900) return;
  if (!game || paused || game.state === 'won' || game.state === 'lost') return;
  if (ui.arsenalOpen) { closeArsenal(); return; }
  if (ui.targeting && AIM[ui.targeting].global) return;
  if (ui.targeting) {
    const g = aimAt(p);
    // mouse: the reticle already follows the cursor, a click fires. Touch: a tap moves the reticle,
    // a second tap on it (or the AUSLÖSEN button) fires.
    if (p.type === 'mouse') { ui.aim = g; fireAim(); return; }
    const sp = aimScreen();
    if (sp && Math.hypot(sp.x - p.x, sp.y - p.y) < 30) { fireAim(); return; }
    ui.aim = g; sfx('click');
    return;
  }
  // power-up crates take priority: tap to activate
  for (const d of game.drops) {
    const sp = renderer.worldToScreen(d.wx, d.wy - 46);
    if (Math.hypot(sp.x - p.x, sp.y - p.y) < Math.max(34, 52 * renderer.cam.zoom)) { game.collect(d); return; }
  }
  // boss marker at the screen edge: look at the boss
  for (const m of renderer.bossMarks || []) if (Math.hypot(m.x - p.x, m.y - p.y) < 44) { closeBuildMenu(); closeTowerMenu(); lookAtBoss(m.e); return; }
  const c = renderer.screenToCell(p.x, p.y);
  const inMap = c.x >= 0 && c.y >= 0 && c.x < game.N && c.y < game.N;
  const t = inMap ? game.towerAt(c.x, c.y) || game.barricadeAt(c.x, c.y) : null;
  if (t) { if (ui.selected === t) closeTowerMenu(); else openTowerMenu(t); return; }
  // free ground: towers; road: a barricade
  const spot = inMap && (game.canBuild(c.x, c.y) || game.canBarricade(c.x, c.y));
  if (ui.buildCell && spot && (c.x !== ui.buildCell.x || c.y !== ui.buildCell.y)) {
    const keep = ui.previewType, road = game.canBarricade(c.x, c.y);
    openBuildMenu(c.x, c.y);
    if (keep && (keep === 'barricade') === road) chooseTower(keep);
    return;
  }
  if (ui.buildCell || ui.selected) { closeBuildMenu(); closeTowerMenu(); return; }
  if (spot) openBuildMenu(c.x, c.y);
}
// ---------------- long press: hold 5 s for a detailed explanation ----------------
// (a ring fills around the finger; a normal tap never opens these, so nothing pops up by accident)
const HOLD_MS = 5000, HOLD_SHOW = 300;
let hold = null, holdFired = 0;
function holdStart(x, y, fn) { holdCancel(); hold = { x, y, t0: performance.now(), fn }; }
function holdCancel() { if (!hold) return; hold = null; $('hold-ring').classList.add('hidden'); }
function updateHold() {
  if (!hold) return;
  const dt = performance.now() - hold.t0, el = $('hold-ring');
  if (dt < HOLD_SHOW) return;
  el.classList.remove('hidden');
  el.style.left = hold.x + 'px'; el.style.top = hold.y + 'px';
  el.style.setProperty('--p', Math.min(1, (dt - HOLD_SHOW) / (HOLD_MS - HOLD_SHOW)).toFixed(3));
  if (dt >= HOLD_MS) {
    const fn = hold.fn;
    holdCancel(); holdFired = performance.now(); holdSuppress = true;
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { /* ignore */ }
    fn();
  }
}
// the click that ends a long press must not also trigger the button (however long the finger stays down)
let holdSuppress = false, ghostUntil = 0;
document.addEventListener('pointerup', () => { if (holdSuppress) setTimeout(() => { holdSuppress = false; }, 60); }, true);
document.addEventListener('click', (e) => { if (holdSuppress || performance.now() - holdFired < 300 || performance.now() < ghostUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener('contextmenu', (e) => { if (game) e.preventDefault(); });
function attachHold(el, fn) {
  el.addEventListener('pointerdown', () => { const r = el.getBoundingClientRect(); holdStart(r.left + r.width / 2, r.top + r.height / 2, fn); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, holdCancel);
}
// explanation card; the game pauses while it is open
function infoModal(title, html) {
  const wasPaused = paused;
  paused = true;
  sfx('click');
  modal(title, 'intel-title', html, 0, [['OK', 'primary', () => { closeModal(); paused = wasPaused; }]]);
  $('modal').classList.add('intel-modal');
}
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
const TOWER_TIPS = {
  gatling: ['Sehr hohe Feuerrate – ideal gegen Schwärme leichter Einheiten und Drohnen.', 'Panzerung wird von jedem einzelnen Treffer abgezogen: gegen Panzer und Bosse kaum Wirkung.'],
  missile: ['Zielsuchende Raketen mit Flächenschaden – trifft auch dicht gedrängte Gruppen.', 'Stark gegen Luftziele (×1,8).', `Zerschmettert gefrorene Gegner (×${num(SHATTER.mul)}).`],
  plasma: ['Ignoriert Panzerung vollständig – die Waffe gegen Panzer und Bosse.', 'Zerreißt Energieschilde doppelt so schnell.', 'Trifft keine Luftziele.'],
  emp: ['Kettenblitz springt auf mehrere Ziele und verlangsamt sie.', 'Reißt Energieschilde ein (×4).', 'Deckt getarnte Infiltratoren in seiner Reichweite auf.'],
  flak: ['Reine Flugabwehr: Splitterwolken zerfetzen Drohnen, Bomber und Mutterschiffe.', 'Trifft keine Bodenziele.'],
  flame: ['Trifft alles im Flammenkegel und setzt Maschinen in Brand.', 'Kurze Reichweite – gehört direkt an die Straße.', 'Feuer auf vereiste Gegner löst einen Thermoschock aus (Bonusschaden).'],
  rail: ['Das Geschoss durchschlägt alles in einer Linie – stelle ihn längs einer Geraden auf.', 'Extreme Reichweite, langsame Feuerrate.', `Zerschmettert gefrorene Gegner (×${num(SHATTER.mul)}).`],
  laser: ['Dauerstrahl, der sich auf demselben Ziel bis zum Dreifachen aufheizt.', 'Ideal gegen einzelne, zähe Gegner und Bosse.'],
  acid: ['Säure zerfrisst die Panzerung (stapelbar) und brennt nach.', 'Hinterlässt Säurepfützen, die nachfolgende Gegner verätzen.', 'Trifft keine Luftziele.'],
  mortar: ['Artillerie mit riesigem Wirkungsradius und großer Reichweite.', `Mindestreichweite ${num(TOWERS.mortar.minRange)} – direkt daneben trifft er nicht.`, `Zerschmettert gefrorene Gegner (×${num(SHATTER.mul)}).`],
  cryo: ['Kältestrahl verlangsamt stark und friert Gegner schließlich ein (Bosse werden nur verlangsamt).', `Gefrorene zerspringen unter Railgun, Mörser und Raketen (×${num(SHATTER.mul)}).`, 'Feuer auf Vereiste löst einen Thermoschock aus.'],
};
function towerInfoHTML(k, t) {
  const def = TOWERS[k], E = EFFECT[k];
  const s1 = towerStats(k, 1), s3 = towerStats(k, MAX_LEVEL);
  const dmg = (s) => def.dps ? `${Math.round(s.dps)}/s` : def.kind === 'hitscan' || def.kind === 'flak' ? `${Math.round(s.dmg)} × ${num(s.rate)}/s` : `${Math.round(s.dmg)}`;
  const grid = [
    ['Schaden', `${dmg(s1)} → <b>${dmg(s3)}</b>`],
    ['Reichweite', `${num(s1.range)} → <b>${num(s3.range)}</b>`],
    !def.dps && def.kind !== 'hitscan' && def.kind !== 'flak' ? ['Feuerrate', `${num(s1.rate, 2)}/s → <b>${num(s3.rate, 2)}/s</b>`] : null,
    s1.splash ? ['Flächenradius', `${num(s1.splash)} → <b>${num(s3.splash)}</b>`] : null,
    ['Ziele', def.ground && def.air ? 'Boden + Luft' : def.air ? 'nur Luft' : 'nur Boden'],
    ['Kosten', `${def.cost} · Upgrades ${[1, 2].map(l => upgradeCost(k, l)).join(' / ')}`],
    ['Haltbarkeit', `${s1.hp} → <b>${s3.hp}</b>`],
  ].filter(Boolean);
  const vs = ['light', 'armored', 'heavy', 'air'].map(c => {
    const m = c === 'air' ? (def.air ? E[c] : 0) : (def.ground ? E[c] : 0);
    return `<span class="${!m ? 'n' : m >= 1.2 ? 'g' : m <= 0.6 ? 'b' : ''}">${CLASS_NAME[c]}: ${m ? '×' + num(m) : 'trifft nicht'}</span>`;
  }).join('');
  const specs = (SPECS[k] || []).map(x => `<li><b>${x.name}</b> – ${x.desc}</li>`).join('');
  let now = '';
  if (t) {
    const sp = t.spec && SPECS[k].find(x => x.id === t.spec);
    now = `<div class="info-now">Dieser Turm: Stufe ${['I', 'II', 'III'][t.level - 1]}${sp ? ` · ◆ ${sp.name}` : ''} · Kampfkraft ${Math.round(game.towerEff(t) * 100)} % · ${t.kills} Abschüsse${t.rank ? ` · Rang ${'★'.repeat(t.rank)}` : ''}${t.z ? ` · Anhöhe: +${Math.round(game.heightAt(t.cx, t.cy) * ELEV_RANGE * 100)} % Reichweite` : ''}</div>`;
  }
  return `<div class="info-head"><img src="${icons[k] || ''}" alt=""><div><div class="info-name">${def.name}</div><div class="info-sub">${def.desc}</div></div></div>
    <div class="info-grid">${grid.map(([a, b]) => `<span>${a}: ${b}</span>`).join('')}</div>
    <div class="info-sec">WIRKUNG GEGEN</div><div class="info-vs">${vs}</div>
    <div class="info-sec">TAKTIK</div><ul class="info-list">${(TOWER_TIPS[k] || []).map(x => `<li>${x}</li>`).join('')}
      <li>Auf Anhöhen +${Math.round(ELEV_RANGE * 100)} % Reichweite pro Stufe. Beschädigte Türme schießen schwächer – rechtzeitig reparieren.</li></ul>
    ${specs ? `<div class="info-sec">SPEZIALISIERUNG AB STUFE III · ${specCost(k)} CREDITS</div><ul class="info-list">${specs}</ul>` : ''}${now}`;
}
function showTowerInfo(k, t) { infoModal('TURM-DATENBLATT', towerInfoHTML(k, t)); }
function abilityInfoHTML(kind) {
  const g = game;
  if (kind === 'orbital') return `<div class="info-head"><i class="ic ic-orbital"></i><div><div class="info-name">Orbitalschlag</div><div class="info-sub">Satellitengestützter Energiestrahl</div></div></div>
    <ul class="info-list"><li>Knopf antippen, Ziel auf der Karte wählen (Vorschau mit Radius), <b>AUSLÖSEN</b>.</li>
    <li>Nach 1,2 Sekunden schlägt ein Energiestrahl im Radius 1,7 Felder ein – ignoriert jede Panzerung, Flieger erleiden 60 %.</li>
    <li>Volle Wirkung im Zentrum, 60 % am Rand.</li>
    <li>Lädt sich während der Wellen von selbst wieder auf: ${Math.round(g ? g.orbital.max : 85)} Sekunden.</li>
    <li>Tipp: auf dichte Gruppen oder einen Boss mit Eskorte zielen.</li></ul>`;
  if (kind === 'hole') return `<div class="info-head"><i class="ic ic-hole"></i><div><div class="info-name">Schwarzes Loch</div><div class="info-sub">Künstliche Singularität</div></div></div>
    <ul class="info-list"><li>Öffnet sich für ${HOLE.dur} Sekunden im Radius ${num(HOLE.radius)} Felder.</li>
    <li>Saugt alle Maschinen (auch Flieger) in den Wirbel, zerquetscht sie und hält sie fest.</li>
    <li>Bosse werden nicht eingesaugt, aber stark gebremst und beschädigt.</li>
    <li>Am Ende kollabiert das Loch mit einer Druckwelle.</li>
    <li>Wiederaufladung: ${Math.round(g ? g.hole.max : HOLE.cd)} Sekunden (erstes Loch nach ${Math.round(g ? HOLE.first * (g.mods.cd || 1) * (1 - g.perk.cd) : HOLE.first)} s).</li>
    <li>Tipp: an Engstellen oder Kreuzungen mehrerer Pfade setzen.</li></ul>`;
  const cdOf = (W, k) => Math.round(g ? g[k].max : W.cd);
  if (kind === 'ion') return `<div class="info-head"><i class="ic ic-ion"></i><div><div class="info-name">Ionensturm</div><div class="info-sub">EMP-Welle über die ganze Karte</div></div></div>
    <ul class="info-list"><li>Trifft <b>jede</b> Maschine auf der Karte – kein Zielen nötig, nur <b>AUSLÖSEN</b>.</li>
    <li>Nach ${num(ION.charge)} Sekunden Aufladung: alle Maschinen ${ION.stun} Sekunden gelähmt (Bosse ${num(ION.bossStun)} s), sie laufen und schießen nicht.</li>
    <li>Alle Energieschilde brechen zusammen, Hacker verlieren die Verbindung, Getarnte werden sichtbar, Sandwühler tauchen auf.</li>
    <li>Drohnen und Flieger verlieren ${Math.round(ION.airDmg * 100)} % ihrer Lebensenergie – die meisten stürzen ab.</li>
    <li>Wiederaufladung: ${cdOf(ION, 'ion')} Sekunden.</li>
    <li>Tipp: gegen Luftangriffe, Schildträger und als Notbremse vor dem Hauptquartier.</li></ul>`;
  if (kind === 'rod') return `<div class="info-head"><i class="ic ic-rod"></i><div><div class="info-name">Wolframstab</div><div class="info-sub">Kinetischer Schlag aus dem Orbit</div></div></div>
    <ul class="info-list"><li>Ein Satellit wirft einen Wolframstab mit Überschallgeschwindigkeit ab – Einschlag nach ${num(ROD.delay)} Sekunden.</li>
    <li>Gewaltiger Schaden im Kern (${num(ROD.r)} Felder), ${Math.round(ROD.splashMul * 100)} % im Umkreis bis ${num(ROD.splash)} Felder; ignoriert Panzerung.</li>
    <li>Bosse verlieren mindestens ${Math.round(ROD.bossFrac * 100)} % ihrer Lebensenergie.</li>
    <li>Wiederaufladung: ${cdOf(ROD, 'rod')} Sekunden.</li>
    <li>Tipp: der Boss-Killer – genau auf das größte Ziel setzen.</li></ul>`;
  if (kind === 'napalm') return `<div class="info-head"><i class="ic ic-napalm"></i><div><div class="info-name">Napalm-Staffel</div><div class="info-sub">Drei Bomber, ein Feuerteppich</div></div></div>
    <ul class="info-list"><li>Punkt auf einer Straße wählen: die Bomber legen einen Brandteppich ${num(NAPALM.len * 2)} Felder lang <b>entlang der Straße</b>.</li>
    <li>Der Teppich brennt ${NAPALM.burn} Sekunden, setzt Bodentruppen in Brand und ignoriert Panzerung. Flieger bleiben verschont.</li>
    <li>Hitzefeste Maschinen (Magma-Läufer) nehmen kaum Schaden.</li>
    <li>Wiederaufladung: ${cdOf(NAPALM, 'napalm')} Sekunden.</li>
    <li>Tipp: auf lange gerade Straßenstücke, auf denen sich eine Kolonne staut.</li></ul>`;
  const n = g && g.nuke;
  return `<div class="info-head"><i class="ic ic-nuke"></i><div><div class="info-name">Atombombe</div><div class="info-sub">Die letzte Option</div></div></div>
    <ul class="info-list"><li>Lädt sich durch Abschüsse auf (jede Maschine gibt ihre Belohnung als Ladung).</li>
    <li>Nach dem Auslösen heult die Sirene, nach ${num(NUKE.delay)} Sekunden detoniert der Sprengkopf: Blitz, Röntgenbild, Zeitlupe.</li>
    <li>Voller Schaden im Radius ${num(NUKE.radius)} Felder, 40 % bis ${num(NUKE.outer)} Felder. Bosse verlieren ${Math.round(NUKE.bossFrac * 100)} % ihrer Lebensenergie.</li>
    <li><b>Achtung:</b> Eigene Türme im Zentrum (${num(NUKE.towerRadius)} Felder) werden schwer beschädigt.</li>
    <li>Verstrahlung: ${NUKE.radT} Sekunden lang verliert jede Maschine in der Zone ${Math.round(NUKE.radDps * 100)} % ihrer Lebensenergie pro Sekunde und nimmt ${Math.round((NUKE.radVuln - 1) * 100)} % mehr Schaden.</li>
    <li>Danach ist die Abschussrampe beschädigt: Reparatur kostet ${n ? g.nukeRepairCost() : NUKE.repairCost(1, 1)} Credits (jedes Mal 40 % mehr) und dauert ${Math.round(NUKE.repairTime * (g ? (g.mods.cd || 1) * (1 - g.perk.cd) : 1))} Sekunden.</li>
    <li>Eine Atom-Kiste lädt +50 %, startet die Reparatur gratis oder halbiert die Reparaturzeit.</li></ul>`;
}
function showAbilityInfo(kind) { infoModal('SPEZIALWAFFE', abilityInfoHTML(kind)); }
function powerupInfoHTML(type) {
  const p = POWERUPS[type];
  return `<div class="info-head"><i class="ic ic-${p.icon}"></i><div><div class="info-name" style="color:${p.color}">${p.name}</div><div class="info-sub">Power-up-Kiste</div></div></div>
    <div class="info-desc">${p.desc}</div><ul class="info-list"><li>Kisten fallen selten von zerstörten Maschinen, bei Bossen immer.</li><li>Antippen zum Einsammeln – nach ${DROP_LIFE()} Sekunden zerfallen sie.</li></ul>`;
}
const DROP_LIFE = () => Math.round(25 * (1 + (game ? game.perk.drops * 4 / 3 : 0)));
for (const [id, kind] of [['btn-orbital', 'orbital'], ['btn-nuke', 'nuke'], ['btn-hole', 'hole'], ['btn-ion', 'ion'], ['btn-rod', 'rod'], ['btn-napalm', 'napalm']]) attachHold($(id), () => showAbilityInfo(kind));

// ---------------- special weapons: aim preview ----------------
// tapping a weapon icon shows its real area of effect (ghost effect, hit markers, count) before anything happens
const AIM = {
  orbital: { name: 'ORBITALSCHLAG', icon: 'orbital', btn: 'btn-orbital', r: 1.7,
    fire: (a) => game.orbitalStrike(a.x, a.y) && toast('ORBITALSCHLAG EINGELEITET', 'warn', 1400) },
  nuke: { name: 'ATOMSCHLAG', icon: 'nuke', btn: 'btn-nuke', r: NUKE.outer,
    fire: (a) => game.nukeStrike(a.x, a.y) && toast('ATOMSCHLAG EINGELEITET – IN DECKUNG!', 'bad', 2200) },
  hole: { name: 'SCHWARZES LOCH', icon: 'hole', btn: 'btn-hole', r: HOLE.radius,
    fire: (a) => game.holeStrike(a.x, a.y) && toast('SCHWARZES LOCH GEÖFFNET', 'warn', 1600) },
  rod: { name: 'WOLFRAMSTAB', icon: 'rod', btn: 'btn-rod', r: ROD.splash,
    fire: (a) => game.rodStrike(a.x, a.y) && toast('WOLFRAMSTAB AUSGEKLINKT', 'warn', 1400) },
  napalm: { name: 'NAPALM-STAFFEL', icon: 'napalm', btn: 'btn-napalm', r: 1.2,
    fire: (a) => game.napalmStrike(a.x, a.y) && toast('BOMBERSTAFFEL IM ANFLUG', 'warn', 1600) },
  ion: { name: 'IONENSTURM', icon: 'ion', btn: 'btn-ion', r: 0, global: true,
    fire: () => game.ionStrike() && toast('IONENSTURM LÄDT …', 'warn', 1400) },
};
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
function aimAt(p) {
  const w = renderer.screenToWorld(p.x, p.y), g = toGrid(w.x, w.y);
  const N = game.N;
  return { x: Math.max(0, Math.min(N, g.x)), y: Math.max(0, Math.min(N, g.y)) };
}
function aimScreen() {
  if (!ui.aim) return null;
  const w = toWorld(ui.aim.x, ui.aim.y);
  return renderer.worldToScreen(w.x, w.y);
}
function startAim(kind) {
  closeBuildMenu(); closeTowerMenu();
  for (const k in AIM) $(AIM[k].btn).classList.toggle('arming', k === kind);
  ui.targeting = kind;
  // start in the middle of the view (a bit above centre: the bottom is covered by the bar)
  ui.aim = aimAt({ x: window.innerWidth / 2, y: window.innerHeight * 0.45 });
  const A = AIM[kind];
  $('aim-title').innerHTML = `${IC(A.icon)}<span>${A.name}</span>`;
  $('aim-hint').textContent = A.global ? 'Trifft die ganze Karte – AUSLÖSEN drücken' : kind === 'napalm' ? 'Punkt auf einer Straße wählen – der Teppich folgt der Straße'
    : finePointer ? 'Maus bewegen, Klick setzt das Ziel' : 'Karte antippen oder Ziel ziehen';
  closeArsenal();
  const bar = $('aim-bar');
  bar.dataset.kind = kind;
  bar.classList.remove('hidden');
  document.body.classList.add('aiming');
  hudCache['aim-count'] = null;
  updateAim();
}
function endAim() {
  ui.targeting = null; ui.aim = null; ui.aimDrag = null;
  for (const k in AIM) $(AIM[k].btn).classList.remove('arming');
  $('aim-bar').classList.add('hidden');
  document.body.classList.remove('aiming');
}
function fireAim() {
  const k = ui.targeting, a = ui.aim;
  if (!game || paused || !k || !a) return;
  AIM[k].fire(a);
  endAim();
}
function updateAim() {
  if (!ui.targeting) return;
  if (!game || game.state === 'won' || game.state === 'lost') { endAim(); return; }
  const k = ui.targeting, a = ui.aim;
  const r = k === 'nuke' ? NUKE.radius : AIM[k].r;
  let n = game.enemiesInRange(a.x, a.y, r, true, true).length;
  if (k === 'ion') n = game.enemies.filter(e => e.alive).length;
  if (k === 'napalm') { const pts = game.napalmPath(a.x, a.y); n = game.enemies.filter(e => e.alive && !e.air && pts.some(p => (p.gx - e.gx) ** 2 + (p.gy - e.gy) ** 2 <= NAPALM.w * NAPALM.w * 2.2)).length; }
  let html = n ? `<b>${n}</b> Gegner im Wirkungsbereich` : 'Keine Gegner im Wirkungsbereich';
  if (k === 'ion') { const air = game.enemies.filter(e => e.alive && e.air && !e.def.boss).length; html += ` · ${ION.stun} s gelähmt${air ? ` · ${air} Flieger stürzen ab` : ''}`; }
  if (k === 'napalm') html += ` · brennt ${NAPALM.burn} s entlang der Straße`;
  if (k === 'rod') html += ' · Boss-Killer: mind. 40 % beim Boss';
  if (k === 'nuke') {
    const own = game.towers.filter(t => Math.hypot(t.gx - a.x, t.gy - a.y) <= NUKE.towerRadius).length;
    if (own) html += ` · <em>${own} eigene${own === 1 ? 'r Turm' : ' Türme'} beschädigt</em>`;
  }
  if (k === 'hole') html += ' · zieht 10 s lang alles ein';
  if (k === 'nuke') html += ` · verstrahlt ${NUKE.radT} s · danach Reparatur ${game.nukeRepairCost()} Credits`;
  if (hudCache['aim-count'] !== html) { hudCache['aim-count'] = html; $('aim-count').innerHTML = html; }
}
$('aim-fire').onclick = () => { unlockAudio(); fireAim(); };
$('aim-cancel').onclick = () => { endAim(); sfx('click'); };

// what a long press on the map explains (null = nothing there, no ring)
function holdTarget(p) {
  if (!game || paused || ui.targeting || replay) return null;
  for (const d of game.drops) {
    const sp = renderer.worldToScreen(d.wx, d.wy - 46);
    if (Math.hypot(sp.x - p.x, sp.y - p.y) < Math.max(34, 52 * renderer.cam.zoom)) return () => infoModal('POWER-UP', powerupInfoHTML(d.type));
  }
  const c = renderer.screenToCell(p.x, p.y);
  const t = game.towerAt(c.x, c.y);
  if (t) return () => { closeTowerMenu(); showTowerInfo(t.type, t); };
  const e = enemyAt(p);
  if (e) return () => { closeBuildMenu(); closeTowerMenu(); showIntel(e.type, false); };
  return null;
}
const input = new Input(canvas, renderer, {
  tap: onTap,
  holdStart: (p) => { const fn = holdTarget(p); if (fn) holdStart(p.x, p.y, fn); },
  holdCancel,
  // desktop: the reticle follows the mouse
  hover: (p) => { if (game && ui.targeting && p) ui.aim = aimAt(p); },
  // touch: dragging that starts on the reticle moves it (anywhere else still pans the camera)
  dragStart: (p) => {
    if (!game || !ui.targeting || paused || AIM[ui.targeting].global) return false;
    const sp = aimScreen(), z = renderer.cam.zoom, r = AIM[ui.targeting].r;
    const rx = Math.max(56, r * 64 * Math.SQRT2 * z), ry = Math.max(40, r * 32 * Math.SQRT2 * z);
    if (((p.x - sp.x) / rx) ** 2 + ((p.y - sp.y) / ry) ** 2 > 1) return false;
    ui.aimDrag = { dx: sp.x - p.x, dy: sp.y - p.y };
    return true;
  },
  drag: (p) => { if (game && ui.targeting && ui.aimDrag) ui.aim = aimAt({ x: p.x + ui.aimDrag.dx, y: p.y + ui.aimDrag.dy }); },
  dragEnd: () => { ui.aimDrag = null; },
});

$('btn-orbital').onclick = () => {
  if (!game || paused || !game.orbital.on) return;
  unlockAudio();
  if (ui.targeting === 'orbital') { endAim(); sfx('click'); return; }
  if (game.orbital.cd > 0) { sfx('error'); toast(`Orbitalschlag lädt noch ${Math.ceil(game.orbital.cd)} s`, 'bad', 1400); return; }
  startAim('orbital');
  sfx('click');
};
$('btn-nuke').onclick = () => {
  if (!game || paused || !game.nuke.on) return;
  unlockAudio();
  if (ui.targeting === 'nuke') { endAim(); sfx('click'); return; }
  const n = game.nuke;
  if (n.state === 'repair') { sfx('error'); toast(`Abschussrampe wird repariert – noch ${Math.ceil(n.repairDur - n.repairT)} s`, 'bad', 1800); return; }
  if (n.state === 'broken') {
    // two taps: announce the price, then pay
    const c = game.nukeRepairCost();
    if (performance.now() - (ui.nukeRepairAsk || 0) < 3500) {
      ui.nukeRepairAsk = 0;
      if (game.repairNuke()) toast(`Reparatur gestartet – ${Math.round(n.repairDur)} s`, '', 2000);
      return;
    }
    ui.nukeRepairAsk = performance.now();
    sfx('click');
    toast(game.credits >= c ? `Abschussrampe reparieren für ${c} Credits? Nochmal tippen` : `Reparatur kostet ${c} Credits – noch ${c - game.credits} fehlen`, game.credits >= c ? 'warn' : 'bad', 3000);
    return;
  }
  if (!game.nukeReady()) { sfx('error'); toast(`Atombombe lädt: ${Math.floor(game.nuke.charge / game.nuke.need * 100)} % – Abschüsse laden sie auf`, 'bad', 1800); return; }
  startAim('nuke');
  sfx('alarm');
};
$('btn-hole').onclick = () => {
  if (!game || paused || !game.hole.on) return;
  unlockAudio();
  if (ui.targeting === 'hole') { endAim(); sfx('click'); return; }
  if (game.hole.cd > 0) { sfx('error'); toast(`Schwarzes Loch lädt noch ${Math.ceil(game.hole.cd)} s`, 'bad', 1400); return; }
  startAim('hole');
  sfx('click');
};
// the newer cooldown weapons share one handler
for (const [kind, label] of [['ion', 'Ionensturm'], ['rod', 'Wolframstab'], ['napalm', 'Napalm-Staffel']]) {
  $('btn-' + kind).onclick = () => {
    const W = game && game[kind];
    if (!W || paused || !W.on) return;
    unlockAudio();
    if (ui.targeting === kind) { endAim(); sfx('click'); return; }
    if (kind === 'ion' && game.ionCharge > 0) return;
    if (W.cd > 0) { sfx('error'); toast(`${label} lädt noch ${Math.ceil(W.cd)} s`, 'bad', 1400); return; }
    startAim(kind);
    sfx('click');
  };
}
function updateCdWeapon(kind) {
  const b = $('btn-' + kind), W = game[kind];
  b.classList.toggle('hidden', !W.on);
  if (!W.on) return;
  const ready = W.cd <= 0 && !(kind === 'ion' && game.ionCharge > 0);
  b.style.setProperty('--p', (1 - W.cd / W.max).toFixed(3));
  b.classList.toggle('ready', ready && ui.targeting !== kind);
  setText(kind + '-cd', ui.targeting === kind ? 'ZIEL' : ready ? 'BEREIT' : `${Math.ceil(W.cd)} s`);
}
// ---- arsenal: all special weapons behind one button ----
const WEAPONS = ['orbital', 'rod', 'napalm', 'ion', 'hole', 'nuke'];
function weaponReady(k) {
  const W = game[k];
  if (!W || !W.on) return false;
  if (k === 'nuke') return game.nukeReady();
  if (k === 'ion' && game.ionCharge > 0) return false;
  return W.cd <= 0;
}
function weaponProgress(k) {
  const W = game[k];
  if (k === 'nuke') return W.state ? 0 : W.charge / W.need;
  return 1 - W.cd / W.max;
}
function openArsenal() {
  closeBuildMenu(); closeTowerMenu();
  ui.arsenalOpen = true;
  $('arsenal').classList.remove('hidden');
  $('btn-arsenal').classList.add('open');
  sfx('click');
}
function closeArsenal() {
  if (!ui.arsenalOpen) return;
  ui.arsenalOpen = false;
  $('arsenal').classList.add('hidden');
  $('btn-arsenal').classList.remove('open');
}
$('btn-arsenal').onclick = (e) => {
  e.stopPropagation();
  if (!game || paused) return;
  unlockAudio();
  if (ui.targeting) { endAim(); sfx('click'); return; }
  if (ui.arsenalOpen) { closeArsenal(); sfx('click'); } else openArsenal();
};
function updateArsenal() {
  const avail = WEAPONS.filter(k => game[k] && game[k].on);
  const b = $('btn-arsenal');
  b.classList.toggle('hidden', !avail.length);
  if (!avail.length) { closeArsenal(); return; }
  const ready = avail.filter(weaponReady).length;
  const best = Math.max(...avail.map(weaponProgress));
  b.style.setProperty('--p', Math.min(1, best).toFixed(3));
  b.classList.toggle('ready', ready > 0 && !ui.targeting);
  b.classList.toggle('arming', !!ui.targeting);
  setText('arsenal-cd', ui.targeting ? 'ABBRUCH' : ui.arsenalOpen ? 'ZU' : ready ? `${ready} BEREIT` : 'WAFFEN');
}
function updateHole() {
  const b = $('btn-hole'), o = game.hole;
  b.classList.toggle('hidden', !o.on);
  if (!o.on) return;
  const ready = o.cd <= 0;
  b.style.setProperty('--p', (1 - o.cd / o.max).toFixed(3));
  b.classList.toggle('ready', ready && ui.targeting !== 'hole');
  setText('hole-cd', ui.targeting === 'hole' ? 'ZIEL' : ready ? 'BEREIT' : `${Math.ceil(o.cd)} s`);
}
function updateNuke() {
  const b = $('btn-nuke'), n = game.nuke;
  b.classList.toggle('hidden', !n.on);
  if (!n.on) return;
  const ready = game.nukeReady();
  const st = n.state;
  b.style.setProperty('--p', st === 'broken' ? 0 : st === 'repair' ? (n.repairT / n.repairDur).toFixed(3) : (n.charge / n.need).toFixed(3));
  b.classList.toggle('ready', ready && ui.targeting !== 'nuke');
  b.classList.toggle('spent', st === 'broken');
  b.classList.toggle('repairing', st === 'repair');
  b.classList.toggle('affordable', st === 'broken' && game.credits >= game.nukeRepairCost());
  setText('nuke-cd', ui.targeting === 'nuke' ? 'ZIEL' : st === 'broken' ? `🔧 ${game.nukeRepairCost()}` : st === 'repair' ? `🔧 ${Math.ceil(n.repairDur - n.repairT)} s` : ready ? 'BEREIT' : `${Math.floor(n.charge / n.need * 100)} %`);
}
function updateBuffs() {
  const wt = game.weather, W = wt && WEATHER[wt.type];
  const html = (W ? `<span class="buff weather" style="--bc:${W.color}">${IC(W.icon)} ${W.name} ${Math.ceil(wt.dur - wt.t)}s</span>` : '') + Object.entries(game.buffs).filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="buff" style="--bc:${POWERUPS[k].color}">${IC(POWERUPS[k].icon)} ${POWERUPS[k].name} ${Math.ceil(v)}s</span>`).join('');
  if (hudCache.buffs !== html) { hudCache.buffs = html; $('buffs').innerHTML = html; }
}
function showBanner(icon, name, desc, color) {
  const b = $('pu-banner');
  $('pu-icon').innerHTML = IC(icon); $('pu-name').textContent = name; $('pu-desc').textContent = desc;
  b.style.setProperty('--pc', color);
  b.classList.remove('hidden', 'show'); void b.offsetWidth; b.classList.add('show');
}
// a boss arrives: banner + the camera glides over to it and back (cancelled as soon as you touch the map)
let camTween = null;
function bossIntro(e) {
  showBanner('skull', e.def.name.toUpperCase(), (e.def.air ? 'Fliegende Festung im Anflug' : 'Boss-Einheit im Anmarsch') + ' – roter Pfeil am Rand antippen', '#ff5a3c');
}
// camera glides to the boss and stays with it a moment (tap on the boss marker at the screen edge)
function lookAtBoss(e) {
  const c = renderer.cam;
  camTween = { e, from: { x: c.x, y: c.y, z: c.zoom }, toZ: Math.min(renderer.maxZoom, Math.max(c.zoom, 0.95)), t: 0, stay: true };
  sfx('click');
}
function updateCamTween(dt) {
  const tw = camTween;
  if (!tw) return;
  if (input.pointers.size || !tw.e.alive) { camTween = null; return; }
  tw.t += dt;
  const c = renderer.cam, ease = (u) => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  const to = { x: tw.e.wx, y: tw.e.wy - (tw.e.air ? 160 : 130) };
  let k;
  if (tw.t < 0.8) k = ease(tw.t / 0.8);
  else if (tw.stay) { camTween = null; return; }
  else if (tw.t < 2.4) k = 1;
  else if (tw.t < 3.2) k = 1 - ease((tw.t - 2.4) / 0.8);
  else { camTween = null; return; }
  c.zoom = tw.from.z + (tw.toZ - tw.from.z) * k;
  c.x = tw.from.x + (to.x - tw.from.x) * k; c.y = tw.from.y + (to.y - tw.from.y) * k;
  renderer.clampCam();
}
// nuclear strike: frame ground zero so the whole mushroom cloud is on screen and the HUD is out of the way
// (like the replay); afterwards the camera glides back. Touching the map ends it right away.
let nukeCam = null;
const easeIO = (u) => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
function blastFrame(gx, gy) {
  const w = toWorld(gx, gy), r = renderer;
  const top = w.y - 700, bot = w.y + 190;   // mushroom cloud top .. blast rings at the ground
  const z = Math.max(0.2, Math.min(0.95, (r.vh - 24) / (bot - top), (r.vw - 24) / 950));
  return { x: w.x, y: (top + bot) / 2, z };
}
function setCam(v) { const c = renderer.cam; c.x = v.x; c.y = v.y; c.zoom = v.z; }
function startNukeCam(gx, gy) {
  if (gx == null) return;
  const c = renderer.cam;
  camTween = null;
  nukeCam = { from: nukeCam ? nukeCam.from : { x: c.x, y: c.y, z: c.zoom }, to: blastFrame(gx, gy), t: 0 };
  setCam(nukeCam.to);   // the switch happens under the white flash
  document.body.classList.add('nukecine');
}
const NUKE_CAM_HOLD = NUKE.cine.freeze + 4.4, NUKE_CAM_BACK = 1.2;
function updateNukeCam(dt) {
  const nc = nukeCam;
  if (!nc) return;
  nc.t += dt;
  if (input.pointers.size && nc.t > 0.3) { endNukeCam(false); return; }
  if (nc.t < NUKE_CAM_HOLD) return;
  const u = Math.min(1, (nc.t - NUKE_CAM_HOLD) / NUKE_CAM_BACK), k = easeIO(u);
  setCam({ x: nc.to.x + (nc.from.x - nc.to.x) * k, y: nc.to.y + (nc.from.y - nc.to.y) * k, z: nc.to.z + (nc.from.z - nc.to.z) * k });
  if (u >= 1) endNukeCam(false);
}
function endNukeCam(restore) {
  if (!nukeCam) return;
  if (restore) setCam(nukeCam.from);
  nukeCam = null;
  document.body.classList.remove('nukecine');
  renderer.clampCam();
}
function updateBossBar() {
  let b = null;
  for (const e of game.enemies) if (e.alive && e.def.boss && (!b || e.hp / e.maxHp < b.hp / b.maxHp)) b = e;
  const on = !!b;
  if (hudCache.bossOn !== on) { hudCache.bossOn = on; $('boss-bar').classList.toggle('hidden', !on); document.body.classList.toggle('boss', on); }
  if (!b) return;
  const n = game.enemies.filter(e => e.alive && e.def.boss).length;
  setText('bb-name', b.def.name.toUpperCase() + (n > 1 ? ` ×${n}` : ''));
  setText('bb-phase', b.phase === 3 ? 'ÜBERLADUNG' : b.phase === 2 ? 'WUTPHASE' : '');
  const bar = $('boss-bar');
  bar.classList.toggle('p2', b.phase === 2); bar.classList.toggle('p3', b.phase === 3);
  const w = (Math.max(0, b.hp / b.maxHp) * 100).toFixed(1) + '%';
  if (hudCache.bbFill !== w) { hudCache.bbFill = w; $('bb-fill').style.width = w; }
  const sw = (b.maxShield ? Math.max(0, b.shield / b.maxHp) * 100 : 0).toFixed(1) + '%';
  if (hudCache.bbShield !== sw) { hudCache.bbShield = sw; $('bb-shield').style.width = sw; }
}
function showPowerBanner(type) {
  const p = POWERUPS[type], b = $('pu-banner');
  $('pu-icon').innerHTML = IC(p.icon); $('pu-name').textContent = p.name + '!'; $('pu-desc').textContent = p.desc;
  b.style.setProperty('--pc', p.color);
  b.classList.remove('hidden', 'show'); void b.offsetWidth; b.classList.add('show');
}
function updateOrbital() {
  const b = $('btn-orbital'), o = game.orbital;
  b.classList.toggle('hidden', !o.on);
  if (!o.on) return;
  const ready = o.cd <= 0;
  b.style.setProperty('--p', (1 - o.cd / o.max).toFixed(3));
  b.classList.toggle('ready', ready && ui.targeting !== 'orbital');
  setText('orbital-cd', ui.targeting === 'orbital' ? 'ZIEL' : ready ? 'BEREIT' : `${Math.ceil(o.cd)} s`);
}

// ---------------- HUD ----------------
const hudCache = {};
function setText(id, v) { if (hudCache[id] === v) return false; hudCache[id] = v; $(id).textContent = v; return true; }
function pulse(id) { const el = $(id); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }

function updateHUD() {
  if (!game) return;
  updateOrbital();
  updateNuke();
  updateHole();
  for (const k of ['ion', 'rod', 'napalm']) updateCdWeapon(k);
  updateArsenal();
  updateAim();
  updateBossBar();
  updateBuffs();
  setText('hud-lives', String(game.lives));
  if (setText('hud-credits', String(game.credits))) pulse('stat-credits');
  setText('hud-wave', game.mods.endless ? `${game.wave}/∞` : `${game.wave}/${game.waves.length}`);
  const b = $('btn-wave');
  let label, sub = '', enabled;
  if (game.state === 'build') { label = '▶ ANGRIFF STARTEN'; sub = 'Welle 1 rufen'; enabled = true; }
  else if (game.wave >= game.waves.length) { label = 'LETZTE WELLE'; sub = `${game.enemies.length + game.queue.length} Gegner übrig`; enabled = false; }
  else if (game.canCallWave()) { label = `⏩ WELLE ${game.wave + 1} IN ${Math.max(0, Math.ceil(game.nextWaveIn))} s`; sub = `jetzt rufen · +${Math.round(Math.max(0, game.nextWaveIn) * 2.5)} Bonus`; enabled = true; }
  else { label = `WELLE ${game.wave} LÄUFT`; sub = `${game.enemies.length + game.queue.length} Gegner`; enabled = false; }
  setText('wave-label', label);
  setText('wave-sub', sub);
  if (b.disabled === enabled) b.disabled = !enabled;
  b.classList.toggle('attention', game.state === 'build');
  if (ui.buildCell) {
    const priceOf = (k) => k === 'barricade' ? game.barricadeCost() : TOWERS[k].cost;
    for (const o of bmButtons) {
      const poor = game.credits < priceOf(o.k);
      if (o.el._poor !== poor) { o.el._poor = poor; o.el.classList.toggle('poor', poor); }
    }
    if (ui.previewType) { const bb = $('bd-build'); const poor = game.credits < priceOf(ui.previewType) || (ui.previewType === 'barricade' && game.barricades.length >= BAR.max); if (bb.disabled !== poor) bb.disabled = poor; }
    if (ui.buildCell.road ? !game.canBarricade(ui.buildCell.x, ui.buildCell.y) : !game.canBuild(ui.buildCell.x, ui.buildCell.y)) closeBuildMenu();
  }
  if (ui.selected) {
    if (ui.selected.kind === 'barricade' ? !game.barricades.includes(ui.selected) : !game.towers.includes(ui.selected)) closeTowerMenu();
    else updateTowerMenu(false);
  }
  positionMenus();
}

$('btn-wave').onclick = () => { unlockAudio(); if (game && game.canCallWave()) { game.startWave(); closeBuildMenu(); } };
$('btn-speed').onclick = () => {
  speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
  $('btn-speed').textContent = speed + '×';
  $('btn-speed').classList.toggle('on', speed > 1);
  sfx('click');
};
$('btn-pause').onclick = () => openPause();

// ---------------- modal ----------------
function modal(title, cls, text, stars, buttons) {
  $('modal-title').textContent = title;
  $('modal-title').className = 'panel-title ' + (cls || '');
  $('modal-text').innerHTML = text || '';
  $('modal-stars').innerHTML = stars ? starsHTML(stars) : '';
  $('modal-stars').classList.toggle('hidden', !stars);
  const box = $('modal-buttons');
  box.innerHTML = '';
  for (const [label, kind, fn] of buttons) {
    const b = document.createElement('button');
    b.className = 'btn ' + (kind || '');
    b.textContent = label;
    b.onclick = () => { sfx('click'); fn(); };
    box.appendChild(b);
  }
  $('modal').classList.remove('hidden', 'intel-modal');
}
function closeModal() { $('modal').classList.add('hidden'); }

function openPause() {
  if (!game || game.state === 'won' || game.state === 'lost') return;
  paused = true;
  saveRun();
  sfx('click');
  modal('PAUSE', '', `Einsatz ${game.level.number}: <b>${game.level.name}</b>${challenge ? '' : ' · ' + DIFFICULTY[game.mods.diff || 0].name} · Welle ${game.wave}/${game.waves.length}`, 0, [
    ['WEITER', 'primary', () => { paused = false; closeModal(); }],
    ['FEINDKATALOG', '', () => openCatalog()],
    [`TON: ${soundOn() ? 'AN' : 'AUS'}`, '', () => { toggleSound(); openPause(); }],
    [`MUSIK: ${musicOn() ? 'AN' : 'AUS'}`, '', () => { toggleMusic(); openPause(); }],
    ['NEU STARTEN', '', () => { closeModal(); startLevel(game.levelIdx, challenge); }],
    ['EINSATZ VERLASSEN', 'danger', () => { closeModal(); toLevels(); }],
  ]);
}
function onChallengeEnd(won) {
  const ch = challenge;
  const medal = medalFor(ch, game, won);
  save.data.challenges = save.data.challenges || {};
  const key = ch.daily ? 'daily:' + ch.daily : ch.id;
  const prev = save.data.challenges[key] || { medal: 0, best: 0 };
  save.data.challenges[key] = { medal: Math.max(prev.medal, medal), best: Math.max(prev.best, game.wave) };
  save.write();
  sfx(medal ? 'victory' : 'defeat');
  const title = ch.mods.endless ? 'ENDLOS – ERGEBNIS' : won ? 'CHALLENGE GESCHAFFT' : 'CHALLENGE GESCHEITERT';
  const text = (ch.mods.endless ? `Du hast <b>${game.wave - 1}</b> Wellen überstanden (Rekord: ${save.data.challenges[key].best - 1}).` : `${ch.name}: Basis <b>${game.lives}/${game.maxLives}</b> · Zerstörte Maschinen: <b>${game.kills}</b>`) +
    `<div class="medal m${medal}">${medal ? IC('trophy') + ' ' + MEDAL_NAME[medal] : 'Keine Medaille'}</div>`;
  setTimeout(() => modal(title, medal ? 'win' : 'lose', text, 0, [
    ['NOCHMAL', 'primary', () => { closeModal(); startLevel(ch.level, ch); }],
    ['CHALLENGES', '', () => { closeModal(); toLevels('challenges'); }],
  ]), 1100);
}
function onWin() {
  clearRun();
  if (challenge) { onChallengeEnd(true); return; }
  const stars = game.stars();
  const i = game.levelIdx;
  save.data.stars[i] = Math.max(save.data.stars[i] || 0, stars);
  save.data.diffWon = save.data.diffWon || {};
  save.data.diffWon[i] = Math.max(save.data.diffWon[i] || 0, game.mods.diff || 0);
  save.write();
  sfx('victory');
  const hasNext = i < LEVEL_COUNT - 1;
  const btns = [];
  if (hasNext) btns.push(['NÄCHSTER EINSATZ', 'primary', () => { closeModal(); startLevel(i + 1); }]);
  btns.push(['NOCHMAL SPIELEN', hasNext ? '' : 'primary', () => { closeModal(); startLevel(i); }]);
  btns.push(['EINSATZÜBERSICHT', '', () => { closeModal(); toLevels(); }]);
  const nextLevel = hasNext ? LEVEL_SPECS[i + 1] : null;
  const newTower = hasNext && !freePlay() ? TOWER_ORDER.find(k => TOWERS[k].unlock === i + 2) : null;
  setTimeout(() => modal('SIEG', 'win',
    `Einsatz ${i + 1} „${game.level.name}" gehalten · <b>${DIFFICULTY[game.mods.diff || 0].name}</b><br>Basis: <b>${game.lives}/${game.maxLives}</b> · Zerstörte Maschinen: <b>${game.kills}</b>` +
    (newTower ? `<br><br>🔓 Neuer Turm freigeschaltet: <b>${TOWERS[newTower].name}</b>` : '') +
    (nextLevel && nextLevel.biome !== game.level.biome ? `<br>🌍 Neues Einsatzgebiet: <b>${BIOMES[nextLevel.biome].name}</b>` : '') +
    (hasNext ? '' : `<br><br><b>Alle ${LEVEL_COUNT} Einsätze abgeschlossen – die Menschheit hat eine Zukunft.</b>`),
    stars, btns), 1100);
}
function onLose() {
  clearRun();
  if (challenge) { onChallengeEnd(false); return; }
  sfx('defeat');
  setTimeout(() => modal('BASIS ZERSTÖRT', 'lose',
    `Die Maschinen haben das Hauptquartier überrannt – in Welle ${game.wave}.<br>Zerstörte Maschinen: <b>${game.kills}</b>`, 0, [
      ['NOCHMAL VERSUCHEN', 'primary', () => { closeModal(); startLevel(game.levelIdx, challenge); }],
      ['EINSATZÜBERSICHT', '', () => { closeModal(); toLevels(); }],
    ]), 1100);
}

function processEvents() {
  for (const ev of game.events) {
    if (ev.type === 'toast') toast(ev.text, ev.bad ? 'bad' : ev.warn ? 'warn' : '', ev.long ? 4000 : 2200);
    else if (ev.type === 'baseHit') {
      pulse('stat-lives');
      const f = $('damage-flash');
      f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60);
      if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) { /* ignore */ }
    } else if (ev.type === 'upgraded') {
      if (ui.selected === ev.t) updateTowerMenu(true);
      toast(`${TOWERS[ev.t.type].name} auf Stufe ${['I', 'II', 'III'][ev.t.level - 1]} aufgerüstet`, '', 1600);
    } else if (ev.type === 'towerLost') {
      if (ui.selected === ev.t) closeTowerMenu();
    } else if (ev.type === 'wave') toast(`WELLE ${ev.n} / ${game.waves.length}`, '', 1600);
    else if (ev.type === 'powerup') showPowerBanner(ev.pu);
    else if (ev.type === 'bossSpawn') bossIntro(ev.e);
    else if (ev.type === 'towerDamaged') { if (!save.data.dmgHint) { save.data.dmgHint = true; save.write(); toast('Beschädigte Türme schießen schwächer – antippen und reparieren (kostet Credits und ein paar Sekunden)', 'warn', 4200); } }
    else if (ev.type === 'repaired') { if (ui.selected === ev.t) updateTowerMenu(true); }
    else if (ev.type === 'ionStorm') toast(`IONENSTURM – ${ev.n} Maschinen gelähmt, Schilde zerstört`, 'warn', 2200);
    else if (ev.type === 'barricade') toast(ev.detour ? 'Barrikade steht – die Maschinen nehmen den Umweg' : 'Barrikade steht – kein Umweg: Bodentruppen müssen sie durchbrechen', '', 2600);
    else if (ev.type === 'barricadeLost') { if (ui.selected === ev.b) closeTowerMenu(); }
    else if (ev.type === 'nukeRepaired') toast('ABSCHUSSRAMPE REPARIERT – ATOMBOMBE BEREIT', 'warn', 2400);
    else if (ev.type === 'weather') { const W = WEATHER[ev.w]; showBanner(W.icon, W.name.toUpperCase(), W.desc, W.color); if (ui.selected) updateTowerMenu(true); }
    else if (ev.type === 'weatherEnd') { toast('Das Wetter klart auf', '', 1800); if (ui.selected) updateTowerMenu(true); }
    else if (ev.type === 'specialized') { if (ui.selected === ev.t) updateTowerMenu(true); toast(`${TOWERS[ev.t.type].name}: ${ev.sp.name}`, '', 1600); }
    else if (ev.type === 'hack') { if (!save.data.hackHint) { save.data.hackHint = true; save.write(); toast('Ein Saboteur hackt deinen Turm – schieß ihn ab, dann geht der Turm wieder online!', 'warn', 3600); } }
    else if (ev.type === 'bossPhase') {
      if (ev.phase === 2) toast(`${ev.e.def.name.toUpperCase()} – WUTPHASE: Panzerplatten abgeworfen, Energieschild, Verstärkung!`, 'warn', 3200);
      else toast(`${ev.e.def.name.toUpperCase()} – ÜBERLADUNG: EMP-Stoß legt ${ev.jammed || 'keine'} Türme lahm!`, 'warn', 3200);
      if (navigator.vibrate) try { navigator.vibrate(80); } catch (e) { /* ignore */ }
    }
    else if (ev.type === 'nukeHit') { startNukeCam(ev.gx, ev.gy); if (navigator.vibrate) try { navigator.vibrate([120, 60, 200]); } catch (e) { /* ignore */ } }
    else if (ev.type === 'rankUp') { if (ev.rank >= 2) toast(`${TOWERS[ev.t.type].name} erreicht Rang ${'★'.repeat(ev.rank)} (+${ev.rank * 8} % Schaden)`, '', 1800); }
    else if (ev.type === 'newTypes') {
      save.data.intel = save.data.intel || {};
      for (const k of ev.types) if (!save.data.intel[k]) { save.data.intel[k] = true; showIntel(k, true); }
      save.write();
    } else if (ev.type === 'won') onWin();
    else if (ev.type === 'lost') onLose();
  }
  game.events.length = 0;
}

// ---------------- flow ----------------
function updateInsets() {
  const portrait = window.innerWidth <= window.innerHeight;
  renderer.insets = portrait ? { top: 50, bottom: 70, left: 0, right: 0 } : { top: 46, bottom: 0, left: 0, right: 0 };
}

let challenge = null;
async function startLevel(i, ch = null, restored = null) {
  unlockAudio();
  const spec = LEVEL_SPECS[i];
  challenge = ch;
  if (!restored) clearRun();
  const g = restored || new Game(i, { ...(ch ? ch.mods : DIFFICULTY[diffIdx()].mods), unlockAll: freePlay(), diff: ch ? 0 : diffIdx(), perks: ch ? null : { ...perkLevels() } });
  // only the enemy types of this mission (incl. units launched by carriers / bursting out)
  const types = new Set();
  for (const w of g.waves.slice(0, 60)) for (const gr of w.groups) {
    types.add(gr.type);
    const d = ENEMIES[gr.type];
    if (d.spawns) types.add(d.spawns.type);
    if (d.burst) types.add(d.burst.type);
  }
  const models = [...types].map(t => ENEMIES[t].model);
  musicPreload(['build', 'battle', 'battle2', ...(g.waves.some(w => w.groups.some(gr => ENEMIES[gr.type].boss)) ? ['boss'] : [])]);
  const slow = setTimeout(() => toast('Lade Einsatzdaten …', '', 1500), 400);
  await Promise.all([Assets.loadBiome(spec.biome), Assets.loadModels(models), g.nuke.on ? Assets.loadVfx('nuke') : null, g.hole.on ? Assets.loadVfx('hole') : null]);
  clearTimeout(slow);
  endAim();
  game = g;
  window.__game = game;
  window.__renderer = renderer;
  paused = false;
  speed = 1;
  $('btn-speed').textContent = '1×';
  $('btn-speed').classList.remove('on');
  closeBuildMenu(); closeTowerMenu();
  updateInsets();
  renderer.setGame(game);
  hideScreens();
  setInGameUI(true);
  for (const k in hudCache) delete hudCache[k];
  updateHUD();
  runSaveT = 4;
  if (restored) {
    // resumed after the app was closed: start paused so the player can get their bearings
    toast(`EINSATZ FORTGESETZT – Welle ${game.wave}/${game.waves.length}`, 'warn', 2600);
    openPause();
    maybeRotateHint();
    return;
  }
  if (ch) toast(`CHALLENGE: ${ch.name.toUpperCase()} – ${ch.desc}`, 'warn', 4500);
  else toast(`EINSATZ ${i + 1}: ${spec.name.toUpperCase()} – ${BIOMES[spec.biome].name} · ${DIFFICULTY[game.mods.diff].name}`, game.mods.diff ? 'warn' : '', 2600);
  const newTower = freePlay() ? null : TOWER_ORDER.find(k => TOWERS[k].unlock === i + 1 && i > 0);
  if (newTower) setTimeout(() => toast(`Neuer Turm verfügbar: ${TOWERS[newTower].name}`, 'warn', 3500), 900);
  if (i === 0) setTimeout(() => toast('Tippe ein freies Feld an, um einen Turm zu bauen', '', 4000), 1200);
  else if (game.N > 15 && !save.data.bigMapHint) {
    save.data.bigMapHint = true; save.write();
    setTimeout(() => toast('Große Karte: mit zwei Fingern zoomen und verschieben – rote Pfeile zeigen Gegner außerhalb', '', 5000), 1200);
  } else if (game.routes.length > 1) setTimeout(() => toast(`${game.routes.length} Angriffspfade – verteidige alle Zugänge!`, '', 3200), 1400);
  if (!save.data.arsenalHint && (game.orbital.on || game.napalm.on)) {
    save.data.arsenalHint = save.data.holeHint = save.data.nukeHint = save.data.orbitalHint = true; save.write();
    setTimeout(() => toast('Spezialwaffen: der Knopf unten rechts öffnet das Arsenal – Waffe antippen, Ziel wählen, AUSLÖSEN. Lange drücken erklärt die Waffe', 'warn', 6000), 2400);
  }
  for (const [k, name, what] of [['napalm', 'NAPALM-STAFFEL', 'Brandteppich entlang einer Straße'], ['ion', 'IONENSTURM', 'lähmt die ganze Karte, Flieger stürzen ab'], ['rod', 'WOLFRAMSTAB', 'kinetischer Schlag, der Boss-Killer']]) {
    if (game[k].on && !freePlay() && !save.data[k + 'Hint']) { save.data[k + 'Hint'] = true; save.write(); setTimeout(() => toast(`Neu im Arsenal: ${name} – ${what}`, 'warn', 4500), 3200); }
  }
  if (game.hole.on && !save.data.holeHint) {
    save.data.holeHint = true; save.write();
    setTimeout(() => toast('Neu: SCHWARZES LOCH – saugt Gegner 10 Sekunden lang ein (im Arsenal, Knopf unten rechts)', 'warn', 5000), 4200);
  }
  if (game.nuke.on && !save.data.nukeHint) {
    save.data.nukeHint = true; save.write();
    setTimeout(() => toast('Neu: ATOMBOMBE – lädt sich durch Abschüsse auf, verstrahlt das Gebiet; danach muss die Abschussrampe repariert werden (im Arsenal, Knopf unten rechts)', 'warn', 5000), 3400);
  }
  if (game.orbital.on && !save.data.orbitalHint) {
    save.data.orbitalHint = true; save.write();
    setTimeout(() => toast('Neu: ORBITALSCHLAG – im Arsenal (Knopf unten rechts), dann Ziel antippen', 'warn', 4500), 2600);
  }
  if (!save.data.barHint) {
    save.data.barHint = true; save.write();
    setTimeout(() => toast('Neu: BARRIKADEN – tippe auf die Straße. Gibt es einen Umweg, nehmen die Maschinen ihn, sonst müssen sie sich durchkämpfen', 'warn', 6000), 5200);
  } else if (game.level.links && !save.data.detourHint) {
    save.data.detourHint = true; save.write();
    setTimeout(() => toast('Diese Karte hat Umwege: mit Barrikaden lenkst du die Maschinen auf den Weg, den du willst', 'warn', 5000), 2600);
  }
  maybeRotateHint();
}
function toMenu() { saveRun(); if (applySwUpdate()) return; game = null; setInGameUI(false); updateResumeBtn(); showScreen('screen-menu'); }
let levelTab = 'campaign';
function toLevels(tab) {
  saveRun();
  if (applySwUpdate()) return;
  game = null; challenge = null; setInGameUI(false);
  if (tab) levelTab = tab;
  renderLevels(); renderChallenges(); setLevelTab(levelTab);
  showScreen('screen-levels');
}
function setLevelTab(tab) {
  levelTab = tab;
  $('tab-campaign').classList.toggle('on', tab === 'campaign');
  $('tab-challenges').classList.toggle('on', tab === 'challenges');
  $('level-list').classList.toggle('hidden', tab !== 'campaign');
  $('challenge-list').classList.toggle('hidden', tab !== 'challenges');
  $('diff-bar').classList.toggle('hidden', tab !== 'campaign');
}
$('tab-campaign').onclick = () => { sfx('click'); setLevelTab('campaign'); };
$('tab-challenges').onclick = () => { sfx('click'); setLevelTab('challenges'); };
function medalHTML(m) { return m ? `<span class="medal-s m${m}">${IC('trophy')}${MEDAL_NAME[m]}</span>` : '<span class="medal-s m0">offen</span>'; }
function renderChallenges() {
  const list = $('challenge-list');
  list.innerHTML = '';
  const cleared = (n) => freePlay() || (save.data.stars[n - 1] || 0) > 0;
  let maxLevel = 0;
  while (maxLevel < LEVEL_COUNT && cleared(maxLevel + 1)) maxLevel++;
  const res = save.data.challenges || {};
  const cards = [];
  if (maxLevel >= 5) cards.push({ ch: dailyChallenge(Math.max(6, maxLevel)), locked: false });
  else cards.push({ ch: { id: 'daily', name: 'Tages-Challenge', icon: 'calendar', desc: 'Jeden Tag ein anderer Einsatz mit zwei zufälligen Regeln.', req: 5 }, locked: true });
  for (const ch of CHALLENGES) cards.push({ ch, locked: !cleared(ch.req) });
  for (const { ch, locked } of cards) {
    const r = res[ch.daily ? 'daily:' + ch.daily : ch.id] || { medal: 0, best: 0 };
    const b = document.createElement('button');
    b.className = 'ch-card' + (locked ? ' locked' : '') + (ch.daily ? ' daily' : '');
    const map = ch.level != null && !locked ? `Karte: Einsatz ${ch.level + 1} · ${LEVEL_SPECS[ch.level].name}` : '';
    b.innerHTML = `<i class="ic ic-${locked ? 'lock' : ch.icon} ch-ic"></i>
      <div class="ch-body"><div class="ch-name">${ch.name}</div><div class="ch-desc">${ch.desc}</div>
      <div class="ch-meta">${locked ? `Freischalten: Einsatz ${ch.req} abschließen` : map}${!locked && ch.mods && ch.mods.endless && r.best ? ` · Rekord: Welle ${r.best - 1}` : ''}</div></div>
      <div class="ch-medal">${locked ? '' : medalHTML(r.medal)}</div>`;
    b.onclick = () => {
      if (locked) { sfx('error'); toast(`Schließe zuerst Einsatz ${ch.req} ab`, 'bad'); return; }
      sfx('click'); startLevel(ch.level, ch);
    };
    list.appendChild(b);
  }
}
function toggleMusic() {
  save.data.music = !musicOn();
  setMusic(save.data.music);
  save.write();
  $('btn-music').textContent = `MUSIK: ${save.data.music ? 'AN' : 'AUS'}`;
}
function toggleSound() {
  save.data.sound = !soundOn();
  setSound(save.data.sound);
  save.write();
  $('btn-sound').textContent = `TON: ${save.data.sound ? 'AN' : 'AUS'}`;
}
function maybeRotateHint() {
  const portrait = window.innerWidth < window.innerHeight;
  $('rotate-hint').classList.toggle('hidden', !(portrait && game && !save.data.rotateHintSeen && window.innerWidth < 700));
}
$('rotate-ok').onclick = () => { save.data.rotateHintSeen = true; save.write(); $('rotate-hint').classList.add('hidden'); };
$('btn-play').onclick = () => { unlockAudio(); sfx('click'); toLevels(); };
$('btn-resume').onclick = () => { unlockAudio(); sfx('click'); resumeRun(); };
// ---------------- commander perks ----------------
function starsEarned() { return Object.values(save.data.stars || {}).reduce((a, b) => a + (b || 0), 0); }
function perkLevels() { return save.data.perks || (save.data.perks = {}); }
function starsSpent() { let n = 0; for (const [id, l] of Object.entries(perkLevels())) for (let i = 0; i < l; i++) n += PERK_COST[i]; return n; }
let perksFrom = 'screen-menu';
function openPerks(from) { perksFrom = from; renderPerks(); showScreen('screen-perks'); }
function renderPerks() {
  const free = starsEarned() - starsSpent(), L = perkLevels();
  $('perk-stars').innerHTML = `★ ${free} <small>frei · ${starsEarned()} verdient</small>`;
  $('perk-list').innerHTML = PERKS.map(p => {
    const l = L[p.id] || 0, max = l >= PERK_COST.length, c = max ? 0 : PERK_COST[l];
    const pips = PERK_COST.map((_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
    return `<div class="perk"><i class="ic ic-${p.icon} perk-ic"></i><div class="perk-info"><b>${p.name}</b><span>${p.desc}</span><div class="perk-pips">${pips}</div></div>`
      + `<button class="btn ${max ? '' : 'primary'}" data-perk="${p.id}" ${max || free < c ? 'disabled' : ''}>${max ? 'MAX' : `★ ${c}`}</button></div>`;
  }).join('');
}
$('perk-list').onclick = (e) => {
  const b = e.target.closest('[data-perk]');
  if (!b) return;
  const L = perkLevels(), id = b.dataset.perk, l = L[id] || 0;
  if (l >= PERK_COST.length || starsEarned() - starsSpent() < PERK_COST[l]) { sfx('error'); return; }
  L[id] = l + 1; save.write(); sfx('upgrade'); renderPerks();
};
$('btn-perks-reset').onclick = () => { save.data.perks = {}; save.write(); sfx('sell'); renderPerks(); };
$('btn-perks').onclick = () => { unlockAudio(); sfx('click'); openPerks('screen-menu'); };
$('btn-perks2').onclick = () => { sfx('click'); openPerks('screen-levels'); };
$('btn-perks-back').onclick = () => { sfx('click'); if (perksFrom === 'screen-levels') toLevels(); else showScreen('screen-menu'); };

$('btn-help').onclick = () => { unlockAudio(); sfx('click'); showScreen('screen-help'); };
$('btn-help-back').onclick = () => { sfx('click'); showScreen('screen-menu'); };
$('btn-levels-back').onclick = () => { sfx('click'); updateResumeBtn(); showScreen('screen-menu'); };
$('btn-sound').onclick = () => { unlockAudio(); toggleSound(); sfx('click'); };
$('btn-music').onclick = () => { unlockAudio(); toggleMusic(); sfx('click'); };
function updateFreeBtn() { $('btn-free').textContent = `FREIES SPIEL: ${freePlay() ? 'AN' : 'AUS'}`; }
$('btn-free').onclick = () => {
  unlockAudio(); sfx('click');
  save.data.free = !freePlay(); save.write(); updateFreeBtn();
  toast(freePlay() ? 'Freies Spiel: alle Einsätze, Challenges, Türme und Fähigkeiten verfügbar' : 'Klassisch: Einsätze, Türme und Fähigkeiten werden nacheinander freigeschaltet', '', 3200);
};
updateFreeBtn();

window.addEventListener('resize', () => { renderer.resize(); if (game) { updateInsets(); renderer.clampCam(); maybeRotateHint(); } });
window.addEventListener('orientationchange', () => setTimeout(() => { renderer.resize(); if (game) { updateInsets(); renderer.resetCamera(); maybeRotateHint(); } }, 250));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  saveRun();
  if (game && game.state !== 'won' && game.state !== 'lost' && $('modal').classList.contains('hidden')) openPause();
});
window.addEventListener('pagehide', () => saveRun());
window.addEventListener('keydown', (e) => {
  if (!game) return;
  if (ui.targeting && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); if (e.key === 'Enter') fireAim(); else endAim(); return; }
  if (e.key === 'Escape') { if (ui.buildCell) closeBuildMenu(); else if (ui.selected) closeTowerMenu(); else openPause(); }
  if (e.key === ' ') { e.preventDefault(); if (game.canCallWave()) game.startWave(); }
});

// ---------------- music ----------------
// build phase / menu: calm track; enemies on the field: battle; a boss alive: boss track. Calm only after the
// field has been empty for a few seconds, so the music doesn't flip between waves.
let musicCalm = 0;
function updateMusic(dt) {
  if (!game) { music('build'); musicLevel(1); return; }
  if (game.state === 'won' || game.state === 'lost') { music(null, 1.2); return; }
  let n = 0, boss = false;
  const list = replay ? replay.enemies : game.enemies;
  for (const e of list) if (e.alive) { n++; if (e.def.boss) boss = true; }
  if (n > 0 || (game.queue.length && game.queue[0].t - game.time < 3)) musicCalm = 0; else musicCalm += paused ? 0 : dt;
  // two battle tracks take turns wave by wave, so long missions don't repeat one loop
  music(boss ? 'boss' : game.wave > 0 && musicCalm < 6 ? (game.wave % 2 ? 'battle' : 'battle2') : 'build');
  // pause: quieter; siren: half; nuclear flash, X-ray and mushroom cloud: (almost) silent, then back slowly
  musicLevel(paused ? 0.4 : game.cine ? 0.04 : game.nukes.length ? 0.45 : 1, game.cine ? 0.2 : 2.5);
}

// ---------------- loop ----------------
let last = performance.now();
const STEP = 1 / 60;
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  updateHold();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  let ts = 1;
  if (game && !paused) {
    // cinematic time (nuclear strike): freeze, slow motion, ramp back - the HUD and screen effects run in real time
    ts = game.timeScale();
    if (!replay) game.advanceCinematic(dt);
    game.fx.realtimeScreen = true;
    game.fx.screen(dt);
    // the nuclear flash also blinds the HUD; in between, the whole screen turns into an X-ray negative
    const st = game.fx.blindState();
    const ha = !st || st.xray ? 0 : st.t < NUKE.whiteEnd ? st.white : Math.max(0, 1 - (st.t - NUKE.whiteEnd) / 0.5);
    if (hudCache.nukeFlash !== ha) { hudCache.nukeFlash = ha; $('nuke-flash').style.opacity = ha.toFixed(3); }
    setXray(!!(st && st.xray));
    if (hudCache.beat !== !!(st && st.beat)) { hudCache.beat = !!(st && st.beat); document.body.classList.toggle('beat', hudCache.beat); }
    if (hudCache.glitch !== !!(st && st.glitch)) { hudCache.glitch = !!(st && st.glitch); document.body.classList.toggle('glitch', hudCache.glitch); }
    game.fx.update(dt, true);   // real-time particles (nuclear blast) keep full speed during slow motion
    if (replay) updateReplay(dt);
    else {
      updateCamTween(dt);
      updateNukeCam(dt);
      acc += dt * speed * ts;
      let n = 0;
      while (acc >= STEP && n < 12) { game.update(STEP); acc -= STEP; n++; }
      if (n === 12) acc = 0;
      processEvents();
      updateHUD();
      offerReplay(dt);
      if (game && (runSaveT -= dt) <= 0) { runSaveT = 4; saveRun(); }
    }
  }
  else setXray(false);
  if (game) renderer.draw(paused ? 0 : dt * Math.min(speed, 2) * ts, ui);
  updateMusic(dt);
}
// ---------------- nuke replay ----------------
// the detonation once more from a snapshot of the battlefield: same flash, X-ray and slow motion, game paused meanwhile
let replay = null, replayOffer = 0;
function offerReplay(dt) {
  if (!game.nukeReplay || replay || game.cine) { if (!game.nukeReplay) $('btn-replay').classList.add('hidden'); return; }
  if (game.nukeReplay.offered) {
    replayOffer -= dt;
    if (replayOffer <= 0) $('btn-replay').classList.add('hidden');
    return;
  }
  game.nukeReplay.offered = true; replayOffer = 14;
  $('btn-replay').classList.remove('hidden');
}
function startReplay() {
  const R = game && game.nukeReplay;
  if (!R || replay || game.cine) return;
  closeBuildMenu(); closeTowerMenu(); endAim(); endNukeCam(true);
  const c = renderer.cam;
  replay = { t: 0, gt: 0, blasted: false, cam: { x: c.x, y: c.y, z: c.zoom }, enemies: game.enemies, zones: game.radZones, drops: game.drops, strikes: game.strikesW };
  game.enemies = R.enemies.map(e => ({ ...e }));
  game.radZones = []; game.drops = []; game.strikesW = [];
  const w = toWorld(R.gx, R.gy);
  setCam(blastFrame(R.gx, R.gy));
  game.fx.nuke(w.x, w.y);
  game.startCinematic(NUKE.cine);
  sfx('nuke');
  $('btn-replay').classList.add('hidden');
  $('replay-label').classList.remove('hidden');
  document.body.classList.add('replaying');
}
function updateReplay(dt) {
  const ts = game.timeScale();
  game.advanceCinematic(dt);
  game.fx.update(dt * ts);
  replay.t += dt; replay.gt += dt * ts;
  if (!replay.blasted && replay.gt >= NUKE.blastDelay) {
    replay.blasted = true;
    const R = game.nukeReplay;
    const bw = toWorld(R.gx, R.gy);
    game.fx.nukeBlast(bw.x, bw.y);
    game.enemies = game.enemies.filter(e => {
      if (Math.hypot(e.gx - R.gx, e.gy - R.gy) > NUKE.radius || e.def.boss) return true;
      game.deathFx(e, 'nuke', R);
      return false;
    });
  }
  if (!game.cine && replay.t > 1.2) endReplay();
}
function endReplay() {
  if (!replay) return;
  if (!game) { replay = null; $('replay-label').classList.add('hidden'); document.body.classList.remove('replaying'); return; }
  game.enemies = replay.enemies; game.radZones = replay.zones; game.drops = replay.drops; game.strikesW = replay.strikes;
  const c = renderer.cam; c.x = replay.cam.x; c.y = replay.cam.y; c.zoom = replay.cam.z; renderer.clampCam();
  replay = null;
  $('replay-label').classList.add('hidden');
  document.body.classList.remove('replaying');
}
$('btn-replay').onclick = (e) => { e.stopPropagation(); unlockAudio(); startReplay(); };

function setXray(on) { if (hudCache.xray !== on) { hudCache.xray = on; document.body.classList.toggle('xray', on); if (!on) document.body.classList.remove('beat', 'glitch'); } }

// ---------------- offline (service worker) ----------------
// sw.js keeps every game file on the device. After a deploy the new version installs in the background:
// it is taken over right away while the main menu is open, otherwise when the player next leaves a mission.
let swUpdate = false, swPoll = 0;
function swSend(msg) { const c = navigator.serviceWorker && navigator.serviceWorker.controller; if (c) c.postMessage(msg); }
function onMenuScreen() { return !game && !$('screen-menu').classList.contains('hidden') && $('modal').classList.contains('hidden'); }
function applySwUpdate() { if (!swUpdate) return false; swUpdate = false; location.reload(); return true; }
function showOfflineStatus(s) {
  const el = $('offline-status');
  if (!s || !s.total) return;
  const done = s.have >= s.total;
  el.classList.remove('hidden');
  el.classList.toggle('done', done);
  el.textContent = done ? '✓ OFFLINE SPIELBAR' : `Lade Spieldaten für offline … ${Math.floor(s.have / s.total * 100)} %`;
  clearTimeout(swPoll);
  if (!done) swPoll = setTimeout(() => swSend('status'), 2500);
}
function initOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.sw === 'status') showOfflineStatus(e.data); });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had) { swSend('fill'); swSend('status'); return; }     // first install: start the background download
    swUpdate = true;
    if (onMenuScreen()) applySwUpdate();
  });
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
  if (had) { swSend('status'); setTimeout(() => swSend('fill'), 3000); }
}

async function boot() {
  setSound(save.data.sound !== false);
  $('btn-sound').textContent = `TON: ${save.data.sound !== false ? 'AN' : 'AUS'}`;
  setMusic(save.data.music !== false);
  $('btn-music').textContent = `MUSIK: ${save.data.music !== false ? 'AN' : 'AUS'}`;
  musicPreload(['build']);
  renderer.resize();
  await Assets.load((p) => { $('loadfill').style.width = Math.round(p * 100) + '%'; });
  makeIcons();
  installIconCss();
  await new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = 'assets/title.jpg'; });
  updateResumeBtn();
  showScreen('screen-menu');
  initOffline();
  requestAnimationFrame((t) => { last = t; frame(t); });
  const q = new URLSearchParams(location.search);
  if (q.has('level')) startLevel(Math.max(0, Math.min(LEVEL_COUNT - 1, (parseInt(q.get('level'), 10) || 1) - 1)));
}
boot();
