import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { z } from 'zod';
import type { LawMeta } from '../../lib/corpus-types.ts';
import type { Ref, LawFeatures, AbbrevRec } from '../../lib/ref-types.ts';
import { LAW_TYPES, type LawType } from '../../lib/shared/contract.ts';
import { DEFAULT_STORE, readLatest, resolveStore } from '../lib/paths.ts';
import { sha256Hex } from './util.ts';
import type { RefsManifest, RefsStatus } from './types.ts';

const SHARDS = 32;

const RefsManifestSchema = z.object({
  snapshotId: z.string(),
  corpusSha256: z.string(),
  createdAt: z.string(),
  files: z.array(z.object({
    path: z.string(),
    bytes: z.number(),
    sha256: z.string(),
  })),
});

export function resolveSnapshotId(store: string, snapshot?: string): string {
  if (snapshot) return snapshot;
  const latest = readLatest(store);
  if (!latest) throw new Error(`コーパスがまだありません: ${join(store, 'data/corpus/LATEST')}`);
  return latest;
}

export function storeOf(storeArg?: string): string {
  return resolveStore(storeArg ?? DEFAULT_STORE);
}

export function refsDirOf(store: string, snapshotId: string): string {
  return join(store, 'data', 'refs', snapshotId);
}

export function corpusDirOf(store: string, snapshotId: string): string {
  return join(store, 'data', 'corpus', snapshotId);
}

export function graphDirOf(store: string, snapshotId: string): string {
  return join(store, 'data', 'graph', snapshotId);
}

export function webDirOf(store: string, snapshotId: string): string {
  return join(store, 'data', 'web', snapshotId);
}

function shardName(i: number): string {
  return `refs-${String(i).padStart(2, '0')}.jsonl.gz`;
}

export function inspectRefs(refsDir: string): RefsStatus {
  if (!existsSync(refsDir)) {
    throw new Error(`参照抽出の出力がありません: ${refsDir}`);
  }
  const missing: string[] = [];
  for (let i = 0; i < SHARDS; i++) {
    const name = shardName(i);
    if (!existsSync(join(refsDir, name))) missing.push(name);
  }
  for (const name of ['abbrevs.jsonl.gz', 'law-features.jsonl']) {
    if (!existsSync(join(refsDir, name))) missing.push(name);
  }
  if (missing.length) {
    throw new Error(`refs が未完成（不足: ${missing.join(', ')}）: ${refsDir}`);
  }

  const manifestPath = join(refsDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    const fingerprint = fingerprintWithoutManifest(refsDir);
    return {
      complete: false,
      dir: refsDir,
      warning: 'data/refs に manifest.json がない。抽出器の再生成前の出力として扱う。再生成後は graph と export を再実行する。',
      manifest: null,
      fingerprint,
      shardCount: SHARDS,
    };
  }

  const manifest: RefsManifest = RefsManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const fingerprint = `${manifest.snapshotId}:${manifest.corpusSha256}:${manifest.createdAt}`;
  return {
    complete: true,
    dir: refsDir,
    warning: null,
    manifest,
    fingerprint,
    shardCount: SHARDS,
  };
}

function fingerprintWithoutManifest(refsDir: string): string {
  const parts: string[] = [];
  for (let i = 0; i < SHARDS; i++) {
    const p = join(refsDir, shardName(i));
    const st = statSync(p);
    parts.push(`${shardName(i)}:${st.size}`);
  }
  const statsPath = join(refsDir, 'stats.json');
  if (existsSync(statsPath)) {
    parts.push(`stats:${sha256Hex(readFileSync(statsPath))}`);
  }
  return `no-manifest:${sha256Hex(parts.join('|'))}`;
}

export async function* iterateRefs(refsDir: string): AsyncGenerator<Ref> {
  for (let i = 0; i < SHARDS; i++) {
    const p = join(refsDir, shardName(i));
    const rl = createInterface({ input: createReadStream(p).pipe(createGunzip()) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      yield JSON.parse(line) as Ref;
    }
  }
}

export async function readJsonlGz<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as T);
  }
  return out;
}

export function loadLaws(corpusDir: string): LawMeta[] {
  return JSON.parse(readFileSync(join(corpusDir, 'laws.json'), 'utf8')) as LawMeta[];
}

export function loadRepealed(corpusDir: string): LawMeta[] {
  const p = join(corpusDir, 'repealed.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8')) as LawMeta[];
}

export function loadCorpusManifest(corpusDir: string): { snapshotId: string; egovAsof: string; createdAt: string } {
  return JSON.parse(readFileSync(join(corpusDir, 'manifest.json'), 'utf8')) as {
    snapshotId: string;
    egovAsof: string;
    createdAt: string;
  };
}

export function loadLawFeatures(refsDir: string): Map<string, LawFeatures> {
  const text = readFileSync(join(refsDir, 'law-features.jsonl'), 'utf8');
  const map = new Map<string, LawFeatures>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as LawFeatures;
    map.set(rec.lawId, rec);
  }
  return map;
}

export async function loadAbbrevs(refsDir: string): Promise<AbbrevRec[]> {
  return readJsonlGz<AbbrevRec>(join(refsDir, 'abbrevs.jsonl.gz'));
}

export function asLawType(raw: string): LawType {
  return (LAW_TYPES as readonly string[]).includes(raw) ? (raw as LawType) : 'Misc';
}

export function loadJlawAliasToTitle(vendorDir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(vendorDir)) return out;
  for (const name of readdirSync(vendorDir)) {
    if (!name.endsWith('.json')) continue;
    const raw = JSON.parse(readFileSync(join(vendorDir, name), 'utf8')) as Record<string, string>;
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith('_')) continue;
      if (!out.has(k)) out.set(k, v);
    }
  }
  return out;
}
