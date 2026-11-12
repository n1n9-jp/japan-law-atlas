import { CATEGORY_NAMES, GROUP_DEFS, groupIdForCategory } from './categories.ts';
import { mulberry32 } from '../lib/random.ts';
import type { PairAgg } from './edges.ts';
import type { NodeRec } from './types.ts';

export interface CircleLayout {
  x: number[];
  y: number[];
  rho: number[];
  seed: number;
  adjFlowShare: number;
  groupContig: number;
}

export interface CircleOptions {
  iterations?: number;
  seeds?: number[];
}

const N = CATEGORY_NAMES.length;
const GAP = 25;

export function flowMatrix(nodes: NodeRec[], pairs: PairAgg[]): number[][] {
  const catOf = new Map(nodes.map((n) => [n.lawId, n.category]));
  const F = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (const p of pairs) {
    if (p.mainRefs <= 0) continue;
    const i = catOf.get(p.srcLaw);
    const j = catOf.get(p.tgtLaw);
    if (i === undefined || j === undefined || i === j) continue;
    F[i]![j]! += p.mainRefs;
    F[j]![i]! += p.mainRefs;
  }
  return F;
}

export function circleRadii(nodes: NodeRec[]): number[] {
  const n = new Array<number>(N).fill(0);
  for (const node of nodes) n[node.category] = (n[node.category] ?? 0) + 1;
  return n.map((c) => 10 * Math.sqrt(c));
}

export function adjacencyStats(x: number[], y: number[], rho: number[], F: number[][]): {
  adjFlowShare: number;
  groupContig: number;
} {
  let flowAll = 0;
  let flowAdj = 0;
  const hasGroupNbr = new Array<boolean>(N).fill(false);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const f = F[i]![j]!;
      flowAll += f;
      const d = Math.hypot(x[i]! - x[j]!, y[i]! - y[j]!);
      const gap = d - rho[i]! - rho[j]!;
      if (gap < GAP) {
        flowAdj += f;
        if (groupIdForCategory(i) === groupIdForCategory(j)) {
          hasGroupNbr[i] = true;
          hasGroupNbr[j] = true;
        }
      }
    }
  }
  const contig = hasGroupNbr.filter(Boolean).length / N;
  return { adjFlowShare: flowAll > 0 ? flowAdj / flowAll : 0, groupContig: contig };
}

function springsOf(F: number[][]): { i: number; j: number; k: number }[] {
  const T = F.map((row) => row.reduce((s, v) => s + v, 0));
  const a = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  let maxA = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const den = Math.sqrt(T[i]! * T[j]!);
      const v = den > 0 ? F[i]![j]! / den : 0;
      a[i]![j] = v;
      if (v > maxA) maxA = v;
    }
  }
  const kMap = new Map<string, number>();
  const add = (i: number, j: number, k: number) => {
    const a0 = Math.min(i, j);
    const b0 = Math.max(i, j);
    const key = `${a0}\t${b0}`;
    kMap.set(key, (kMap.get(key) ?? 0) + k);
  };
  if (maxA > 0) {
    const flowPairs = new Set<string>();
    for (let i = 0; i < N; i++) {
      const ranked = Array.from({ length: N }, (_, j) => j)
        .filter((j) => j !== i)
        .sort((p, q) => a[i]![q]! - a[i]![p]! || p - q)
        .slice(0, 5);
      for (const j of ranked) flowPairs.add(`${Math.min(i, j)}\t${Math.max(i, j)}`);
    }
    for (const key of flowPairs) {
      const [is, js] = key.split('\t');
      const i = Number(is);
      const j = Number(js);
      add(i, j, Math.sqrt(a[i]![j]! / maxA));
    }
  }
  let acc = 0;
  for (const g of GROUP_DEFS) {
    const ids = g.categories.map((_, k) => acc + k);
    acc += g.categories.length;
    for (let p = 0; p < ids.length; p++) {
      for (let q = p + 1; q < ids.length; q++) add(ids[p]!, ids[q]!, 1);
    }
  }
  const out: { i: number; j: number; k: number }[] = [];
  for (const [key, k] of kMap) {
    const [is, js] = key.split('\t');
    out.push({ i: Number(is), j: Number(js), k });
  }
  out.sort((p, q) => p.i - q.i || p.j - q.j);
  return out;
}

function gravityOf(F: number[][]): number[] {
  const T = F.map((row) => row.reduce((s, v) => s + v, 0));
  const mean = T.reduce((s, v) => s + v, 0) / N;
  return T.map((t) => (mean > 0 ? 0.01 * t / mean : 0));
}

