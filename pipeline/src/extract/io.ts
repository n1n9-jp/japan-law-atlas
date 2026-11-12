import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createGunzip, createGzip } from 'node:zlib';
import { z } from 'zod';
import type { Ref } from '../../lib/ref-types.js';
import { buildDict, loadJlawMaps } from './dict.js';
import { extractLaw } from './extract.js';
import { shardOf } from './hash.js';
import { mulberry32, sampleIndices } from '../lib/random.js';
import { DEFAULT_STORE, readLatest, resolveStore } from '../lib/paths.js';
import { emptyExtras, type ExtractExtras, type NameSource, type SlimLaw, type SlimMeta } from './types.js';

const SHARDS = 32;

const MetaSchema = z.object({
  lawId: z.string(),
  title: z.string(),
  abbrevs: z.array(z.string()).default([]),
  oldTitles: z.array(z.string()).default([]),
  num: z.string().default(''),
  numNorm: z.string().default(''),
  lawType: z.string(),
  status: z.enum(['current', 'notYetEffective', 'repealed']),
  revisionId: z.string().optional(),
  kana: z.string().optional(),
});

const LawSchema = z.object({
  meta: MetaSchema,
  toc: z.array(z.unknown()).default([]),
  articles: z
    .array(
      z.object({
        pid: z.string(),
        part: z.enum(['main', 'enact', 'appdx', 'suppl', 'supplAmend']).default('main'),
        title: z.string().default(''),
        caption: z.string().nullable().default(null),
        toc: z.array(z.number()).default([]),
      }),
    )
    .default([]),
  sentences: z.array(
    z.object({
      pid: z.string(),
      sent: z.number(),
      part: z.enum(['main', 'enact', 'appdx', 'suppl', 'supplAmend']),
      text: z.string(),
      inTable: z.boolean().default(false),
      supplIndex: z.number().nullable().default(null),
      amendLawNum: z.string().nullable().default(null),
    }),
  ),
  appdx: z.array(z.unknown()).optional(),
});

export interface ExtractCliArgs {
  snapshot?: string;
  store?: string;
  law?: string;
}

export function parseArgs(argv: string[]): ExtractCliArgs {
  const out: ExtractCliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    const take = (k: keyof ExtractCliArgs) => {
      if (a.includes('=') && a.split('=')[1]) {
        out[k] = a.slice(a.indexOf('=') + 1);
      } else if (next && !next.startsWith('-')) {
        out[k] = next;
        i++;
      }
    };
    if (a === '--snapshot' || a.startsWith('--snapshot=')) take('snapshot');
    else if (a === '--store' || a.startsWith('--store=')) take('store');
    else if (a === '--law' || a.startsWith('--law=')) take('law');
  }
  return out;
}

export function resolveSnapshot(store: string, snapshot?: string): string {
  if (snapshot) return snapshot;
  const latest = readLatest(store);
  if (!latest) {
    throw new Error(`コーパスがまだありません: ${join(store, 'data/corpus/LATEST')}`);
  }
  return latest;
}

async function readJsonlGz<T>(path: string, parse: (v: unknown) => T): Promise<T[]> {
  const out: T[] = [];
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    out.push(parse(JSON.parse(line)));
  }
  return out;
}

function slimMeta(v: z.infer<typeof MetaSchema>): SlimMeta {
  return {
    lawId: v.lawId,
    title: v.title,
    abbrevs: v.abbrevs,
    oldTitles: v.oldTitles,
    num: v.num,
    numNorm: v.numNorm,
    lawType: v.lawType,
    status: v.status,
  };
}

function slimLaw(v: z.infer<typeof LawSchema>): SlimLaw {
  return {
    meta: slimMeta(v.meta),
    toc: v.toc as SlimLaw['toc'],
    articles: v.articles as SlimLaw['articles'],
    sentences: v.sentences,
  };
}

