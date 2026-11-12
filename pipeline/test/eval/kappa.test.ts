import { describe, expect, it } from 'vitest';
import { cohenKappa, spanAgreement } from '../../src/eval/kappa.ts';
import type { GoldRef, GoldSentence } from '../../src/eval/types.ts';

describe('cohenKappa', () => {
  it('is 1 for perfect agreement', () => {
    expect(cohenKappa(['cite', 'junyo'], ['cite', 'junyo'])).toBe(1);
  });

  it('matches the two-category hand calculation', () => {
    const a = ['cite', 'cite', 'junyo', 'junyo'];
    const b = ['cite', 'junyo', 'junyo', 'junyo'];
    const po = 3 / 4;
    const pe = (2 / 4) * (1 / 4) + (2 / 4) * (3 / 4);
    expect(cohenKappa(a, b)).toBeCloseTo((po - pe) / (1 - pe), 10);
  });
});

describe('spanAgreement', () => {
  const sent: GoldSentence = {
    gid: 'g001',
    lawId: 'A',
    pid: 'm.a1.p1',
    sent: 1,
    part: 'main',
    text: 'xxxxx',
    articleText: 'xxxxx',
    stratum: 'Act|main',
  };
  const ref = (start: number, end: number): GoldRef => ({
    start,
    end,
    mention: 'x'.repeat(end - start),
    tgtLaw: null,
    tgtStatus: 'unknown',
    tgtPid: null,
    tgtEnd: null,
    kind: 'cite',
    yomikae: false,
  });

  it('is Dice over span matches; empty vs empty is 1', () => {
    expect(spanAgreement([sent], new Map([['g001', []]]), new Map([['g001', []]]))).toBe(1);
    const a = [ref(0, 4)];
    const b = [ref(0, 4), ref(6, 8)];
    expect(spanAgreement([sent], new Map([['g001', a]]), new Map([['g001', b]]))).toBeCloseTo(2 / 3, 10);
  });
});
