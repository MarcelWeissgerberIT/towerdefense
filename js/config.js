// Iron Sentinel – game data: towers, enemies, biomes.

export const TILE_W = 128;          // iso tile width in world px
export const TILE_H = 64;
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;
export const UNIT_PX = HW * Math.SQRT2; // world px per 3D model unit (1 tile = 1 unit)

export const TOWER_SCALE = 1.25;   // draw scale for tower models (readability)
export const MAX_LEVEL = 3;
export const UPGRADE_TIME = { 1: 4, 2: 6 };   // seconds to upgrade from level n to n+1
export const WAVE_GAP = 14;                   // seconds between the end of one wave's spawning and the next wave
export const SELL_RATE = 0.7;
export const FULL_REFUND_TIME = 6;   // seconds after building: 100 % refund (undo)

// kind: hitscan | missile | plasma | rail | emp | flak | flame | laser | mortar
export const TOWERS = {
  gatling: {
    name: 'Gatling-MG', model: 'tower_gatling', unlock: 1, kind: 'hitscan',
    desc: 'Rotorkanone mit enormer Feuerrate. Boden + Luft. Schwach gegen Panzerung.',
    cost: 100, range: 2.6, rate: 8, dmg: 7, ground: true, air: true, turn: 8, hp: 630, color: '#ffc04d',
  },
  missile: {
    name: 'Raketenwerfer', model: 'tower_missile', unlock: 1, kind: 'missile',
    desc: 'Zielsuchende Raketen mit Flächenschaden. Stark gegen Luftziele.',
    cost: 170, range: 3.6, rate: 0.9, dmg: 34, splash: 0.9, ground: true, air: true, turn: 4, hp: 570, color: '#ff6a3d',
  },
  plasma: {
    name: 'Plasmakanone', model: 'tower_plasma', unlock: 2, kind: 'plasma',
    desc: 'Plasmaladung ignoriert Panzerung, zerstört Schilde. Nur Bodenziele.',
    cost: 230, range: 2.9, rate: 1.0, dmg: 72, splash: 0.55, ground: true, air: false, turn: 3.5, hp: 690, color: '#4fe3ff',
  },
  emp: {
    name: 'EMP-Turm', model: 'tower_emp', unlock: 3, kind: 'emp', static: true,
    desc: 'Kettenblitz verlangsamt Maschinen und reißt Energieschilde ein.',
    cost: 200, range: 2.5, rate: 1.1, dmg: 12, chain: 4, slow: 0.45, slowDur: 1.6, ground: true, air: true, hp: 540, color: '#c58bff',
  },
  flak: {
    name: 'Flak', model: 'tower_flak', unlock: 5, kind: 'flak',
    desc: 'Vierlings-Flugabwehr. Zerfetzt Drohnen mit Splitterwolken. Nur Luftziele.',
    cost: 180, range: 3.5, rate: 3.2, dmg: 17, splash: 0.65, ground: false, air: true, turn: 6, hp: 570, color: '#d8ff6a',
  },
  flame: {
    name: 'Flammenwerfer', model: 'tower_flame', unlock: 7, kind: 'flame',
    desc: 'Flammenstrahl trifft alles im Kegel und setzt Maschinen in Brand. Kurze Reichweite.',
    cost: 210, range: 1.95, dps: 58, cone: 0.62, burn: 14, burnDur: 2.2, ground: true, air: false, turn: 5, hp: 810, color: '#ff8c2a',
  },
  rail: {
    name: 'Railgun', model: 'tower_rail', unlock: 9, kind: 'rail',
    desc: 'Elektromagnetisches Geschoss durchschlägt alles in einer Linie. Extreme Reichweite.',
    cost: 340, range: 5.6, rate: 0.33, dmg: 235, ground: true, air: true, turn: 2.6, hp: 600, color: '#9fd8ff',
  },
  laser: {
    name: 'Laser', model: 'tower_laser', unlock: 12, kind: 'laser',
    desc: 'Dauerstrahl, dessen Schaden sich auf demselben Ziel bis zum Dreifachen aufheizt.',
    cost: 300, range: 3.4, dps: 46, ramp: 3, rampTime: 2.4, ground: true, air: true, turn: 4.5, hp: 600, color: '#ff4040',
  },
  mortar: {
    name: 'Mörser', model: 'tower_mortar', unlock: 15, kind: 'mortar',
    desc: 'Schwere Artillerie mit riesigem Wirkungsradius. Mindestreichweite, nur Bodenziele.',
    cost: 280, range: 5.2, minRange: 1.4, rate: 0.42, dmg: 120, splash: 1.25, ground: true, air: false, turn: 2.2, hp: 780, color: '#e0c080',
  },
};
// effectiveness of each tower against the enemy classes (damage multiplier; 0 = cannot target)
export const CLASS_NAME = { light: 'Leicht', armored: 'Gepanzert', heavy: 'Schwer gepanzert', air: 'Luftziel' };
export const EFFECT = {
  gatling: { light: 1.4, armored: 0.75, heavy: 0.45, air: 1.1 },
  missile: { light: 0.8, armored: 1.1, heavy: 1.0, air: 1.8 },
  plasma:  { light: 0.8, armored: 1.3, heavy: 1.5, air: 0 },
  emp:     { light: 1.2, armored: 1.0, heavy: 0.8, air: 1.4 },
  flak:    { light: 0, armored: 0, heavy: 0, air: 1.5 },
  flame:   { light: 1.5, armored: 1.0, heavy: 0.55, air: 0 },
  rail:    { light: 0.6, armored: 1.2, heavy: 1.6, air: 1.0 },
  laser:   { light: 0.9, armored: 1.1, heavy: 1.35, air: 1.0 },
  mortar:  { light: 1.25, armored: 1.0, heavy: 0.75, air: 0 },
};
export function effectOf(towerType, enemyType) {
  const t = TOWERS[towerType], e = ENEMIES[enemyType];
  if (e.air ? !t.air : !t.ground) return 0;
  return EFFECT[towerType][e.cls] ?? 1;
}
export const TOWER_ORDER = ['gatling', 'missile', 'plasma', 'emp', 'flak', 'flame', 'rail', 'laser', 'mortar'];

