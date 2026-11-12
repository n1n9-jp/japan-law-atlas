import { describe, expect, it } from 'vitest';
import { comparePairSets } from '../../src/eval/pairs.ts';

describe('comparePairSets', () => {
  it('restricts to laws present on both sides', () => {
    const ours = new Set(['A\tB', 'A\tC', 'D\tE']);
    const theirs = new Set(['A\tB', 'A\tZ', 'X\tY']);
    const got = comparePairSets(ours, theirs, new Set(['A', 'B', 'C', 'D', 'E']), new Set(['A', 'B', 'Z', 'X', 'Y']));
    expect(got.lawsInBoth).toBe(2);
    expect(got.both).toBe(1);
    expect(got.ours).toBe(1);
    expect(got.theirs).toBe(1);
    expect(got.oursOnly).toBe(0);
    expect(got.theirsOnly).toBe(0);
  });
});
