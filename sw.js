// Iron Sentinel service worker: keeps the game on the device, so it starts fast and plays offline.
// VERSION / FILES (path -> content hash) are written by tools/gen_sw.mjs on every deploy. A new version
// downloads only the files whose hash changed and copies everything else over from the previous cache.
const VERSION = 'd124318ace', FILES = {"index.html":"4584f7287c","manifest.webmanifest":"dbbdfe9082","css/style.css":"c5ccd8f418","js/assets.js":"ed45690702","js/audio.js":"eac4e269a5","js/challenges.js":"1aa7f4d386","js/config.js":"003517e368","js/fx.js":"993c80b00b","js/game.js":"5256551000","js/input.js":"73db21e087","js/iso.js":"6761ac1af1","js/level_specs.js":"e01fef488a","js/levels.js":"3e757fc27f","js/levels_data.js":"36cc5a9b68","js/main.js":"7fedacd0e6","js/render.js":"0d5b0b20cf","assets/audio/sfx.json":"2c0eb03b5a","assets/audio/sfx.mp3":"e4f91642b5","assets/fonts/orbitron.woff2":"b522c4d914","assets/fonts/rajdhani-500.woff2":"c6dd2c160a","assets/fonts/rajdhani-600.woff2":"525a3afc6a","assets/fonts/rajdhani-700.woff2":"518e92dca2","assets/icon-180.png":"80eb5c9fc5","assets/icon-192.png":"15f734707c","assets/icon-512.png":"0fe1f208f2","assets/models/enemy_aegis.webp":"a66ff2cc5e","assets/models/enemy_android.webp":"f14f54a892","assets/models/enemy_bomber.webp":"93c5a15580","assets/models/enemy_boss.webp":"defc7b1714","assets/models/enemy_brood.webp":"0713441c96","assets/models/enemy_drone.webp":"7740a7e49f","assets/models/enemy_infiltrator.webp":"5f88d632c7","assets/models/enemy_kamikaze.webp":"ee5ccbfcba","assets/models/enemy_mech.webp":"1fc5b14982","assets/models/enemy_mothership.webp":"71f85531bd","assets/models/enemy_repair.webp":"5782bfadc2","assets/models/enemy_saboteur.webp":"99e8161e75","assets/models/enemy_shield.webp":"8b73a2d0fc","assets/models/enemy_siege.webp":"7562530a61","assets/models/enemy_spider.webp":"18e5e3169c","assets/models/enemy_tank.webp":"8748128559","assets/models/models.json":"ef50049663","assets/models/p3d_base_hq.webp":"a85c7fe877","assets/models/p3d_base_hq_shadow.webp":"134529705c","assets/models/p3d_prop_barrier.webp":"d63c0a89fe","assets/models/p3d_prop_barrier_shadow.webp":"31045249ec","assets/models/p3d_prop_c_bus.webp":"7d637c8bda","assets/models/p3d_prop_c_bus_shadow.webp":"2b179a3996","assets/models/p3d_prop_c_car.webp":"d2c8db811b","assets/models/p3d_prop_c_car_shadow.webp":"33ab4f6245","assets/models/p3d_prop_c_rubble.webp":"7577a1d03f","assets/models/p3d_prop_c_rubble_shadow.webp":"350bf87ffe","assets/models/p3d_prop_c_tower.webp":"034f841690","assets/models/p3d_prop_c_tower_shadow.webp":"bdc8ec7e25","assets/models/p3d_prop_c_uplink.webp":"d8a8fd5a89","assets/models/p3d_prop_c_uplink_shadow.webp":"7eade03b81","assets/models/p3d_prop_crates.webp":"9c78a898aa","assets/models/p3d_prop_crates_shadow.webp":"121fb566ff","assets/models/p3d_prop_d_pump.webp":"2e08331d8b","assets/models/p3d_prop_d_pump_shadow.webp":"f58cea158e","assets/models/p3d_prop_d_rock.webp":"b5d2692dd0","assets/models/p3d_prop_d_rock_shadow.webp":"48020bdacd","assets/models/p3d_prop_d_tank.webp":"67b787c8e7","assets/models/p3d_prop_d_tank_shadow.webp":"8a3a4544bb","assets/models/p3d_prop_i_ice.webp":"687479b16a","assets/models/p3d_prop_i_ice_shadow.webp":"d1bf4472fa","assets/models/p3d_prop_i_pine.webp":"2c1ad394cd","assets/models/p3d_prop_i_pine_shadow.webp":"d1b375b75b","assets/models/p3d_prop_i_station.webp":"a42e66623e","assets/models/p3d_prop_i_station_shadow.webp":"cb25b8e280","assets/models/p3d_prop_i_wreck.webp":"4999999826","assets/models/p3d_prop_i_wreck_shadow.webp":"b39cfbcfc8","assets/models/p3d_prop_j_bush.webp":"8424c76720","assets/models/p3d_prop_j_bush_shadow.webp":"25ea3a59c6","assets/models/p3d_prop_j_heli.webp":"276ca0f97c","assets/models/p3d_prop_j_heli_shadow.webp":"27a708c242","assets/models/p3d_prop_j_temple.webp":"393ab9e967","assets/models/p3d_prop_j_temple_shadow.webp":"f428d7b0f0","assets/models/p3d_prop_j_tree.webp":"c955e41963","assets/models/p3d_prop_j_tree_shadow.webp":"44dbaba4cf","assets/models/p3d_prop_ruin.webp":"ba9318561b","assets/models/p3d_prop_ruin_shadow.webp":"91fc40431a","assets/models/p3d_prop_scrap.webp":"69220622a9","assets/models/p3d_prop_scrap_shadow.webp":"a024ce1405","assets/models/p3d_prop_tree.webp":"2111d42018","assets/models/p3d_prop_tree_shadow.webp":"7b9811970d","assets/models/p3d_prop_v_factory.webp":"c4629a295e","assets/models/p3d_prop_v_factory_shadow.webp":"a9f431b473","assets/models/p3d_prop_v_rocks.webp":"48bd136a54","assets/models/p3d_prop_v_rocks_shadow.webp":"12228b910d","assets/models/p3d_prop_v_spire.webp":"5d12c717bd","assets/models/p3d_prop_v_spire_shadow.webp":"62f5af1e3e","assets/models/p3d_prop_wreck.webp":"0acb53cc37","assets/models/p3d_prop_wreck_shadow.webp":"f07d85a968","assets/models/p3d_spawn_gate.webp":"77396f9d70","assets/models/p3d_spawn_gate_shadow.webp":"7ea6062326","assets/models/tower_acid.webp":"7553b2beeb","assets/models/tower_acid_base.webp":"7e2c518c8d","assets/models/tower_acid_shadow.webp":"209e75534c","assets/models/tower_cryo.webp":"7137002483","assets/models/tower_cryo_base.webp":"c123fd5fed","assets/models/tower_cryo_shadow.webp":"e18c634585","assets/models/tower_emp.webp":"673fcbf822","assets/models/tower_emp_shadow.webp":"b2845cee0e","assets/models/tower_flak.webp":"37137227ab","assets/models/tower_flak_base.webp":"861b8dfc40","assets/models/tower_flak_shadow.webp":"fb2d404fc3","assets/models/tower_flame.webp":"51a2d4686d","assets/models/tower_flame_base.webp":"2db47f5106","assets/models/tower_flame_shadow.webp":"d6dfde63c7","assets/models/tower_gatling.webp":"e9e285f21a","assets/models/tower_gatling_base.webp":"ce484ae07e","assets/models/tower_gatling_shadow.webp":"6a9389d6da","assets/models/tower_laser.webp":"ac8294a385","assets/models/tower_laser_base.webp":"3a6c79aa60","assets/models/tower_laser_shadow.webp":"a00ab1a195","assets/models/tower_missile.webp":"08ab330fcb","assets/models/tower_missile_base.webp":"a7cf1deef2","assets/models/tower_missile_shadow.webp":"c3b765949b","assets/models/tower_mortar.webp":"37e6f6b779","assets/models/tower_mortar_base.webp":"59984f8b4b","assets/models/tower_mortar_shadow.webp":"4fa6712ebb","assets/models/tower_plasma.webp":"061b1b4721","assets/models/tower_plasma_base.webp":"77c5409603","assets/models/tower_plasma_shadow.webp":"910e97cf2f","assets/models/tower_rail.webp":"0a3ab1629e","assets/models/tower_rail_base.webp":"cc980b6f4e","assets/models/tower_rail_shadow.webp":"b4090e8b08","assets/music/battle.mp3":"2f2e63d8dd","assets/music/battle2.mp3":"ea89ba1635","assets/music/boss.mp3":"dfc06a8fc3","assets/music/build.mp3":"618ffef749","assets/music/music.json":"52d718f8ab","assets/tex/city_ground.jpg":"f898a968ea","assets/tex/city_road.jpg":"8fda23eede","assets/tex/desert_ground.jpg":"9e1e409aed","assets/tex/desert_road.jpg":"7d0c8867eb","assets/tex/ground.jpg":"b8cfcdaf8e","assets/tex/ice_ground.jpg":"1aa05345a9","assets/tex/ice_road.jpg":"f7ca79ae47","assets/tex/jungle_ground.jpg":"8df6192dc2","assets/tex/jungle_road.jpg":"fff38183b2","assets/tex/road.jpg":"c53eaac7a4","assets/tex/volcano_ground.jpg":"8e77007966","assets/tex/volcano_road.jpg":"ea3db1b982","assets/title.jpg":"7b7fcc7ae5","assets/ui/icons.json":"8756c8040a","assets/ui/icons.webp":"41bef29d1b","assets/vfx/explosion.webp":"80d3a28276","assets/vfx/explosion_ground.webp":"8568f761df","assets/vfx/explosion_heavy.webp":"fcd15cc033","assets/vfx/explosion_nuke.webp":"87d0b42865","assets/vfx/explosion_plasma.webp":"4a1baf97ba","assets/vfx/vfx_blackhole.json":"00876bee78","assets/vfx/vfx_blackhole.webp":"51da187734"};

