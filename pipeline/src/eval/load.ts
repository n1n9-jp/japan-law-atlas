import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Part } from '../../lib/shared/contract.ts';
import { csvToObjects } from './csv.ts';
import {
  hardBits,
  rowKey,
  typeBucket,
  type IndexRow,
} from './gold-sample.ts';
import { readJsonl, readJsonlGz, listShardFiles, forEachJsonlGzLine } from './io.ts';
import { articlePid, sentenceKey } from './pid.ts';
import {
  goldAnnotationSchema,
  goldSentenceSchema,
  lawMetaSchema,
  predRefSchema,
} from './schemas.ts';
import type { EvalPaths } from './paths.ts';
import type { GoldAnnotation, GoldSentence, PredRef } from './types.ts';

export async function loadGold(paths: EvalPaths): Promise<{
  sentences: GoldSentence[];
  annotations: GoldAnnotation[];
  adjudicated: GoldAnnotation[];
} | null> {
  if (!existsSync(paths.sentences) || !existsSync(paths.annotations)) return null;
  const sentences = readJsonl(paths.sentences, goldSentenceSchema);
  const annotations = readJsonl(paths.annotations, goldAnnotationSchema);
  const adjudicated = existsSync(paths.adjudicated)
    ? readJsonl(paths.adjudicated, goldAnnotationSchema)
    : [];
  return { sentences, annotations, adjudicated };
}

export function refsReady(paths: EvalPaths): boolean {
  return existsSync(path.join(paths.refsDir, 'manifest.json'));
}

export async function loadPreds(paths: EvalPaths): Promise<PredRef[] | null> {
  if (!refsReady(paths)) return null;
  const files = listShardFiles(paths.refsDir, 'refs-', '.jsonl.gz');
  if (files.length === 0) return null;
  const all: PredRef[] = [];
  for (const file of files) {
    const rows = await readJsonlGz(file, predRefSchema);
    for (const row of rows) all.push(row);
  }
  return all;
}

export function loadSupplement(paths: EvalPaths): {
  sentences: GoldSentence[];
  annotations: GoldAnnotation[];
} | null {
  if (!existsSync(paths.supplementRelative)) return null;
  const rows = readJsonl(paths.supplementRelative, goldSentenceSchema.passthrough());
  const sentences: GoldSentence[] = [];
  const annotations: GoldAnnotation[] = [];
  for (const row of rows) {
    const rec = row as GoldSentence & { annotator?: string; refs?: GoldAnnotation['refs'] };
    sentences.push({
      gid: rec.gid,
      lawId: rec.lawId,
      pid: rec.pid,
      sent: rec.sent,
      part: rec.part,
      text: rec.text,
      articleText: rec.articleText,
      stratum: rec.stratum,
    });
    annotations.push({
      gid: rec.gid,
      annotator: rec.annotator ?? 'c1',
      refs: rec.refs ?? [],
    });
  }
  return { sentences, annotations };
}

export function loadStatusById(paths: EvalPaths): Map<string, string> | null {
  const lawsPath = path.join(paths.corpusDir, 'laws.json');
  if (!existsSync(lawsPath)) return null;
  const parsed: unknown = JSON.parse(readFileSync(lawsPath, 'utf8'));
  const arr = Array.isArray(parsed) ? parsed : [];
  const map = new Map<string, string>();
  for (const item of arr) {
    const v = lawMetaSchema.safeParse(item);
    if (!v.success) continue;
    map.set(v.data.lawId, v.data.status);
  }
  const repealedPath = path.join(paths.corpusDir, 'repealed.json');
  if (existsSync(repealedPath)) {
    const r: unknown = JSON.parse(readFileSync(repealedPath, 'utf8'));
    const rows = Array.isArray(r) ? r : [];
    for (const item of rows) {
      const v = lawMetaSchema.safeParse(item);
      if (!v.success) continue;
      map.set(v.data.lawId, v.data.status);
    }
  }
  return map;
}

function intern(cache: Map<string, string>, value: string): string {
  const hit = cache.get(value);
  if (hit) return hit;
  cache.set(value, value);
  return value;
}

