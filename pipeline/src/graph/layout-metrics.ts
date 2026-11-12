import { CATEGORY_NAMES } from './categories.ts';
import { layoutEdgeWeight, type PairAgg } from './edges.ts';
import {
  median,
  percentile,
  pointInPolygons,
  segmentHitsAabb,
  segmentHitsCircle,
  weightedMedian,
} from './geometry.ts';
import type { CircleLayout } from './layout-circles.ts';
import { mulberry32 } from '../lib/random.ts';
import type { GraphState, NodeRec } from './types.ts';

export const MAP_D = 2000;
const CENTER_R = 250;
const VIEW = 150;

export interface LayoutMetrics {
  knnCatPurity: number;
  edgeLenCross: number;
  lawsInCenter: number;
  centerPassPerLocal: number | null;
  diskFill: number;
  inkOverEmpty: number;
  hubToNbrCentroidMedian: number;
  hubDistMedian: number;
  hubsInContinent: number;
  familyDistMedian: number;
  familyDistP90: number;
  intraEdgeVsRandom: number;
  adjFlowShare: number;
  groupContig: number;
  shortShare: number;
  longShare: number;
  viewportPassPerLocalMedian: number;
}

export function mPass(m: LayoutMetrics): { id: string; key: string; value: number | null; ok: boolean; need: string }[] {
  return [
    { id: 'M1', key: 'knnCatPurity', value: m.knnCatPurity, ok: m.knnCatPurity >= 0.90, need: '≥ 0.90' },
    { id: 'M2', key: 'edgeLenCross', value: m.edgeLenCross, ok: m.edgeLenCross <= 0.32, need: '≤ 0.32' },
    { id: 'M3', key: 'lawsInCenter', value: m.lawsInCenter, ok: m.lawsInCenter >= 0.04, need: '≥ 0.04' },
    { id: 'M4', key: 'centerPassPerLocal', value: m.centerPassPerLocal, ok: m.centerPassPerLocal !== null && m.centerPassPerLocal <= 1.0, need: '≤ 1.0（分母0は不合格）' },
    { id: 'M5', key: 'diskFill', value: m.diskFill, ok: m.diskFill >= 0.60, need: '≥ 0.60' },
    { id: 'M6', key: 'inkOverEmpty', value: m.inkOverEmpty, ok: m.inkOverEmpty <= 0.45, need: '≤ 0.45' },
    { id: 'M7a', key: 'hubToNbrCentroidMedian', value: m.hubToNbrCentroidMedian, ok: m.hubToNbrCentroidMedian <= 0.12, need: '≤ 0.12' },
    { id: 'M7b', key: 'hubDistMedian', value: m.hubDistMedian, ok: m.hubDistMedian <= 700, need: '≤ 700' },
    { id: 'M7c', key: 'hubsInContinent', value: m.hubsInContinent, ok: m.hubsInContinent >= 27, need: '≥ 27' },
    { id: 'M8med', key: 'familyDistMedian', value: m.familyDistMedian, ok: m.familyDistMedian <= 0.03, need: '≤ 0.03' },
    { id: 'M8p90', key: 'familyDistP90', value: m.familyDistP90, ok: m.familyDistP90 <= 0.10, need: '≤ 0.10' },
    { id: 'M9', key: 'intraEdgeVsRandom', value: m.intraEdgeVsRandom, ok: m.intraEdgeVsRandom <= 0.70, need: '≤ 0.70' },
    { id: 'M10a', key: 'adjFlowShare', value: m.adjFlowShare, ok: m.adjFlowShare >= 0.25, need: '≥ 0.25' },
    { id: 'M10b', key: 'groupContig', value: m.groupContig, ok: m.groupContig >= 0.75, need: '≥ 0.75' },
    { id: 'M11short', key: 'shortShare', value: m.shortShare, ok: m.shortShare >= 0.35, need: '≥ 0.35' },
    { id: 'M11long', key: 'longShare', value: m.longShare, ok: m.longShare <= 0.35, need: '≤ 0.35' },
  ];
}

function knnCatPurity(laws: NodeRec[], k = 10): number {
  const n = laws.length;
  if (n <= 1) return 1;
  const kk = Math.min(k, n - 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = laws[i]!;
    const dist: { d: number; j: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = laws[j]!;
      dist.push({ d: Math.hypot(a.x - b.x, a.y - b.y), j });
    }
    dist.sort((p, q) => p.d - q.d || p.j - q.j);
    let same = 0;
    for (let t = 0; t < kk; t++) {
      if (laws[dist[t]!.j]!.category === a.category) same++;
    }
    acc += same / kk;
  }
  return acc / n;
}

