// Iron Sentinel – app controller: screens, HUD, build drawer, tower menu, game loop.
import { TOWERS, ENEMIES, TOWER_ORDER, MAX_LEVEL, BIOMES, BIOME_ORDER, UPGRADE_TIME, ELEV_RANGE, CLASS_NAME, EFFECT, POWERUPS, NUKE, HOLE, DIFFICULTY, effectOf, upgradeCost, towerStats } from './config.js';
import { LEVEL_SPECS, LEVEL_COUNT, getLevel, makeWaves, hpMultiplier } from './levels.js';
import { Assets, Models, drawIcon } from './assets.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { CHALLENGES, dailyChallenge, medalFor, MEDAL_NAME, todayKey } from './challenges.js';
import { toWorld, toGrid } from './iso.js';
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
  if (!on) { closeBuildMenu(); closeTowerMenu(); endAim(); $('nuke-flash').style.opacity = 0; hudCache.nukeFlash = 0; }
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
      const dw = (save.data.diffWon || {})[i];
      total += stars;
      const locked = !levelUnlocked(i);
      const btn = document.createElement('button');
      btn.className = 'ltile' + (locked ? ' locked' : '') + (stars ? ' done' : '');
      const n = 2 * L.M + 1;
      btn.innerHTML = `<div class="lnum">${locked ? '🔒' : i + 1}</div><div class="lname">${L.name}</div>`
        + `<div class="lmeta">${n}×${n} · ${L.paths} ${L.paths === 1 ? 'Pfad' : 'Pfade'}</div><div class="stars small">${starsHTML(stars)}</div>`
        + (dw > 0 ? `<div class="ldiff d${dw}">${DIFFICULTY[dw].name}</div>` : '');
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
  for (const k of TOWER_ORDER.filter(k => game.unlocked(k))) {
    const def = TOWERS[k];
    const b = document.createElement('button');
    b.className = 'bd-card';
    b.innerHTML = `<img src="${icons[k] || ''}" alt=""><span class="bd-name">${def.name}</span><span class="bd-cost">${IC('credits')}${def.cost}</span>`;
    b.onclick = (e) => { e.stopPropagation(); chooseTower(k); };
    box.appendChild(b);
    bmButtons.push({ el: b, k });
  }
  $('bd-info').innerHTML = '<span class="bd-hint">Turm wählen – die Reichweite wird auf der Karte angezeigt</span>';
  $('bd-build').classList.add('hidden');
  $('builddrawer').classList.remove('hidden');
  $('btn-wave').classList.add('under-drawer');
  $('btn-orbital').classList.add('under-drawer');
  $('btn-nuke').classList.add('under-drawer');
  $('btn-hole').classList.add('under-drawer');
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
function chooseTower(k) {
  if (!game || !ui.buildCell) return;
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
  if (game.credits < TOWERS[k].cost) { sfx('error'); toast('Nicht genug Credits', 'bad', 1200); return; }
  const t = game.build(k, ui.buildCell.x, ui.buildCell.y);
  if (t) closeBuildMenu();
}
function closeBuildMenu() {
  ui.buildCell = null; ui.previewType = null;
  $('builddrawer').classList.add('hidden');
  $('btn-wave').classList.remove('under-drawer');
  $('btn-orbital').classList.remove('under-drawer');
  $('btn-nuke').classList.remove('under-drawer');
  $('btn-hole').classList.remove('under-drawer');
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
  const key = [t.id, t.level, t.mode, game.credits >= cost, maxed, game.sellValue(t), rc, Math.round(t.hp), prog, t.kills, t.rank].join('|');
  if (!force && key === tmCache) return;
  tmCache = key;
  $('tm-name').textContent = def.name;
  $('tm-level').textContent = ['I', 'II', 'III'][t.level - 1];
  $('tm-hpfill').style.width = `${Math.max(0, t.hp / s.hp) * 100}%`;
  const next = maxed ? null : game.statsFor(t.type, t.level + 1, t.cx, t.cy);
  const dmg = def.dps ? `${Math.round(s.dps)}/s` : def.kind === 'hitscan' || def.kind === 'flak' ? `${Math.round(s.dmg)}×${s.rate.toFixed(1)}` : Math.round(s.dmg);
  const ndmg = next ? (def.dps ? Math.round(next.dps) : Math.round(next.dmg)) : null;
  $('tm-stats').innerHTML = `<span>${IC('damage')} ${dmg}${ndmg ? `<em>→${ndmg}</em>` : ''}</span><span>${IC('range')} ${s.range.toFixed(1)}</span><span>${IC('kills')} ${t.kills}${t.rank ? ` <em class="rank">${IC('star').repeat(t.rank)}</em>` : ''}</span>`;
  const up = $('tm-upgrade');
  up.disabled = maxed || game.credits < cost || !!t.upgrading;
  up.textContent = t.upgrading ? `⏳ ${prog} %` : maxed ? 'MAX' : `▲ ${cost} · ${UPGRADE_TIME[t.level]} s`;
  const rp = $('tm-repair');
  rp.classList.toggle('hidden', rc <= 0);
  rp.innerHTML = `${IC('wrench')} ${rc}`;
  rp.disabled = game.credits < rc;
  $('tm-mode').innerHTML = `${IC('target')} ${MODES[t.mode]}`;
  $('tm-mode').classList.toggle('hidden', !!def.static && def.kind !== 'emp');
  $('tm-sell').innerHTML = `${IC('sell')} +${game.sellValue(t)}`;
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
  const lv = game ? game.level.number : 1, wv = game ? Math.max(1, game.wave) : 1;
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
  if (!game || paused || game.state === 'won' || game.state === 'lost') return;
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
  const c = renderer.screenToCell(p.x, p.y);
  const inMap = c.x >= 0 && c.y >= 0 && c.x < game.N && c.y < game.N;
  const t = inMap ? game.towerAt(c.x, c.y) : null;
  if (t) { if (ui.selected === t) closeTowerMenu(); else openTowerMenu(t); return; }
  if (!(inMap && game.canBuild(c.x, c.y))) {
    const e = enemyAt(p);
    if (e) { closeBuildMenu(); closeTowerMenu(); showIntel(e.type, false); return; }
  }
  if (ui.buildCell && inMap && game.canBuild(c.x, c.y) && (c.x !== ui.buildCell.x || c.y !== ui.buildCell.y)) {
    const keep = ui.previewType;
    openBuildMenu(c.x, c.y);
    if (keep) chooseTower(keep);
    return;
  }
  if (ui.buildCell || ui.selected) { closeBuildMenu(); closeTowerMenu(); return; }
  if (inMap && game.canBuild(c.x, c.y)) openBuildMenu(c.x, c.y);
}
// ---------------- special weapons: aim preview ----------------
// tapping a weapon icon shows its real area of effect (ghost effect, hit markers, count) before anything happens
const AIM = {
  orbital: { name: 'ORBITALSCHLAG', icon: 'orbital', btn: 'btn-orbital', r: 1.7,
    fire: (a) => game.orbitalStrike(a.x, a.y) && toast('ORBITALSCHLAG EINGELEITET', 'warn', 1400) },
  nuke: { name: 'ATOMSCHLAG', icon: 'nuke', btn: 'btn-nuke', r: NUKE.outer,
    fire: (a) => game.nukeStrike(a.x, a.y) && toast('ATOMSCHLAG EINGELEITET – IN DECKUNG!', 'bad', 2200) },
  hole: { name: 'SCHWARZES LOCH', icon: 'hole', btn: 'btn-hole', r: HOLE.radius,
    fire: (a) => game.holeStrike(a.x, a.y) && toast('SCHWARZES LOCH GEÖFFNET', 'warn', 1600) },
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
  $('aim-hint').textContent = finePointer ? 'Maus bewegen, Klick setzt das Ziel' : 'Karte antippen oder Ziel ziehen';
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
  const n = game.enemiesInRange(a.x, a.y, r, true, true).length;
  let html = n ? `<b>${n}</b> Gegner im Wirkungsbereich` : 'Keine Gegner im Wirkungsbereich';
  if (k === 'nuke') {
    const own = game.towers.filter(t => Math.hypot(t.gx - a.x, t.gy - a.y) <= NUKE.towerRadius).length;
    if (own) html += ` · <em>${own} eigene${own === 1 ? 'r Turm' : ' Türme'} beschädigt</em>`;
  }
  if (k === 'hole') html += ' · zieht 10 s lang alles ein';
  if (hudCache['aim-count'] !== html) { hudCache['aim-count'] = html; $('aim-count').innerHTML = html; }
}
$('aim-fire').onclick = () => { unlockAudio(); fireAim(); };
$('aim-cancel').onclick = () => { endAim(); sfx('click'); };

