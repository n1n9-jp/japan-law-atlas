import { describe, expect, it } from 'vitest';
import { addRefToPair, dominantKind, emptyKindCounts, newPair, pickDomKind } from '../../src/graph/edges.ts';
import { REF_KINDS } from '../../lib/shared/contract.ts';

describe('dominantKind ties', () => {
  it('picks the earlier REF_KINDS on a tie', () => {
    const c = emptyKindCounts();
    c[REF_KINDS.indexOf('cite')] = 3;
    c[REF_KINDS.indexOf('junyo')] = 3;
    c[REF_KINDS.indexOf('term')] = 2;
    expect(REF_KINDS[dominantKind(c)]).toBe('junyo');
  });

  it('uses 本則系 counts when mainRefs > 0', () => {
    const p = newPair('A', 'B');
    addRefToPair(p, 'suppl', 'basis');
    addRefToPair(p, 'suppl', 'basis');
    addRefToPair(p, 'main', 'cite');
    addRefToPair(p, 'main', 'cite');
    expect(pickDomKind(p.mainRefs, p.kindMain, p.kindSuppl)).toBe(REF_KINDS.indexOf('cite'));
  });

  it('uses 附則系 when mainRefs is 0', () => {
    const p = newPair('A', 'B');
    addRefToPair(p, 'suppl', 'junyo');
    addRefToPair(p, 'supplAmend', 'cite');
    expect(p.mainRefs).toBe(0);
    expect(pickDomKind(p.mainRefs, p.kindMain, p.kindSuppl)).toBe(REF_KINDS.indexOf('junyo'));
  });
});
