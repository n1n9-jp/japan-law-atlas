export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleIndices(length: number, n: number, rng: () => number): number[] {
  const take = Math.min(n, length);
  const idx = Array.from({ length }, (_, i) => i);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (length - i));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx.slice(0, take);
}
