// Iron Sentinel – app controller: screens, HUD, build drawer, tower menu, game loop.
import { TOWERS, TOWER_ORDER, MAX_LEVEL, BIOMES, BIOME_ORDER, UPGRADE_TIME, upgradeCost, towerStats } from './config.js';
import { LEVEL_SPECS, LEVEL_COUNT } from './levels.js';
import { Assets, Models } from './assets.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { toWorld } from './iso.js';
import { sfx, unlockAudio, setSound, soundOn } from './audio.js';

const $ = (id) => document.getElementById(id);
const STORE = 'ironsentinel.v2';
const save = (() => {
  let data = { stars: {}, sound: true, rotateHintSeen: false };
  try { Object.assign(data, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { /* private mode */ }
  return { data, write() { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* ignore */ } } };
})();

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
  if (!on) { closeBuildMenu(); closeTowerMenu(); }
}
function starsHTML(n) { let s = ''; for (let i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>'; return s; }

function levelUnlocked(i) { return i === 0 || (save.data.stars[i - 1] || 0) > 0; }
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
      if (L.biome !== bid) return;
      const stars = save.data.stars[i] || 0;
      total += stars;
      const locked = !levelUnlocked(i);
      const btn = document.createElement('button');
      btn.className = 'ltile' + (locked ? ' locked' : '') + (stars ? ' done' : '');
      btn.innerHTML = `<div class="lnum">${locked ? '🔒' : i + 1}</div><div class="lname">${L.name}</div><div class="stars small">${starsHTML(stars)}</div>`;
      btn.onclick = () => {
        if (locked) { sfx('error'); toast('Schließe zuerst den vorherigen Einsatz ab', 'bad'); return; }
        sfx('click'); startLevel(i);
      };
      row.appendChild(btn);
    });
    sec.appendChild(row);
    list.appendChild(sec);
  }
  $('total-stars').innerHTML = `★ ${total} / ${LEVEL_COUNT * 3}`;
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
}

