import { REF_KINDS, type RefKind } from '../../lib/shared/contract.ts';
import type { Part } from '../../lib/ref-types.ts';

export const MAIN_PARTS = new Set<Part>(['main', 'enact', 'appdx']);
export const SUPPL_PARTS = new Set<Part>(['suppl', 'supplAmend']);

export function kindIndex(kind: RefKind): number {
  const i = REF_KINDS.indexOf(kind);
  return i < 0 ? REF_KINDS.indexOf('cite') : i;
}

export function emptyKindCounts(): number[] {
  return Array.from({ length: REF_KINDS.length }, () => 0);
}

export function kindMaskOf(counts: number[]): number {
  let mask = 0;
  for (let i = 0; i < counts.length; i++) {
    if ((counts[i] ?? 0) > 0) mask |= 1 << i;
  }
  return mask;
}

export function dominantKind(counts: number[]): number {
  let best = 0;
  let bestN = -1;
  for (let i = 0; i < REF_KINDS.length; i++) {
    const n = counts[i] ?? 0;
    if (n > bestN) {
      bestN = n;
      best = i;
    }
  }
  return best;
}

export function pickDomKind(mainRefs: number, kindMain: number[], kindSuppl: number[]): number {
  return dominantKind(mainRefs > 0 ? kindMain : kindSuppl);
}

export interface PairAgg {
  srcLaw: string;
  tgtLaw: string;
  mainRefs: number;
  supplRefs: number;
  kindAll: number[];
  kindMain: number[];
  kindSuppl: number[];
}

export function newPair(srcLaw: string, tgtLaw: string): PairAgg {
  return {
    srcLaw,
    tgtLaw,
    mainRefs: 0,
    supplRefs: 0,
    kindAll: emptyKindCounts(),
    kindMain: emptyKindCounts(),
    kindSuppl: emptyKindCounts(),
  };
}

export function addRefToPair(pair: PairAgg, part: Part, kind: RefKind): void {
  const k = kindIndex(kind);
  pair.kindAll[k] = (pair.kindAll[k] ?? 0) + 1;
  if (MAIN_PARTS.has(part)) {
    pair.mainRefs += 1;
    pair.kindMain[k] = (pair.kindMain[k] ?? 0) + 1;
  } else if (SUPPL_PARTS.has(part)) {
    pair.supplRefs += 1;
    pair.kindSuppl[k] = (pair.kindSuppl[k] ?? 0) + 1;
  }
}

export function hasBasisOrImplements(pair: PairAgg): boolean {
  const basis = REF_KINDS.indexOf('basis');
  const impl = REF_KINDS.indexOf('implements');
  return (pair.kindAll[basis] ?? 0) > 0 || (pair.kindAll[impl] ?? 0) > 0;
}

export function hasMainBasisOrImplements(pair: PairAgg): boolean {
  const basis = REF_KINDS.indexOf('basis');
  const impl = REF_KINDS.indexOf('implements');
  return (pair.kindMain[basis] ?? 0) > 0 || (pair.kindMain[impl] ?? 0) > 0;
}

export function parentScore(pair: PairAgg): number {
  const basis = REF_KINDS.indexOf('basis');
  const impl = REF_KINDS.indexOf('implements');
  return (pair.kindAll[basis] ?? 0) * 3 + (pair.kindAll[impl] ?? 0);
}

export function layoutEdgeWeight(pair: PairAgg): number {
  if (pair.mainRefs <= 0) return 0;
  let w = Math.log2(1 + pair.mainRefs);
  if (hasMainBasisOrImplements(pair)) w += 2;
  return w;
}

export function undirectedPairKey(a: string, b: string): string {
  return a < b ? `${a}\t${b}` : `${b}\t${a}`;
}
