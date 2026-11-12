import type { CategoryFlowsFile, ContinentsFile } from '../../lib/shared/contract.ts';
import { contourDensity, polylabel } from './libs.ts';
import { CATEGORY_NAMES, GROUP_DEFS } from './categories.ts';
import { pointInPolygons, ringArea, simplifyClosedRing } from './geometry.ts';
import type { PairAgg } from './edges.ts';
import type { NodeRec } from './types.ts';
import { round1 } from './util.ts';

interface Point {
  x: number;
  y: number;
}

export function buildContinents(nodes: NodeRec[]): ContinentsFile {
  const byCat: Point[][] = Array.from({ length: CATEGORY_NAMES.length }, () => []);
  const byGroup: Point[][] = Array.from({ length: GROUP_DEFS.length }, () => []);
  for (const n of nodes) {
    const p = { x: n.x, y: n.y };
    byCat[n.category]?.push(p);
    const g = GROUP_DEFS.find((d) => d.categories.includes(CATEGORY_NAMES[n.category]!));
    if (g) byGroup[g.id]?.push(p);
  }

  const categories = byCat.map((pts, id) => {
    process.stderr.write(`[continents] category ${id} n=${pts.length} bandwidth=18\n`);
    const built = densityContinent(pts, 18, `category ${id}`);
    return { id, polygons: built.polygons, area: built.area, labelPos: built.labelPos };
  });
  const groups = byGroup.map((pts, id) => {
    process.stderr.write(`[continents] group ${id} n=${pts.length} bandwidth=30\n`);
    const built = densityContinent(pts, 30, `group ${id}`);
    return { id, polygons: built.polygons, labelPos: built.labelPos };
  });
  return { categories, groups };
}

export function buildCategoryFlows(nodes: NodeRec[], pairs: PairAgg[]): CategoryFlowsFile {
  const byId = new Map(nodes.map((n) => [n.lawId, n]));
  const acc = new Map<string, number>();
  for (const p of pairs) {
    if (p.mainRefs <= 0) continue;
    const src = byId.get(p.srcLaw);
    const tgt = byId.get(p.tgtLaw);
    if (!src || !tgt || src.category === tgt.category) continue;
    const k = `${src.category}\t${tgt.category}`;
    acc.set(k, (acc.get(k) ?? 0) + p.mainRefs);
  }
  const rows = [...acc.entries()]
    .map(([k, refs]) => {
      const [s, t] = k.split('\t');
      return { src: Number(s), tgt: Number(t), refs };
    })
    .sort((a, b) => b.refs - a.refs || a.src - b.src || a.tgt - b.tgt)
    .slice(0, 300);
  return {
    n: rows.length,
    src: rows.map((r) => r.src),
    tgt: rows.map((r) => r.tgt),
    refs: rows.map((r) => r.refs),
  };
}

export function coverageRatio(points: Point[], polygons: number[][][]): number {
  if (points.length === 0) return 1;
  let n = 0;
  for (const p of points) if (pointInPolygons(p.x, p.y, polygons)) n++;
  return n / points.length;
}

export function continentStats(nodes: NodeRec[], continents: ContinentsFile): {
  continentFallbacks: number;
  inContinentRatio: number;
  inContinentRatioMin: number;
  inContinentRatioByCategory: number[];
  inOtherContinentRatio: number;
  continentOverlapAreaRatio: number;
} {
  const byCat: NodeRec[][] = Array.from({ length: CATEGORY_NAMES.length }, () => []);
  for (const n of nodes) byCat[n.category]!.push(n);
  const byCatRatio = byCat.map((arr, id) => {
    if (arr.length === 0) return 1;
    const polys = continents.categories[id]?.polygons ?? [];
    let n = 0;
    for (const p of arr) if (pointInPolygons(p.x, p.y, polys)) n++;
    return n / arr.length;
  });
  let inOwn = 0;
  let inOther = 0;
  for (const n of nodes) {
    const own = continents.categories[n.category]?.polygons ?? [];
    if (pointInPolygons(n.x, n.y, own)) inOwn++;
    for (let c = 0; c < CATEGORY_NAMES.length; c++) {
      if (c === n.category) continue;
      const polys = continents.categories[c]?.polygons ?? [];
      if (pointInPolygons(n.x, n.y, polys)) {
        inOther++;
        break;
      }
    }
  }
  const populated = byCatRatio.filter((_, i) => (byCat[i]?.length ?? 0) > 0);
  return {
    continentFallbacks: 0,
    inContinentRatio: nodes.length ? inOwn / nodes.length : 0,
    inContinentRatioMin: populated.length ? Math.min(...populated) : 1,
    inContinentRatioByCategory: byCatRatio,
    inOtherContinentRatio: nodes.length ? inOther / nodes.length : 0,
    continentOverlapAreaRatio: continentOverlapRatio(continents),
  };
}

