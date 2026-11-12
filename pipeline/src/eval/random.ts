export { mulberry32, sampleIndices } from '../lib/random.ts';

export const EVAL_SEED = 20261008;

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function pickN<T>(items: readonly T[], n: number, rng: () => number): T[] {
  return shuffle(items, rng).slice(0, n);
}
