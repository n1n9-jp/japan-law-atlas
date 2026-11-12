import type { LawEdgesFile, LawsFile } from './shared/contract';
import type { AtlasUrlState } from './url-state';

const INF = 1e6;

export function edgeWeight(edges: LawEdgesFile, i: number, parts: AtlasUrlState['parts']): number {
  const main = edges.mainRefs[i]!;
  const suppl = edges.supplRefs[i]!;
  if (parts === 'main') return main;
  if (parts === 'suppl') return suppl;
  return main + suppl;
}

export function isEdgeVisible(
  edges: LawEdgesFile,
  laws: LawsFile,
  i: number,
  state: Pick<AtlasUrlState, 'kinds' | 'parts' | 'types' | 'minRefs'> & { hideIntraFamily: boolean },
): boolean {
  if (edgeWeight(edges, i, state.parts) < state.minRefs) return false;
  if (!state.kinds.includes(edges.domKind[i]!)) return false;
  if (!state.types.includes(laws.type[edges.src[i]!]!)) return false;
  if (!state.types.includes(laws.type[edges.tgt[i]!]!)) return false;
  if (state.hideIntraFamily && edges.intraFamily[i] === 1) return false;
  return true;
}

export function countVisibleEdges(
  edges: LawEdgesFile,
  laws: LawsFile,
  state: Pick<AtlasUrlState, 'kinds' | 'parts' | 'types' | 'minRefs'> & { hideIntraFamily: boolean },
): number {
  let n = 0;
  for (let i = 0; i < edges.n; i++) if (isEdgeVisible(edges, laws, i, state)) n++;
  return n;
}

/** 近い線の重み下限。Δ≤0 は 5。`max(1, 5−2Δ)` を切り上げ。 */
export function nearWeightFloor(delta: number): number {
  if (delta <= 0) return 5;
  return Math.max(1, Math.ceil(5 - 2 * delta));
}

/** 遠い線の重み下限。`20 × 4^(Δ − 1)`（Δ=1で20、2で80、2.5で160、3で320）。 */
export function farWeightFloor(delta: number): number {
  return 20 * 4 ** (delta - 1);
}

export function worldScreenDiagonal(width: number, height: number, zoom: number): number {
  const s = 2 ** zoom;
  return Math.hypot(width / s, height / s);
}

/** Δ≤0.5 では ∞（近い線の層だけ）。それ以外は画面対角線の世界長 × 0.6。 */
export function lodLengthCutoff(width: number, height: number, zoom: number, fitZoom: number): number {
  const delta = zoom - fitZoom;
  if (delta <= 0.5) return INF;
  return worldScreenDiagonal(width, height, zoom) * 0.6;
}

function weightChannels(parts: AtlasUrlState['parts'], floor: number): [number, number][] {
  const all: [number, number] = [-INF, INF];
  const min: [number, number] = [floor, INF];
  if (parts === 'main') return [min, all, all];
  if (parts === 'suppl') return [all, min, all];
  return [all, all, min];
}

export function gpuFilterRangeNear(
  parts: AtlasUrlState['parts'],
  minRefs: number,
  lodMin: number,
  lz: number,
): [number, number][] {
  return [...weightChannels(parts, Math.max(minRefs, lodMin)), [-INF, lz]];
}

export function gpuFilterRangeFar(
  parts: AtlasUrlState['parts'],
  minRefs: number,
  lodMin: number,
  lz: number,
): [number, number][] {
  return [...weightChannels(parts, Math.max(minRefs, lodMin)), [lz + 1e-4, INF]];
}

export function lawLabelRankCut(zoom: number, fitZoom: number): number {
  return 150 * 4 ** (zoom - fitZoom);
}

/**
 * DataFilterExtension の binary getFilterCategory は _getCategoryKey を飛ばし、
 * raw の 0–7 がビットマスクと食い違って全線が消える。
 * 種類・法令種別・ファミリーは filterValue の重みを −1 にして range で落とす。
 */
export function maskFilterValue(
  filterValue: Float32Array,
  filterCategory: Uint8Array,
  n: number,
  kinds: number[],
  types: number[],
  hideIntraFamily: boolean,
): Float32Array {
  const kindOk = new Uint8Array(16);
  const typeOk = new Uint8Array(16);
  for (const k of kinds) if (k >= 0 && k < 16) kindOk[k] = 1;
  for (const t of types) if (t >= 0 && t < 16) typeOk[t] = 1;
  const out = new Float32Array(filterValue);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (
      !kindOk[filterCategory[o]!]
      || !typeOk[filterCategory[o + 1]!]
      || !typeOk[filterCategory[o + 2]!]
      || (hideIntraFamily && filterCategory[o + 3] === 1)
    ) {
      out[o] = -1;
      out[o + 1] = -1;
      out[o + 2] = -1;
    }
  }
  return out;
}

/** DataFilterExtension は binary だと _getCategoryKey を飛ばす。キーを 0..n-1 にして filterCategories と揃える。 */
const CATEGORY_SENTINEL = 31;

export function gpuFilterCategories(
  kinds: number[],
  types: number[],
  hideIntraFamily: boolean,
): number[][] {
  return [
    kinds.map((_, i) => i),
    types.map((_, i) => i),
    types.map((_, i) => i),
    hideIntraFamily ? [0] : [0, 1],
  ];
}

export function remapFilterCategory(
  raw: Uint8Array,
  n: number,
  kinds: number[],
  types: number[],
  hideIntraFamily: boolean,
): Uint32Array {
  const kindKey = new Int16Array(16).fill(-1);
  const typeKey = new Int16Array(16).fill(-1);
  for (let i = 0; i < kinds.length; i++) kindKey[kinds[i]!] = i;
  for (let i = 0; i < types.length; i++) typeKey[types[i]!] = i;
  const out = new Uint32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = kindKey[raw[i * 4]!]!;
    const ts = typeKey[raw[i * 4 + 1]!]!;
    const tt = typeKey[raw[i * 4 + 2]!]!;
    const fam = raw[i * 4 + 3]!;
    out[i * 4] = k < 0 ? CATEGORY_SENTINEL : k;
    out[i * 4 + 1] = ts < 0 ? CATEGORY_SENTINEL : ts;
    out[i * 4 + 2] = tt < 0 ? CATEGORY_SENTINEL : tt;
    out[i * 4 + 3] = hideIntraFamily && fam === 1 ? CATEGORY_SENTINEL : fam;
  }
  return out;
}
