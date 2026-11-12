import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contourDensity } from 'd3-contour';
import { converter } from 'culori';
import { CATEGORY_NAMES, GROUP_DEFS, categoryIdByName, groupIdForCategory, spaced } from '../lib/categories.ts';
import { kansujiToArabicInString } from '../lib/kansuji.ts';
import { MOCK_SNAPSHOT, STORE_ROOT } from '../lib/paths.ts';
import { gaussian, mulberry32, pickWeighted } from '../lib/random.ts';
import {
  CONTRACT_VERSION,
  LAW_STATUSES,
  LAW_TYPES,
  REF_KINDS,
  type Category,
  type CategoryFlowsFile,
  type CategoryGroup,
  type ContinentsFile,
  type LawEdgesFile,
  type LawRefsFile,
  type LawsFile,
  type Manifest,
  type RefRows,
} from '../lib/shared/contract.ts';
import { validateWebData } from '../lib/shared/validate-web-data.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = '/tmp/hourei-cache/egov-laws-none.json';
const toRgb = converter('rgb');
const rng = mulberry32(20261008);

interface EgovLaw {
  law_info: {
    law_id: string;
    law_type: string;
    law_num: string;
    promulgation_date: string;
  };
  revision_info: {
    law_revision_id: string;
    law_title: string;
    law_title_kana: string | null;
    abbrev: string | null;
    category: string;
    current_revision_status: string;
  };
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function oklchRgb(l: number, c: number, h: number): [number, number, number] {
  const rgb = toRgb({ mode: 'oklch', l, c, h });
  const r = rgb?.r ?? 0.5;
  const g = rgb?.g ?? 0.5;
  const b = rgb?.b ?? 0.5;
  return [
    Math.round(Math.min(1, Math.max(0, r)) * 255),
    Math.round(Math.min(1, Math.max(0, g)) * 255),
    Math.round(Math.min(1, Math.max(0, b)) * 255),
  ];
}

function makeCategories(counts: Map<number, number>, labelPos: Map<number, [number, number]>): {
  groups: CategoryGroup[];
  categories: Category[];
} {
  const groups: CategoryGroup[] = GROUP_DEFS.map((g) => ({ id: g.id, name: g.name, hue: g.hue }));
  const categories: Category[] = [];
  let id = 0;
  for (const g of GROUP_DEFS) {
    const ls = spaced(g.categories.length, 0.66, 0.82);
    const hs = spaced(g.categories.length, g.hue - 10, g.hue + 10);
    for (let i = 0; i < g.categories.length; i++) {
      const pos = labelPos.get(id) ?? [0, 0];
      categories.push({
        id,
        name: g.categories[i]!,
        groupId: g.id,
        color: oklchRgb(ls[i]!, 0.13, hs[i]!),
        lawCount: counts.get(id) ?? 0,
        labelPos: pos,
      });
      id++;
    }
  }
  return { groups, categories };
}

function lawTypeIndex(raw: string): number {
  const i = LAW_TYPES.indexOf(raw as (typeof LAW_TYPES)[number]);
  return i >= 0 ? i : LAW_TYPES.indexOf('Misc');
}

function makeLabel(title: string, abbrevs: string[]): string {
  const paren = /（([^）]+)）/.exec(title);
  let base = title;
  if (/^(明治|大正|昭和|平成|令和)/.test(title) && paren) base = paren[1]!;
  const abbr = abbrevs.find((a) => a && a.length < base.length);
  let label = abbr ?? base;
  if (label.length > 16) label = `${label.slice(0, 15)}…`;
  return label;
}

function douglasPeucker(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const [first, last] = [pts[0]!, pts[pts.length - 1]!];
  let maxD = 0;
  let idx = 0;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i]![0] - dx * pts[i]![1] + last[0] * first[1] - last[1] * first[0]) / len;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = douglasPeucker(pts.slice(0, idx + 1), eps);
    const right = douglasPeucker(pts.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function ringArea(ring: number[]): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2]! * ring[j * 2 + 1]! - ring[j * 2]! * ring[i * 2 + 1]!;
  }
  return Math.abs(a) / 2;
}

function centroid(ring: number[]): [number, number] {
  let sx = 0, sy = 0, n = ring.length / 2;
  if (!n) return [0, 0];
  for (let i = 0; i < n; i++) {
    sx += ring[i * 2]!;
    sy += ring[i * 2 + 1]!;
  }
  return [sx / n, sy / n];
}

