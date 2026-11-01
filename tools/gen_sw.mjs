// Writes the precache list (file -> content hash) into sw.js so the service worker knows every game file
// and re-downloads only the files whose content changed. Runs on every deploy (see .github/workflows/pages.yml).
//   node tools/gen_sw.mjs [siteDir]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] || new URL('..', import.meta.url).pathname;
const ENTRIES = ['index.html', 'manifest.webmanifest', 'css', 'js', 'assets'];

function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const f of readdirSync(p).sort()) if (!f.startsWith('.')) walk(join(p, f), out); }
  else out.push(p);
  return out;
}
const files = {};
for (const e of ENTRIES) for (const f of walk(join(root, e), [])) {
  files[relative(root, f).split('\\').join('/')] = createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 10);
}
const swPath = join(root, 'sw.js');
const version = createHash('sha1').update(JSON.stringify(files)).digest('hex').slice(0, 10);
let sw = readFileSync(swPath, 'utf8');
const line = `const VERSION = '${version}', FILES = ${JSON.stringify(files)};`;
if (!/^const VERSION = .*$/m.test(sw)) throw new Error('sw.js: VERSION line not found');
sw = sw.replace(/^const VERSION = .*$/m, () => line);
writeFileSync(swPath, sw);
console.log(`sw.js: ${Object.keys(files).length} files, version ${version}`);
