import { describe, expect, it } from 'vitest';
import { defaultUrlState, parseUrlState, serializeUrlState } from '../lib/url-state';

describe('url-state', () => {
  it('defaults serialize to empty', () => {
    expect(serializeUrlState(defaultUrlState())).toBe('');
  });

  it('roundtrips selection and filters', () => {
    const src = {
      ...defaultUrlState(),
      law: '129AC0000000089',
      edge: { src: 'A', tgt: 'B' },
      kinds: [0, 1, 7],
      parts: 'all' as const,
      types: [1, 2],
      minRefs: 3,
      color: 'kind' as const,
      focus: { kind: 'group' as const, id: 2 },
      view: { x: 12.4, y: -8.6, zoom: 1.234 },
    };
    const q = serializeUrlState(src);
    const back = parseUrlState(q);
    expect(back.law).toBe(src.law);
    expect(back.edge).toEqual(src.edge);
    expect(back.kinds).toEqual(src.kinds);
    expect(back.parts).toBe('all');
    expect(back.types).toEqual(src.types);
    expect(back.minRefs).toBe(3);
    expect(back.color).toBe('kind');
    expect(back.focus).toEqual({ kind: 'group', id: 2 });
    expect(back.view?.x).toBe(12);
    expect(back.view?.y).toBe(-9);
    expect(back.view?.zoom).toBeCloseTo(1.23, 5);
  });
});