function circlePoly(cx: number, cy: number, r: number, n = 24): number[] {
  const ring: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    ring.push(round1(cx + r * Math.cos(t)), round1(cy + r * Math.sin(t)));
  }
  return ring;
}

function contourPolygons(
  points: { x: number; y: number }[],
  bandwidth: number,
): { polygons: number[][][]; area: number; labelPos: [number, number] } {
  if (points.length === 0) {
    return { polygons: [], area: 0, labelPos: [0, 0] };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - 40;
  const minY = Math.min(...ys) - 40;
  const maxX = Math.max(...xs) + 40;
  const maxY = Math.max(...ys) + 40;
  const width = Math.max(maxX - minX, 80);
  const height = Math.max(maxY - minY, 80);
  try {
    const contours = contourDensity<{ x: number; y: number }>()
      .x((d) => d.x - minX)
      .y((d) => d.y - minY)
      .size([width, height])
      .bandwidth(bandwidth)
      .cellSize(4)
      .thresholds(8)(points);
    const mid = contours[Math.min(2, Math.max(0, contours.length - 3))] ?? contours[0];
    if (mid && mid.coordinates.length) {
      const polygons: number[][][] = [];
      let bestArea = 0;
      let bestPos: [number, number] = [points[0]!.x, points[0]!.y];
      for (const poly of mid.coordinates) {
        const rings: number[][] = [];
        for (const ring of poly) {
          const pts: [number, number][] = ring.map((p) => [p[0]! + minX, p[1]! + minY]);
          const simp = douglasPeucker(pts, 2);
          const flat: number[] = [];
          for (const [x, y] of simp) flat.push(round1(x), round1(y));
          if (flat.length >= 6) rings.push(flat);
        }
        if (rings[0]) {
          const a = ringArea(rings[0]);
          if (a > bestArea) {
            bestArea = a;
            bestPos = centroid(rings[0]);
          }
          polygons.push(rings);
        }
      }
      if (polygons.length) return { polygons, area: bestArea, labelPos: bestPos };
    }
  } catch {
    // fall through
  }
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  let maxR = 20;
  for (const p of points) maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy) * 1.2);
  const ring = circlePoly(cx, cy, maxR);
  return { polygons: [[ring]], area: ringArea(ring), labelPos: [round1(cx), round1(cy)] };
}

function emptyRows(): RefRows {
  return {
    other: [], srcPid: [], tgtPid: [], tgtEnd: [], kind: [], part: [], flags: [], mention: [], ctx: [],
  };
}

function pushRow(rows: RefRows, row: {
  other: number; srcPid: string; tgtPid: string | null; tgtEnd: string | null;
  kind: number; part: number; flags: number; mention: string; ctx: string | null;
}): void {
  rows.other.push(row.other);
  rows.srcPid.push(row.srcPid);
  rows.tgtPid.push(row.tgtPid);
  rows.tgtEnd.push(row.tgtEnd);
  rows.kind.push(row.kind);
  rows.part.push(row.part);
  rows.flags.push(row.flags);
  rows.mention.push(row.mention);
  rows.ctx.push(row.ctx);
}