// ---------------- build drawer (bottom sheet) ----------------
let bmButtons = [];
const ROLE = {
  gatling: 'Boden + Luft · Schnellfeuer', missile: 'Boden + Luft · Fläche', plasma: 'Boden · ignoriert Panzer', emp: 'Boden + Luft · verlangsamt',
  flak: 'nur Luft · Fläche', flame: 'Boden · Kegel + Brand', rail: 'Boden + Luft · Durchschlag', laser: 'Boden + Luft · heizt auf', mortar: 'Boden · Artillerie',
};
function openBuildMenu(cx, cy) {
  closeTowerMenu();
  ui.buildCell = { x: cx, y: cy };
  ui.previewType = null;
  const box = $('bd-cards');
  box.innerHTML = '';
  bmButtons = [];
  for (const k of TOWER_ORDER.filter(k => game.unlocked(k))) {
    const def = TOWERS[k];
    const b = document.createElement('button');
    b.className = 'bd-card';
    b.innerHTML = `<img src="${icons[k] || ''}" alt=""><span class="bd-name">${def.name}</span><span class="bd-cost">⚡${def.cost}</span>`;
    b.onclick = (e) => { e.stopPropagation(); chooseTower(k); };
    box.appendChild(b);
    bmButtons.push({ el: b, k });
  }
  $('bd-info').innerHTML = '<span class="bd-hint">Turm wählen – die Reichweite wird auf der Karte angezeigt</span>';
  $('bd-build').classList.add('hidden');
  $('builddrawer').classList.remove('hidden');
  $('btn-wave').classList.add('under-drawer');
  requestAnimationFrame(() => ensureCellVisible(cx, cy));
  sfx('click');
}
function chooseTower(k) {
  if (!game || !ui.buildCell) return;
  const def = TOWERS[k];
  if (ui.previewType === k) { buildChosen(); return; }   // second tap on the same card builds
  ui.previewType = k;
  bmButtons.forEach(o => o.el.classList.toggle('sel', o.k === k));
  const s = towerStats(k, 1);
  const dmg = def.dps ? `${Math.round(s.dps)}/s` : def.kind === 'hitscan' || def.kind === 'flak' ? `${Math.round(s.dmg * s.rate)}/s` : Math.round(s.dmg);
  $('bd-info').innerHTML = `<b>${def.name}</b> <span class="bd-role">${ROLE[k]}</span><br><small>${def.desc}</small>` +
    `<div class="bd-chips"><span>💥 ${dmg}</span><span>📡 ${s.range.toFixed(1)}</span><span>🛡 ${s.hp}</span></div>`;
  const bb = $('bd-build');
  bb.textContent = `BAUEN · ⚡${def.cost}`;
  bb.disabled = game.credits < def.cost;
  bb.classList.remove('hidden');
  requestAnimationFrame(() => ui.buildCell && ensureCellVisible(ui.buildCell.x, ui.buildCell.y));
  sfx('click');
}
function buildChosen() {
  if (!game || !ui.buildCell || !ui.previewType) return;
  const k = ui.previewType;
  if (game.credits < TOWERS[k].cost) { sfx('error'); toast('Nicht genug Credits', 'bad', 1200); return; }
  const t = game.build(k, ui.buildCell.x, ui.buildCell.y);
  if (t) closeBuildMenu();
}
function closeBuildMenu() {
  ui.buildCell = null; ui.previewType = null;
  $('builddrawer').classList.add('hidden');
  $('btn-wave').classList.remove('under-drawer');
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
function updateTowerMenu(force) {
  const t = ui.selected;
  if (!t || !game) return;
  const def = TOWERS[t.type];
  const s = t.stats, maxed = t.level >= MAX_LEVEL;
  const cost = maxed ? 0 : upgradeCost(t.type, t.level);
  const rc = game.repairCost(t);
  const prog = t.upgrading ? Math.floor(t.upgrading.t / t.upgrading.dur * 100) : -1;
  const key = [t.id, t.level, t.mode, game.credits >= cost, maxed, game.sellValue(t), rc, Math.round(t.hp), prog].join('|');
  if (!force && key === tmCache) return;
  tmCache = key;
  $('tm-name').textContent = def.name;
  $('tm-level').textContent = ['I', 'II', 'III'][t.level - 1];
  $('tm-hpfill').style.width = `${Math.max(0, t.hp / s.hp) * 100}%`;
  const next = maxed ? null : towerStats(t.type, t.level + 1);
  const dmg = def.dps ? `${Math.round(s.dps)}/s` : def.kind === 'hitscan' || def.kind === 'flak' ? `${Math.round(s.dmg)}×${s.rate.toFixed(1)}` : Math.round(s.dmg);
  const ndmg = next ? (def.dps ? Math.round(next.dps) : Math.round(next.dmg)) : null;
  $('tm-stats').innerHTML = `<span>💥 ${dmg}${ndmg ? `<em>→${ndmg}</em>` : ''}</span><span>📡 ${s.range.toFixed(1)}</span><span>☠ ${t.kills}</span>`;
  const up = $('tm-upgrade');
  up.disabled = maxed || game.credits < cost || !!t.upgrading;
  up.textContent = t.upgrading ? `⏳ ${prog} %` : maxed ? 'MAX' : `▲ ${cost} · ${UPGRADE_TIME[t.level]} s`;
  const rp = $('tm-repair');
  rp.classList.toggle('hidden', rc <= 0);
  rp.textContent = `🔧 ${rc}`;
  rp.disabled = game.credits < rc;
  $('tm-mode').textContent = `🎯 ${MODES[t.mode]}`;
  $('tm-mode').classList.toggle('hidden', !!def.static && def.kind !== 'emp');
  $('tm-sell').textContent = `💰 +${game.sellValue(t)}`;
}
$('tm-upgrade').onclick = (e) => { e.stopPropagation(); if (ui.selected && game.upgrade(ui.selected)) updateTowerMenu(true); };
$('tm-repair').onclick = (e) => { e.stopPropagation(); if (ui.selected && game.repair(ui.selected)) updateTowerMenu(true); };
$('tm-mode').onclick = (e) => {
  e.stopPropagation();
  const t = ui.selected; if (!t) return;
  const order = ['first', 'strong', 'near'];
  t.mode = order[(order.indexOf(t.mode) + 1) % order.length];
  t.target = null;
  sfx('click'); updateTowerMenu(true);
};
$('tm-sell').onclick = (e) => { e.stopPropagation(); if (ui.selected) { game.sell(ui.selected); closeTowerMenu(); } };

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

// ---------------- map interaction ----------------
function onTap(p) {
  unlockAudio();
  if (!game || paused || game.state === 'won' || game.state === 'lost') return;
  const c = renderer.screenToCell(p.x, p.y);
  const inMap = c.x >= 0 && c.y >= 0 && c.x < game.N && c.y < game.N;
  const t = inMap ? game.towerAt(c.x, c.y) : null;
  if (t) { if (ui.selected === t) closeTowerMenu(); else openTowerMenu(t); return; }
  if (ui.buildCell && inMap && game.canBuild(c.x, c.y) && (c.x !== ui.buildCell.x || c.y !== ui.buildCell.y)) {
    const keep = ui.previewType;
    openBuildMenu(c.x, c.y);
    if (keep) chooseTower(keep);
    return;
  }
  if (ui.buildCell || ui.selected) { closeBuildMenu(); closeTowerMenu(); return; }
  if (inMap && game.canBuild(c.x, c.y)) openBuildMenu(c.x, c.y);
}
new Input(canvas, renderer, { tap: onTap, hover: () => {} });

// ---------------- HUD ----------------
const hudCache = {};
function setText(id, v) { if (hudCache[id] === v) return false; hudCache[id] = v; $(id).textContent = v; return true; }
function pulse(id) { const el = $(id); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }

function updateHUD() {
  if (!game) return;
  setText('hud-lives', String(game.lives));
  if (setText('hud-credits', String(game.credits))) pulse('stat-credits');
  setText('hud-wave', `${game.wave}/${game.waves.length}`);
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
    for (const o of bmButtons) {
      const poor = game.credits < TOWERS[o.k].cost;
      if (o.el._poor !== poor) { o.el._poor = poor; o.el.classList.toggle('poor', poor); }
    }
    if (ui.previewType) { const bb = $('bd-build'); const poor = game.credits < TOWERS[ui.previewType].cost; if (bb.disabled !== poor) bb.disabled = poor; }
    if (!game.canBuild(ui.buildCell.x, ui.buildCell.y)) closeBuildMenu();
  }
  if (ui.selected) {
    if (!game.towers.includes(ui.selected)) closeTowerMenu();
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
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }

function openPause() {
  if (!game || game.state === 'won' || game.state === 'lost') return;
  paused = true;
  sfx('click');
  modal('PAUSE', '', `Einsatz ${game.level.number}: <b>${game.level.name}</b> · Welle ${game.wave}/${game.waves.length}`, 0, [
    ['WEITER', 'primary', () => { paused = false; closeModal(); }],
    [`TON: ${soundOn() ? 'AN' : 'AUS'}`, '', () => { toggleSound(); openPause(); }],
    ['NEU STARTEN', '', () => { closeModal(); startLevel(game.levelIdx); }],
    ['EINSATZ VERLASSEN', 'danger', () => { closeModal(); toLevels(); }],
  ]);
}
function onWin() {
  const stars = game.stars();
  const i = game.levelIdx;
  save.data.stars[i] = Math.max(save.data.stars[i] || 0, stars);
  save.write();
  sfx('victory');
  const hasNext = i < LEVEL_COUNT - 1;
  const btns = [];
  if (hasNext) btns.push(['NÄCHSTER EINSATZ', 'primary', () => { closeModal(); startLevel(i + 1); }]);
  btns.push(['NOCHMAL SPIELEN', hasNext ? '' : 'primary', () => { closeModal(); startLevel(i); }]);
  btns.push(['EINSATZÜBERSICHT', '', () => { closeModal(); toLevels(); }]);
  const nextLevel = hasNext ? LEVEL_SPECS[i + 1] : null;
  const newTower = hasNext ? TOWER_ORDER.find(k => TOWERS[k].unlock === i + 2) : null;
  setTimeout(() => modal('SIEG', 'win',
    `Einsatz ${i + 1} „${game.level.name}" gehalten.<br>Basis: <b>${game.lives}/${game.maxLives}</b> · Zerstörte Maschinen: <b>${game.kills}</b>` +
    (newTower ? `<br><br>🔓 Neuer Turm freigeschaltet: <b>${TOWERS[newTower].name}</b>` : '') +
    (nextLevel && nextLevel.biome !== game.level.biome ? `<br>🌍 Neues Einsatzgebiet: <b>${BIOMES[nextLevel.biome].name}</b>` : '') +
    (hasNext ? '' : '<br><br><b>Alle 25 Einsätze abgeschlossen – die Menschheit hat eine Zukunft.</b>'),
    stars, btns), 1100);
}
function onLose() {
  sfx('defeat');
  setTimeout(() => modal('BASIS ZERSTÖRT', 'lose',
    `Die Maschinen haben das Hauptquartier überrannt – in Welle ${game.wave}.<br>Zerstörte Maschinen: <b>${game.kills}</b>`, 0, [
      ['NOCHMAL VERSUCHEN', 'primary', () => { closeModal(); startLevel(game.levelIdx); }],
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
    else if (ev.type === 'won') onWin();
    else if (ev.type === 'lost') onLose();
  }
  game.events.length = 0;
}

// ---------------- flow ----------------
function updateInsets() {
  const portrait = window.innerWidth <= window.innerHeight;
  renderer.insets = portrait ? { top: 50, bottom: 70, left: 0, right: 0 } : { top: 46, bottom: 0, left: 0, right: 0 };
}

async function startLevel(i) {
  unlockAudio();
  const spec = LEVEL_SPECS[i];
  await Assets.loadBiome(spec.biome);
  game = new Game(i);
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
  toast(`EINSATZ ${i + 1}: ${spec.name.toUpperCase()} – ${BIOMES[spec.biome].name}`, '', 2600);
  const newTower = TOWER_ORDER.find(k => TOWERS[k].unlock === i + 1 && i > 0);
  if (newTower) setTimeout(() => toast(`Neuer Turm verfügbar: ${TOWERS[newTower].name}`, 'warn', 3500), 900);
  if (i === 0) setTimeout(() => toast('Tippe ein freies Feld an, um einen Turm zu bauen', '', 4000), 1200);
  maybeRotateHint();
}
function toMenu() { game = null; setInGameUI(false); showScreen('screen-menu'); }
function toLevels() { game = null; setInGameUI(false); renderLevels(); showScreen('screen-levels'); }
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
$('btn-help').onclick = () => { unlockAudio(); sfx('click'); showScreen('screen-help'); };
$('btn-help-back').onclick = () => { sfx('click'); showScreen('screen-menu'); };
$('btn-levels-back').onclick = () => { sfx('click'); showScreen('screen-menu'); };
$('btn-sound').onclick = () => { unlockAudio(); toggleSound(); sfx('click'); };

window.addEventListener('resize', () => { renderer.resize(); if (game) { updateInsets(); renderer.clampCam(); maybeRotateHint(); } });
window.addEventListener('orientationchange', () => setTimeout(() => { renderer.resize(); if (game) { updateInsets(); renderer.resetCamera(); maybeRotateHint(); } }, 250));
document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.state !== 'won' && game.state !== 'lost' && $('modal').classList.contains('hidden')) openPause(); });
window.addEventListener('keydown', (e) => {
  if (!game) return;
  if (e.key === 'Escape') { if (ui.buildCell) closeBuildMenu(); else if (ui.selected) closeTowerMenu(); else openPause(); }
  if (e.key === ' ') { e.preventDefault(); if (game.canCallWave()) game.startWave(); }
});

// ---------------- loop ----------------
let last = performance.now();
const STEP = 1 / 60;
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (game && !paused) {
    acc += dt * speed;
    let n = 0;
    while (acc >= STEP && n < 12) { game.update(STEP); acc -= STEP; n++; }
    if (n === 12) acc = 0;
    processEvents();
    updateHUD();
  }
  if (game) renderer.draw(paused ? 0 : dt * Math.min(speed, 2), ui);
}

async function boot() {
  setSound(save.data.sound !== false);
  $('btn-sound').textContent = `TON: ${save.data.sound !== false ? 'AN' : 'AUS'}`;
  renderer.resize();
  await Assets.load((p) => { $('loadfill').style.width = Math.round(p * 100) + '%'; });
  makeIcons();
  await new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = 'assets/title.jpg'; });
  showScreen('screen-menu');
  requestAnimationFrame((t) => { last = t; frame(t); });
  const q = new URLSearchParams(location.search);
  if (q.has('level')) startLevel(Math.max(0, Math.min(LEVEL_COUNT - 1, (parseInt(q.get('level'), 10) || 1) - 1)));
}
boot();
