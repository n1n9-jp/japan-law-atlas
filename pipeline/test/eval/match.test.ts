import { describe, expect, it } from 'vitest';
import { greedyMatch, overlapLen, spansHalfOverlap } from '../../src/eval/match.ts';

describe('spansHalfOverlap', () => {
  it('matches identical spans', () => {
    expect(spansHalfOverlap({ start: 0, end: 10 }, { start: 0, end: 10 })).toBe(true);
  });

  it('matches when each span is at least half covered', () => {
    expect(spansHalfOverlap({ start: 0, end: 10 }, { start: 0, end: 6 })).toBe(true);
    expect(overlapLen({ start: 0, end: 10 }, { start: 0, end: 6 })).toBe(6);
  });

  it('rejects when overlap is less than half of the longer span', () => {
    expect(spansHalfOverlap({ start: 0, end: 10 }, { start: 0, end: 4 })).toBe(false);
    expect(overlapLen({ start: 0, end: 10 }, { start: 0, end: 4 })).toBe(4);
  });

  it('rejects disjoint spans', () => {
    expect(spansHalfOverlap({ start: 0, end: 5 }, { start: 5, end: 10 })).toBe(false);
  });
});

describe('greedyMatch', () => {
  it('pairs largest overlap first and keeps 1-1', () => {
    const gold = [
      { start: 0, end: 10, id: 'g0' },
      { start: 5, end: 15, id: 'g1' },
    ];
    const pred = [{ start: 0, end: 12, id: 'p0' }];
    const pairs = greedyMatch(gold, pred);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.gold.id).toBe('g0');
    expect(pairs[0]?.overlap).toBe(10);
  });
});
