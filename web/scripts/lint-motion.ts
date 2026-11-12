import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTS = new Set(['.css', '.tsx', '.ts']);
const SKIP = new Set(['node_modules', '.next', 'public', 'lib/shared']);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else if (EXTS.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

function fail(file: string, line: number, msg: string): void {
  console.error(`${path.relative(ROOT, file)}:${line}: ${msg}`);
}

async function main(): Promise<void> {
  const files = await walk(ROOT);
  let errors = 0;
  for (const file of files) {
    if (file.includes('/scripts/lint-motion.ts')) continue;
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    let inHoverMedia = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const n = i + 1;
      if (/transition\s*:\s*all\b/.test(line) || /transition-all/.test(line)) {
        fail(file, n, 'transition: all / transition-all');
        errors++;
      }
      if (/scale\(\s*0\s*\)/.test(line)) {
        fail(file, n, 'scale(0)');
        errors++;
      }
      if (/\bease-in\b/.test(line) && !/\bease-in-out\b/.test(line)) {
        fail(file, n, 'ease-in');
        errors++;
      }
      if (/@media\s*\(\s*hover:\s*hover/.test(line)) inHoverMedia++;
      if (inHoverMedia && line.includes('}') && !line.includes('{')) {
        // crude: count braces
      }
      const opens = (line.match(/{/g) ?? []).length;
      const closes = (line.match(/}/g) ?? []).length;
      if (inHoverMedia) inHoverMedia += opens - closes;
      if (inHoverMedia < 0) inHoverMedia = 0;
      if (/:hover\b/.test(line) && inHoverMedia <= 0 && file.endsWith('.css')) {
        fail(file, n, ':hover outside (hover: hover) and (pointer: fine)');
        errors++;
      }
    }
  }
  void stat;
  if (errors) {
    console.error(`${errors} motion lint errors`);
    process.exit(1);
  }
  console.log('lint:motion ok');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
