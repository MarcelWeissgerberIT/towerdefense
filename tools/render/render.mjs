// Drives render.html in headless Chromium and writes raw PNG frames + meta JSON.
//   node tools/render/render.mjs <serverBaseUrl> <config.json> <outDir> [name ...]
// The server must serve render.html, node_modules/three and the GLB files (paths in config are relative to it).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [base, cfgPath, outDir, ...only] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
await page.goto(`${base}/render.html`);
await page.waitForFunction(() => window.ready === true);

for (const [name, opt] of Object.entries(cfg)) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  const res = await page.evaluate((o) => window.renderModel(o), { ...opt, url: opt.url || `glb/${name}.glb` });
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const save = (file, dataUrl) => fs.writeFileSync(path.join(dir, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  if (res.base) save('base.png', res.base);
  res.frames.forEach((f, i) => save(`f${String(i).padStart(2, '0')}.png`, f));
  delete res.base; delete res.frames;
  res.P = opt.P;
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(res, null, 1));
  console.log(`${name}: ${res.N} frames ${res.W}x${res.H} in ${((Date.now() - t0) / 1000).toFixed(1)}s`, res.autoInfo ? `auto yaw ${res.autoInfo.yaw.toFixed(0)}°` : '');
}
await browser.close();