function asCorpusLaw(parsed: unknown, where: string): {
  lawId: string;
  title: string;
  lawType: string;
  sentences: { pid: string; sent: number; part: Part; text: string }[];
} {
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${where}: not an object`);
  const rec = parsed as { meta?: unknown; sentences?: unknown };
  if (typeof rec.meta !== 'object' || rec.meta === null) throw new Error(`${where}: missing meta`);
  const meta = rec.meta as { lawId?: unknown; title?: unknown; lawType?: unknown };
  if (typeof meta.lawId !== 'string' || typeof meta.title !== 'string' || typeof meta.lawType !== 'string') {
    throw new Error(`${where}: meta fields`);
  }
  if (!Array.isArray(rec.sentences)) throw new Error(`${where}: sentences`);
  const sentences: { pid: string; sent: number; part: Part; text: string }[] = [];
  for (const item of rec.sentences) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as { pid?: unknown; sent?: unknown; part?: unknown; text?: unknown };
    if (typeof s.pid !== 'string' || typeof s.sent !== 'number' || typeof s.part !== 'string' || typeof s.text !== 'string') {
      continue;
    }
    sentences.push({ pid: s.pid, sent: s.sent, part: s.part as Part, text: s.text });
  }
  return { lawId: meta.lawId, title: meta.title, lawType: meta.lawType, sentences };
}

export async function buildSentenceIndex(paths: EvalPaths): Promise<IndexRow[]> {
  const files = listShardFiles(paths.corpusDir, 'text-', '.jsonl.gz');
  if (files.length === 0) {
    throw new Error(`corpus shards not found in ${paths.corpusDir}`);
  }
  const out: IndexRow[] = [];
  const lawIds = new Map<string, string>();
  const pids = new Map<string, string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    await forEachJsonlGzLine(file, (parsed, lineNo) => {
      const law = asCorpusLaw(parsed, `${file}:${lineNo}`);
      const bucket = typeBucket(law.lawType);
      const lawId = intern(lawIds, law.lawId);
      for (const s of law.sentences) {
        out.push({
          lawId,
          pid: intern(pids, s.pid),
          sent: s.sent,
          part: s.part,
          bucket,
          bits: hardBits(s.text, law.title),
        });
      }
    });
    process.stderr.write(`index ${i + 1}/${files.length} ${path.basename(file)} rows=${out.length}\n`);
  }
  return out;
}

export async function hydrateGoldBodies(
  paths: EvalPaths,
  selected: readonly IndexRow[],
): Promise<Map<string, { text: string; articleText: string }>> {
  const wantLaws = new Set(selected.map((s) => s.lawId));
  const wantKeys = new Set(selected.map(rowKey));
  const wantArticles = new Set(
    selected.map((s) => `${s.lawId}\t${articlePid(s.pid) ?? s.pid}`),
  );
  const files = listShardFiles(paths.corpusDir, 'text-', '.jsonl.gz');
  const out = new Map<string, { text: string; articleText: string }>();
  for (const file of files) {
    await forEachJsonlGzLine(file, (parsed, lineNo) => {
      const law = asCorpusLaw(parsed, `${file}:${lineNo}`);
      if (!wantLaws.has(law.lawId)) return;
      const byArticle = new Map<string, string[]>();
      for (const s of law.sentences) {
        const akey = articlePid(s.pid) ?? s.pid;
        if (!wantArticles.has(`${law.lawId}\t${akey}`)) continue;
        const list = byArticle.get(akey);
        if (list) list.push(s.text);
        else byArticle.set(akey, [s.text]);
      }
      for (const s of law.sentences) {
        const key = rowKey({ lawId: law.lawId, pid: s.pid, sent: s.sent });
        if (!wantKeys.has(key)) continue;
        const akey = articlePid(s.pid) ?? s.pid;
        out.set(key, { text: s.text, articleText: (byArticle.get(akey) ?? [s.text]).join('') });
      }
    });
  }
  return out;
}

export async function loadCorpusSentencesForLaws(
  paths: EvalPaths,
  lawIds: ReadonlySet<string>,
): Promise<Map<string, { pid: string; sent: number; text: string }[]>> {
  const out = new Map<string, { pid: string; sent: number; text: string }[]>();
  if (lawIds.size === 0) return out;
  const files = listShardFiles(paths.corpusDir, 'text-', '.jsonl.gz');
  for (const file of files) {
    await forEachJsonlGzLine(file, (parsed, lineNo) => {
      const law = asCorpusLaw(parsed, `${file}:${lineNo}`);
      if (!lawIds.has(law.lawId)) return;
      out.set(
        law.lawId,
        law.sentences.map((s) => ({ pid: s.pid, sent: s.sent, text: s.text })),
      );
    });
  }
  return out;
}

export function predsForSentences(
  sentences: readonly GoldSentence[],
  preds: readonly PredRef[],
): PredRef[] {
  const keys = new Set(sentences.map((s) => sentenceKey(s.lawId, s.pid, s.sent)));
  return preds.filter((p) => keys.has(sentenceKey(p.srcLaw, p.srcPid, p.sent)));
}

export function loadPairCsv(filePath: string): Set<string> {
  const rows = csvToObjects(readFileSync(filePath, 'utf8'));
  const set = new Set<string>();
  for (const row of rows) {
    const src = row.src_law_id ?? '';
    const tgt = row.tgt_law_id ?? '';
    if (src && tgt) set.add(`${src}\t${tgt}`);
  }
  return set;
}

export function goldRefsForEval(
  sentences: readonly GoldSentence[],
  annotations: readonly GoldAnnotation[],
  adjudicated: readonly GoldAnnotation[],
): Map<string, GoldAnnotation['refs']> {
  const finalByGid = new Map<string, GoldAnnotation['refs']>();
  for (const row of adjudicated) {
    if (row.annotator === 'final') finalByGid.set(row.gid, row.refs);
  }
  const pass1 = new Map<string, GoldAnnotation['refs']>();
  for (const row of annotations) {
    if (row.annotator === 'final') {
      finalByGid.set(row.gid, row.refs);
      continue;
    }
    if (!pass1.has(row.gid)) pass1.set(row.gid, row.refs);
  }
  const out = new Map<string, GoldAnnotation['refs']>();
  for (const s of sentences) {
    out.set(s.gid, finalByGid.get(s.gid) ?? pass1.get(s.gid) ?? []);
  }
  return out;
}
