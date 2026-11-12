import { CATEGORY_NAMES } from './categories.ts';
import { Graph, forceAtlas2, noverlap } from './libs.ts';
import { layoutEdgeWeight, undirectedPairKey, type PairAgg } from './edges.ts';
import { percentile } from './geometry.ts';
import { placeCategoryCircles, type CircleLayout } from './layout-circles.ts';
import type { NodeRec } from './types.ts';
import { mulberry32 } from '../lib/random.ts';
import { round1, withSeededRandom } from './util.ts';
import { sortNodes } from './write-web.ts';

export interface LayoutOptions {
  categoryIterations?: number;
  lawIterations?: number;
  noverlapIterations?: number;
  circleSeeds?: number[];
}

export interface LayoutResult {
  bounds: [number, number, number, number];
  circles: CircleLayout;
}

export function nodeRadius(n: NodeRec): number {
  return n.ghost ? 0.75 : 0.75 + 0.4 * Math.sqrt(n.articleCount);
}

interface UEdge {
  a: string;
  b: string;
  w: number;
}

function undirectedEdges(pairs: PairAgg[]): UEdge[] {
  const m = new Map<string, UEdge>();
  for (const p of pairs) {
    const w = layoutEdgeWeight(p);
    if (w <= 0) continue;
    const key = undirectedPairKey(p.srcLaw, p.tgtLaw);
    const cur = m.get(key);
    if (cur) cur.w += w;
    else m.set(key, { a: p.srcLaw < p.tgtLaw ? p.srcLaw : p.tgtLaw, b: p.srcLaw < p.tgtLaw ? p.tgtLaw : p.srcLaw, w });
  }
  return [...m.values()];
}

export function orientAndNudge(
  pts: { x: number; y: number }[],
  pulls: { x: number; y: number }[],
  rho: number,
  s: number[],
): void {
  const apply = (m: 1 | -1): { score: number; theta: number } => {
    let dot = 0;
    let cross = 0;
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i]!.x;
      const py = m * pts[i]!.y;
      const ex = pulls[i]!.x;
      const ey = pulls[i]!.y;
      dot += px * ex + py * ey;
      cross += px * ey - py * ex;
    }
    const theta = Math.atan2(cross, dot);
    const score = Math.hypot(dot, cross);
    return { score, theta };
  };
  const s1 = apply(1);
  const sm = apply(-1);
  const m: 1 | -1 = sm.score > s1.score + 1e-15 ? -1 : 1;
  const theta = m === 1 ? s1.theta : sm.theta;
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  for (let i = 0; i < pts.length; i++) {
    const px = pts[i]!.x;
    const py = m * pts[i]!.y;
    pts[i]!.x = px * c - py * sn;
    pts[i]!.y = px * sn + py * c;
  }
  for (let i = 0; i < pts.length; i++) {
    const e = pulls[i]!;
    const el = Math.hypot(e.x, e.y);
    if (el < 1e-12 || s[i] === 0) continue;
    pts[i]!.x += 0.5 * s[i]! * rho * (e.x / el);
    pts[i]!.y += 0.5 * s[i]! * rho * (e.y / el);
  }
}

export function softEnclose(pts: { x: number; y: number }[], rho: number): void {
  const inner = 0.92 * rho;
  const band = 0.08 * rho;
  if (band <= 0) return;
  for (const p of pts) {
    const r = Math.hypot(p.x, p.y);
    if (r <= inner) continue;
    const rp = inner + band * Math.tanh((r - inner) / band);
    const s = rp / r;
    p.x *= s;
    p.y *= s;
  }
}

