import type { LawEdgesFile } from './shared/contract';

export interface NeighborEdge {
  edgeIndex: number;
  other: number;
  mainRefs: number;
  supplRefs: number;
  kindMask: number;
  domKind: number;
}

export interface Adjacency {
  out: NeighborEdge[][];
  in: NeighborEdge[][];
}

export function buildAdjacency(nLaws: number, edges: LawEdgesFile): Adjacency {
  const out: NeighborEdge[][] = Array.from({ length: nLaws }, () => []);
  const inn: NeighborEdge[][] = Array.from({ length: nLaws }, () => []);
  for (let i = 0; i < edges.n; i++) {
    const s = edges.src[i]!;
    const t = edges.tgt[i]!;
    const rec: Omit<NeighborEdge, 'other'> = {
      edgeIndex: i,
      mainRefs: edges.mainRefs[i]!,
      supplRefs: edges.supplRefs[i]!,
      kindMask: edges.kindMask[i]!,
      domKind: edges.domKind[i]!,
    };
    out[s]!.push({ ...rec, other: t });
    inn[t]!.push({ ...rec, other: s });
  }
  const byRefs = (a: NeighborEdge, b: NeighborEdge) => (b.mainRefs + b.supplRefs) - (a.mainRefs + a.supplRefs);
  for (let i = 0; i < nLaws; i++) {
    out[i]!.sort(byRefs);
    inn[i]!.sort(byRefs);
  }
  return { out, in: inn };
}

export function neighborSet(adj: Adjacency, index: number): Set<number> {
  const s = new Set<number>([index]);
  for (const e of adj.out[index] ?? []) s.add(e.other);
  for (const e of adj.in[index] ?? []) s.add(e.other);
  return s;
}

/** 入出力を合算した言及数の上位。選択時の法令名に使う。 */
export function topNeighborIds(adj: Adjacency, index: number, limit = 15): number[] {
  const mentions = new Map<number, number>();
  const add = (list: NeighborEdge[]) => {
    for (const e of list) {
      mentions.set(e.other, (mentions.get(e.other) ?? 0) + e.mainRefs + e.supplRefs);
    }
  };
  add(adj.out[index] ?? []);
  add(adj.in[index] ?? []);
  return [...mentions.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([id]) => id);
}
