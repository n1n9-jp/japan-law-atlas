export interface BundleInput {
  nLaws: number;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  category: ArrayLike<number>;
  nEdges: number;
  src: ArrayLike<number>;
  tgt: ArrayLike<number>;
  categoryCount: number;
}

export interface BundleResult {
  positions: Float32Array;
  startIndices: Uint32Array;
  categoryCenters: Float32Array;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cubic(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  t: number,
): [number, number] {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const x = uu * u * p0x + 3 * uu * t * p1x + 3 * u * tt * p2x + tt * t * p3x;
  const y = uu * u * p0y + 3 * uu * t * p1y + 3 * u * tt * p2y + tt * t * p3y;
  return [x, y];
}

function quad(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  t: number,
): [number, number] {
  const u = 1 - t;
  const x = u * u * p0x + 2 * u * t * p1x + t * t * p2x;
  const y = u * u * p0y + 2 * u * t * p1y + t * t * p2y;
  return [x, y];
}

export function categoryCenters(
  nLaws: number,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  category: ArrayLike<number>,
  categoryCount: number,
): Float32Array {
  const sx = new Float64Array(categoryCount);
  const sy = new Float64Array(categoryCount);
  const c = new Float64Array(categoryCount);
  for (let i = 0; i < nLaws; i++) {
    const k = category[i]!;
    if (k < 0 || k >= categoryCount) continue;
    sx[k] += x[i]!;
    sy[k] += y[i]!;
    c[k] += 1;
  }
  const out = new Float32Array(categoryCount * 2);
  for (let k = 0; k < categoryCount; k++) {
    const n = c[k] || 1;
    out[k * 2] = sx[k]! / n;
    out[k * 2 + 1] = sy[k]! / n;
  }
  return out;
}

export function bundleEdges(input: BundleInput): BundleResult {
  const { nLaws, x, y, category, nEdges, src, tgt, categoryCount } = input;
  const centers = categoryCenters(nLaws, x, y, category, categoryCount);
  const startIndices = new Uint32Array(nEdges + 1);
  const positions = new Float32Array(nEdges * 17 * 2);
  let total = 0;
  const beta = 0.8;

  for (let e = 0; e < nEdges; e++) {
    const s = src[e]!;
    const t = tgt[e]!;
    const psx = x[s]!;
    const psy = y[s]!;
    const ptx = x[t]!;
    const pty = y[t]!;
    const cs = category[s]!;
    const ct = category[t]!;
    startIndices[e] = total;
    let off = total * 2;
    if (cs !== ct) {
      const ccsx = centers[cs * 2]!;
      const ccsy = centers[cs * 2 + 1]!;
      const cctx = centers[ct * 2]!;
      const ccty = centers[ct * 2 + 1]!;
      const p1x = beta * ccsx + (1 - beta) * lerp(psx, ptx, 1 / 3);
      const p1y = beta * ccsy + (1 - beta) * lerp(psy, pty, 1 / 3);
      const p2x = beta * cctx + (1 - beta) * lerp(psx, ptx, 2 / 3);
      const p2y = beta * ccty + (1 - beta) * lerp(psy, pty, 2 / 3);
      for (let i = 0; i <= 16; i++) {
        const [bx, by] = cubic(psx, psy, p1x, p1y, p2x, p2y, ptx, pty, i / 16);
        positions[off++] = bx;
        positions[off++] = by;
      }
      total += 17;
    } else {
      const dx = ptx - psx;
      const dy = pty - psy;
      const len = Math.hypot(dx, dy) || 1;
      const cpx = (psx + ptx) / 2 + (-dy / len) * 0.15 * len;
      const cpy = (psy + pty) / 2 + (dx / len) * 0.15 * len;
      for (let i = 0; i <= 8; i++) {
        const [bx, by] = quad(psx, psy, cpx, cpy, ptx, pty, i / 8);
        positions[off++] = bx;
        positions[off++] = by;
      }
      total += 9;
    }
  }
  startIndices[nEdges] = total;
  return { positions: positions.subarray(0, total * 2), startIndices, categoryCenters: centers };
}

export function edgeWidth(mainRefs: number): number {
  return Math.min(3, 0.6 + 0.25 * Math.log2(1 + mainRefs));
}