export async function runExtract(args: ExtractCliArgs): Promise<void> {
  const store = resolveStore(args.store ?? DEFAULT_STORE);
  const snapshot = resolveSnapshot(store, args.snapshot);
  const corpusDir = join(store, 'data/corpus', snapshot);
  const lawsPath = join(corpusDir, 'laws.json');
  const repealedPath = join(corpusDir, 'repealed.json');
  if (!existsSync(lawsPath)) {
    throw new Error(`コーパスがまだありません: ${lawsPath}（m1-01 の完了を待っています）`);
  }

  const t0 = Date.now();
  const laws = (JSON.parse(readFileSync(lawsPath, 'utf8')) as unknown[]).map((x) => slimMeta(MetaSchema.parse(x)));
  const repealed = existsSync(repealedPath)
    ? (JSON.parse(readFileSync(repealedPath, 'utf8')) as unknown[]).map((x) => slimMeta(MetaSchema.parse(x)))
    : [];
  const dict = buildDict([...laws, ...repealed], loadJlawMaps());

  const pidIndex = args.law ? new Map<string, Set<string>>() : await collectPidIndex(corpusDir);
  for (const m of laws) {
    if (!pidIndex.has(m.lawId)) pidIndex.set(m.lawId, new Set());
  }

  const destDir = join(store, 'data/refs', snapshot);
  const outDir = join('/tmp/hourei-refs', snapshot);
  if (!args.law) {
    mkdirSync(outDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });
    const destManifest = join(destDir, 'manifest.json');
    if (existsSync(destManifest)) unlinkSync(destManifest);
  }

  const shardWriters = args.law
    ? []
    : await Promise.all(
        Array.from({ length: SHARDS }, (_, i) =>
          openGzWriter(join(outDir, `refs-${String(i).padStart(2, '0')}.jsonl.gz`)),
        ),
      );
  const abbrevWriter = args.law ? null : await openGzWriter(join(outDir, 'abbrevs.jsonl.gz'));
  const featureLines: string[] = [];
  const unresolved: { mention: string; srcLaw: string; srcPid: string; rule: string }[] = [];
  const ruleCounts = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  const partCounts = new Map<string, number>();
  let refCount = 0;
  let crossPairs = new Set<string>();
  let unknownLawish = 0;
  let lawish = 0;
  let amendingLaw = 0;
  const prevPairs = args.law ? null : await loadPrevMainPairs(destDir);
  const extrasAcc = emptyExtras();
  const sentenceText = new Map<string, string>();
  const supplAmendFusokuDest = {
    sameSk: 0,
    amendingS1: 0,
    otherS1: 0,
    selfS1: 0,
    nullPid: 0,
    other: 0,
    n: 0,
  };
  let nullPidAll = 0;

  const bump = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1);

  const handleLaw = (law: SlimLaw) => {
    if (args.law && law.meta.lawId !== args.law) return;
    const result = extractLaw(law, dict, { targetPids: pidIndex });
    addExtras(extrasAcc, result.extras);
    if (prevPairs) {
      for (const s of law.sentences) {
        const key = `${law.meta.lawId}:${s.pid}#${s.sent}`;
        if (prevPairs.exampleKeys.has(key)) sentenceText.set(key, s.text);
      }
    }
    for (const r of result.refs) {
      refCount++;
      shardWriters[shardOf(r.srcLaw, SHARDS)]?.write(stableRefJson(r));
      bump(ruleCounts, r.rule);
      bump(kindCounts, r.kind);
      bump(partCounts, r.part);
      if (r.tgtStatus === 'amendingLaw') amendingLaw++;
      if (r.tgtLaw && r.tgtLaw !== r.srcLaw && MAIN_PARTS.has(r.part)) {
        crossPairs.add(`${r.srcLaw}>${r.tgtLaw}`);
      }
      if (!r.tgtPid) nullPidAll++;
      if (r.part === 'supplAmend' && r.mention.includes('附則第')) {
        supplAmendFusokuDest.n++;
        const srcK = /^s(\d+)/.exec(r.srcPid)?.[1];
        const tgtK = r.tgtPid ? /^s(\d+)/.exec(r.tgtPid)?.[1] : null;
        if (!r.tgtPid) supplAmendFusokuDest.nullPid++;
        else if (r.tgtStatus === 'amendingLaw' && tgtK === '1') supplAmendFusokuDest.amendingS1++;
        else if (r.tgtLaw && r.tgtLaw !== r.srcLaw && tgtK === '1') supplAmendFusokuDest.otherS1++;
        else if (r.tgtLaw === r.srcLaw && srcK && tgtK === srcK) supplAmendFusokuDest.sameSk++;
        else if (r.tgtLaw === r.srcLaw && tgtK === '1') supplAmendFusokuDest.selfS1++;
        else supplAmendFusokuDest.other++;
      }
      const lawishRef = r.rawName !== null || r.rule.startsWith('L1') || r.rule.startsWith('L5') || r.rule.startsWith('L2');
      if (lawishRef) {
        if (r.tgtStatus === 'amendingLaw') {
          // excluded from both numerator and denominator
        } else {
          lawish++;
          if (r.tgtStatus === 'unknown') {
            unknownLawish++;
            unresolved.push({ mention: r.mention, srcLaw: r.srcLaw, srcPid: r.srcPid, rule: r.rule });
          }
        }
      } else if (r.tgtStatus === 'unknown') {
        unresolved.push({ mention: r.mention, srcLaw: r.srcLaw, srcPid: r.srcPid, rule: r.rule });
      }
    }
    for (const a of result.abbrevs) abbrevWriter?.write(JSON.stringify(a));
    featureLines.push(JSON.stringify(result.features));
    return result;
  };

  let debugResult: ReturnType<typeof extractLaw> | undefined;
  const shardIds = args.law ? [shardOf(args.law, SHARDS)] : [...Array(SHARDS).keys()];
  for (const i of shardIds) {
    const p = join(corpusDir, `text-${String(i).padStart(2, '0')}.jsonl.gz`);
    if (!existsSync(p)) continue;
    const rows = await readJsonlGz(p, (v) => slimLaw(LawSchema.parse(v)));
    for (const law of rows) {
      const r = handleLaw(law);
      if (args.law && r) debugResult = r;
    }
    await Promise.all(shardWriters.map((w) => w.flush()));
    await abbrevWriter?.flush();
  }

  if (args.law) {
    if (!debugResult) throw new Error(`法令 ${args.law} がコーパスにありません`);
    const { formatDebug } = await import('./debug.js');
    process.stdout.write(formatDebug(args.law, debugResult));
    return;
  }

  await Promise.all(shardWriters.map((w) => w.close()));
  await abbrevWriter?.close();
  writeFileSync(join(outDir, 'law-features.jsonl'), featureLines.join('\n') + (featureLines.length ? '\n' : ''));

  const sample = sampleUnresolved(unresolved, 500);
  writeFileSync(join(outDir, 'unresolved-sample.jsonl'), sample.map((x) => JSON.stringify(x)).join('\n') + (sample.length ? '\n' : ''));

  const elapsedMs = Date.now() - t0;
  const mem = process.memoryUsage();
  const stats = {
    snapshot,
    elapsedMs,
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    refs: refCount,
    crossLawPairsMain: crossPairs.size,
    unresolvedRateLawish: lawish === 0 ? 0 : unknownLawish / lawish,
    unknownLawish,
    lawish,
    amendingLaw,
    l3TypeSkips: extrasAcc.l3TypeSkips,
    l5BySource: extrasAcc.l5BySource,
    parenCarry: extrasAcc.parenCarry,
    mergedDojo: extrasAcc.mergedDojo,
    l7CountedByNumber: extrasAcc.l7CountedByNumber,
    prefixHits: extrasAcc.prefixHits,
    droppedAbbrevs: extrasAcc.droppedAbbrevs,
    abbrevByShape: extrasAcc.abbrevByShape,
    abbrevUnrecorded: extrasAcc.abbrevUnrecorded,
    l2Fallback: extrasAcc.l2Fallback,
    dictSkippedDueToBodyDef: extrasAcc.dictSkippedDueToBodyDef,
    tableContext: extrasAcc.tableContext,
    existRetarget: extrasAcc.existRetarget,
    dojoAnte: extrasAcc.dojoAnte,
    dohyoAnte: extrasAcc.dohyoAnte,
    ryukyu: extrasAcc.ryukyu,
    dojoLastOtherButSelf: extrasAcc.dojoLastOtherButSelf,
    droppedNames: dict.stats.droppedNames,
    pairDelta: prevPairs
      ? buildPairDelta(prevPairs.pairs, crossPairs, prevPairs.examples, sentenceText)
      : null,
    supplAmendFusokuDest,
    nullPidAll,
    fusokuNullRate: refCount === 0 ? 0 : supplAmendFusokuDest.nullPid / refCount,
    rules: Object.fromEntries([...ruleCounts.entries()].sort()),
    kinds: Object.fromEntries([...kindCounts.entries()].sort()),
    parts: Object.fromEntries([...partCounts.entries()].sort()),
    dict: dict.stats,
  };
  writeFileSync(join(outDir, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
  writeFileSync(join(outDir, 'report.md'), renderReport(stats));

  const copied: { path: string; bytes: number; sha256: string }[] = [];
  for (const name of readdirSync(outDir).sort()) {
    if (name === 'manifest.json') continue;
    const from = join(outDir, name);
    const to = join(destDir, name);
    copyVerified(from, to);
    const info = sha256File(to);
    const src = sha256File(from);
    if (info.bytes !== src.bytes || info.sha256 !== src.sha256) {
      throw new Error(`写し先の確認に失敗: ${name} src=${src.sha256}/${src.bytes} dest=${info.sha256}/${info.bytes}`);
    }
    copied.push({ path: name, bytes: info.bytes, sha256: info.sha256 });
  }

  const corpusManifest = join(corpusDir, 'manifest.json');
  const corpusSha256 = existsSync(corpusManifest) ? sha256File(corpusManifest).sha256 : '';
  const manifest = {
    snapshotId: snapshot,
    corpusSha256,
    createdAt: new Date().toISOString(),
    files: copied,
  };
  writeFileSync(join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stderr.write(
    `extract done snapshot=${snapshot} refs=${refCount} pairs=${crossPairs.size} ${elapsedMs}ms rssMB=${(mem.rss / (1024 * 1024)).toFixed(0)}\n`,
  );
}

const MAIN_PARTS = new Set(['main', 'enact', 'appdx']);

function sha256File(path: string): { bytes: number; sha256: string } {
  const buf = readFileSync(path);
  return { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

function copyVerified(from: string, to: string): void {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      copyFileSync(from, to);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  const py = spawnSync('python3', ['-c', 'import shutil, sys; shutil.copy2(sys.argv[1], sys.argv[2])', from, to], {
    encoding: 'utf8',
  });
  if (py.status === 0) return;
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`copy failed ${to}: ${msg}; python: ${py.stderr || py.stdout}`);
}

function stableRefJson(r: Ref): string {
  return JSON.stringify({
    id: r.id,
    srcLaw: r.srcLaw,
    srcPid: r.srcPid,
    sent: r.sent,
    part: r.part,
    start: r.start,
    end: r.end,
    mention: r.mention,
    rawName: r.rawName,
    tgtLaw: r.tgtLaw,
    tgtStatus: r.tgtStatus,
    tgtPid: r.tgtPid,
    tgtEnd: r.tgtEnd,
    kind: r.kind,
    flags: r.flags,
    rule: r.rule,
    confidence: r.confidence,
  });
}

function openGzWriter(path: string): {
  write: (line: string) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
} {
  const gzip = createGzip();
  const out = createWriteStream(path);
  gzip.pipe(out);
  let draining: Promise<void> | null = null;
  return {
    write(line: string) {
      if (!gzip.write(line + '\n') && !draining) {
        draining = once(gzip, 'drain').then(() => {
          draining = null;
        });
      }
    },
    async flush() {
      if (draining) await draining;
    },
    async close() {
      if (draining) await draining;
      const finished = once(out, 'finish');
      gzip.end();
      await finished;
    },
  };
}

async function collectPidIndex(corpusDir: string): Promise<Map<string, Set<string>>> {
  const index = new Map<string, Set<string>>();
  for (let i = 0; i < SHARDS; i++) {
    const p = join(corpusDir, `text-${String(i).padStart(2, '0')}.jsonl.gz`);
    if (!existsSync(p)) continue;
    const rows = await readJsonlGz(p, (v) => slimLaw(LawSchema.parse(v)));
    for (const law of rows) {
      const set = index.get(law.meta.lawId) ?? new Set<string>();
      for (const a of law.articles) set.add(a.pid);
      for (const s of law.sentences) set.add(s.pid);
      index.set(law.meta.lawId, set);
    }
  }
  return index;
}

function sampleUnresolved<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const rng = mulberry32(20261008);
  return sampleIndices(items.length, n, rng).map((i) => items[i]!);
}

interface PairExample {
  srcLaw: string;
  tgtLaw: string;
  mention: string;
  srcPid: string;
  sent: number;
}

interface PairDelta {
  prev: number;
  now: number;
  added: number;
  removed: number;
  removedSamples: { srcLaw: string; tgtLaw: string; mention: string; srcPid: string; sent: number; text: string }[];
}

async function loadPrevMainPairs(destDir: string): Promise<{
  pairs: Set<string>;
  examples: Map<string, PairExample>;
  exampleKeys: Set<string>;
} | null> {
  const pairs = new Set<string>();
  const examples = new Map<string, PairExample>();
  const exampleKeys = new Set<string>();
  let found = false;
  for (let i = 0; i < SHARDS; i++) {
    const p = join(destDir, `refs-${String(i).padStart(2, '0')}.jsonl.gz`);
    if (!existsSync(p)) continue;
    found = true;
    const rows = await readJsonlGz(p, (v) => v as Ref);
    for (const r of rows) {
      if (!r.tgtLaw || r.tgtLaw === r.srcLaw || !MAIN_PARTS.has(r.part)) continue;
      const key = `${r.srcLaw}>${r.tgtLaw}`;
      pairs.add(key);
      if (!examples.has(key)) {
        examples.set(key, {
          srcLaw: r.srcLaw,
          tgtLaw: r.tgtLaw,
          mention: r.mention,
          srcPid: r.srcPid,
          sent: r.sent,
        });
        exampleKeys.add(`${r.srcLaw}:${r.srcPid}#${r.sent}`);
      }
    }
  }
  if (!found || pairs.size === 0) return null;
  return { pairs, examples, exampleKeys };
}

function buildPairDelta(
  prev: Set<string>,
  now: Set<string>,
  examples: Map<string, PairExample>,
  sentenceText: Map<string, string>,
): PairDelta {
  const removedKeys = [...prev].filter((k) => !now.has(k));
  const added = [...now].filter((k) => !prev.has(k)).length;
  const rng = mulberry32(20261008);
  const sampleIdx = sampleIndices(removedKeys.length, Math.min(50, removedKeys.length), rng);
  const removedSamples = sampleIdx.map((i) => {
    const key = removedKeys[i]!;
    const ex = examples.get(key);
    const text = ex ? (sentenceText.get(`${ex.srcLaw}:${ex.srcPid}#${ex.sent}`) ?? '') : '';
    return {
      srcLaw: ex?.srcLaw ?? key.split('>')[0]!,
      tgtLaw: ex?.tgtLaw ?? key.split('>')[1]!,
      mention: ex?.mention ?? '',
      srcPid: ex?.srcPid ?? '',
      sent: ex?.sent ?? 0,
      text,
    };
  });
  return { prev: prev.size, now: now.size, added, removed: removedKeys.length, removedSamples };
}

function addExtras(acc: ExtractExtras, x: ExtractExtras): void {
  acc.l3TypeSkips += x.l3TypeSkips;
  acc.parenCarry += x.parenCarry;
  acc.mergedDojo += x.mergedDojo;
  acc.l7CountedByNumber += x.l7CountedByNumber;
  acc.prefixHits += x.prefixHits;
  acc.droppedAbbrevs += x.droppedAbbrevs;
  acc.l2Fallback += x.l2Fallback;
  acc.dictSkippedDueToBodyDef += x.dictSkippedDueToBodyDef;
  acc.existRetarget += x.existRetarget;
  acc.ryukyu += x.ryukyu;
  acc.dojoLastOtherButSelf += x.dojoLastOtherButSelf;
  acc.tableContext.rowLaw += x.tableContext.rowLaw;
  acc.tableContext.yomikae += x.tableContext.yomikae;
  acc.dohyoAnte.self += x.dohyoAnte.self;
  acc.dohyoAnte.other += x.dohyoAnte.other;
  acc.dohyoAnte.miss += x.dohyoAnte.miss;
  for (const k of Object.keys(acc.l5BySource) as NameSource[]) acc.l5BySource[k] += x.l5BySource[k];
  for (const k of Object.keys(x.abbrevByShape) as (keyof ExtractExtras['abbrevByShape'])[]) {
    acc.abbrevByShape[k] += x.abbrevByShape[k];
  }
  for (const [k, v] of Object.entries(x.abbrevUnrecorded)) {
    acc.abbrevUnrecorded[k] = (acc.abbrevUnrecorded[k] ?? 0) + v;
  }
  for (const k of Object.keys(acc.dojoAnte) as (keyof ExtractExtras['dojoAnte'])[]) {
    acc.dojoAnte[k] += x.dojoAnte[k];
  }
}

function renderReport(stats: {
  snapshot: string;
  elapsedMs: number;
  rssBytes: number;
  refs: number;
  crossLawPairsMain: number;
  unresolvedRateLawish: number;
  amendingLaw?: number;
  l3TypeSkips?: number;
  l5BySource?: Record<string, number>;
  parenCarry?: number;
  mergedDojo?: number;
  l7CountedByNumber?: number;
  prefixHits?: number;
  droppedAbbrevs?: number;
  droppedNames?: number;
  abbrevByShape?: Record<string, number>;
  abbrevUnrecorded?: Record<string, number>;
  l2Fallback?: number;
  dictSkippedDueToBodyDef?: number;
  tableContext?: { rowLaw: number; yomikae: number };
  existRetarget?: number;
  dojoAnte?: Record<string, number>;
  dohyoAnte?: Record<string, number>;
  ryukyu?: number;
  dojoLastOtherButSelf?: number;
  pairDelta?: PairDelta | null;
  supplAmendFusokuDest?: Record<string, number>;
  fusokuNullRate?: number;
  rules: Record<string, number>;
  kinds: Record<string, number>;
  parts: Record<string, number>;
}): string {
  const d = stats.pairDelta;
  const lines = [
    `# 参照抽出 ${stats.snapshot}`,
    '',
    `- 処理時間: ${(stats.elapsedMs / 1000).toFixed(1)} 秒`,
    `- RSS: ${(stats.rssBytes / (1024 * 1024)).toFixed(0)} MB`,
    `- 参照数: ${stats.refs}`,
    `- 本則系の他法令ペア: ${stats.crossLawPairsMain}`,
    `- 法令名らしい言及の未解決率: ${(stats.unresolvedRateLawish * 100).toFixed(2)}%`,
    `- amendingLaw: ${stats.amendingLaw ?? 0}`,
    `- L3 種類スキップ: ${stats.l3TypeSkips ?? 0}`,
    `- L5 当たり方: ${JSON.stringify(stats.l5BySource ?? {})}`,
    `- 括弧書きを越えて引き継いだ件数: ${stats.parenCarry ?? 0}`,
    `- 「同条」などを後ろの条項とまとめた件数: ${stats.mergedDojo ?? 0}`,
    `- L7 を条番号で数えた件数（抄）: ${stats.l7CountedByNumber ?? 0}`,
    `- 新/旧/改正前の前置きで当たった件数: ${stats.prefixHits ?? 0}`,
    `- 末尾の条件で捨てた略称の数: ${stats.droppedAbbrevs ?? 0}`,
    `- 辞書から外した名前の数: ${stats.droppedNames ?? 0}`,
    `- 略称の定義の形: ${JSON.stringify(stats.abbrevByShape ?? {})}`,
    `- 定義の括弧を記録しなかった数（理由別）: ${JSON.stringify(stats.abbrevUnrecorded ?? {})}`,
    `- L2-abbrev-fallback: ${stats.l2Fallback ?? 0}`,
    `- 本文の定義があるので辞書を使わなかった: ${stats.dictSkippedDueToBodyDef ?? 0}`,
    `- 表の文脈: ${JSON.stringify(stats.tableContext ?? {})}`,
    `- 条の有無で引き継ぎ先を変えた: ${stats.existRetarget ?? 0}`,
    `- 同条・同項・同号の先行詞: ${JSON.stringify(stats.dojoAnte ?? {})}`,
    `- 同表の先行詞: ${JSON.stringify(stats.dohyoAnte ?? {})}`,
    `- 琉球政府の立法: ${stats.ryukyu ?? 0}`,
    `- 同条で直前が他法令なのに自分の法令にした: ${stats.dojoLastOtherButSelf ?? 0}`,
    `- 改正附則の附則第: ${JSON.stringify(stats.supplAmendFusokuDest ?? {})}`,
    `- 附則第 pidなし/全体: ${((stats.fusokuNullRate ?? 0) * 100).toFixed(3)}%`,
    '',
    '## 前の版との法令ペア',
    '',
    d
      ? [
          `- 前の版の本則系他法令ペア: ${d.prev}`,
          `- 今回: ${d.now}`,
          `- 増えた数: ${d.added}`,
          `- 減った数: ${d.removed}`,
          '',
          '### 減ったペアの標本50件',
          '',
          ...d.removedSamples.map(
            (s) =>
              `- ${s.srcLaw} → ${s.tgtLaw} mention=${JSON.stringify(s.mention)} srcPid=${s.srcPid} sent=${s.sent}\n  ${s.text}`,
          ),
        ].join('\n')
      : '- （前の版なし）',
    '',
    '## 規則',
    '',
    ...Object.entries(stats.rules).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## 種類',
    '',
    ...Object.entries(stats.kinds).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## 部',
    '',
    ...Object.entries(stats.parts).map(([k, v]) => `- ${k}: ${v}`),
    '',
  ];
  return lines.join('\n');
}
