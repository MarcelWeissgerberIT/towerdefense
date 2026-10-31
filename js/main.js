// Iron Sentinel – app controller: screens, HUD, build bar, game loop.
import { TOWERS, TOWER_ORDER, LEVELS, MAX_LEVEL, WAVE_COUNT, upgradeCost, towerStats } from './config.js';
import { Assets } from './assets.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { sfx, unlockAudio, setSound, soundOn } from './audio.js';

const $ = (id) => document.getElementById(id);
const STORE = 'ironsentinel.v1';

const save = (() => {
  let data = { stars: {}, sound: true, rotateHintSeen: false };
  try { Object.assign(data, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { /* private mode */ }
  return {
    data,
    write() { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* ignore */ } },
  };
})();

const canvas = $('game');
const renderer = new Renderer(canvas);
let game = null;
let paused = false;
let speed = 1;
const ui = { placing: null, ghost: null, selected: null, pending: null };

// ---------------- screens ----------------
function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}
function hideScreens() { for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden'); }
function setInGameUI(on) {
  for (const id of ['hud', 'buildbar', 'btn-wave']) $(id).classList.toggle('hidden', !on);
  if (!on) { $('towerpanel').classList.add('hidden'); $('confirm').classList.add('hidden'); }
}

function starsHTML(n) {
  let s = '';
  for (let i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return s;
}

function renderLevels() {
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const prev = i === 0 ? 1 : (save.data.stars[LEVELS[i - 1].id] || 0);
    const locked = prev === 0;
    const stars = save.data.stars[L.id] || 0;
    const b = document.createElement('button');
    b.className = 'lcard' + (locked ? ' locked' : '');
    b.innerHTML = `<div class="num">EINSATZ ${i + 1}</div><div class="name">${L.name}</div><div class="sub">${L.sub}</div>
      <div class="meta"><span>${locked ? '🔒 Gesperrt' : `${L.paths.length > 1 ? '2 Angriffsrouten · ' : ''}${WAVE_COUNT} Wellen`}</span><span class="stars">${starsHTML(stars)}</span></div>`;
    b.onclick = () => {
      if (locked) { sfx('error'); toast('Schließe zuerst den vorherigen Einsatz ab', 'bad'); return; }
      sfx('click');
      startLevel(i);
    };
    list.appendChild(b);
  });
}

