import { csvToObjects, parseCsv, toCsv } from './csv.ts';
import { JLAW_SECOND_PASS_SIZE } from './expected.ts';
import { writeText } from './io.ts';
import { articlePid } from './pid.ts';
import { EVAL_SEED, mulberry32, shuffle } from './random.ts';
import type { PredRef } from './types.ts';

export interface JlawPrecisionRow {
  via: string;
  source_id: string;
  source_article: string;
  cited_name: string;
  resolved_id: string;
  ctx_hit: string;
  label_O_X: string;
}

export interface JlawSampleResult {
  available: boolean;
  reason: string | null;
  oTotal: number;
  xTotal: number;
  unknown: number;
  jlawPrecision: number | null;
  ourCorrectRate: number | null;
  ourMissingRate: number | null;
  xWeFixed: number;
  matchedRows: number;
  unmatchedCorpus: number;
  labelAgreement: number | null;
  labelAgreementN: number;
  oAgree: number | null;
  xAvoid: number | null;
}

export interface CorpusSent {
  pid: string;
  sent: number;
  text: string;
}

/** Original-column CSV for a second annotator. No our_label. label_O_X stays empty. */
export function writeJlawSecondPass(csvText: string, dest: string, seed = EVAL_SEED): {
  selected: number;
  origIndices: number[];
} {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('jlaw precision sample has no data rows');
  const header = rows[0]!;
  const data = rows.slice(1).map((row, origIndex) => ({ origIndex, row }));
  const picked = shuffle(data, mulberry32(seed)).slice(0, JLAW_SECOND_PASS_SIZE);
  const out = [header, ...picked.map((p) => {
    const copy = p.row.slice();
    const labelIdx = header.indexOf('label_O_X');
    if (labelIdx >= 0) copy[labelIdx] = '';
    while (copy.length < header.length) copy.push('');
    return copy.slice(0, header.length);
  })];
  writeText(dest, toCsv(out));
  return { selected: picked.length, origIndices: picked.map((p) => p.origIndex) };
}

export function parseJlawArticle(sourceArticle: string): string | null {
  const t = sourceArticle.replace(/\s+/g, '');
  const m = t.match(/第([0-9]+(?:[-_][0-9]+)*)条/);
  if (!m) return null;
  const num = m[1]!.replaceAll('-', '_');
  return `m.a${num}`;
}

export function jlawPrecisionEval(
  csvText: string,
  preds: readonly PredRef[],
): JlawSampleResult {
  const rows = csvToObjects(csvText).map((r) => ({
    via: r.via ?? '',
    source_id: r.source_id ?? '',
    source_article: r.source_article ?? '',
    cited_name: r.cited_name ?? '',
    resolved_id: r.resolved_id ?? '',
    ctx_hit: r.ctx_hit ?? '',
    label_O_X: (r.label_O_X ?? '').trim(),
  }));
  const byLaw = new Map<string, PredRef[]>();
  for (const p of preds) {
    const list = byLaw.get(p.srcLaw);
    if (list) list.push(p);
    else byLaw.set(p.srcLaw, [p]);
  }

  let oTotal = 0;
  let xTotal = 0;
  let oAgree = 0;
  let xSameError = 0;
  let matchedRows = 0;
  let labeled = 0;

  for (const row of rows) {
    if (row.label_O_X === 'O' || row.label_O_X === 'X') labeled += 1;
    const ours = findCorresponding(row, byLaw.get(row.source_id) ?? []);
    if (ours) matchedRows += 1;
    if (row.label_O_X === 'O') {
      oTotal += 1;
      if (ours && ours.tgtLaw === row.resolved_id) oAgree += 1;
    } else if (row.label_O_X === 'X') {
      xTotal += 1;
      if (ours && ours.tgtLaw === row.resolved_id) xSameError += 1;
    }
  }

  if (labeled === 0) {
    return emptyJlaw('JLaw precision_sample.csv の label_O_X がすべて空（公開ファイルは注釈用テンプレート）');
  }
  return {
    available: true,
    reason: null,
    oTotal,
    xTotal,
    unknown: 0,
    jlawPrecision: oTotal + xTotal === 0 ? null : oTotal / (oTotal + xTotal),
    ourCorrectRate: oTotal === 0 ? null : oAgree / oTotal,
    ourMissingRate: null,
    xWeFixed: xTotal - xSameError,
    matchedRows,
    unmatchedCorpus: 0,
    labelAgreement: null,
    labelAgreementN: 0,
    oAgree: oTotal === 0 ? null : oAgree / oTotal,
    xAvoid: xTotal === 0 ? null : 1 - xSameError / xTotal,
  };
}

function emptyJlaw(reason: string): JlawSampleResult {
  return {
    available: false,
    reason,
    oTotal: 0,
    xTotal: 0,
    unknown: 0,
    jlawPrecision: null,
    ourCorrectRate: null,
    ourMissingRate: null,
    xWeFixed: 0,
    matchedRows: 0,
    unmatchedCorpus: 0,
    labelAgreement: null,
    labelAgreementN: 0,
    oAgree: null,
    xAvoid: null,
  };
}

