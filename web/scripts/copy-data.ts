import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION } from '../lib/shared/contract.ts';
import { MOCK_SNAPSHOT, STORE_ROOT } from '../lib/paths.ts';
import { validateWebData } from '../lib/shared/validate-web-data.ts';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.join(STORE_ROOT, 'data/web');
const MOCK_ROOT = path.join(STORE_ROOT, 'data/mock');
const EXTRACT_ROOT = process.env.HOUREI_WEB_EXTRACT ?? '/tmp/hourei-web';
const REQUIRED = ['manifest.json', 'laws.json', 'law-edges.json', 'continents.json', 'category-flows.json'] as const;

function arg(name: string, fallback: string | null): string | null {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

async function isComplete(dir: string): Promise<boolean> {
  try {
    await Promise.all(REQUIRED.map((f) => access(path.join(dir, f))));
    return true;
  } catch {
    return false;
  }
}

async function refsCount(dir: string): Promise<number> {
  try {
    const names = await readdir(path.join(dir, 'refs'));
    return names.filter((n) => n.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function newestComplete(root: string): Promise<{ snapshot: string; src: string } | null> {
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return null;
  }
  const dirs: { snapshot: string; src: string }[] = [];
  for (const name of names) {
    const src = path.join(root, name);
    if (await isComplete(src)) dirs.push({ snapshot: name, src });
  }
  dirs.sort((a, b) => a.snapshot.localeCompare(b.snapshot));
  return dirs.at(-1) ?? null;
}

async function fromLatestPointer(): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(WEB_ROOT, 'latest.json'), 'utf8')) as { snapshotId?: string };
    return raw.snapshotId ?? null;
  } catch {
    return null;
  }
}

async function extractTar(snapshot: string): Promise<string | null> {
  const tarPath = path.join(STORE_ROOT, 'data/graph', snapshot, 'web.tar.gz');
  try {
    await access(tarPath);
  } catch {
    return null;
  }
  const dest = path.join(EXTRACT_ROOT, snapshot);
  const tarStat = await stat(tarPath);
  let destFresh = false;
  try {
    const man = await stat(path.join(dest, 'manifest.json'));
    destFresh = man.mtimeMs >= tarStat.mtimeMs;
  } catch {
    destFresh = false;
  }
  if (destFresh && await isComplete(dest) && (await refsCount(dest)) > 1000) return dest;
  await mkdir(EXTRACT_ROOT, { recursive: true });
  await execFileAsync('tar', ['-xzf', tarPath, '-C', EXTRACT_ROOT]);
  if (!(await isComplete(dest))) {
    throw new Error(`tar を展開したが ${dest} に初回5ファイルが無い`);
  }
  return dest;
}

async function resolve(requested: string): Promise<{ snapshot: string; src: string; kind: 'web' | 'mock' | 'web-tar'; refs: number }> {
  const snapshot = requested === 'latest' || requested === 'auto'
    ? (await fromLatestPointer()) ?? (await newestComplete(WEB_ROOT))?.snapshot ?? MOCK_SNAPSHOT
    : requested;

  const tar = snapshot.startsWith('mock-') ? null : await extractTar(snapshot);
  if (tar) {
    return { snapshot, src: tar, kind: 'web-tar', refs: await refsCount(tar) };
  }
  const web = path.join(WEB_ROOT, snapshot);
  if (await isComplete(web)) {
    return { snapshot, src: web, kind: 'web', refs: await refsCount(web) };
  }
  const mock = path.join(MOCK_ROOT, snapshot);
  if (await isComplete(mock)) {
    return { snapshot, src: mock, kind: 'mock', refs: await refsCount(mock) };
  }
  throw new Error(`${snapshot} が data/web・data/mock・data/graph/${snapshot}/web.tar.gz のどれにも揃っていません`);
}

async function main(): Promise<void> {
  const statusOnly = process.argv.includes('--status');
  const skipValidate = process.argv.includes('--skip-validate') || !process.argv.includes('--validate');
  const requested = arg('--snapshot', statusOnly ? 'latest' : MOCK_SNAPSHOT)!;
  const resolved = await resolve(requested);
  if (statusOnly) {
    console.log(JSON.stringify({ requested, ...resolved, ready: true }, null, 2));
    return;
  }
  if (resolved.kind !== 'mock' && resolved.refs < 1000) {
    console.warn(`refs が ${resolved.refs} 件しかない。data/graph/${resolved.snapshot}/web.tar.gz を展開できないか確認。`);
  }
  const destRoot = path.join(ROOT, 'public/data');
  await mkdir(destRoot, { recursive: true });
  const existing = await readdir(destRoot).catch(() => [] as string[]);
  for (const name of existing) {
    if (name === 'latest.json') continue;
    await rm(path.join(destRoot, name), { recursive: true, force: true });
  }
  const dest = path.join(destRoot, resolved.snapshot);
  await cp(resolved.src, dest, { recursive: true });
  const latest = {
    contractVersion: CONTRACT_VERSION,
    snapshotId: resolved.snapshot,
    dataPath: `/data/${resolved.snapshot}/`,
  };
  await writeFile(path.join(destRoot, 'latest.json'), JSON.stringify(latest));
  if (!skipValidate) {
    const result = await validateWebData(dest);
    if (!result.ok) {
      for (const issue of result.issues) console.error(`${issue.path}: ${issue.message}`);
      process.exit(1);
    }
  }
  console.log(`copied ${resolved.src} (${resolved.kind}, refs=${resolved.refs}) -> ${dest}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