// ---------------- toasts ----------------
function toast(text, kind = '', ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  const box = $('toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
}

// ---------------- build bar ----------------
const cards = {};
function buildBar() {
  const bar = $('buildbar');
  bar.innerHTML = '';
  for (const key of TOWER_ORDER) {
    const def = TOWERS[key];
    const b = document.createElement('button');
    b.className = 'tcard';
    b.innerHTML = `<span class="tname">${def.name.toUpperCase()}</span><img src="assets/sprites/${def.sprite}.webp" alt=""><span class="cost">${def.cost}</span>`;
    b.onclick = (e) => { e.stopPropagation(); unlockAudio(); selectBuild(key); };
    bar.appendChild(b);
    cards[key] = b;
  }
}

function selectBuild(key) {
  if (!game || game.state === 'won' || game.state === 'lost') return;
  closeTowerPanel();
  if (ui.placing === key) { cancelPlacing(); return; }
  sfx('click');
  ui.placing = key;
  ui.ghost = null;
  ui.pending = null;
  $('confirm').classList.add('hidden');
  for (const k in cards) cards[k].classList.toggle('sel', k === key);
  if (game.credits < TOWERS[key].cost) toast('Nicht genug Credits', 'bad', 1400);
  else toast(`${TOWERS[key].name}: freies Feld antippen`, '', 1600);
}

function cancelPlacing() {
  ui.placing = null;
  ui.ghost = null;
  ui.pending = null;
  $('confirm').classList.add('hidden');
  for (const k in cards) cards[k].classList.remove('sel');
}

function confirmBuild() {
  if (!ui.pending || !game) return;
  const { type, cx, cy } = ui.pending;
  const t = game.build(type, cx, cy);
  if (t) cancelPlacing();
  else { ui.pending = null; $('confirm').classList.add('hidden'); }
}

// ---------------- tower panel ----------------
function openTowerPanel(t) {
  cancelPlacing();
  ui.selected = t;
  $('towerpanel').classList.remove('hidden');
  $('tp-img').src = `assets/sprites/${TOWERS[t.type].sprite}.webp`;
  updateTowerPanel(true);
  sfx('click');
}
function closeTowerPanel() {
  ui.selected = null;
  $('towerpanel').classList.add('hidden');
}

let tpCache = '';
function updateTowerPanel(force) {
  const t = ui.selected;
  if (!t || !game) return;
  const def = TOWERS[t.type];
  const s = t.stats;
  const maxed = t.level >= MAX_LEVEL;
  const next = maxed ? null : towerStats(t.type, t.level + 1);
  const cost = maxed ? 0 : upgradeCost(t.type, t.level);
  const key = [t.id, t.level, t.mode, game.credits >= cost, maxed, game.sellValue(t), t.kills].join('|');
  if (!force && key === tpCache) return;
  tpCache = key;
  $('tp-name').textContent = def.name;
  $('tp-level').textContent = 'STUFE ' + ['I', 'II', 'III'][t.level - 1] + (maxed ? ' · MAX' : '');
  const d = (a, b, f = (v) => Math.round(v)) => `${f(a)}${b !== undefined && b !== null ? `<em>→${f(b)}</em>` : ''}`;
  const f1 = (v) => v.toFixed(1);
  let special = '';
  if (t.type === 'missile') special = `<div class="tp-stat"><small>FLÄCHE</small><b>${d(s.splash, next && next.splash, f1)}</b></div>`;
  else if (t.type === 'plasma') special = `<div class="tp-stat"><small>PANZERUNG</small><b>ignoriert</b></div>`;
  else if (t.type === 'rail') special = `<div class="tp-stat"><small>DURCHSCHLAG</small><b>Linie</b></div>`;
  else if (t.type === 'emp') special = `<div class="tp-stat"><small>KETTE / SLOW</small><b>${s.chain} · ${Math.round(s.slow * 100)}%</b></div>`;
  else special = `<div class="tp-stat"><small>ZIELE</small><b>Boden+Luft</b></div>`;
  $('tp-stats').innerHTML =
    `<div class="tp-stat"><small>SCHADEN</small><b>${d(s.dmg, next && next.dmg)}</b></div>` +
    `<div class="tp-stat"><small>REICHWEITE</small><b>${d(s.range, next && next.range, f1)}</b></div>` +
    `<div class="tp-stat"><small>SCHUSS/S</small><b>${d(s.rate, next && next.rate, f1)}</b></div>` + special;
  for (const b of $('tp-modes').children) b.classList.toggle('on', b.dataset.mode === t.mode);
  const up = $('tp-upgrade');
  up.disabled = maxed || game.credits < cost;
  up.textContent = maxed ? 'MAXIMAL' : `UPGRADE · ${cost}`;
  $('tp-sell').textContent = `VERKAUFEN · +${game.sellValue(t)}`;
}

$('tp-close').onclick = () => { closeTowerPanel(); sfx('click'); };
$('tp-upgrade').onclick = () => { if (ui.selected && game.upgrade(ui.selected)) updateTowerPanel(true); };
$('tp-sell').onclick = () => { if (ui.selected) { game.sell(ui.selected); closeTowerPanel(); } };
for (const b of $('tp-modes').children) {
  b.onclick = () => { if (ui.selected) { ui.selected.mode = b.dataset.mode; sfx('click'); updateTowerPanel(true); } };
}
$('btn-confirm').onclick = () => confirmBuild();
$('btn-cancel').onclick = () => { cancelPlacing(); sfx('click'); };

// ---------------- map interaction ----------------
function onTap(p) {
  unlockAudio();
  if (!game || paused || game.state === 'won' || game.state === 'lost') return;
  const c = renderer.screenToCell(p.x, p.y);
  const inMap = c.x >= 0 && c.y >= 0 && c.x < game.N && c.y < game.N;
  if (ui.placing) {
    if (!inMap) { cancelPlacing(); return; }
    const existing = game.towerAt(c.x, c.y);
    if (existing) { openTowerPanel(existing); return; }
    const ok = game.canBuild(c.x, c.y);
    if (!ok) { sfx('error'); toast('Hier kann nicht gebaut werden', 'bad', 1200); return; }
    if (p.type === 'mouse') { ui.pending = { type: ui.placing, cx: c.x, cy: c.y }; confirmBuild(); return; }
    // touch: two-step (preview, then confirm)
    if (ui.pending && ui.pending.cx === c.x && ui.pending.cy === c.y) { confirmBuild(); return; }
    ui.pending = { type: ui.placing, cx: c.x, cy: c.y };
    ui.ghost = { type: ui.placing, cx: c.x, cy: c.y, ok: true };
    const def = TOWERS[ui.placing];
    const bc = $('btn-confirm');
    bc.textContent = `${def.name.toUpperCase()} BAUEN · ${def.cost}`;
    bc.disabled = game.credits < def.cost;
    $('confirm').classList.remove('hidden');
    sfx('click');
    return;
  }
  const t = inMap ? game.towerAt(c.x, c.y) : null;
  if (t) { if (ui.selected === t) closeTowerPanel(); else openTowerPanel(t); }
  else if (ui.selected) closeTowerPanel();
}

function onHover(p) {
  if (!game || !ui.placing) return;
  if (!p) { if (!ui.pending) ui.ghost = null; return; }
  const c = renderer.screenToCell(p.x, p.y);
  const inMap = c.x >= 0 && c.y >= 0 && c.x < game.N && c.y < game.N;
  ui.ghost = inMap ? { type: ui.placing, cx: c.x, cy: c.y, ok: game.canBuild(c.x, c.y) } : null;
}

new Input(canvas, renderer, { tap: onTap, hover: onHover });

// ---------------- HUD ----------------
const hudCache = {};
function setText(id, v) {
  if (hudCache[id] === v) return false;
  hudCache[id] = v;
  $(id).textContent = v;
  return true;
}
function pulse(id) {
  const el = $(id);
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

function updateHUD() {
  if (!game) return;
  setText('hud-lives', String(game.lives));
  if (setText('hud-credits', String(game.credits))) pulse('stat-credits');
  setText('hud-wave', `${game.wave}/${WAVE_COUNT}`);
  for (const k of TOWER_ORDER) {
    const poor = game.credits < TOWERS[k].cost;
    if (cards[k]._poor !== poor) { cards[k]._poor = poor; cards[k].classList.toggle('poor', poor); }
  }
  // wave button
  const b = $('btn-wave');
  let label, sub = '', enabled;
  if (game.state === 'build') { label = '▶ ANGRIFF STARTEN'; sub = 'Welle 1 rufen'; enabled = true; }
  else if (game.wave >= WAVE_COUNT) { label = 'LETZTE WELLE'; sub = `${game.enemies.length + game.queue.length} Gegner übrig`; enabled = false; }
  else if (game.canCallWave()) {
    label = `⏩ WELLE ${game.wave + 1}`;
    sub = game.breakTimer > 0 ? `startet in ${Math.ceil(game.breakTimer)} s · Bonus` : 'jetzt rufen · Bonus';
    enabled = true;
  } else { label = `WELLE ${game.wave} LÄUFT`; sub = `${game.enemies.length + game.queue.length} Gegner`; enabled = false; }
  setText('wave-label', label);
  setText('wave-sub', sub);
  if (b.disabled === enabled) b.disabled = !enabled;
  b.classList.toggle('attention', game.state === 'build');
  if (ui.pending) {
    const bc = $('btn-confirm');
    const poor = game.credits < TOWERS[ui.pending.type].cost;
    if (bc.disabled !== poor) bc.disabled = poor;
  }
  if (ui.selected) {
    if (!game.towers.includes(ui.selected)) closeTowerPanel();
    else updateTowerPanel(false);
  }
}

$('btn-wave').onclick = () => { unlockAudio(); if (game && game.canCallWave()) game.startWave(); };
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
  modal('PAUSE', '', `Einsatz: <b>${game.level.name}</b> · Welle ${game.wave}/${WAVE_COUNT}`, 0, [
    ['WEITER', 'primary', () => { paused = false; closeModal(); }],
    [`TON: ${soundOn() ? 'AN' : 'AUS'}`, '', () => { toggleSound(); openPause(); }],
    ['NEU STARTEN', '', () => { closeModal(); startLevel(game.levelIdx); }],
    ['EINSATZ VERLASSEN', 'danger', () => { closeModal(); toMenu(); }],
  ]);
}

function onWin() {
  const stars = game.stars();
  const id = game.level.id;
  save.data.stars[id] = Math.max(save.data.stars[id] || 0, stars);
  save.write();
  sfx('victory');
  const hasNext = game.levelIdx < LEVELS.length - 1;
  const btns = [];
  if (hasNext) btns.push(['NÄCHSTER EINSATZ', 'primary', () => { closeModal(); startLevel(game.levelIdx + 1); }]);
  btns.push(['NOCHMAL SPIELEN', hasNext ? '' : 'primary', () => { closeModal(); startLevel(game.levelIdx); }]);
  btns.push(['EINSATZÜBERSICHT', '', () => { closeModal(); toLevels(); }]);
  setTimeout(() => modal('SIEG', 'win',
    `Das Hauptquartier hält stand.<br>Basis-Integrität: <b>${game.lives}/${game.maxLives}</b> · Zerstörte Maschinen: <b>${game.kills}</b>` +
    (hasNext ? '' : '<br><br><b>Alle Einsätze abgeschlossen – die Menschheit hat eine Zukunft.</b>'),
    stars, btns), 900);
}
function onLose() {
  sfx('defeat');
  setTimeout(() => modal('BASIS ZERSTÖRT', 'lose',
    `Die Maschinen haben das Hauptquartier überrannt – in Welle ${game.wave}.<br>Zerstörte Maschinen: <b>${game.kills}</b>`,
    0, [
      ['NOCHMAL VERSUCHEN', 'primary', () => { closeModal(); startLevel(game.levelIdx); }],
      ['EINSATZÜBERSICHT', '', () => { closeModal(); toLevels(); }],
    ]), 900);
}

function processEvents() {
  for (const ev of game.events) {
    if (ev.type === 'toast') toast(ev.text, ev.bad ? 'bad' : ev.warn ? 'warn' : '', ev.long ? 3800 : 2200);
    else if (ev.type === 'baseHit') {
      pulse('stat-lives');
      const f = $('damage-flash');
      f.classList.add('on');
      setTimeout(() => f.classList.remove('on'), 60);
      if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) { /* ignore */ }
    } else if (ev.type === 'wave') {
      toast(`WELLE ${ev.n} / ${WAVE_COUNT}`, '', 1600);
    } else if (ev.type === 'won') onWin();
    else if (ev.type === 'lost') onLose();
  }
  game.events.length = 0;
}

