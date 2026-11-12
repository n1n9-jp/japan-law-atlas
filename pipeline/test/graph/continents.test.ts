import { describe, expect, it } from 'vitest';
import { buildContinents, coverageRatio } from '../../src/graph/continents.ts';
import { douglasPeucker, simplifyClosedRing } from '../../src/graph/geometry.ts';
import { mulberry32 } from '../../src/lib/random.ts';
import type { NodeRec } from '../../src/graph/types.ts';

function closedCircle(n: number, r: number, cx = 0, cy = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

function nodeAt(i: number, category: number, x: number, y: number): NodeRec {
  return {
    lawId: `L${String(i).padStart(3, '0')}`,
    revisionId: `R${i}`,
    title: `法令${i}`,
    kana: '',
    abbrevs: [],
    oldTitles: [],
    num: `法律第${i}号`,
    numNorm: `法律第${i}号`,
    lawType: 'Act',
    categoryName: ['憲法', '国会'][category] ?? '憲法',
    category,
    promulgated: 20200101,
    status: 'current',
    articleCount: 5,
    ghost: false,
    label: `法令${i}`,
    aliases: [],
    delegations: 0,
    inLaws: 0, outLaws: 0, inRefs: 0, outRefs: 0,
    pagerank: 0.01, prRank: i + 1,
    parentLawId: null, familyLawId: `L${String(i).padStart(3, '0')}`,
    community: 0, bridge: 1,
    x, y, r: 1.5,
  };
}

function ringLen(poly: number[][][]): number {
  return poly[0]?.[0]?.length ?? 0;
}

describe('closed-ring simplify', () => {
  it('does not collapse a closed 24-gon the way douglasPeucker does', () => {
    const closed = closedCircle(24, 80);
    closed[closed.length - 1] = [closed[0]![0], closed[0]![1]];
    const dp = douglasPeucker(closed, 2);
    expect(dp).toHaveLength(2);

    const simp = simplifyClosedRing(closed, 2);
    expect(simp.length).toBeGreaterThanOrEqual(8);
    const a = simp[0]!;
    const b = simp[simp.length - 1]!;
    expect(a[0]).toBe(b[0]);
    expect(a[1]).toBe(b[1]);
  });

  it('keeps an open polyline that is then reclosed', () => {
    const open = closedCircle(32, 60).slice(0, -1);
    const simp = simplifyClosedRing(open, 2);
    expect(simp.length).toBeGreaterThanOrEqual(8);
    const a = simp[0]!;
    const b = simp[simp.length - 1]!;
    expect(a[0]).toBe(b[0]);
    expect(a[1]).toBe(b[1]);
  });
});

describe('continent isolines', () => {
  it('builds real isolines at bandwidth 18 (category) and 30 (group)', () => {
    const rng = mulberry32(20261008);
    const nodes: NodeRec[] = [];
    for (let i = 0; i < 80; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = 18 * Math.sqrt(rng());
      nodes.push(nodeAt(i, 0, 120 + rad * Math.cos(ang), 80 + rad * Math.sin(ang)));
    }
    const continents = buildContinents(nodes);
    const cat = continents.categories[0]!;
    const group = continents.groups[0]!;
    expect(cat.polygons.length).toBeGreaterThan(0);
    expect(group.polygons.length).toBeGreaterThan(0);
    expect(ringLen(cat.polygons)).toBeGreaterThanOrEqual(8);
    expect(ringLen(group.polygons)).toBeGreaterThanOrEqual(8);
    // circleFallback was a regular 24-gon (25 coords including close = 50 numbers)
    expect(ringLen(cat.polygons)).not.toBe(50);
    expect(ringLen(group.polygons)).not.toBe(50);
    const pts = nodes.map((n) => ({ x: n.x, y: n.y }));
    expect(coverageRatio(pts, cat.polygons)).toBeGreaterThanOrEqual(0.9);
    expect(coverageRatio(pts, group.polygons)).toBeGreaterThanOrEqual(0.9);
  });
});
