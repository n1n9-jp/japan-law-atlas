import path from 'node:path';
import { DEFAULT_STORE, readLatest } from '../lib/paths.ts';

export { DEFAULT_STORE };

export interface EvalPaths {
  store: string;
  snapshotId: string;
  evalRoot: string;
  goldDir: string;
  externalDir: string;
  prefetchExternal: string;
  prefetchGold: string;
  corpusDir: string;
  refsDir: string;
  sentences: string;
  annotations: string;
  adjudicated: string;
  secondPassInput: string;
  guideline: string;
  reportJson: string;
  reportMd: string;
  lawvisPairs: string;
  jlawPairs: string;
  jlawPrecision: string;
  jlawPrecisionLabeled: string;
  jlawPrecisionSecondPass: string;
  jlawRecall: string;
  supplementRelative: string;
  diffSample: string;
  diffClassified: string;
}

export function resolveSnapshotId(store: string, snapshot?: string): string | null {
  if (snapshot) return snapshot;
  return readLatest(store);
}

export function evalPaths(store: string, snapshotId: string): EvalPaths {
  const evalRoot = path.join(store, 'data/eval', snapshotId);
  const goldDir = path.join(evalRoot, 'gold');
  const externalDir = path.join(evalRoot, 'external');
  const prefetchExternal = path.join(store, 'data/eval/prefetch/external');
  const prefetchGold = path.join(store, 'data/eval/prefetch/gold');
  return {
    store,
    snapshotId,
    evalRoot,
    goldDir,
    externalDir,
    prefetchExternal,
    prefetchGold,
    corpusDir: path.join(store, 'data/corpus', snapshotId),
    refsDir: path.join(store, 'data/refs', snapshotId),
    sentences: path.join(goldDir, 'sentences.jsonl'),
    annotations: path.join(goldDir, 'annotations.jsonl'),
    adjudicated: path.join(goldDir, 'adjudicated.jsonl'),
    secondPassInput: path.join(goldDir, 'second-pass-input.jsonl'),
    guideline: path.join(goldDir, 'guideline.md'),
    reportJson: path.join(evalRoot, 'report.json'),
    reportMd: path.join(evalRoot, 'report.md'),
    lawvisPairs: path.join(externalDir, 'lawvis-pairs.csv'),
    jlawPairs: path.join(externalDir, 'jlaw-pairs.csv'),
    jlawPrecision: path.join(externalDir, 'jlaw-precision-sample.csv'),
    jlawPrecisionLabeled: path.join(externalDir, 'jlaw-precision-labeled.csv'),
    jlawPrecisionSecondPass: path.join(externalDir, 'jlaw-precision-second-pass.csv'),
    jlawRecall: path.join(externalDir, 'jlaw-recall-gold-sample.csv'),
    supplementRelative: path.join(goldDir, 'supplement-relative.jsonl'),
    diffSample: path.join(evalRoot, 'diff-sample.jsonl'),
    diffClassified: path.join(evalRoot, 'diff-classified.jsonl'),
  };
}
