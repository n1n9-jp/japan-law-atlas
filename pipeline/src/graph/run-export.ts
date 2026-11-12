import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { CONTRACT_VERSION, type Manifest } from '../../lib/shared/contract.ts';
import {
  corpusDirOf,
  graphDirOf,
  inspectRefs,
  refsDirOf,
  resolveSnapshotId,
  storeOf,
  webDirOf,
} from './load.ts';
import { renderMapPng } from './render-map.ts';
import { loadGraphState } from './run-graph.ts';
import type { LayoutReport } from './types.ts';
import { writeWebBundle } from './write-web.ts';

export interface ExportCliArgs {
  snapshot?: string;
  store?: string;
}

function loadEval(store: string, snapshotId: string): Manifest['eval'] {
  const p = join(store, 'data', 'eval', snapshotId, 'report.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    const vs = (v: unknown): { ours: number; theirs: number; both: number } | null => {
      if (!v || typeof v !== 'object') return null;
      const o = v as Record<string, unknown>;
      if (typeof o.ours === 'number' && typeof o.theirs === 'number' && typeof o.both === 'number') {
        return { ours: o.ours, theirs: o.theirs, both: o.both };
      }
      return null;
    };
    const vsLawvis = vs(raw.vsLawvis);
    const vsJlaw = vs(raw.vsJlaw);
    const num = (k: string) => (typeof raw[k] === 'number' ? raw[k] as number : null);
    const fields = {
      crossLawF1: num('crossLawF1'),
      crossLawPrecision: num('crossLawPrecision'),
      crossLawRecall: num('crossLawRecall'),
      articleLevelF1: num('articleLevelF1'),
      kindAccuracy: num('kindAccuracy'),
      goldSentences: num('goldSentences'),
      goldRefs: num('goldRefs'),
    };
    if (Object.values(fields).some((v) => v === null) || !vsLawvis || !vsJlaw) return null;
    return { ...fields, vsLawvis, vsJlaw } as Manifest['eval'];
  } catch {
    return null;
  }
}

export async function runExport(args: ExportCliArgs): Promise<{ webDir: string; report: LayoutReport }> {
  const t0 = Date.now();
  const store = storeOf(args.store);
  const snapshotId = resolveSnapshotId(store, args.snapshot);
  const graphDir = graphDirOf(store, snapshotId);
  const refsDir = refsDirOf(store, snapshotId);
  const corpusDir = corpusDirOf(store, snapshotId);
  const webDir = webDirOf(store, snapshotId);

  const state = loadGraphState(graphDir);
  const refsStatus = inspectRefs(refsDir);
  if (refsStatus.warning) process.stderr.write(`[export] ${refsStatus.warning}\n`);
  if (refsStatus.fingerprint !== state.meta.refsStatus.fingerprint) {
    throw new Error(
      `refs の fingerprint が graph 実行時と違う。先に npm run graph を再実行してください\n  graph: ${state.meta.refsStatus.fingerprint}\n  refs:  ${refsStatus.fingerprint}`,
    );
  }

  const tmpDir = join('/tmp/hourei-web', snapshotId);
  const written = await writeWebBundle({
    state,
    destDir: tmpDir,
    refsDir,
    corpusDir,
    evalBlock: loadEval(store, snapshotId),
  });

  mkdirSync(join(store, 'data', 'web', snapshotId), { recursive: true });
  mkdirSync(join(store, 'data', 'graph', snapshotId), { recursive: true });
  process.stderr.write(`[export] copying first-load files + tarball (refs stay in tar)\n`);
  for (const name of ['manifest.json', 'laws.json', 'law-edges.json', 'continents.json', 'category-flows.json']) {
    writeFileSync(join(webDir, name), readFileSync(join(tmpDir, name)));
  }
  const tarGz = join(store, 'data', 'graph', snapshotId, 'web.tar.gz');
  const packed = spawnSync('tar', ['-C', '/tmp/hourei-web', '-czf', tarGz, snapshotId], { encoding: 'utf8' });
  if (packed.status !== 0) {
    throw new Error(`web.tar.gz 作成失敗: ${packed.stderr}`);
  }

  const latest = {
    contractVersion: CONTRACT_VERSION,
    snapshotId,
    dataPath: `/data/${snapshotId}/`,
  };
  writeFileSync(join(store, 'data', 'web', 'latest.json'), JSON.stringify(latest) + '\n');

  const pngPath = join(store, 'media', 'm2', 'map-overview.png');
  renderMapPng(state, pngPath);

  const reportPath = join(graphDir, 'layout-report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as LayoutReport;
  report.firstGzipBytes = written.firstGzip;
  report.totalWebBytes = written.totalBytes;
  report.refsRowCap = written.refsRowCap;
  report.refsPerPartnerCap = written.refsPerPartnerCap;
  report.elapsedMs.export = Date.now() - t0;
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

  process.stderr.write(
    `[export] snapshot=${snapshotId} firstGzip=${written.firstGzip} total=${written.totalBytes} ${Date.now() - t0}ms\n`,
  );
  return { webDir, report };
}