new Input(canvas, renderer, {
  tap: onTap,
  // desktop: the reticle follows the mouse
  hover: (p) => { if (game && ui.targeting && p) ui.aim = aimAt(p); },
  // touch: dragging that starts on the reticle moves it (anywhere else still pans the camera)
  dragStart: (p) => {
    if (!game || !ui.targeting || paused) return false;
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
  b.style.setProperty('--p', (n.charge / n.need).toFixed(3));
  b.classList.toggle('ready', ready && ui.targeting !== 'nuke');
  setText('nuke-cd', ui.targeting === 'nuke' ? 'ZIEL' : ready ? 'BEREIT' : `${Math.floor(n.charge / n.need * 100)} %`);
}
function updateBuffs() {
  const html = Object.entries(game.buffs).filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="buff" style="--bc:${POWERUPS[k].color}">${IC(POWERUPS[k].icon)} ${POWERUPS[k].name} ${Math.ceil(v)}s</span>`).join('');
  if (hudCache.buffs !== html) { hudCache.buffs = html; $('buffs').innerHTML = html; }
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
  updateAim();
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
  $('modal').classList.remove('hidden', 'intel-modal');
}
function closeModal() { $('modal').classList.add('hidden'); }

function openPause() {
  if (!game || game.state === 'won' || game.state === 'lost') return;
  paused = true;
  sfx('click');
  modal('PAUSE', '', `Einsatz ${game.level.number}: <b>${game.level.name}</b>${challenge ? '' : ' · ' + DIFFICULTY[game.mods.diff || 0].name} · Welle ${game.wave}/${game.waves.length}`, 0, [
    ['WEITER', 'primary', () => { paused = false; closeModal(); }],
    ['FEINDKATALOG', '', () => openCatalog()],
    [`TON: ${soundOn() ? 'AN' : 'AUS'}`, '', () => { toggleSound(); openPause(); }],
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
    else if (ev.type === 'nukeHit') { if (navigator.vibrate) try { navigator.vibrate([120, 60, 200]); } catch (e) { /* ignore */ } }
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
async function startLevel(i, ch = null) {
  unlockAudio();
  const spec = LEVEL_SPECS[i];
  challenge = ch;
  const g = new Game(i, { ...(ch ? ch.mods : DIFFICULTY[diffIdx()].mods), unlockAll: freePlay(), diff: ch ? 0 : diffIdx() });
  // only the enemy types of this mission (incl. units launched by carriers / bursting out)
  const types = new Set();
  for (const w of g.waves.slice(0, 60)) for (const gr of w.groups) {
    types.add(gr.type);
    const d = ENEMIES[gr.type];
    if (d.spawns) types.add(d.spawns.type);
    if (d.burst) types.add(d.burst.type);
  }
  const models = [...types].map(t => ENEMIES[t].model);
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
  if (ch) toast(`CHALLENGE: ${ch.name.toUpperCase()} – ${ch.desc}`, 'warn', 4500);
  else toast(`EINSATZ ${i + 1}: ${spec.name.toUpperCase()} – ${BIOMES[spec.biome].name} · ${DIFFICULTY[game.mods.diff].name}`, game.mods.diff ? 'warn' : '', 2600);
  const newTower = freePlay() ? null : TOWER_ORDER.find(k => TOWERS[k].unlock === i + 1 && i > 0);
  if (newTower) setTimeout(() => toast(`Neuer Turm verfügbar: ${TOWERS[newTower].name}`, 'warn', 3500), 900);
  if (i === 0) setTimeout(() => toast('Tippe ein freies Feld an, um einen Turm zu bauen', '', 4000), 1200);
  else if (game.N > 15 && !save.data.bigMapHint) {
    save.data.bigMapHint = true; save.write();
    setTimeout(() => toast('Große Karte: mit zwei Fingern zoomen und verschieben – rote Pfeile zeigen Gegner außerhalb', '', 5000), 1200);
  } else if (game.routes.length > 1) setTimeout(() => toast(`${game.routes.length} Angriffspfade – verteidige alle Zugänge!`, '', 3200), 1400);
  if (freePlay() && game.hole.on && game.nuke.on && game.orbital.on && !(save.data.holeHint && save.data.nukeHint && save.data.orbitalHint)) {
    save.data.holeHint = save.data.nukeHint = save.data.orbitalHint = true; save.write();
    setTimeout(() => toast('Spezialwaffen rechts: Orbitalschlag (lädt nach), Atombombe (lädt durch Abschüsse), Schwarzes Loch – antippen, dann Ziel wählen', 'warn', 6000), 2400);
  }
  if (game.hole.on && !save.data.holeHint) {
    save.data.holeHint = true; save.write();
    setTimeout(() => toast('Neu: SCHWARZES LOCH – saugt Gegner 10 Sekunden lang ein (Knopf rechts oben)', 'warn', 5000), 4200);
  }
  if (game.nuke.on && !save.data.nukeHint) {
    save.data.nukeHint = true; save.write();
    setTimeout(() => toast('Neu: ATOMBOMBE – lädt sich durch Abschüsse auf (Knopf rechts)', 'warn', 5000), 3400);
  }
  if (game.orbital.on && !save.data.orbitalHint) {
    save.data.orbitalHint = true; save.write();
    setTimeout(() => toast('Neu: ORBITALSCHLAG – Knopf unten rechts, dann Ziel antippen', 'warn', 4500), 2600);
  }
  maybeRotateHint();
}
function toMenu() { game = null; setInGameUI(false); showScreen('screen-menu'); }
let levelTab = 'campaign';
function toLevels(tab) {
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
function updateFreeBtn() { $('btn-free').textContent = `FREIES SPIEL: ${freePlay() ? 'AN' : 'AUS'}`; }
$('btn-free').onclick = () => {
  unlockAudio(); sfx('click');
  save.data.free = !freePlay(); save.write(); updateFreeBtn();
  toast(freePlay() ? 'Freies Spiel: alle Einsätze, Challenges, Türme und Fähigkeiten verfügbar' : 'Klassisch: Einsätze, Türme und Fähigkeiten werden nacheinander freigeschaltet', '', 3200);
};
updateFreeBtn();

window.addEventListener('resize', () => { renderer.resize(); if (game) { updateInsets(); renderer.clampCam(); maybeRotateHint(); } });
window.addEventListener('orientationchange', () => setTimeout(() => { renderer.resize(); if (game) { updateInsets(); renderer.resetCamera(); maybeRotateHint(); } }, 250));
document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.state !== 'won' && game.state !== 'lost' && $('modal').classList.contains('hidden')) openPause(); });
window.addEventListener('keydown', (e) => {
  if (!game) return;
  if (ui.targeting && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); if (e.key === 'Enter') fireAim(); else endAim(); return; }
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
  let ts = 1;
  if (game && !paused) {
    // cinematic time (nuclear strike): freeze, slow motion, ramp back - the HUD and screen effects run in real time
    ts = game.timeScale();
    game.advanceCinematic(dt);
    game.fx.realtimeScreen = true;
    game.fx.screen(dt);
    // the nuclear flash also blinds the HUD: double flash, white-out, quick fade (the map keeps glowing longer)
    const b = game.fx.blind, bt = b ? b.t : 9;
    const ha = bt < 0.07 ? 1 : bt < 0.14 ? 0.5 : bt < 0.55 ? 1 : Math.max(0, 1 - (bt - 0.55) / 0.5);
    if (hudCache.nukeFlash !== ha) { hudCache.nukeFlash = ha; $('nuke-flash').style.opacity = ha.toFixed(3); }
    acc += dt * speed * ts;
    let n = 0;
    while (acc >= STEP && n < 12) { game.update(STEP); acc -= STEP; n++; }
    if (n === 12) acc = 0;
    processEvents();
    updateHUD();
  }
  if (game) renderer.draw(paused ? 0 : dt * Math.min(speed, 2) * ts, ui);
}

async function boot() {
  setSound(save.data.sound !== false);
  $('btn-sound').textContent = `TON: ${save.data.sound !== false ? 'AN' : 'AUS'}`;
  renderer.resize();
  await Assets.load((p) => { $('loadfill').style.width = Math.round(p * 100) + '%'; });
  makeIcons();
  installIconCss();
  await new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = 'assets/title.jpg'; });
  showScreen('screen-menu');
  requestAnimationFrame((t) => { last = t; frame(t); });
  const q = new URLSearchParams(location.search);
  if (q.has('level')) startLevel(Math.max(0, Math.min(LEVEL_COUNT - 1, (parseInt(q.get('level'), 10) || 1) - 1)));
}
boot();
