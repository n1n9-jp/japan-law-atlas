import { KIND_RGB } from './colors';
import { bundleEdges, edgeWidth } from './bundle-edges';
import {
  CITE_KIND_ALPHA_MUL,
  EDGE_VERTEX_ALPHA,
  INTRA_CATEGORY_ALPHA_MUL,
  OVERVIEW_PAIR_WEIGHT,
} from './edge-style';
import { REF_KINDS } from './shared/contract';
import type { LawEdgesFile, LawsFile } from './shared/contract';

export {
  CITE_KIND_ALPHA_MUL,
  EDGE_VERTEX_ALPHA,
  INTRA_CATEGORY_ALPHA_MUL,
  OVERVIEW_PAIR_WEIGHT,
} from './edge-style';

const CITE_KIND = REF_KINDS.indexOf('cite');

export interface GeometryBuffers {
  positions: Float32Array;
  startIndices: Uint32Array;
  packedIndex: Uint32Array;
  widths: Float32Array;
  colorByCategory: Uint8Array;
  colorByKind: Uint8Array;
  dash: Float32Array;
  filterValue: Float32Array;
  filterCategory: Uint8Array;
  categoryCenters: Float32Array;
}

export interface PackedGeometryInput {
  nLaws: number;
  x: Float32Array;
  y: Float32Array;
  category: Uint16Array;
  type: Uint8Array;
  nEdges: number;
  src: Uint32Array;
  tgt: Uint32Array;
  mainRefs: Float32Array;
  supplRefs: Float32Array;
  domKind: Uint8Array;
  intraFamily: Uint8Array;
  categoryColors: Uint8Array;
  categoryCount: number;
}

export function packGeometryInput(
  laws: LawsFile,
  edges: LawEdgesFile,
  categoryColors: [number, number, number][],
): PackedGeometryInput {
  const colors = new Uint8Array(categoryColors.length * 3);
  for (let i = 0; i < categoryColors.length; i++) {
    colors[i * 3] = categoryColors[i]![0]!;
    colors[i * 3 + 1] = categoryColors[i]![1]!;
    colors[i * 3 + 2] = categoryColors[i]![2]!;
  }
  return {
    nLaws: laws.n,
    x: Float32Array.from(laws.x),
    y: Float32Array.from(laws.y),
    category: Uint16Array.from(laws.category),
    type: Uint8Array.from(laws.type),
    nEdges: edges.n,
    src: Uint32Array.from(edges.src),
    tgt: Uint32Array.from(edges.tgt),
    mainRefs: Float32Array.from(edges.mainRefs),
    supplRefs: Float32Array.from(edges.supplRefs),
    domKind: Uint8Array.from(edges.domKind),
    intraFamily: Uint8Array.from(edges.intraFamily),
    categoryColors: colors,
    categoryCount: categoryColors.length,
  };
}

export function packedTransferList(p: PackedGeometryInput): Transferable[] {
  return [
    p.x.buffer, p.y.buffer, p.category.buffer, p.type.buffer,
    p.src.buffer, p.tgt.buffer, p.mainRefs.buffer, p.supplRefs.buffer,
    p.domKind.buffer, p.intraFamily.buffer, p.categoryColors.buffer,
  ];
}

/** 全体表示の重み以上の線を、(src分野, tgt分野) の組で数える。 */
export function countCategoryPairs(
  p: PackedGeometryInput,
  minWeight = OVERVIEW_PAIR_WEIGHT,
): Uint32Array {
  const counts = new Uint32Array(p.categoryCount * p.categoryCount);
  for (let i = 0; i < p.nEdges; i++) {
    if (p.mainRefs[i]! < minWeight) continue;
    const sc = p.category[p.src[i]!]!;
    const tc = p.category[p.tgt[i]!]!;
    if (sc < 0 || tc < 0 || sc >= p.categoryCount || tc >= p.categoryCount) continue;
    counts[sc * p.categoryCount + tc]!++;
  }
  return counts;
}

export function pairVertexAlpha(
  pairN: number,
  opts: { cite?: boolean; intra?: boolean } = {},
): number {
  let a = EDGE_VERTEX_ALPHA;
  if (opts.intra) a *= INTRA_CATEGORY_ALPHA_MUL;
  else a /= Math.sqrt(Math.max(1, pairN));
  if (opts.cite) a *= CITE_KIND_ALPHA_MUL;
  return Math.max(1, Math.round(a));
}