export function jlawLabeledEval(
  labeledCsv: string,
  secondPassCsv: string | null,
  preds: readonly PredRef[],
  corpusByLaw: ReadonlyMap<string, readonly CorpusSent[]>,
): JlawSampleResult {
  const rows = csvToObjects(labeledCsv);
  const byLaw = new Map<string, PredRef[]>();
  for (const p of preds) {
    const list = byLaw.get(p.srcLaw);
    if (list) list.push(p);
    else byLaw.set(p.srcLaw, [p]);
  }
  let oTotal = 0;
  let xTotal = 0;
  let unknown = 0;
  let ourCorrect = 0;
  let ourMissing = 0;
  let xWeFixed = 0;
  let matchedRows = 0;
  let unmatchedCorpus = 0;
  let judged = 0;

  for (const row of rows) {
    const label = (row.our_label ?? row.label_O_X ?? '').trim();
    if (label === '?') {
      unknown += 1;
      continue;
    }
    if (label !== 'O' && label !== 'X') continue;
    judged += 1;
    if (label === 'O') oTotal += 1;
    else xTotal += 1;
    const correctId = label === 'O' ? row.resolved_id ?? '' : row.correct_law_id ?? '';
    const hit = findCtxHit(corpusByLaw.get(row.source_id ?? '') ?? [], row.ctx_before ?? '', row.ctx_hit ?? '');
    if (!hit) {
      unmatchedCorpus += 1;
      continue;
    }
    const ours = overlapPred(
      byLaw.get(row.source_id ?? '') ?? [],
      hit.pid,
      hit.sent,
      hit.start,
      hit.end,
    );
    if (!ours) {
      ourMissing += 1;
      continue;
    }
    matchedRows += 1;
    if (ours.tgtLaw === correctId) {
      ourCorrect += 1;
      if (label === 'X') xWeFixed += 1;
    }
  }

  let agree = 0;
  let agreeN = 0;
  if (secondPassCsv) {
    const oursByKey = new Map<string, string>();
    for (const row of rows) {
      oursByKey.set(jlawRowKey(row), (row.our_label ?? '').trim());
    }
    for (const row of csvToObjects(secondPassCsv)) {
      const key = jlawRowKey(row);
      const a = oursByKey.get(key);
      const b = (row.label_O_X ?? '').trim();
      if (!a || !b) continue;
      agreeN += 1;
      if (a === b) agree += 1;
    }
  }

  if (judged === 0) return emptyJlaw('our_label が空');
  return {
    available: true,
    reason: null,
    oTotal,
    xTotal,
    unknown,
    jlawPrecision: oTotal + xTotal === 0 ? null : oTotal / (oTotal + xTotal),
    ourCorrectRate: matchedRows === 0 ? null : ourCorrect / matchedRows,
    ourMissingRate: judged === 0 ? null : ourMissing / judged,
    xWeFixed,
    matchedRows,
    unmatchedCorpus,
    labelAgreement: agreeN === 0 ? null : agree / agreeN,
    labelAgreementN: agreeN,
    oAgree: oTotal === 0 ? null : ourCorrect / Math.max(1, oTotal),
    xAvoid: xTotal === 0 ? null : xWeFixed / xTotal,
  };
}

export function jlawRowKey(row: Record<string, string>): string {
  return `${row.source_id ?? ''}\t${row.ctx_hit ?? ''}\t${row.cited_name ?? ''}\t${row.resolved_id ?? ''}`;
}

export function findCtxHit(
  sentences: readonly CorpusSent[],
  ctxBefore: string,
  ctxHit: string,
): { pid: string; sent: number; start: number; end: number } | null {
  if (!ctxHit) return null;
  const tail = ctxBefore.replace(/\s+/g, '').slice(-24);
  let fallback: { pid: string; sent: number; start: number; end: number } | null = null;
  for (const s of sentences) {
    const idx = s.text.indexOf(ctxHit);
    if (idx < 0) continue;
    const cand = { pid: s.pid, sent: s.sent, start: idx, end: idx + ctxHit.length };
    const prefix = s.text.slice(0, idx).replace(/\s+/g, '');
    if (tail && prefix.endsWith(tail)) return cand;
    fallback ??= cand;
  }
  return fallback;
}

function overlapPred(
  preds: readonly PredRef[],
  pid: string,
  sent: number,
  start: number,
  end: number,
): PredRef | null {
  const span = { start, end };
  const cands = preds.filter((p) => p.srcPid === pid && p.sent === sent);
  let best: PredRef | null = null;
  let bestOv = 0;
  for (const p of cands) {
    const ov = Math.max(0, Math.min(p.end, span.end) - Math.max(p.start, span.start));
    const la = p.end - p.start;
    const lb = span.end - span.start;
    if (la <= 0 || lb <= 0) continue;
    if (ov * 2 >= la && ov * 2 >= lb && ov > bestOv) {
      best = p;
      bestOv = ov;
    }
  }
  return best;
}

export function findCorresponding(
  row: JlawPrecisionRow,
  preds: readonly PredRef[],
): PredRef | null {
  const article = parseJlawArticle(row.source_article);
  const hit = row.ctx_hit;
  const inArticle = article
    ? preds.filter((p) => articlePid(p.srcPid) === article)
    : preds;
  const scored = inArticle
    .map((p) => ({ p, score: mentionScore(p, hit, row.cited_name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p ?? null;
}

function mentionScore(p: PredRef, hit: string, citedName: string): number {
  if (hit && p.mention === hit) return 4;
  if (hit && (p.mention.includes(hit) || hit.includes(p.mention))) return 3;
  if (citedName && (p.rawName === citedName || p.mention.includes(citedName))) return 2;
  if (hit && p.mention !== '' && hit.includes(p.mention.slice(0, Math.min(4, p.mention.length)))) {
    return 1;
  }
  return 0;
}
