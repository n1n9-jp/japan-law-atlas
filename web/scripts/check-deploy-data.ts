import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestPointerSchema, manifestSchema } from '../lib/shared/contract-schema.ts';
import { validateWebData } from '../lib/shared/validate-web-data.ts';

export const DEFAULT_MAX_TOTAL_BYTES = 150_000_000;
export const MIN_REFS = 1000;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA_ROOT = path.join(ROOT, 'public/data');

export type DeployMode = 'production' | 'preview';

export interface CheckDeployDataOptions {
  dataRoot?: string;
  production?: boolean;
  maxTotalBytes?: number;
  minRefs?: number;
}

export interface CheckDeployDataResult {
  ok: boolean;
  issues: string[];
  snapshotId: string;
  files: number;
  bytes: number;
  mode: DeployMode;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return null;
}

export function resolveMode(options: CheckDeployDataOptions = {}): DeployMode {
  if (options.production) return 'production';
  if (process.argv.includes('--production')) return 'production';
  if (process.env.VERCEL_ENV === 'production') return 'production';
  return 'preview';
}

async function dirBytes(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirBytes(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

async function fileCount(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  let n = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) n += await fileCount(full);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

export async function checkDeployData(options: CheckDeployDataOptions = {}): Promise<CheckDeployDataResult> {
  const dataRoot = options.dataRoot ?? arg('--data-root') ?? DEFAULT_DATA_ROOT;
  const maxTotalBytes = options.maxTotalBytes
    ?? (arg('--max-total-bytes') ? Number(arg('--max-total-bytes')) : DEFAULT_MAX_TOTAL_BYTES);
  const minRefs = options.minRefs
    ?? (arg('--min-refs') ? Number(arg('--min-refs')) : MIN_REFS);
  const mode = resolveMode(options);
  const issues: string[] = [];
  let snapshotId = '';
  let files = 0;
  let bytes = 0;

  let latestRaw: string;
  try {
    latestRaw = await readFile(path.join(dataRoot, 'latest.json'), 'utf8');
  } catch {
    issues.push('public/data/latest.json がありません');
    return { ok: false, issues, snapshotId, files, bytes, mode };
  }

  let latestJson: unknown;
  try {
    latestJson = JSON.parse(latestRaw);
  } catch {
    issues.push('latest.json が JSON ではありません');
    return { ok: false, issues, snapshotId, files, bytes, mode };
  }

  const parsed = latestPointerSchema.safeParse(latestJson);
  if (!parsed.success) {
    issues.push(`latest.json が latestPointerSchema に合いません: ${parsed.error.message}`);
    return { ok: false, issues, snapshotId, files, bytes, mode };
  }

  snapshotId = parsed.data.snapshotId;
  const expectedPath = `/data/${snapshotId}/`;
  if (parsed.data.dataPath !== expectedPath) {
    issues.push(`dataPath が ${JSON.stringify(parsed.data.dataPath)} です。${JSON.stringify(expectedPath)} である必要があります`);
  }

  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await readdir(dataRoot, { withFileTypes: true });
  } catch {
    issues.push(`${dataRoot} を読めません`);
    return { ok: false, issues, snapshotId, files, bytes, mode };
  }

  const names = entries.map((e) => e.name).sort();
  const expected = ['latest.json', snapshotId].sort();
  if (names.length !== 2 || names[0] !== expected[0] || names[1] !== expected[1]) {
    issues.push(`public/data/ の中身は latest.json と ${snapshotId}/ だけである必要があります（実際: ${names.join(', ') || '(空)'}）`);
  }

  const snapshotDir = path.join(dataRoot, snapshotId);
  const snapStat = await stat(snapshotDir).catch(() => null);
  if (!snapStat?.isDirectory()) {
    issues.push(`スナップショットのディレクトリがありません: ${snapshotDir}`);
    return { ok: issues.length === 0, issues, snapshotId, files, bytes, mode };
  }

  files = await fileCount(snapshotDir);
  bytes = await dirBytes(snapshotDir);

  if (mode === 'production') {
    if (snapshotId.startsWith('mock-')) {
      issues.push(`本番に仮データ（mock）を出せません: snapshotId=${snapshotId}`);
    }

    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(await readFile(path.join(snapshotDir, 'manifest.json'), 'utf8'));
    } catch {
      issues.push('manifest.json がありません');
      return { ok: false, issues, snapshotId, files, bytes, mode };
    }
    const manifestParsed = manifestSchema.safeParse(manifestJson);
    if (!manifestParsed.success) {
      issues.push(`manifest.json がスキーマに合いません: ${manifestParsed.error.message}`);
    } else {
      const manifest = manifestParsed.data;
      if (manifest.isMock) issues.push('manifest.isMock が true です。本番には出せません');
      if (manifest.snapshotId !== snapshotId) {
        issues.push(`manifest.snapshotId が ${manifest.snapshotId} で latest.json の ${snapshotId} と違います`);
      }
      const listedRefs = manifest.files.filter((f) => f.path.startsWith('refs/') && f.path.endsWith('.json')).length;
      let diskRefs = 0;
      try {
        const refNames = await readdir(path.join(snapshotDir, 'refs'));
        diskRefs = refNames.filter((n) => n.endsWith('.json')).length;
      } catch {
        diskRefs = 0;
      }
      if (diskRefs !== listedRefs) {
        issues.push(`refs/*.json が ${diskRefs} 件で、manifest.files の refs/ は ${listedRefs} 件です`);
      }
      if (diskRefs < minRefs) {
        issues.push(`refs/*.json が ${diskRefs} 件しかありません（${minRefs} 以上必要）`);
      }
    }

    if (bytes > maxTotalBytes) {
      issues.push(`スナップショット全体が ${bytes} bytes で、上限 ${maxTotalBytes} bytes を超えています`);
    }

    const validated = await validateWebData(snapshotDir);
    if (!validated.ok) {
      for (const issue of validated.issues) issues.push(`${issue.path}: ${issue.message}`);
    }
  }

  return { ok: issues.length === 0, issues, snapshotId, files, bytes, mode };
}

async function main(): Promise<void> {
  const result = await checkDeployData();
  if (!result.ok) {
    for (const issue of result.issues) console.error(issue);
    process.exit(1);
  }
  console.log(`deploy-data ok snapshot=${result.snapshotId} files=${result.files} bytes=${result.bytes} mode=${result.mode}`);
}

const isMain = process.argv[1] && path.basename(process.argv[1]).includes('check-deploy-data');
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