export function towerStats(type, level) {
  const t = TOWERS[type];
  const l = level - 1;
  const m = Math.pow(1.5, l);
  return {
    dmg: (t.dmg || 0) * m,
    dps: (t.dps || 0) * m,
    burn: (t.burn || 0) * m,
    range: t.range * (1 + 0.1 * l),
    rate: (t.rate || 1) * (1 + 0.12 * l),
    splash: t.splash ? t.splash * (1 + 0.1 * l) : 0,
    chain: t.chain ? t.chain + l : 0,
    slow: t.slow ? Math.min(0.7, t.slow + 0.08 * l) : 0,
    hp: Math.round(t.hp * (1 + 0.35 * l)),
  };
}
export const upgradeCost = (type, level) => Math.round(TOWERS[type].cost * 0.8 * level);
export function totalInvested(type, level) {
  let c = TOWERS[type].cost;
  for (let l = 1; l < level; l++) c += upgradeCost(type, l);
  return c;
}

// scale: extra draw scale on top of the model's real size (readability)
// atk: weapon used against towers {dmg, range, rate, kind: laser|cannon|plasma|missile|shell, splash}
export const ENEMIES = {
  spider:   { cls: 'light', info: 'Schneller, leichter Aufklärer. Kommt in großen Schwärmen – einzeln harmlos, in Masse gefährlich.', motion: 'spider', stride: 0.22, name: 'Späher-Spinne',   model: 'enemy_spider',   hp: 40,   speed: 1.6,  armor: 0,  reward: 5,   leak: 1, cost: 1,  scale: 0.9 },
  android:  { cls: 'light', info: 'Standard-Infanterie der Maschinen. Marschiert in Reihen und schießt mit Lasern auf nahe Türme.', motion: 'biped', stride: 0.4, cycle: 0.8, name: 'Endoskelett',     model: 'enemy_android',  hp: 110,  speed: 0.95, armor: 1,  reward: 8,   leak: 1, cost: 2,  scale: 0.9,
    atk: { dmg: 5, range: 1.8, rate: 1.0, kind: 'laser' } },
  drone:    { cls: 'air', info: 'Fliegt über das Gelände und beschießt Türme mit Raketen. Reine Bodengeschütze können sie nicht treffen.', motion: 'hover', name: 'Jäger-Drohne',    model: 'enemy_drone',    hp: 90,   speed: 1.3,  armor: 0,  reward: 12,  leak: 1, cost: 3, scale: 0.9, air: true, lift: 52,
    atk: { dmg: 9, range: 2.2, rate: 0.6, kind: 'missile' } },
  mech:     { cls: 'armored', info: 'Gepanzerter Kampfläufer mit schwerer Kanone. Nimmt Türme am Wegrand gezielt unter Beschuss.', motion: 'biped', stride: 0.5, cycle: 1.0, name: 'Sturm-Mech',      model: 'enemy_mech',     hp: 420,  speed: 0.68, armor: 4,  reward: 20,  leak: 2, cost: 7,  scale: 0.9,
    atk: { dmg: 15, range: 2.2, rate: 0.8, kind: 'cannon' } },
  tank:     { cls: 'heavy', info: 'Langsam, aber extrem gepanzert, mit Plasmakanone. Leichte Waffen prallen einfach ab.', motion: 'tracks', name: 'HK-Panzer',       model: 'enemy_tank',     hp: 620,  speed: 0.55, armor: 8,  reward: 28,  leak: 3, cost: 10, scale: 0.85,
    atk: { dmg: 28, range: 2.6, rate: 0.45, kind: 'plasma' } },
  shield:   { cls: 'armored', info: 'Ein Energieschild schluckt jeden Schaden, bis er zusammenbricht. EMP und Plasma zerlegen Schilde in Sekunden.', motion: 'biped', stride: 0.4, cycle: 0.8, name: 'Schild-Android',  model: 'enemy_shield',   hp: 190,  speed: 0.8,  armor: 2,  reward: 16,  leak: 2, cost: 5,  scale: 0.9, shield: 240 },
  repair:   { cls: 'armored', info: 'Repariert alle beschädigten Maschinen in seiner Nähe. Zuerst ausschalten, sonst heilt er die ganze Kolonne.', motion: 'tracks', name: 'Reparatur-Crawler', model: 'enemy_repair', hp: 250,  speed: 0.78, armor: 3,  reward: 18,  leak: 1, cost: 5,  scale: 0.85, heal: 26, healRange: 1.7 },
  kamikaze: { cls: 'air', info: 'Hält direkt auf deine Türme zu und explodiert beim Aufprall. Abschießen, bevor sie ankommt.', motion: 'hover', name: 'Kamikaze-Drohne', model: 'enemy_kamikaze', hp: 55,   speed: 1.9,  armor: 0,  reward: 10,  leak: 1, cost: 3.5, scale: 0.95, air: true, lift: 40,
    dive: { range: 1.3, dmg: 95, splash: 0.6 } },
  siege:    { cls: 'heavy', info: 'Artillerie auf vier Beinen. Beschießt Türme mit Granaten aus großer Entfernung.', motion: 'walker', stride: 0.7, name: 'Belagerungs-Walker', model: 'enemy_siege', hp: 720,  speed: 0.45, armor: 6,  reward: 40,  leak: 4, cost: 14, scale: 0.85,
    atk: { dmg: 42, range: 3.0, rate: 0.25, kind: 'shell', splash: 0.7 } },
  boss:     { cls: 'heavy', info: 'Gigantischer Kampfläufer mit enormer Panzerung und Lebensenergie. Nur konzentriertes, panzerbrechendes Feuer hält ihn auf.', motion: 'walker', stride: 0.95, name: 'Koloss',          model: 'enemy_boss',     hp: 3600, speed: 0.36, armor: 12, reward: 260, leak: 8, cost: 80, scale: 0.78, boss: true,
    atk: { dmg: 40, range: 3.0, rate: 0.9, kind: 'cannon' } },
  mothership: { cls: 'air', info: 'Fliegende Festung. Setzt unterwegs laufend Kamikaze-Drohnen aus.', motion: 'hover', name: 'Mutterschiff',  model: 'enemy_mothership', hp: 3000, speed: 0.42, armor: 6, reward: 280, leak: 8, cost: 80, scale: 0.78, boss: true, air: true, lift: 84,
    atk: { dmg: 30, range: 3.2, rate: 1.1, kind: 'missile' }, spawns: { type: 'kamikaze', every: 6.5, count: 2 } },
};