const PREFIX = 'iron-sentinel-';
const CACHE = PREFIX + VERSION;
const HDR = 'x-sw-hash';
const BASE = new URL('./', self.location).href;
// big files the game loads on demand (enemy sheets, biome textures, rare effects, music): not needed to start,
// they are cached on first use and filled in the background after the game has loaded
const LAZY = /^assets\/(models\/enemy_|tex\/|music\/|vfx\/(explosion_nuke|vfx_blackhole))/;
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', mp3: 'audio/mpeg', m4a: 'audio/mp4', woff2: 'font/woff2' };

const urlOf = (p) => BASE + p;
async function stamped(res, p, h) {
  const body = await res.arrayBuffer();
  const type = res.headers.get('content-type') || TYPES[p.split('.').pop()] || 'application/octet-stream';
  return new Response(body, { status: 200, headers: { 'content-type': type, [HDR]: h } });
}
async function download(cache, p, h) {
  const res = await fetch(urlOf(p) + '?v=' + h, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  const r = await stamped(res, p, h);
  await cache.put(urlOf(p), r.clone());
  return r;
}
async function current(cache, p, h) {
  const r = await cache.match(urlOf(p));
  return r && r.headers.get(HDR) === h ? r : null;
}
// the same file (same hash) from an older version's cache
async function fromOld(p, h) {
  for (const k of await caches.keys()) {
    if (!k.startsWith(PREFIX) || k === CACHE) continue;
    const r = await current(await caches.open(k), p, h);
    if (r) return r;
  }
  return null;
}
async function pool(items, fn, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await pool(Object.entries(FILES), async ([p, h]) => {
      if (await current(cache, p, h)) return;
      const old = await fromOld(p, h);
      if (old) await cache.put(urlOf(p), old);
      else if (!LAZY.test(p)) await download(cache, p, h);
    }, 6);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function serve(p, h) {
  const cache = await caches.open(CACHE);
  const hit = await current(cache, p, h);
  if (hit) return hit;
  try {
    return await download(cache, p, h);
  } catch (err) {
    const any = await caches.match(urlOf(p));   // offline: an older copy is better than nothing
    if (any) return any;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range') || !req.url.startsWith(BASE)) return;
  let p = new URL(req.url).pathname.slice(new URL(BASE).pathname.length);
  if (req.mode === 'navigate' || p === '') p = 'index.html';
  const h = FILES[p];
  if (h) e.respondWith(serve(p, h));
});

// the page asks how much is stored ('status') and to fetch the rest in the background ('fill')
async function status() {
  const cache = await caches.open(CACHE);
  let have = 0, total = 0;
  for (const [p, h] of Object.entries(FILES)) { total++; if (await current(cache, p, h)) have++; }
  return { version: VERSION, have, total };
}
let filling = null;
async function fill() {
  const cache = await caches.open(CACHE);
  const todo = [];
  for (const [p, h] of Object.entries(FILES)) if (!(await current(cache, p, h))) todo.push([p, h]);
  await pool(todo, async ([p, h]) => { try { await download(cache, p, h); } catch (err) { /* retried next time */ } }, 3);
}
self.addEventListener('message', (e) => {
  const reply = (s) => { if (e.source) e.source.postMessage({ sw: 'status', ...s }); };
  if (e.data === 'fill') {
    filling = filling || fill().finally(() => { filling = null; });
    e.waitUntil(filling.then(status).then(reply));
  } else if (e.data === 'status') e.waitUntil(status().then(reply));
});