export function hubLawIds(nodes: NodeRec[], pairs: PairAgg[], top = 30): string[] {
  const laws = nodes.filter((n) => !n.ghost);
  const wIn = new Map<string, number>();
  for (const n of laws) wIn.set(n.lawId, 0);
  for (const p of pairs) {
    const w = layoutEdgeWeight(p);
    if (w <= 0) continue;
    if (!wIn.has(p.tgtLaw)) continue;
    wIn.set(p.tgtLaw, (wIn.get(p.tgtLaw) ?? 0) + w);
  }
  return [...laws]
    .sort((a, b) => (wIn.get(b.lawId) ?? 0) - (wIn.get(a.lawId) ?? 0) || a.lawId.localeCompare(b.lawId))
    .slice(0, top)
    .map((n) => n.lawId);
}

export function computeLayoutMetrics(state: GraphState, circles: CircleLayout): LayoutMetrics {
  const { nodes, pairs, continents } = state;
  const byId = new Map(nodes.map((n) => [n.lawId, n]));
  const laws = nodes.filter((n) => !n.ghost);
  const D = MAP_D;

  const edges: { a: NodeRec; b: NodeRec; w: number; len: number; cross: boolean }[] = [];
  for (const p of pairs) {
    const w = layoutEdgeWeight(p);
    if (w <= 0) continue;
    const a = byId.get(p.srcLaw);
    const b = byId.get(p.tgtLaw);
    if (!a || !b) continue;
    const len = Math.hypot(a.x - b.x, a.y - b.y);
    edges.push({ a, b, w, len, cross: a.category !== b.category });
  }

  const knn = knnCatPurity(laws, 10);
  const edgeLenCross = weightedMedian(edges.filter((e) => e.cross).map((e) => ({ value: e.len / D, weight: e.w })));
  const lawsInCenter = laws.length ? laws.filter((n) => Math.hypot(n.x, n.y) < CENTER_R).length / laws.length : 0;

  let pass = 0;
  let local = 0;
  for (const e of edges) {
    const ra = Math.hypot(e.a.x, e.a.y);
    const rb = Math.hypot(e.b.x, e.b.y);
    const oneIn = ra < CENTER_R || rb < CENTER_R;
    if (oneIn) local++;
    if (!oneIn && segmentHitsCircle(e.a.x, e.a.y, e.b.x, e.b.y, CENTER_R)) pass++;
  }
  const centerPassPerLocal = local > 0 ? pass / local : null;

  const occupied50 = new Set<string>();
  for (const n of laws) occupied50.add(`${Math.floor(n.x / 50)},${Math.floor(n.y / 50)}`);
  let cells = 0;
  let filled = 0;
  for (let ix = -25; ix < 25; ix++) {
    for (let iy = -25; iy < 25; iy++) {
      const cx = (ix + 0.5) * 50;
      const cy = (iy + 0.5) * 50;
      if (Math.hypot(cx, cy) > 900) continue;
      cells++;
      if (occupied50.has(`${ix},${iy}`)) filled++;
    }
  }
  const diskFill = cells > 0 ? filled / cells : 0;

  const occupied25 = new Set<string>();
  for (const n of laws) occupied25.add(`${Math.floor(n.x / 25)},${Math.floor(n.y / 25)}`);
  let inkAll = 0;
  let inkEmpty = 0;
  for (const e of edges) {
    const len = e.len;
    if (len <= 0) continue;
    const steps = Math.max(1, Math.ceil(len / 12.5));
    const sl = len / steps;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const x = e.a.x + (e.b.x - e.a.x) * t;
      const y = e.a.y + (e.b.y - e.a.y) * t;
      const key = `${Math.floor(x / 25)},${Math.floor(y / 25)}`;
      inkAll += sl;
      if (!occupied25.has(key)) inkEmpty += sl;
    }
  }
  const inkOverEmpty = inkAll > 0 ? inkEmpty / inkAll : 0;

  const hubs = hubLawIds(nodes, pairs, 30);
  const hubNodes = hubs.map((id) => byId.get(id)!).filter(Boolean);
  const nbrW = new Map<string, Map<string, number>>();
  for (const id of hubs) nbrW.set(id, new Map());
  for (const e of edges) {
    if (nbrW.has(e.a.lawId)) {
      const m = nbrW.get(e.a.lawId)!;
      m.set(e.b.lawId, (m.get(e.b.lawId) ?? 0) + e.w);
    }
    if (nbrW.has(e.b.lawId)) {
      const m = nbrW.get(e.b.lawId)!;
      m.set(e.a.lawId, (m.get(e.a.lawId) ?? 0) + e.w);
    }
  }
  const hubToNbr: number[] = [];
  for (const h of hubNodes) {
    const m = nbrW.get(h.lawId)!;
    let sx = 0, sy = 0, sw = 0;
    for (const [oid, w] of m) {
      const o = byId.get(oid);
      if (!o) continue;
      sx += o.x * w;
      sy += o.y * w;
      sw += w;
    }
    if (sw <= 0) continue;
    hubToNbr.push(Math.hypot(h.x - sx / sw, h.y - sy / sw) / D);
  }
  const hubToNbrCentroidMedian = median(hubToNbr);
  const hubDistMedian = median(hubNodes.map((h) => Math.hypot(h.x, h.y)));
  let hubsInContinent = 0;
  for (const h of hubNodes) {
    const polys = continents.categories[h.category]?.polygons ?? [];
    if (pointInPolygons(h.x, h.y, polys)) hubsInContinent++;
  }

  const fam: number[] = [];
  for (const n of laws) {
    if (!n.parentLawId) continue;
    const p = byId.get(n.parentLawId);
    if (!p) continue;
    fam.push(Math.hypot(n.x - p.x, n.y - p.y) / D);
  }
  const familyDistMedian = median(fam);
  const familyDistP90 = percentile(fam, 0.9);

  const ratios: number[] = [];
  for (let c = 0; c < CATEGORY_NAMES.length; c++) {
    const catLaws = laws.filter((n) => n.category === c);
    if (catLaws.length < 20) continue;
    const intra = edges.filter((e) => !e.a.ghost && !e.b.ghost && e.a.category === c && e.b.category === c);
    if (intra.length < 10) continue;
    const intraMed = median(intra.map((e) => e.len));
    const rng = mulberry32(20261008 + 1000 + c);
    const rand: number[] = [];
    const take = Math.min(2000, (catLaws.length * (catLaws.length - 1)) / 2);
    for (let t = 0; t < take; t++) {
      const i = Math.floor(rng() * catLaws.length);
      let j = Math.floor(rng() * catLaws.length);
      if (j === i) j = (j + 1) % catLaws.length;
      rand.push(Math.hypot(catLaws[i]!.x - catLaws[j]!.x, catLaws[i]!.y - catLaws[j]!.y));
    }
    const randMed = median(rand);
    if (randMed > 0) ratios.push(intraMed / randMed);
  }
  const intraEdgeVsRandom = median(ratios);

  const wAll = edges.reduce((s, e) => s + e.w, 0);
  const wShort = edges.filter((e) => e.len < 0.05 * D).reduce((s, e) => s + e.w, 0);
  const wLong = edges.filter((e) => e.len > 0.25 * D).reduce((s, e) => s + e.w, 0);
  const shortShare = wAll > 0 ? wShort / wAll : 0;
  const longShare = wAll > 0 ? wLong / wAll : 0;

  const vp: number[] = [];
  for (let c = 0; c < CATEGORY_NAMES.length; c++) {
    const catLaws = laws.filter((n) => n.category === c);
    if (catLaws.length === 0) continue;
    const cx = catLaws.reduce((s, n) => s + n.x, 0) / catLaws.length;
    const cy = catLaws.reduce((s, n) => s + n.y, 0) / catLaws.length;
    const minX = cx - VIEW / 2, maxX = cx + VIEW / 2;
    const minY = cy - VIEW / 2, maxY = cy + VIEW / 2;
    const inBox = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
    let loc = 0, pas = 0;
    for (const e of edges) {
      const aIn = inBox(e.a.x, e.a.y);
      const bIn = inBox(e.b.x, e.b.y);
      if (aIn || bIn) loc++;
      else if (segmentHitsAabb(e.a.x, e.a.y, e.b.x, e.b.y, minX, minY, maxX, maxY)) pas++;
    }
    if (loc > 0) vp.push(pas / loc);
  }
  const viewportPassPerLocalMedian = median(vp);

  return {
    knnCatPurity: knn,
    edgeLenCross,
    lawsInCenter,
    centerPassPerLocal,
    diskFill,
    inkOverEmpty,
    hubToNbrCentroidMedian,
    hubDistMedian,
    hubsInContinent,
    familyDistMedian,
    familyDistP90,
    intraEdgeVsRandom,
    adjFlowShare: circles.adjFlowShare,
    groupContig: circles.groupContig,
    shortShare,
    longShare,
    viewportPassPerLocalMedian,
  };
}