// ---------------- flow ----------------
function updateInsets() {
  const portrait = window.innerWidth <= window.innerHeight;
  renderer.insets = portrait
    ? { top: 50, bottom: 96, left: 0, right: 0 }
    : { top: 48, bottom: 0, left: 0, right: window.innerHeight <= 430 ? 76 : 92 };
}

function startLevel(i) {
  unlockAudio();
  game = new Game(i);
  window.__game = game;
  window.__renderer = renderer;
  paused = false;
  speed = 1;
  $('btn-speed').textContent = '1×';
  $('btn-speed').classList.remove('on');
  cancelPlacing();
  closeTowerPanel();
  updateInsets();
  renderer.setGame(game);
  hideScreens();
  setInGameUI(true);
  for (const k in hudCache) delete hudCache[k];
  updateHUD();
  toast(`${game.level.name.toUpperCase()} – ${game.level.sub}`, '', 2600);
  maybeRotateHint();
}

function toMenu() {
  game = null;
  setInGameUI(false);
  showScreen('screen-menu');
}
function toLevels() {
  game = null;
  setInGameUI(false);
  renderLevels();
  showScreen('screen-levels');
}

function toggleSound() {
  save.data.sound = !soundOn();
  setSound(save.data.sound);
  save.write();
  $('btn-sound').textContent = `TON: ${save.data.sound ? 'AN' : 'AUS'}`;
}