function citeFirstOrder(domKind: Uint8Array, n: number): Uint32Array {
  const order = new Uint32Array(n);
  let w = 0;
  for (let i = 0; i < n; i++) if (domKind[i] === CITE_KIND) order[w++] = i;
  for (let i = 0; i < n; i++) if (domKind[i] !== CITE_KIND) order[w++] = i;
  return order;
}

export function buildGeometryFromPacked(p: PackedGeometryInput): GeometryBuffers {
  const bundled = bundleEdges({
    nLaws: p.nLaws,
    x: p.x,
    y: p.y,
    category: p.category,
    nEdges: p.nEdges,
    src: p.src,
    tgt: p.tgt,
    categoryCount: p.categoryCount,
  });
  const n = p.nEdges;
  const pairN = countCategoryPairs(p);
  const order = citeFirstOrder(p.domKind, n);
  const origStart = bundled.startIndices;
  const totalPts = origStart[n]!;
  const positions = new Float32Array(totalPts * 2);
  const startIndices = new Uint32Array(n + 1);
  const packedIndex = new Uint32Array(n);
  const widths = new Float32Array(n);
  const colorByCategory = new Uint8Array(n * 4);
  const colorByKind = new Uint8Array(n * 4);
  const dash = new Float32Array(n * 2);
  const filterValue = new Float32Array(n * 4);
  const filterCategory = new Uint8Array(n * 4);
  let cursor = 0;
  for (let inst = 0; inst < n; inst++) {
    const i = order[inst]!;
    packedIndex[i] = inst;
    startIndices[inst] = cursor;
    const a = origStart[i]!;
    const b = origStart[i + 1]!;
    const len = b - a;
    positions.set(bundled.positions.subarray(a * 2, b * 2), cursor * 2);
    cursor += len;

    widths[inst] = edgeWidth(p.mainRefs[i]!);
    const src = p.src[i]!;
    const tgt = p.tgt[i]!;
    const cat = p.category[src]!;
    const tgtCat = p.category[tgt]!;
    const pair = (cat >= 0 && tgtCat >= 0 && cat < p.categoryCount && tgtCat < p.categoryCount)
      ? pairN[cat * p.categoryCount + tgtCat]!
      : 1;
    const intra = cat === tgtCat;
    const cite = p.domKind[i] === CITE_KIND;
    colorByCategory[inst * 4] = p.categoryColors[cat * 3] ?? 200;
    colorByCategory[inst * 4 + 1] = p.categoryColors[cat * 3 + 1] ?? 200;
    colorByCategory[inst * 4 + 2] = p.categoryColors[cat * 3 + 2] ?? 200;
    colorByCategory[inst * 4 + 3] = pairVertexAlpha(pair, { intra });
    const kr = KIND_RGB[p.domKind[i]!] ?? [217, 222, 231];
    colorByKind[inst * 4] = kr[0]!;
    colorByKind[inst * 4 + 1] = kr[1]!;
    colorByKind[inst * 4 + 2] = kr[2]!;
    colorByKind[inst * 4 + 3] = pairVertexAlpha(pair, { intra, cite });
    const amend = p.domKind[i] === 2;
    dash[inst * 2] = amend ? 4 : 0;
    dash[inst * 2 + 1] = amend ? 3 : 0;
    const main = p.mainRefs[i]!;
    const suppl = p.supplRefs[i]!;
    filterValue[inst * 4] = main;
    filterValue[inst * 4 + 1] = suppl;
    filterValue[inst * 4 + 2] = main + suppl;
    const dx = p.x[src]! - p.x[tgt]!;
    const dy = p.y[src]! - p.y[tgt]!;
    filterValue[inst * 4 + 3] = Math.hypot(dx, dy);
    filterCategory[inst * 4] = p.domKind[i]!;
    filterCategory[inst * 4 + 1] = p.type[src]!;
    filterCategory[inst * 4 + 2] = p.type[tgt]!;
    filterCategory[inst * 4 + 3] = p.intraFamily[i]!;
  }
  startIndices[n] = cursor;
  return {
    positions,
    startIndices,
    packedIndex,
    widths,
    colorByCategory,
    colorByKind,
    dash,
    filterValue,
    filterCategory,
    categoryCenters: bundled.categoryCenters,
  };
}

export function buildGeometry(
  laws: LawsFile,
  edges: LawEdgesFile,
  categoryColors: [number, number, number][],
): GeometryBuffers {
  return buildGeometryFromPacked(packGeometryInput(laws, edges, categoryColors));
}
