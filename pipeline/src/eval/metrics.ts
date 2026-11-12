import { REF_KINDS, type RefKind } from '../../lib/shared/contract.ts';
import { BOOTSTRAP_ITERS, EVAL_SEED } from './expected.ts';
import { greedyMatch } from './match.ts';
import {
  articlePid,
  isIgnoredPredMention,
  isRelativeMention,
  pidStartsWith,
  relativeHead,
  sentenceKey,
} from './pid.ts';
import { mulberry32 } from './random.ts';
import type { GoldRef, GoldSentence, MatchPair, PredRef, Prf } from './types.ts';

export function prf(tp: number, fp: number, fn: number): Prf {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

export interface LinkedRef {
  gold: GoldRef;
  pred: PredRef;
}

export function usablePred(p: PredRef): boolean {
  return !isIgnoredPredMention(p.mention);
}

export function groupPreds(preds: readonly PredRef[]): Map<string, PredRef[]> {
  const map = new Map<string, PredRef[]>();
  for (const p of preds) {
    if (!usablePred(p)) continue;
    const key = sentenceKey(p.srcLaw, p.srcPid, p.sent);
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return map;
}

export function matchSentenceRefs(
  gold: readonly GoldRef[],
  pred: readonly PredRef[],
): MatchPair<GoldRef, PredRef>[] {
  return greedyMatch(gold, pred);
}

export function matchAll(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
): { pairs: LinkedRef[]; goldCount: number; predCount: number } {
  const predBySent = groupPreds(preds);
  const pairs: LinkedRef[] = [];
  let goldCount = 0;
  let predCount = 0;
  const usedPredKeys = new Set<string>();
  for (const s of sentences) {
    const gRefs = goldByGid.get(s.gid) ?? [];
    const key = sentenceKey(s.lawId, s.pid, s.sent);
    const pRefs = predBySent.get(key) ?? [];
    goldCount += gRefs.length;
    predCount += pRefs.length;
    usedPredKeys.add(key);
    for (const m of matchSentenceRefs(gRefs, pRefs)) {
      pairs.push({ gold: m.gold, pred: m.pred });
    }
  }
  return { pairs, goldCount, predCount };
}

export function isCrossLawStatus(status: GoldRef['tgtStatus']): boolean {
  return status === 'current' || status === 'repealed';
}

export function isCrossLawGold(srcLaw: string, ref: GoldRef): boolean {
  return ref.tgtLaw !== null && ref.tgtLaw !== srcLaw && isCrossLawStatus(ref.tgtStatus);
}

export function isCrossLawPred(srcLaw: string, ref: PredRef): boolean {
  return ref.tgtLaw !== null && ref.tgtLaw !== srcLaw && isCrossLawStatus(ref.tgtStatus);
}

export function isRelativeIntraGold(srcLaw: string, ref: GoldRef): boolean {
  const self = ref.tgtStatus === 'self' || ref.tgtLaw === srcLaw;
  return self && isRelativeMention(ref.mention);
}

export function crossLawPrf(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
): Prf {
  const sentByKey = new Map(sentences.map((s) => [s.gid, s]));
  const { pairs } = matchAll(sentences, goldByGid, preds);
  const predBySent = groupPreds(preds);
  let tp = 0;
  let fn = 0;
  const matchedPred = new Set<PredRef>();
  for (const s of sentences) {
    const gRefs = goldByGid.get(s.gid) ?? [];
    for (const g of gRefs) {
      if (!isCrossLawGold(s.lawId, g)) continue;
      const hit = pairs.find((p) => p.gold === g && p.pred.tgtLaw === g.tgtLaw);
      if (hit) {
        tp += 1;
        matchedPred.add(hit.pred);
      } else fn += 1;
    }
  }
  let fp = 0;
  for (const s of sentences) {
    const key = sentenceKey(s.lawId, s.pid, s.sent);
    for (const p of predBySent.get(key) ?? []) {
      if (!isCrossLawPred(s.lawId, p)) continue;
      if (matchedPred.has(p)) continue;
      const already = pairs.some((x) => x.pred === p && x.gold.tgtLaw === p.tgtLaw);
      if (already) continue;
      fp += 1;
    }
  }
  void sentByKey;
  return prf(tp, fp, fn);
}

export function articleLevelPrf(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
): Prf {
  const { pairs } = matchAll(sentences, goldByGid, preds);
  const predBySent = groupPreds(preds);
  let tp = 0;
  let fn = 0;
  const matchedPred = new Set<PredRef>();
  for (const s of sentences) {
    for (const g of goldByGid.get(s.gid) ?? []) {
      if (!isCrossLawGold(s.lawId, g)) continue;
      if (articlePid(g.tgtPid) === null) continue;
      const hit = pairs.find(
        (p) =>
          p.gold === g &&
          p.pred.tgtLaw === g.tgtLaw &&
          articlePid(p.pred.tgtPid) === articlePid(g.tgtPid),
      );
      if (hit) {
        tp += 1;
        matchedPred.add(hit.pred);
      } else fn += 1;
    }
  }
  let fp = 0;
  for (const s of sentences) {
    const key = sentenceKey(s.lawId, s.pid, s.sent);
    for (const p of predBySent.get(key) ?? []) {
      if (!isCrossLawPred(s.lawId, p)) continue;
      if (articlePid(p.tgtPid) === null) continue;
      if (matchedPred.has(p)) continue;
      fp += 1;
    }
  }
  return prf(tp, fp, fn);
}

export function relativeIntraPrf(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
): Prf {
  const { pairs } = matchAll(sentences, goldByGid, preds);
  const predBySent = groupPreds(preds);
  let tp = 0;
  let fn = 0;
  const matchedPred = new Set<PredRef>();
  for (const s of sentences) {
    for (const g of goldByGid.get(s.gid) ?? []) {
      if (!isRelativeIntraGold(s.lawId, g)) continue;
      const hit = pairs.find((p) => p.gold === g && isRelativeIntraPred(s.lawId, p.pred));
      if (hit) {
        tp += 1;
        matchedPred.add(hit.pred);
      } else fn += 1;
    }
  }
  let fp = 0;
  for (const s of sentences) {
    const key = sentenceKey(s.lawId, s.pid, s.sent);
    for (const p of predBySent.get(key) ?? []) {
      if (!isRelativeIntraPred(s.lawId, p)) continue;
      if (matchedPred.has(p)) continue;
      fp += 1;
    }
  }
  return prf(tp, fp, fn);
}

function isRelativeIntraPred(srcLaw: string, ref: PredRef): boolean {
  const self = ref.tgtStatus === 'self' || ref.tgtLaw === srcLaw;
  return self && isRelativeMention(ref.mention);
}

export function isIntraLawGold(ref: GoldRef): boolean {
  return ref.tgtStatus === 'self' && ref.tgtPid !== null;
}

export function isIntraLawPred(srcLaw: string, ref: PredRef): boolean {
  return (ref.tgtStatus === 'self' || ref.tgtLaw === srcLaw) && ref.tgtPid !== null;
}

/** Gold coarser than pred is OK; pred coarser is an error. */
export function intraPidOk(gold: GoldRef, pred: PredRef): boolean {
  const gPid = gold.tgtPid;
  const pPid = pred.tgtPid;
  const gEnd = gold.tgtEnd ?? null;
  const pEnd = pred.tgtEnd ?? null;
  if (gPid === pPid && gEnd === pEnd) return true;
  if (gPid && pPid && pidStartsWith(pPid, gPid)) {
    if (gEnd === null) return true;
    if (pEnd && (pEnd === gEnd || pidStartsWith(pEnd, gEnd))) return true;
  }
  return false;
}

export interface BootstrapCi {
  lo: number;
  hi: number;
  mean: number;
  iters: number;
}

export interface PrfBootstrap {
  f1: BootstrapCi;
  precision: BootstrapCi;
  recall: BootstrapCi;
}

export interface IntraLawResult {
  overall: Prf;
  relative: Prf;
  relativePid: Prf;
  relativeArticleRounded: { n: number; correct: number; rate: number };
  relativeByWord: Record<string, { n: number; tp: number }>;
  relativeBootstrap: BootstrapCi;
  relativePrfBootstrap: PrfBootstrap;
}

function intraPrf(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
  goldOk: (src: string, g: GoldRef) => boolean,
  predOk: (src: string, p: PredRef) => boolean,
): Prf {
  const { pairs } = matchAll(sentences, goldByGid, preds);
  const predBySent = groupPreds(preds);
  let tp = 0;
  let fn = 0;
  const matchedPred = new Set<PredRef>();
  for (const s of sentences) {
    for (const g of goldByGid.get(s.gid) ?? []) {
      if (!goldOk(s.lawId, g)) continue;
      const hit = pairs.find((p) => p.gold === g && predOk(s.lawId, p.pred) && intraPidOk(g, p.pred));
      if (hit) {
        tp += 1;
        matchedPred.add(hit.pred);
      } else fn += 1;
    }
  }
  let fp = 0;
  for (const s of sentences) {
    const key = sentenceKey(s.lawId, s.pid, s.sent);
    for (const p of predBySent.get(key) ?? []) {
      if (!predOk(s.lawId, p)) continue;
      if (matchedPred.has(p)) continue;
      fp += 1;
    }
  }
  return prf(tp, fp, fn);
}

export function intraLawMetrics(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
  seed = EVAL_SEED,
  iters = BOOTSTRAP_ITERS,
): IntraLawResult {
  const overall = intraPrf(sentences, goldByGid, preds, (_src, g) => isIntraLawGold(g), isIntraLawPred);
  const relative = relativeIntraPrf(sentences, goldByGid, preds);
  const relativePid = intraPrf(
    sentences,
    goldByGid,
    preds,
    (src, g) => isRelativeIntraGold(src, g),
    isRelativeIntraPred,
  );
  const { pairs } = matchAll(sentences, goldByGid, preds);
  let artN = 0;
  let artOk = 0;
  const byWord: Record<string, { n: number; tp: number }> = {};
  for (const s of sentences) {
    for (const g of goldByGid.get(s.gid) ?? []) {
      if (!isRelativeIntraGold(s.lawId, g)) continue;
      const word = relativeHead(g.mention);
      byWord[word] ??= { n: 0, tp: 0 };
      byWord[word].n += 1;
      const hit = pairs.find((p) => p.gold === g && isRelativeIntraPred(s.lawId, p.pred));
      if (hit) byWord[word].tp += 1;
      if (articlePid(g.tgtPid) === null) continue;
      artN += 1;
      if (hit && articlePid(hit.pred.tgtPid) === articlePid(g.tgtPid)) artOk += 1;
    }
  }
  const relativePrfBootstrap = bootstrapPrf(sentences, goldByGid, preds, relativeIntraPrf, iters, seed);
  return {
    overall,
    relative,
    relativePid,
    relativeArticleRounded: { n: artN, correct: artOk, rate: artN === 0 ? 1 : artOk / artN },
    relativeByWord: byWord,
    relativeBootstrap: relativePrfBootstrap.f1,
    relativePrfBootstrap,
  };
}

function ciFromScores(scores: number[], iters: number): BootstrapCi {
  if (scores.length === 0) return { lo: 0, hi: 0, mean: 0, iters };
  const sorted = [...scores].sort((a, b) => a - b);
  const lo = sorted[Math.floor(0.025 * iters)]!;
  const hi = sorted[Math.min(iters - 1, Math.floor(0.975 * iters))]!;
  const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return { lo, hi, mean, iters };
}

export function bootstrapPrf(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
  metric: (
    sents: readonly GoldSentence[],
    gold: ReadonlyMap<string, GoldRef[]>,
    preds: readonly PredRef[],
  ) => Prf,
  iters = BOOTSTRAP_ITERS,
  seed = EVAL_SEED,
): PrfBootstrap {
  const rng = mulberry32(seed);
  const f1: number[] = [];
  const precision: number[] = [];
  const recall: number[] = [];
  const n = sentences.length;
  const empty: BootstrapCi = { lo: 0, hi: 0, mean: 0, iters };
  if (n === 0) return { f1: empty, precision: empty, recall: empty };
  for (let i = 0; i < iters; i++) {
    const sample: GoldSentence[] = [];
    for (let k = 0; k < n; k++) {
      sample.push(sentences[Math.floor(rng() * n)]!);
    }
    const got = metric(sample, goldByGid, preds);
    f1.push(got.f1);
    precision.push(got.precision);
    recall.push(got.recall);
  }
  return {
    f1: ciFromScores(f1, iters),
    precision: ciFromScores(precision, iters),
    recall: ciFromScores(recall, iters),
  };
}

export function bootstrapF1(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
  metric: (
    sents: readonly GoldSentence[],
    gold: ReadonlyMap<string, GoldRef[]>,
    preds: readonly PredRef[],
  ) => Prf,
  iters = BOOTSTRAP_ITERS,
  seed = EVAL_SEED,
): BootstrapCi {
  return bootstrapPrf(sentences, goldByGid, preds, metric, iters, seed).f1;
}

export function kindAccuracy(
  sentences: readonly GoldSentence[],
  goldByGid: ReadonlyMap<string, GoldRef[]>,
  preds: readonly PredRef[],
): { accuracy: number; n: number; confusion: Record<string, Record<string, number>> } {
  const { pairs } = matchAll(sentences, goldByGid, preds);
  const confusion: Record<string, Record<string, number>> = {};
  for (const k of REF_KINDS) {
    confusion[k] = Object.fromEntries(REF_KINDS.map((x) => [x, 0])) as Record<string, number>;
  }
  let n = 0;
  let ok = 0;
  for (const p of pairs) {
    if (p.gold.tgtLaw !== p.pred.tgtLaw) continue;
    n += 1;
    confusion[p.gold.kind]![p.pred.kind] = (confusion[p.gold.kind]![p.pred.kind] ?? 0) + 1;
    if (p.gold.kind === p.pred.kind) ok += 1;
  }
  return { accuracy: n === 0 ? 1 : ok / n, n, confusion };
}

export function emptyConfusion(): Record<string, Record<string, number>> {
  const confusion: Record<string, Record<string, number>> = {};
  for (const k of REF_KINDS) {
    confusion[k] = Object.fromEntries(REF_KINDS.map((x) => [x, 0])) as Record<string, number>;
  }
  return confusion;
}

export type { RefKind };
