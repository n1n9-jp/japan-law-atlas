import { mulberry32 } from '../lib/random.ts';
import { Graph, louvain, pagerank } from './libs.ts';
import type { PairAgg } from './edges.ts';
import type { NodeRec } from './types.ts';
import { sigFigs } from './util.ts';

export function computeDegreeMetrics(nodes: NodeRec[], pairs: PairAgg[]): void {
  const byId = new Map(nodes.map((n) => [n.lawId, n]));
  const inLaws = new Map<string, Set<string>>();
  const outLaws = new Map<string, Set<string>>();
  for (const n of nodes) {
    n.inLaws = 0;
    n.outLaws = 0;
    n.inRefs = 0;
    n.outRefs = 0;
    inLaws.set(n.lawId, new Set());
    outLaws.set(n.lawId, new Set());
  }
  for (const p of pairs) {
    if (p.mainRefs <= 0) continue;
    const src = byId.get(p.srcLaw);
    const tgt = byId.get(p.tgtLaw);
    if (!src || !tgt) continue;
    src.outRefs += p.mainRefs;
    tgt.inRefs += p.mainRefs;
    outLaws.get(p.srcLaw)!.add(p.tgtLaw);
    inLaws.get(p.tgtLaw)!.add(p.srcLaw);
  }
  for (const n of nodes) {
    n.outLaws = outLaws.get(n.lawId)!.size;
    n.inLaws = inLaws.get(n.lawId)!.size;
  }
}

export function computeBridge(nodes: NodeRec[], pairs: PairAgg[]): void {
  const byId = new Map(nodes.map((n) => [n.lawId, n]));
  const cats = new Map<string, Set<number>>();
  for (const n of nodes) cats.set(n.lawId, new Set());
  for (const p of pairs) {
    if (p.mainRefs <= 0) continue;
    const src = byId.get(p.srcLaw);
    const tgt = byId.get(p.tgtLaw);
    if (!src || !tgt) continue;
    cats.get(p.tgtLaw)!.add(src.category);
  }
  for (const n of nodes) {
    n.bridge = cats.get(n.lawId)!.size;
  }
}

export function computePagerank(nodes: NodeRec[], pairs: PairAgg[]): void {
  const g = new Graph({ type: 'directed', allowSelfLoops: false });
  for (const n of nodes) g.addNode(n.lawId);
  for (const p of pairs) {
    if (p.mainRefs <= 0) continue;
    if (!g.hasNode(p.srcLaw) || !g.hasNode(p.tgtLaw)) continue;
    if (g.hasEdge(p.srcLaw, p.tgtLaw)) {
      const e = g.getEdgeAttributes(p.srcLaw, p.tgtLaw) as { weight: number };
      g.setEdgeAttribute(p.srcLaw, p.tgtLaw, 'weight', e.weight + p.mainRefs);
    } else {
      g.addEdge(p.srcLaw, p.tgtLaw, { weight: p.mainRefs });
    }
  }
  const scores = pagerank(g, {
    alpha: 0.85,
    tolerance: 1e-9,
    maxIterations: 200,
    getEdgeWeight: 'weight',
  });
  for (const n of nodes) {
    n.pagerank = sigFigs(scores[n.lawId] ?? 0, 4);
  }
  const ranked = [...nodes].sort((a, b) => b.pagerank - a.pagerank || a.lawId.localeCompare(b.lawId));
  ranked.forEach((n, i) => {
    n.prRank = i + 1;
  });
}

export function computeCommunities(nodes: NodeRec[], pairs: PairAgg[]): void {
  const g = new Graph({ type: 'undirected', allowSelfLoops: false });
  for (const n of nodes) g.addNode(n.lawId);
  for (const p of pairs) {
    if (p.mainRefs <= 0) continue;
    if (!g.hasNode(p.srcLaw) || !g.hasNode(p.tgtLaw)) continue;
    if (p.srcLaw === p.tgtLaw) continue;
    const a = p.srcLaw < p.tgtLaw ? p.srcLaw : p.tgtLaw;
    const b = p.srcLaw < p.tgtLaw ? p.tgtLaw : p.srcLaw;
    if (g.hasEdge(a, b)) {
      const e = g.getEdgeAttributes(a, b) as { weight: number };
      g.setEdgeAttribute(a, b, 'weight', e.weight + p.mainRefs);
    } else {
      g.addEdge(a, b, { weight: p.mainRefs });
    }
  }
  const mapping = louvain(g, {
    resolution: 1,
    rng: mulberry32(20261008),
    getEdgeWeight: 'weight',
  });
  const members = new Map<number, string[]>();
  for (const n of nodes) {
    const c = mapping[n.lawId] ?? 0;
    const arr = members.get(c) ?? [];
    arr.push(n.lawId);
    members.set(c, arr);
  }
  const relabel = new Map<number, number>();
  const ordered = [...members.entries()].sort((a, b) => {
    const ma = a[1]!.slice().sort()[0]!;
    const mb = b[1]!.slice().sort()[0]!;
    return ma.localeCompare(mb);
  });
  ordered.forEach(([old], i) => relabel.set(old, i));
  for (const n of nodes) {
    n.community = relabel.get(mapping[n.lawId] ?? 0) ?? 0;
  }
}
