import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pipelineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.resolve(pipelineRoot, '../shared');
const destDir = path.join(pipelineRoot, 'lib/shared');

function listTs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.ts')).sort();
}

function sync() {
  fs.mkdirSync(destDir, { recursive: true });
  const names = listTs(srcDir);
  if (names.length === 0) {
    console.error(`no .ts files in ${srcDir}`);
    process.exit(1);
  }
  for (const name of names) {
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  }
  console.log(`synced ${names.length} files to lib/shared/`);
}

function check() {
  const srcNames = listTs(srcDir);
  const destNames = listTs(destDir);
  const missing = srcNames.filter((n) => !destNames.includes(n));
  const extra = destNames.filter((n) => !srcNames.includes(n));
  const mismatches = [];
  for (const name of srcNames) {
    const a = path.join(srcDir, name);
    const b = path.join(destDir, name);
    if (!fs.existsSync(b)) continue;
    if (fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) mismatches.push(name);
  }
  if (missing.length || extra.length || mismatches.length) {
    if (missing.length) console.error('missing in lib/shared:', missing.join(', '));
    if (extra.length) console.error('extra in lib/shared:', extra.join(', '));
    if (mismatches.length) console.error('differ from shared/:', mismatches.join(', '));
    process.exit(1);
  }
  console.log(`lib/shared matches shared/ (${srcNames.length} files)`);
}

const cmd = process.argv[2];
if (cmd === 'sync') sync();
else if (cmd === 'check') check();
else {
  console.error('usage: node scripts/shared.mjs sync|check');
  process.exit(1);
}