function maybeRotateHint() {
  const el = $('rotate-hint');
  const portrait = window.innerWidth < window.innerHeight;
  el.classList.toggle('hidden', !(portrait && game && !save.data.rotateHintSeen && window.innerWidth < 700));
}
$('rotate-ok').onclick = () => { save.data.rotateHintSeen = true; save.write(); $('rotate-hint').classList.add('hidden'); };

$('btn-play').onclick = () => { unlockAudio(); sfx('click'); toLevels(); };
$('btn-help').onclick = () => { unlockAudio(); sfx('click'); showScreen('screen-help'); };
$('btn-help-back').onclick = () => { sfx('click'); showScreen('screen-menu'); };
$('btn-levels-back').onclick = () => { sfx('click'); showScreen('screen-menu'); };
$('btn-sound').onclick = () => { unlockAudio(); toggleSound(); sfx('click'); };

window.addEventListener('resize', () => {
  renderer.resize();
  if (game) { updateInsets(); renderer.clampCam(); maybeRotateHint(); }
});
window.addEventListener('orientationchange', () => setTimeout(() => {
  renderer.resize();
  if (game) { updateInsets(); renderer.resetCamera(); maybeRotateHint(); }
}, 250));
document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.state !== 'won' && game.state !== 'lost' && $('modal').classList.contains('hidden')) openPause(); });
window.addEventListener('keydown', (e) => {
  if (!game) return;
  if (e.key === 'Escape') { if (ui.placing) cancelPlacing(); else if (ui.selected) closeTowerPanel(); else openPause(); }
  if (e.key === ' ') { e.preventDefault(); if (game.canCallWave()) game.startWave(); }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= TOWER_ORDER.length) selectBuild(TOWER_ORDER[n - 1]);
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
  if (game) renderer.draw(paused ? 0 : dt, ui);
}

// ---------------- boot ----------------
async function boot() {
  setSound(save.data.sound !== false);
  $('btn-sound').textContent = `TON: ${save.data.sound !== false ? 'AN' : 'AUS'}`;
  renderer.resize();
  buildBar();
  await Assets.load((p) => { $('loadfill').style.width = Math.round(p * 100) + '%'; });
  // preload title image before showing the menu
  await new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = 'assets/title.jpg'; });
  showScreen('screen-menu');
  requestAnimationFrame((t) => { last = t; frame(t); });
  const q = new URLSearchParams(location.search);
  if (q.has('level')) startLevel(Math.max(0, Math.min(LEVELS.length - 1, parseInt(q.get('level'), 10) || 0)));
}
boot();