function layoutOneCategory(
  members: NodeRec[],
  cat: number,
  circles: CircleLayout,
  uEdges: UEdge[],
  catOf: Map<string, number>,
  index: Map<string, number>,
  lawIters: number,
): void {
  if (members.length === 0) return;
  const rho = circles.rho[cat]!;
  const cx = circles.x[cat]!;
  const cy = circles.y[cat]!;
  const rng = mulberry32(20261008 + cat);
  const memberSet = new Set(members.map((n) => n.lawId));

  const g = new Graph({ type: 'undirected', allowSelfLoops: false });
  const ordered = [...members].sort((a, b) => (index.get(a.lawId)! - index.get(b.lawId)!));
  for (const n of ordered) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * 100;
    g.addNode(n.lawId, { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, size: 1 });
  }
  const intra = uEdges
    .filter((e) => memberSet.has(e.a) && memberSet.has(e.b))
    .map((e) => {
      const ia = index.get(e.a)!;
      const ib = index.get(e.b)!;
      return ia < ib ? { src: e.a, tgt: e.b, w: e.w, ia, ib } : { src: e.b, tgt: e.a, w: e.w, ia: ib, ib: ia };
    })
    .sort((p, q) => p.ia - q.ia || p.ib - q.ib);
  for (const e of intra) {
    if (!g.hasEdge(e.src, e.tgt)) g.addEdge(e.src, e.tgt, { weight: 0.05 * e.w });
  }
  if (ordered.length >= 2 && lawIters > 0) {
    forceAtlas2.assign(g, {
      iterations: lawIters,
      getEdgeWeight: 'weight',
      settings: {
        linLogMode: true,
        outboundAttractionDistribution: false,
        scalingRatio: 0.05,
        gravity: 1,
        strongGravityMode: false,
        slowDown: 2,
        barnesHutOptimize: ordered.length > 500,
        barnesHutTheta: 0.6,
      },
    });
  }

  const pts = ordered.map((n) => {
    const attr = g.getNodeAttributes(n.lawId) as { x: number; y: number };
    return { x: attr.x, y: attr.y };
  });
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  for (const p of pts) {
    p.x -= mx;
    p.y -= my;
  }
  const p95 = percentile(pts.map((p) => Math.hypot(p.x, p.y)), 0.95);
  const target = 0.92 * rho;
  if (p95 > 1e-9 && target > 0) {
    const sc = target / p95;
    for (const p of pts) {
      p.x *= sc;
      p.y *= sc;
    }
  }

  const u = new Map<number, { x: number; y: number }>();
  for (let k = 0; k < CATEGORY_NAMES.length; k++) {
    if (k === cat) continue;
    const dx = circles.x[k]! - cx;
    const dy = circles.y[k]! - cy;
    const d = Math.hypot(dx, dy);
    u.set(k, d > 1e-12 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 });
  }
  const pulls = ordered.map(() => ({ x: 0, y: 0 }));
  const wExt = new Array<number>(ordered.length).fill(0);
  const wInt = new Array<number>(ordered.length).fill(0);
  const loc = new Map(ordered.map((n, i) => [n.lawId, i]));
  for (const e of uEdges) {
    const ia = loc.get(e.a);
    const ib = loc.get(e.b);
    if (ia === undefined && ib === undefined) continue;
    if (ia !== undefined && ib !== undefined) {
      wInt[ia]! += e.w;
      wInt[ib]! += e.w;
      continue;
    }
    const i = ia !== undefined ? ia : ib!;
    const other = ia !== undefined ? e.b : e.a;
    const ck = catOf.get(other);
    if (ck === undefined) continue;
    const uk = u.get(ck);
    if (!uk) continue;
    pulls[i]!.x += e.w * uk.x;
    pulls[i]!.y += e.w * uk.y;
    wExt[i]! += e.w;
  }
  const s = ordered.map((_, i) => {
    const den = wExt[i]! + wInt[i]!;
    return den > 0 ? wExt[i]! / den : 0;
  });
  orientAndNudge(pts, pulls, rho, s);
  softEnclose(pts, rho);
  for (let i = 0; i < ordered.length; i++) {
    ordered[i]!.x = pts[i]!.x + cx;
    ordered[i]!.y = pts[i]!.y + cy;
  }
}

