import { greedyMatch } from './match.ts';
import type { GoldAnnotation, GoldRef, GoldSentence } from './types.ts';

export function cohenKappa(labelsA: readonly string[], labelsB: readonly string[]): number {
  if (labelsA.length !== labelsB.length) {
    throw new Error('kappa label arrays must have the same length');
  }
  const n = labelsA.length;
  if (n === 0) return 1;
  const cats = [...new Set([...labelsA, ...labelsB])];
  let agree = 0;
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const a = labelsA[i]!;
    const b = labelsB[i]!;
    if (a === b) agree += 1;
    countA.set(a, (countA.get(a) ?? 0) + 1);
    countB.set(b, (countB.get(b) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const c of cats) {
    pe += ((countA.get(c) ?? 0) / n) * ((countB.get(c) ?? 0) / n);
  }
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

export function spanAgreement(
  sentences: readonly GoldSentence[],
  aByGid: ReadonlyMap<string, GoldRef[]>,
  bByGid: ReadonlyMap<string, GoldRef[]>,
): number {
  let matched = 0;
  let nA = 0;
  let nB = 0;
  for (const s of sentences) {
    const a = aByGid.get(s.gid) ?? [];
    const b = bByGid.get(s.gid) ?? [];
    nA += a.length;
    nB += b.length;
    matched += greedyMatch(a, b).length;
  }
  if (nA + nB === 0) return 1;
  return (2 * matched) / (nA + nB);
}

export function kindKappa(
  sentences: readonly GoldSentence[],
  aByGid: ReadonlyMap<string, GoldRef[]>,
  bByGid: ReadonlyMap<string, GoldRef[]>,
): number | null {
  const labelsA: string[] = [];
  const labelsB: string[] = [];
  for (const s of sentences) {
    const a = aByGid.get(s.gid) ?? [];
    const b = bByGid.get(s.gid) ?? [];
    for (const m of greedyMatch(a, b)) {
      labelsA.push(m.gold.kind);
      labelsB.push(m.pred.kind);
    }
  }
  if (labelsA.length === 0) return null;
  return cohenKappa(labelsA, labelsB);
}

export function indexAnnotations(rows: readonly GoldAnnotation[]): Map<string, GoldRef[]> {
  const map = new Map<string, GoldRef[]>();
  for (const row of rows) {
    map.set(row.gid, row.refs);
  }
  return map;
}