function continentOverlapRatio(continents: ContinentsFile): number {
  const cats = continents.categories;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cats) {
    for (const poly of c.polygons) {
      const ring = poly[0] ?? [];
      for (let i = 0; i < ring.length; i += 2) {
        minX = Math.min(minX, ring[i]!);
        maxX = Math.max(maxX, ring[i]!);
        minY = Math.min(minY, ring[i + 1]!);
        maxY = Math.max(maxY, ring[i + 1]!);
      }
    }
  }
  if (!Number.isFinite(minX)) return 0;
  const cell = 4;
  let covered = 0;
  let overlap = 0;
  for (let x = minX; x <= maxX; x += cell) {
    for (let y = minY; y <= maxY; y += cell) {
      let hits = 0;
      for (const c of cats) {
        if (c.polygons.length && pointInPolygons(x, y, c.polygons)) {
          hits++;
          if (hits >= 2) break;
        }
      }
      if (hits >= 1) covered++;
      if (hits >= 2) overlap++;
    }
  }
  return covered > 0 ? overlap / covered : 0;
}

function densityContinent(points: Point[], bandwidth: number, label: string): {
  polygons: number[][][];
  area: number;
  labelPos: [number, number];
} {
  if (points.length === 0) {
    return { polygons: [], area: 0, labelPos: [0, 0] };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = Math.max(80, bandwidth * 4);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  const width = Math.max(maxX - minX, 80);
  const height = Math.max(maxY - minY, 80);
  const density = contourDensity<Point>()
    .x((d) => d.x - minX)
    .y((d) => d.y - minY)
    .weight(() => 1)
    .size([width, height])
    .bandwidth(bandwidth)
    .cellSize(4);
  const cfn = density.contours(points);
  const maxV = cfn.max;
  if (!(maxV > 0)) {
    throw new Error(`continent failed ${label} bandwidth=${bandwidth}: density max is ${maxV}`);
  }

  const polysAt = (v: number): number[][][] => {
    const geo = cfn(v);
    if (!geo?.coordinates?.length) return [];
    return dropTinyIslands(geojsonToPolys(geo, minX, minY), points);
  };

  let lo = 0;
  let hi = maxV;
  let best: number[][][] | null = null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const polys = polysAt(mid);
    const cov = coverageRatio(points, polys);
    if (cov >= 0.9) {
      best = polys;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  if (best) {
    const atLo = polysAt(lo);
    if (coverageRatio(points, atLo) >= 0.9) best = atLo;
  }
  if (!best) {
    const low = polysAt(Math.max(maxV * 1e-6, Number.EPSILON));
    const cov = coverageRatio(points, low);
    throw new Error(
      `continent failed ${label} bandwidth=${bandwidth}: no isoline covers 90% (low-threshold coverage=${cov.toFixed(4)})`,
    );
  }
  const cov = coverageRatio(points, best);
  if (cov < 0.9) {
    throw new Error(`continent failed ${label} bandwidth=${bandwidth}: chosen isoline coverage ${cov.toFixed(4)} < 0.90`);
  }
  const areas = best.map((poly) => ringArea(poly[0] ?? []));
  const total = areas.reduce((a, b) => a + b, 0);
  if (best.length === 0 || total <= 0) {
    throw new Error(`continent failed ${label} bandwidth=${bandwidth}: empty polygon after simplify`);
  }
  let bestI = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i]! > areas[bestI]!) bestI = i;
  const labelPos = labelOf(best[bestI]!);
  return { polygons: best, area: round1(total), labelPos };
}

function geojsonToPolys(geo: { coordinates: number[][][][] }, minX: number, minY: number): number[][][] {
  const polygons: number[][][] = [];
  for (const poly of geo.coordinates ?? []) {
    const rings: number[][] = [];
    for (const ring of poly) {
      const pts: [number, number][] = ring.map((p) => [p[0]! + minX, p[1]! + minY]);
      const simp = simplifyClosedRing(pts, 2);
      const flat: number[] = [];
      for (const [x, y] of simp) flat.push(round1(x), round1(y));
      if (flat.length >= 8) rings.push(flat);
    }
    if (rings[0] && rings[0].length >= 8) polygons.push(rings);
  }
  return polygons;
}

function dropTinyIslands(polygons: number[][][], points: Point[]): number[][][] {
  if (polygons.length <= 1) return polygons;
  const areas = polygons.map((p) => ringArea(p[0] ?? []));
  const total = areas.reduce((a, b) => a + b, 0);
  if (total <= 0) return polygons;
  return polygons.filter((poly, i) => {
    if (areas[i]! >= total * 0.005) return true;
    return points.some((p) => pointInPolygons(p.x, p.y, [poly]));
  });
}

function labelOf(polygon: number[][]): [number, number] {
  const rings: number[][][] = polygon.map((ring) => {
    const pts: number[][] = [];
    for (let i = 0; i < ring.length; i += 2) pts.push([ring[i]!, ring[i + 1]!]);
    if (pts.length >= 2) {
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      if (a[0] !== b[0] || a[1] !== b[1]) pts.push([a[0], a[1]]);
    }
    return pts;
  });
  const pos = polylabel(rings, 1);
  return [round1(pos[0]), round1(pos[1])];
}
