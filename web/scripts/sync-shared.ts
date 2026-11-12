import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'lib/shared');
const SRC = path.resolve(ROOT, '../shared');

function hash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.ts'));
  await mkdir(DEST, { recursive: true });
  let mismatch = false;
  for (const f of files) {
    const from = path.join(SRC, f);
    const to = path.join(DEST, f);
    const a = await readFile(from);
    if (check) {
      const b = await readFile(to).catch(() => null);
      if (!b || hash(a) !== hash(b)) {
        console.error(`mismatch: ${f}`);
        mismatch = true;
      }
    } else {
      await copyFile(from, to);
    }
  }
  if (check && mismatch) process.exit(1);
  if (!check) console.log(`synced ${files.length} files`);
  else console.log('shared copy matches');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