// level number at which each regular enemy type starts appearing
export const ENEMY_UNLOCK = {
  android: 1, spider: 1, drone: 2, mech: 3, tank: 4, repair: 6, shield: 8, kamikaze: 11, siege: 13,
};

export const BIOMES = {
  wasteland: {
    name: 'Ödland', ground: 'ground', road: 'road',
    props: ['prop_ruin', 'prop_wreck', 'prop_barrier', 'prop_tree', 'prop_crates', 'prop_scrap'],
    theme: { camp: ['prop_crates', 'prop_barrier'], spawn: ['prop_wreck', 'prop_scrap'], landmark: ['prop_ruin', ['prop_scrap', 'prop_wreck']], nature: ['prop_tree', 'prop_tree', 'prop_scrap'], plateau: 0.7 },
    decor: [['prop_scrap', 0.5, 0.7, 3], ['prop_barrier', 0.5, 0.7, 2], ['prop_tree', 0.55, 0.8, 2], ['prop_crates', 0.5, 0.65, 1]], decorDensity: 0.1,
    grade: { screen: 'rgba(62,50,40,0.5)', multiply: 'rgb(255,226,200)' },
    slab: ['#5b4a3b', '#2a221c', '#3a2f27', '#17120f'],
    bg: ['#2a1d16', '#140f0d', '#07080a'], ambient: 'ash', roadEdge: 'rgba(30,24,18,0.3)',
  },
  jungle: {
    name: 'Dschungel', ground: 'jungle_ground', road: 'jungle_road',
    props: ['prop_j_tree', 'prop_j_tree', 'prop_j_bush', 'prop_j_bush', 'prop_j_temple', 'prop_j_heli', 'prop_crates'],
    theme: { camp: ['prop_crates', 'prop_barrier'], spawn: ['prop_j_heli', 'prop_crates'], landmark: ['prop_j_temple', ['prop_j_bush', 'prop_j_bush']], nature: ['prop_j_tree', 'prop_j_tree', 'prop_j_bush'], plateau: 0.85 },
    decor: [['prop_j_bush', 0.55, 0.9, 6], ['prop_j_tree', 0.5, 0.75, 3]], decorDensity: 0.22,
    grade: { screen: 'rgba(40,52,30,0.35)', multiply: 'rgb(235,255,225)' },
    slab: ['#4a3a24', '#1f180e', '#30251a', '#120d08'],
    bg: ['#13201a', '#0b130f', '#050807'], ambient: 'fireflies', roadEdge: 'rgba(20,16,8,0.35)',
  },
  desert: {
    name: 'Wüste', ground: 'desert_ground', road: 'desert_road',
    props: ['prop_d_rock', 'prop_d_rock', 'prop_d_tank', 'prop_d_pump', 'prop_scrap', 'prop_barrier'],
    theme: { camp: ['prop_barrier', 'prop_crates'], spawn: ['prop_d_tank', 'prop_scrap'], landmark: ['prop_d_pump', ['prop_d_pump', 'prop_crates']], nature: ['prop_d_rock'], plateau: 1.1 },
    decor: [['prop_d_rock', 0.4, 0.7, 5], ['prop_scrap', 0.5, 0.65, 1]], decorDensity: 0.14,
    grade: { screen: 'rgba(30,20,10,0.15)', multiply: 'rgb(235,215,190)' },
    slab: ['#a0703f', '#4a3018', '#7a5530', '#2c1c0e'],
    bg: ['#3a2814', '#1c140b', '#0a0806'], ambient: 'dust', roadEdge: 'rgba(80,55,25,0.3)',
  },
  ice: {
    name: 'Arktis', ground: 'ice_ground', road: 'ice_road',
    props: ['prop_i_pine', 'prop_i_pine', 'prop_i_ice', 'prop_i_ice', 'prop_i_station', 'prop_i_wreck'],
    theme: { camp: ['prop_crates', 'prop_barrier'], spawn: ['prop_i_wreck', 'prop_scrap'], landmark: ['prop_i_station', ['prop_crates', 'prop_i_wreck']], nature: ['prop_i_pine', 'prop_i_pine', 'prop_i_ice'], plateau: 0.85 },
    decor: [['prop_i_ice', 0.45, 0.7, 4], ['prop_i_pine', 0.5, 0.8, 4]], decorDensity: 0.14,
    grade: { screen: 'rgba(0,0,0,0)', multiply: 'rgb(225,235,250)' },
    slab: ['#c8d6e6', '#6a7f96', '#9fb2c8', '#3f5168'],
    bg: ['#1a2533', '#0d141c', '#05080c'], ambient: 'snow', roadEdge: 'rgba(60,70,85,0.25)',
  },
  volcano: {
    name: 'Vulkan', ground: 'volcano_ground', road: 'volcano_road',
    props: ['prop_v_spire', 'prop_v_rocks', 'prop_v_rocks', 'prop_v_factory', 'prop_scrap', 'prop_tree'],
    theme: { camp: ['prop_barrier', 'prop_crates'], spawn: ['prop_scrap', 'prop_scrap'], landmark: ['prop_v_factory', ['prop_scrap', 'prop_v_rocks']], nature: ['prop_v_rocks', 'prop_v_spire', 'prop_tree'], plateau: 1.1 },
    decor: [['prop_v_rocks', 0.45, 0.7, 5], ['prop_v_spire', 0.45, 0.6, 2], ['prop_scrap', 0.5, 0.6, 1]], decorDensity: 0.12,
    grade: { screen: 'rgba(40,12,4,0.25)', multiply: 'rgb(255,225,210)' },
    slab: ['#3a2a26', '#120c0b', '#2a1c19', '#080505'],
    bg: ['#2a0e08', '#140806', '#060303'], ambient: 'embers', roadEdge: 'rgba(10,6,4,0.4)', lava: true,
  },
};
// terrain: world px per height level, tower range bonus per level of high ground
export const ELEV_PX = 26;
export const ELEV_RANGE = 0.15;
export const BIOME_ORDER = ['wasteland', 'jungle', 'desert', 'ice', 'volcano'];