function separateOverlaps(nodes: NodeRec[], index: Map<string, number>): void {
  const ordered = [...nodes].sort((a, b) => index.get(a.lawId)! - index.get(b.lawId)!);
  const n = ordered.length;
  const maxR = ordered.reduce((m, node) => Math.max(m, node.r), 0.75);
  const cell = Math.max(1e-6, 2 * maxR);
  for (let round = 0; round < 300; round++) {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(ordered[i]!.x / cell);
      const iy = Math.floor(ordered[i]!.y / cell);
      const k = `${ix},${iy}`;
      const b = grid.get(k);
      if (b) b.push(i);
      else grid.set(k, [i]);
    }
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const a = ordered[i]!;
      const ix = Math.floor(a.x / cell);
      const iy = Math.floor(a.y / cell);
      for (let adx = -1; adx <= 1; adx++) {
        for (let ady = -1; ady <= 1; ady++) {
          const bkt = grid.get(`${ix + adx},${iy + ady}`);
          if (!bkt) continue;
          for (const j of bkt) {
            if (j <= i) continue;
            const b = ordered[j]!;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d = Math.hypot(dx, dy);
            const lim = a.r + b.r + 0.1;
            if (d >= lim) continue;
            hits++;
            if (d < 1e-12) {
              const ang = (2 * Math.PI * i) / n;
              dx = Math.cos(ang);
              dy = Math.sin(ang);
              d = 1;
            }
            const push = (lim - d) / 2;
            const ux = dx / d;
            const uy = dy / d;
            a.x += ux * push;
            a.y += uy * push;
            b.x -= ux * push;
            b.y -= uy * push;
          }
        }
      }
    }
    if (hits === 0) break;
  }
}

export function runLayout(
  nodes: NodeRec[],
  pairs: PairAgg[],
  rng: () => number,
  opts: LayoutOptions = {},
): LayoutResult {
  const catIters = opts.categoryIterations ?? 1500;
  const lawIters = opts.lawIterations ?? 600;
  const novIters = opts.noverlapIterations ?? 500;

  const ordered = sortNodes(nodes);
  const index = new Map(ordered.map((n, i) => [n.lawId, i]));
  const catOf = new Map(nodes.map((n) => [n.lawId, n.category]));
  const uEdges = undirectedEdges(pairs);

  const circles = placeCategoryCircles(nodes, pairs, {
    iterations: catIters,
    seeds: opts.circleSeeds,
  });

  const byCat: NodeRec[][] = Array.from({ length: CATEGORY_NAMES.length }, () => []);
  for (const n of nodes) byCat[n.category]!.push(n);
  for (let c = 0; c < CATEGORY_NAMES.length; c++) {
    layoutOneCategory(byCat[c]!, c, circles, uEdges, catOf, index, lawIters);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = 2000 / span;
  for (const n of nodes) {
    n.x = (n.x - ox) * scale;
    n.y = (n.y - oy) * scale;
    n.r = nodeRadius(n);
  }

  const novG = new Graph({ type: 'undirected' });
  for (const n of ordered) {
    novG.addNode(n.lawId, { x: n.x, y: n.y, size: n.r });
  }
  if (novIters > 0) {
    withSeededRandom(rng, () => {
      noverlap.assign(novG, {
        maxIterations: novIters,
        settings: { margin: 0.5, ratio: 1.1 },
      });
    });
    for (const n of nodes) {
      const attr = novG.getNodeAttributes(n.lawId) as { x: number; y: number };
      n.x = attr.x;
      n.y = attr.y;
    }
  }

  separateOverlaps(nodes, index);
  for (const n of nodes) {
    n.x = round1(n.x);
    n.y = round1(n.y);
    n.r = round1(n.r);
  }

  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  return {
    bounds: [round1(minX), round1(minY), round1(maxX), round1(maxY)],
    circles,
  };
}
