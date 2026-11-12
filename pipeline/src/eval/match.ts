import type { MatchPair, Span } from './types.ts';

export function overlapLen(a: Span, b: Span): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return Math.max(0, end - start);
}

export function spansHalfOverlap(a: Span, b: Span): boolean {
  const ov = overlapLen(a, b);
  const la = a.end - a.start;
  const lb = b.end - b.start;
  if (la <= 0 || lb <= 0) return false;
  return ov * 2 >= la && ov * 2 >= lb;
}

export function greedyMatch<G extends Span, P extends Span>(
  gold: readonly G[],
  pred: readonly P[],
): MatchPair<G, P>[] {
  type Cand = { gi: number; pi: number; ov: number };
  const cands: Cand[] = [];
  for (let gi = 0; gi < gold.length; gi++) {
    const g = gold[gi]!;
    for (let pi = 0; pi < pred.length; pi++) {
      const p = pred[pi]!;
      if (!spansHalfOverlap(g, p)) continue;
      cands.push({ gi, pi, ov: overlapLen(g, p) });
    }
  }
  cands.sort((a, b) => b.ov - a.ov || a.gi - b.gi || a.pi - b.pi);
  const usedG = new Set<number>();
  const usedP = new Set<number>();
  const pairs: MatchPair<G, P>[] = [];
  for (const c of cands) {
    if (usedG.has(c.gi) || usedP.has(c.pi)) continue;
    usedG.add(c.gi);
    usedP.add(c.pi);
    pairs.push({
      goldIndex: c.gi,
      predIndex: c.pi,
      overlap: c.ov,
      gold: gold[c.gi]!,
      pred: pred[c.pi]!,
    });
  }
  return pairs;
}
