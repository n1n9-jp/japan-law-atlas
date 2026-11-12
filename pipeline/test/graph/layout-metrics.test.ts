import { describe, expect, it } from 'vitest';
import { addRefToPair, newPair, type PairAgg } from '../../src/graph/edges.ts';
import { computeLayoutMetrics, mPass } from '../../src/graph/layout-metrics.ts';
import type { CircleLayout } from '../../src/graph/layout-circles.ts';
import type { GraphState, NodeRec } from '../../src/graph/types.ts';

function n(id: string, cat: number, x: number, y: number, extra: Partial<NodeRec> = {}): NodeRec {
  return {
    lawId: id,
    revisionId: 'R',
    title: id,
    kana: '',
    abbrevs: [],
    oldTitles: [],
    num: id,
    numNorm: id,
    lawType: 'Act',
    categoryName: '憲法',
    category: cat,
    promulgated: 20200101,
    status: 'current',
    articleCount: 4,
    ghost: false,
    label: id,
    aliases: [],
    delegations: 0,
    inLaws: 0, outLaws: 0, inRefs: 0, outRefs: 0,
    pagerank: 0.01, prRank: 1,
    parentLawId: extra.parentLawId ?? null,
    familyLawId: extra.familyLawId ?? id,
    community: 0, bridge: 1,
    x, y, r: 1,
    ...extra,
  };
}

function pair(a: string, b: string, main = 1): PairAgg {
  const p = newPair(a, b);
  for (let i = 0; i < main; i++) addRefToPair(p, 'main', 'cite');
  return p;
}

function emptyCircles(): CircleLayout {
  return {
    x: Array.from({ length: 50 }, () => 0),
    y: Array.from({ length: 50 }, () => 0),
    rho: Array.from({ length: 50 }, () => 10),
    seed: 1,
    adjFlowShare: 0.3,
    groupContig: 0.8,
  };
}

function stateOf(nodes: NodeRec[], pairs: PairAgg[], circles = emptyCircles()): GraphState {
  return {
    meta: {
      snapshotId: 't', egovAsof: '2026-10-09', corpusCreatedAt: '2026-10-08T00:00:00.000Z',
      pipelineVersion: '1.0.0',
      refsStatus: { complete: false, dir: '', warning: null, manifest: null, fingerprint: 't', shardCount: 0 },
      unknownCategories: [], amendingLawRefs: 0, unknownRefs: 0, selfRefs: 0, skippedTargetRefs: 0,
      ghostLaws: 0, lawEdges: pairs.length, refs: 0, crossLawRefs: 0,
    },
    nodes, pairs, groups: [], categories: [],
    continents: { categories: [], groups: [] },
    flows: { n: 0, src: [], tgt: [], refs: [] },
    bounds: [-1000, -1000, 1000, 1000],
  };
}

describe('layout metrics hand cases', () => {
  it('knnCatPurity matches a 3-point hand calculation', () => {
    const nodes = [n('A', 0, 0, 0), n('B', 0, 1, 0), n('C', 1, 10, 0)];
    const m = computeLayoutMetrics(stateOf(nodes, []), emptyCircles());
    // k = min(10, 2) = 2. A: B same, C other → 0.5; B: 0.5; C: 0. Mean 1/3.
    expect(m.knnCatPurity).toBeCloseTo(1 / 3, 10);
  });

  it('weighted median of cross-edge length / D', () => {
    const nodes = [n('A', 0, 0, 0), n('B', 1, 400, 0), n('C', 1, 800, 0)];
    const pairs = [pair('A', 'B', 1), pair('A', 'C', 3)];
    const m = computeLayoutMetrics(stateOf(nodes, pairs), emptyCircles());
    // w(A-B)=log2(2)=1, len/D=0.2; w(A-C)=log2(4)=2, len/D=0.4. total w=3, median at 1.5 → 0.4
    expect(m.edgeLenCross).toBeCloseTo(0.4, 10);
  });

  it('a ring of laws fails M3, M4, M5', () => {
    const nodes: NodeRec[] = [];
    const pairs: PairAgg[] = [];
    for (let i = 0; i < 40; i++) {
      const ang = (2 * Math.PI * i) / 40;
      nodes.push(n(`L${i}`, i % 2, 800 * Math.cos(ang), 800 * Math.sin(ang)));
      pairs.push(pair(`L${i}`, `L${(i + 1) % 40}`, 1));
    }
    const m = computeLayoutMetrics(stateOf(nodes, pairs), emptyCircles());
    const rows = mPass(m);
    expect(rows.find((r) => r.id === 'M3')?.ok).toBe(false);
    expect(rows.find((r) => r.id === 'M4')?.ok).toBe(false);
    expect(rows.find((r) => r.id === 'M5')?.ok).toBe(false);
    expect(m.lawsInCenter).toBe(0);
    expect(m.centerPassPerLocal).toBeNull();
  });

  it('mixed categories fail M1', () => {
    const nodes: NodeRec[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(n(`A${i}`, 0, i * 10, i % 2 === 0 ? 0 : 4));
      nodes.push(n(`B${i}`, 1, i * 10 + 2, i % 2 === 0 ? 4 : 0));
    }
    const m = computeLayoutMetrics(stateOf(nodes, []), emptyCircles());
    expect(m.knnCatPurity).toBeLessThan(0.90);
    expect(mPass(m).find((r) => r.id === 'M1')?.ok).toBe(false);
  });
});
