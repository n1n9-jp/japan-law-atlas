import { createHash } from 'node:crypto';

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function sigFigs(x: number, n = 4): number {
  if (x === 0 || !Number.isFinite(x)) return 0;
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const f = 10 ** (n - 1 - exp);
  return Math.round(x * f) / f;
}

export function naturalCmp(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const pa = a.match(re) ?? [a];
  const pb = b.match(re) ?? [b];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const xa = pa[i] ?? '';
    const xb = pb[i] ?? '';
    const na = /^\d+$/.test(xa);
    const nb = /^\d+$/.test(xb);
    if (na && nb) {
      const d = Number(xa) - Number(xb);
      if (d !== 0) return d;
      if (xa.length !== xb.length) return xa.length - xb.length;
    } else if (xa !== xb) {
      return xa < xb ? -1 : 1;
    }
  }
  return 0;
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function withSeededRandom<T>(rng: () => number, fn: () => T): T {
  const orig = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

export function pairKey(src: string, tgt: string): string {
  return `${src}\t${tgt}`;
}

export function dateToYyyymmdd(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return 0;
  return Number(`${m[1]}${m[2]}${m[3]}`);
}