async function loadLaws(): Promise<EgovLaw[]> {
  const cached = await readFile(CACHE, 'utf8').catch(() => null);
  if (cached) {
    const parsed = JSON.parse(cached) as { laws: EgovLaw[] };
    if (parsed.laws?.length >= 8000) return parsed.laws;
  }
  const laws: EgovLaw[] = [];
  let offset = 0;
  for (;;) {
    const url = `https://laws.e-gov.go.jp/api/2/laws?repeal_status=None&limit=1000&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`e-Gov ${res.status}`);
    const data = await res.json() as { laws: EgovLaw[]; next_offset: number | null };
    laws.push(...data.laws);
    if (!data.next_offset || data.laws.length === 0) break;
    offset = data.next_offset;
    await new Promise((r) => setTimeout(r, 500));
  }
  await mkdir(path.dirname(CACHE), { recursive: true });
  await writeFile(CACHE, JSON.stringify({ total_count: laws.length, laws }));
  return laws;
}

function pagerank(n: number, src: number[], tgt: number[], w: number[]): number[] {
  const pr = new Float64Array(n).fill(1 / n);
  const outW = new Float64Array(n);
  for (let i = 0; i < src.length; i++) outW[src[i]!] += w[i]!;
  const incoming: { j: number; w: number }[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < src.length; i++) incoming[tgt[i]!]!.push({ j: src[i]!, w: w[i]! });
  const d = 0.85;
  for (let it = 0; it < 80; it++) {
    const next = new Float64Array(n).fill((1 - d) / n);
    for (let i = 0; i < n; i++) {
      for (const e of incoming[i]!) {
        const ow = outW[e.j]!;
        next[i] += d * (ow > 0 ? (pr[e.j]! * e.w) / ow : 0);
      }
    }
    pr.set(next);
  }
  return Array.from(pr);
}

async function main(): Promise<void> {
  const rawLaws = await loadLaws();
  const n0 = rawLaws.length;
  const catCount = new Map<number, number>();
  type Row = {
    id: string; revisionId: string; title: string; kana: string; num: string; numNorm: string;
    aliases: string[]; type: number; category: number; promulgated: number; status: number;
    articles: number; x: number; y: number; r: number;
  };
  const rows: Row[] = [];
  for (const law of rawLaws) {
    const li = law.law_info;
    const ri = law.revision_info;
    const abbrevs = (ri.abbrev ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const aliases = [...new Set(abbrevs)].slice(0, 8);
    const cat = categoryIdByName(ri.category);
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    const statusName = ri.current_revision_status === 'UnEnforced' ? 'notYetEffective' : 'current';
    const ymd = (li.promulgation_date ?? '00000000').replace(/-/g, '');
    const articles = Math.max(1, Math.min(1348, Math.round(Math.exp(2.2 + gaussian(rng) * 1.15))));
    rows.push({
      id: li.law_id,
      revisionId: ri.law_revision_id,
      title: ri.law_title,
      kana: ri.law_title_kana ?? '',
      num: li.law_num,
      numNorm: kansujiToArabicInString(li.law_num.replace(/[\s\u3000]/g, '')),
      aliases,
      type: lawTypeIndex(li.law_type),
      category: cat,
      promulgated: Number(ymd) || 0,
      status: LAW_STATUSES.indexOf(statusName),
      articles,
      x: 0, y: 0, r: round1(1.5 + 0.8 * Math.sqrt(articles)),
    });
  }

  const hubs = ['民法', '刑法', '商法', '憲法', '地方自治法', '行政手続法', '個人情報の保護に関する法律', '会社法', '労働基準法', '租税特別措置法'];
  for (const row of rows) {
    if (hubs.includes(row.title)) row.articles = Math.max(row.articles, row.title === '民法' ? 1044 : 200);
    row.r = round1(1.5 + 0.8 * Math.sqrt(row.articles));
  }

  const catCenters: [number, number][] = CATEGORY_NAMES.map((_, i) => {
    const ang = (2 * Math.PI * i) / CATEGORY_NAMES.length - Math.PI / 2;
    return [820 * Math.cos(ang), 820 * Math.sin(ang)];
  });
  for (const row of rows) {
    const [cx, cy] = catCenters[row.category]!;
    const nCat = catCount.get(row.category) ?? 1;
    const std = 6.5 * Math.sqrt(nCat);
    row.x = cx + gaussian(rng) * std;
    row.y = cy + gaussian(rng) * std;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const row of rows) {
    minX = Math.min(minX, row.x); minY = Math.min(minY, row.y);
    maxX = Math.max(maxX, row.x); maxY = Math.max(maxY, row.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = 2000 / span;
  for (const row of rows) {
    row.x = round1((row.x - cx) * scale);
    row.y = round1((row.y - cy) * scale);
    row.r = round1(row.r * scale);
  }

  const byCat: number[][] = Array.from({ length: CATEGORY_NAMES.length }, () => []);
  for (let i = 0; i < rows.length; i++) byCat[rows[i]!.category]!.push(i);

  const titleIndex = new Map(rows.map((r, i) => [r.title, i]));
  const parent = new Int32Array(n0).fill(-1);
  const family = new Int32Array(n0);
  for (let i = 0; i < n0; i++) {
    const t = rows[i]!.title;
    const m = t.match(/^(.*?)(施行令|施行規則|施行細則)$/);
    if (!m) continue;
    const base = m[1]!;
    const hit = titleIndex.get(base);
    if (hit != null) parent[i] = hit;
  }
  const findRoot = (i: number, seen: Set<number>): number => {
    if (seen.has(i)) return i;
    seen.add(i);
    const p = parent[i]!;
    if (p < 0) {
      const typ = rows[i]!.type;
      if (typ === LAW_TYPES.indexOf('Act') || typ === LAW_TYPES.indexOf('Constitution')) return i;
      return i;
    }
    return findRoot(p, seen);
  };
  for (let i = 0; i < n0; i++) family[i] = findRoot(i, new Set());

  const TARGET = 80_000;
  const kindWeights = [3, 6, 1, 8, 2, 2, 8, 70];
  const srcA: number[] = [];
  const tgtA: number[] = [];
  const mainA: number[] = [];
  const supplA: number[] = [];
  const kindMaskA: number[] = [];
  const domKindA: number[] = [];
  const intraA: number[] = [];
  const seen = new Set<string>();
  const weight = rows.map((r) => (hubs.includes(r.title) ? 80 : 1) + Math.sqrt(r.articles));

  let guard = 0;
  while (srcA.length < TARGET && guard < TARGET * 20) {
    guard++;
    const s = Math.floor(rng() * n0);
    const intra = rng() < 0.7;
    let t: number;
    if (intra) {
      const pool = byCat[rows[s]!.category]!;
      if (pool.length < 2) continue;
      const ww = pool.map((i) => weight[i]!);
      t = pool[pickWeighted(ww, rng)]!;
    } else {
      t = pickWeighted(weight, rng);
    }
    if (t === s) continue;
    const key = `${s},${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = pickWeighted(kindWeights, rng);
    const mainRefs = 1 + Math.floor(rng() * (hubs.includes(rows[t]!.title) ? 12 : 4));
    const supplRefs = rng() < 0.3 ? 1 + Math.floor(rng() * 4) : 0;
    srcA.push(s);
    tgtA.push(t);
    mainA.push(mainRefs);
    supplA.push(supplRefs);
    domKindA.push(kind);
    kindMaskA.push(1 << kind);
    intraA.push(family[s] === family[t] ? 1 : 0);
    weight[t] += 0.4;
  }

  const pr = pagerank(n0, srcA, tgtA, mainA);
  const orderPr = [...Array(n0).keys()].sort((a, b) => pr[b]! - pr[a]!);
  const prRankArr = new Int32Array(n0);
  orderPr.forEach((idx, rank) => {
    prRankArr[idx] = rank + 1;
  });

  const inLaws = new Int32Array(n0);
  const outLaws = new Int32Array(n0);
  const inRefs = new Int32Array(n0);
  const outRefs = new Int32Array(n0);
  const inCat = Array.from({ length: n0 }, () => new Set<number>());
  for (let e = 0; e < srcA.length; e++) {
    const s = srcA[e]!, t = tgtA[e]!;
    outLaws[s]++; inLaws[t]++;
    outRefs[s] += mainA[e]!; inRefs[t] += mainA[e]!;
    inCat[t]!.add(rows[s]!.category);
  }

  const perm = [...Array(n0).keys()].sort((a, b) => {
    const ra = rows[a]!, rb = rows[b]!;
    return ra.status - rb.status || ra.category - rb.category || (ra.id < rb.id ? -1 : ra.id > rb.id ? 1 : 0);
  });
  const newOf = new Int32Array(n0);
  perm.forEach((old, neu) => {
    newOf[old] = neu;
  });

  const n = n0;
  const laws: LawsFile = {
    n,
    id: [], revisionId: [], title: [], label: [], kana: [], num: [], numNorm: [], aliases: [],
    type: [], category: [], promulgated: [], status: [], x: [], y: [], r: [], articles: [],
    inLaws: [], outLaws: [], inRefs: [], outRefs: [], pagerank: [], prRank: [],
    parent: [], family: [], community: [], bridge: [], delegations: [],
  };
  for (const old of perm) {
    const row = rows[old]!;
    laws.id.push(row.id);
    laws.revisionId.push(row.revisionId);
    laws.title.push(row.title);
    laws.label.push(makeLabel(row.title, row.aliases));
    laws.kana.push(row.kana);
    laws.num.push(row.num);
    laws.numNorm.push(row.numNorm);
    laws.aliases.push(row.aliases);
    laws.type.push(row.type);
    laws.category.push(row.category);
    laws.promulgated.push(row.promulgated);
    laws.status.push(row.status);
    laws.x.push(row.x);
    laws.y.push(row.y);
    laws.r.push(row.r);
    laws.articles.push(row.articles);
    laws.inLaws.push(inLaws[old]!);
    laws.outLaws.push(outLaws[old]!);
    laws.inRefs.push(inRefs[old]!);
    laws.outRefs.push(outRefs[old]!);
    const p4 = Number(pr[old]!.toPrecision(4));
    laws.pagerank.push(p4);
    laws.prRank.push(prRankArr[old]!);
    laws.parent.push(parent[old]! < 0 ? -1 : newOf[parent[old]!]!);
    laws.family.push(newOf[family[old]!]!);
    laws.community.push(row.category);
    laws.bridge.push(inCat[old]!.size);
    laws.delegations.push(Math.max(0, Math.round((row.title.includes('施行') ? 8 : 1) + rng() * 6)));
  }

  const edgeIdx = [...Array(srcA.length).keys()].sort((a, b) => {
    const sa = newOf[srcA[a]!]!, sb = newOf[srcA[b]!]!;
    const ta = newOf[tgtA[a]!]!, tb = newOf[tgtA[b]!]!;
    return sa - sb || ta - tb;
  });
  const edges: LawEdgesFile = {
    n: srcA.length,
    src: [], tgt: [], mainRefs: [], supplRefs: [], kindMask: [], domKind: [], intraFamily: [],
  };
  for (const i of edgeIdx) {
    edges.src.push(newOf[srcA[i]!]!);
    edges.tgt.push(newOf[tgtA[i]!]!);
    edges.mainRefs.push(mainA[i]!);
    edges.supplRefs.push(supplA[i]!);
    edges.kindMask.push(kindMaskA[i]!);
    edges.domKind.push(domKindA[i]!);
    edges.intraFamily.push(intraA[i]!);
  }

  const flowMap = new Map<string, number>();
  for (let i = 0; i < edges.n; i++) {
    const sc = laws.category[edges.src[i]!]!;
    const tc = laws.category[edges.tgt[i]!]!;
    if (sc === tc) continue;
    const key = `${sc},${tc}`;
    flowMap.set(key, (flowMap.get(key) ?? 0) + edges.mainRefs[i]!);
  }
  const flowRows = [...flowMap.entries()]
    .map(([k, refs]) => {
      const [src, tgt] = k.split(',').map(Number);
      return { src: src!, tgt: tgt!, refs };
    })
    .sort((a, b) => b.refs - a.refs)
    .slice(0, 300);
  const flows: CategoryFlowsFile = {
    n: flowRows.length,
    src: flowRows.map((r) => r.src),
    tgt: flowRows.map((r) => r.tgt),
    refs: flowRows.map((r) => r.refs),
  };

  const pointsByCat: { x: number; y: number }[][] = Array.from({ length: CATEGORY_NAMES.length }, () => []);
  const pointsByGroup: { x: number; y: number }[][] = Array.from({ length: GROUP_DEFS.length }, () => []);
  for (let i = 0; i < n; i++) {
    const p = { x: laws.x[i]!, y: laws.y[i]! };
    pointsByCat[laws.category[i]!]!.push(p);
    pointsByGroup[groupIdForCategory(laws.category[i]!)]!.push(p);
  }
  const continents: ContinentsFile = { categories: [], groups: [] };
  const labelPos = new Map<number, [number, number]>();
  for (let id = 0; id < CATEGORY_NAMES.length; id++) {
    const c = contourPolygons(pointsByCat[id]!, 18);
    continents.categories.push({ id, polygons: c.polygons, area: c.area, labelPos: c.labelPos });
    labelPos.set(id, c.labelPos);
  }
  for (const g of GROUP_DEFS) {
    const c = contourPolygons(pointsByGroup[g.id]!, 30);
    continents.groups.push({ id: g.id, polygons: c.polygons, labelPos: c.labelPos });
  }

  const { groups, categories } = makeCategories(catCount, labelPos);
  for (const cat of categories) {
    const c = continents.categories[cat.id];
    if (c) cat.labelPos = c.labelPos;
    cat.lawCount = pointsByCat[cat.id]?.length ?? 0;
  }

  const top = [...Array(n).keys()].sort((a, b) => laws.prRank[a]! - laws.prRank[b]!).slice(0, 300);
  const topSet = new Set(top);
  const outMap = new Map<number, { other: number; kind: number; main: number; idx: number }[]>();
  const inMap = new Map<number, { other: number; kind: number; main: number; idx: number }[]>();
  for (let i = 0; i < edges.n; i++) {
    const s = edges.src[i]!, t = edges.tgt[i]!;
    if (topSet.has(s)) {
      const arr = outMap.get(s) ?? [];
      arr.push({ other: t, kind: edges.domKind[i]!, main: edges.mainRefs[i]!, idx: i });
      outMap.set(s, arr);
    }
    if (topSet.has(t)) {
      const arr = inMap.get(t) ?? [];
      arr.push({ other: s, kind: edges.domKind[i]!, main: edges.mainRefs[i]!, idx: i });
      inMap.set(t, arr);
    }
  }

  const refFiles = new Map<string, LawRefsFile>();
  let refCount = 0;
  for (const li of top) {
    const out = emptyRows();
    const inn = emptyRows();
    const outs = (outMap.get(li) ?? []).sort((a, b) => laws.prRank[a.other]! - laws.prRank[b.other]!);
    const inns = (inMap.get(li) ?? []).sort((a, b) => laws.prRank[a.other]! - laws.prRank[b.other]!);
    const fill = (list: typeof outs, rows: RefRows, fromIsSrc: boolean) => {
      for (const e of list) {
        const other = e.other;
        const art = 1 + (e.idx % Math.max(1, laws.articles[fromIsSrc ? li : other]!));
        const tgtArt = 1 + ((e.idx * 3) % Math.max(1, laws.articles[fromIsSrc ? other : li]!));
        const mention = `${laws.title[other]}第${tgtArt}条`;
        const srcPid = `m.a${art}.p1#1`;
        const tgtPid = `m.a${tgtArt}`;
        const part = e.idx % 7 === 0 ? 3 : 0;
        pushRow(rows, {
          other, srcPid, tgtPid, tgtEnd: null, kind: e.kind, part, flags: 0,
          mention,
          ctx: part === 0 ? null : `……⟦${mention}⟧……`,
        });
      }
    };
    fill(outs, out, true);
    fill(inns, inn, false);
    const file: LawRefsFile = {
      lawId: laws.id[li]!,
      out, in: inn,
      outTotal: out.other.length,
      inTotal: inn.other.length,
    };
    refCount += out.other.length + inn.other.length;
    if (out.other.length || inn.other.length) refFiles.set(laws.id[li]!, file);
  }

  minX = Math.min(...laws.x);
  minY = Math.min(...laws.y);
  maxX = Math.max(...laws.x);
  maxY = Math.max(...laws.y);
  const pad = 40;
  const manifest: Manifest = {
    contractVersion: CONTRACT_VERSION,
    snapshotId: MOCK_SNAPSHOT,
    egovAsof: '2026-10-08',
    builtAt: new Date().toISOString(),
    pipelineVersion: '0.0.0-mock',
    isMock: true,
    counts: {
      laws: n,
      ghostLaws: laws.status.filter((s) => s === LAW_STATUSES.indexOf('repealed')).length,
      lawEdges: edges.n,
      refs: refCount,
      crossLawRefs: edges.n,
    },
    bounds: [round1(minX - pad), round1(minY - pad), round1(maxX + pad), round1(maxY + pad)],
    groups,
    categories,
    files: [],
    eval: null,
    attribution: [
      '出典: e-Gov法令検索（https://laws.e-gov.go.jp/）の法令データを加工して作成',
      'この画面は仮データです。位置と参照は実在のメタデータから合成しています。',
    ],
  };

  const outDirs = [
    path.join(STORE_ROOT, 'data/mock', MOCK_SNAPSHOT),
    path.join(ROOT, 'public/data', MOCK_SNAPSHOT),
  ];
  const payloads = new Map<string, Buffer>();
  const put = (rel: string, obj: unknown) => {
    payloads.set(rel, Buffer.from(JSON.stringify(obj), 'utf8'));
  };
  put('laws.json', laws);
  put('law-edges.json', edges);
  put('continents.json', continents);
  put('category-flows.json', flows);
  for (const [id, file] of refFiles) put(`refs/${id}.json`, file);

  manifest.files = [...payloads.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, buf]) => ({ path: p, bytes: buf.length, sha256: sha256(buf) }));
  put('manifest.json', manifest);

  for (const dir of outDirs) {
    await mkdir(path.join(dir, 'refs'), { recursive: true });
    for (const [rel, buf] of payloads) {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), buf);
    }
  }
  const latest = { contractVersion: CONTRACT_VERSION, snapshotId: MOCK_SNAPSHOT, dataPath: `/data/${MOCK_SNAPSHOT}/` };
  await writeFile(path.join(ROOT, 'public/data/latest.json'), JSON.stringify(latest));
  await mkdir(path.join(STORE_ROOT, 'data/web'), { recursive: true });
  await writeFile(path.join(STORE_ROOT, 'data/web/latest.json'), JSON.stringify(latest));

  const result = await validateWebData(outDirs[0]!);
  if (!result.ok) {
    console.error(result.issues);
    process.exit(1);
  }
  console.log(`mock ok laws=${n} edges=${edges.n} refsFiles=${refFiles.size}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