function packOnce(
  seed: number,
  rho: number[],
  F: number[][],
  springs: { i: number; j: number; k: number }[],
  g: number[],
  iterations: number,
): { x: number[]; y: number[] } {
  const rng = mulberry32(seed);
  const x = new Array<number>(N);
  const y = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    x[i] = -150 + rng() * 300;
    y[i] = -150 + rng() * 300;
  }
  const Dx = new Array<number>(N);
  const Dy = new Array<number>(N);
  for (let t = 0; t < iterations; t++) {
    const s = 1 - t / iterations;
    const gamma = Math.min(1, 0.15 + t / 900);
    Dx.fill(0);
    Dy.fill(0);
    for (const sp of springs) {
      const dx = x[sp.j]! - x[sp.i]!;
      const dy = y[sp.j]! - y[sp.i]!;
      const d = Math.hypot(dx, dy);
      const L = gamma * (rho[sp.i]! + rho[sp.j]!);
      if (d < 1e-12) continue;
      const mag = 0.25 * sp.k * (d - L);
      const ux = dx / d;
      const uy = dy / d;
      Dx[sp.i]! += mag * ux;
      Dy[sp.i]! += mag * uy;
      Dx[sp.j]! -= mag * ux;
      Dy[sp.j]! -= mag * uy;
    }
    for (let i = 0; i < N; i++) {
      Dx[i]! -= g[i]! * x[i]!;
      Dy[i]! -= g[i]! * y[i]!;
      x[i]! += 0.5 * s * Dx[i]!;
      y[i]! += 0.5 * s * Dy[i]!;
    }
    collide(x, y, rho, gamma, 3);
  }
  return { x, y };
}

function collide(x: number[], y: number[], rho: number[], gamma: number, rounds: number): void {
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = x[i]! - x[j]!;
        let dy = y[i]! - y[j]!;
        let d = Math.hypot(dx, dy);
        const minD = 1.02 * gamma * (rho[i]! + rho[j]!);
        if (d >= minD) continue;
        if (d < 1e-12) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (minD - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        x[i]! += ux * push;
        y[i]! += uy * push;
        x[j]! -= ux * push;
        y[j]! -= uy * push;
      }
    }
  }
}

function resolveSwap(x: number[], y: number[], rho: number[]): void {
  for (let r = 0; r < 40; r++) {
    for (let i = 0; i < N; i++) {
      x[i]! *= 0.998;
      y[i]! *= 0.998;
    }
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = x[i]! - x[j]!;
        let dy = y[i]! - y[j]!;
        let d = Math.hypot(dx, dy);
        const minD = rho[i]! + rho[j]!;
        if (d >= minD) continue;
        if (d < 1e-12) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (minD - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        x[i]! += ux * push;
        y[i]! += uy * push;
        x[j]! -= ux * push;
        y[j]! -= uy * push;
      }
    }
  }
}

function extraLength(x: number[], y: number[], rho: number[], F: number[][]): number {
  let j = 0;
  for (let i = 0; i < N; i++) {
    for (let k = i + 1; k < N; k++) {
      const f = F[i]![k]!;
      if (f <= 0) continue;
      const d = Math.hypot(x[i]! - x[k]!, y[i]! - y[k]!);
      j += f * Math.max(0, d - rho[i]! - rho[k]!);
    }
  }
  return j;
}

function improveSwaps(x: number[], y: number[], rho: number[], F: number[][]): void {
  const groupPairs: [number, number][] = [];
  let acc = 0;
  for (const g of GROUP_DEFS) {
    const ids = g.categories.map((_, k) => acc + k);
    acc += g.categories.length;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) groupPairs.push([ids[i]!, ids[j]!]);
    }
  }
  for (let round = 0; round < 6; round++) {
    let accepted = false;
    for (const [i, j] of groupPairs) {
      const beforeJ = extraLength(x, y, rho, F);
      const bx = x.slice();
      const by = y.slice();
      const tx = x[i]!;
      const ty = y[i]!;
      x[i] = x[j]!;
      y[i] = y[j]!;
      x[j] = tx;
      y[j] = ty;
      resolveSwap(x, y, rho);
      const afterJ = extraLength(x, y, rho, F);
      if (beforeJ > 0 ? afterJ <= beforeJ * 0.999 : afterJ < beforeJ) {
        accepted = true;
      } else {
        for (let k = 0; k < N; k++) {
          x[k] = bx[k]!;
          y[k] = by[k]!;
        }
      }
    }
    if (!accepted) break;
  }
}

export function placeCategoryCircles(
  nodes: NodeRec[],
  pairs: PairAgg[],
  opts: CircleOptions = {},
): CircleLayout {
  const iterations = opts.iterations ?? 1500;
  const seeds = opts.seeds ?? Array.from({ length: 16 }, (_, i) => i + 1);
  const F = flowMatrix(nodes, pairs);
  const rho = circleRadii(nodes);
  const springs = springsOf(F);
  const g = gravityOf(F);

  let best: CircleLayout | null = null;
  let bestScore = -Infinity;
  for (const seed of seeds) {
    const packed = packOnce(seed, rho, F, springs, g, iterations);
    const x = packed.x;
    const y = packed.y;
    improveSwaps(x, y, rho, F);
    const stats = adjacencyStats(x, y, rho, F);
    const score = stats.adjFlowShare + 0.5 * stats.groupContig;
    if (score > bestScore + 1e-15 || (Math.abs(score - bestScore) <= 1e-15 && (best === null || seed < best.seed))) {
      bestScore = score;
      best = { x, y, rho, seed, adjFlowShare: stats.adjFlowShare, groupContig: stats.groupContig };
    }
  }
  return best!;
}
