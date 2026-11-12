import { describe, expect, it } from 'vitest';
import { collectAliases, makeLabel } from '../../src/graph/labels.ts';

describe('makeLabel', () => {
  it('uses first shorter abbrev', () => {
    expect(makeLabel('地方自治法', ['自治法', '地自法'])).toBe('自治法');
  });

  it('falls back to title when abbrev is longer', () => {
    expect(makeLabel('民法', ['民法及び関連法令の略称'])).toBe('民法');
  });

  it('uses paren name for era-prefixed titles', () => {
    expect(makeLabel('明治五年太政官布告第三百三十七号（改暦ノ布告）', [])).toBe('改暦ノ布告');
    expect(makeLabel('明治五年太政官布告第三百三十七号（改暦ノ布告）', ['暦'])).toBe('暦');
  });

  it('truncates over 16 chars', () => {
    const title = 'あいうえおかきくけこさしすせそたち';
    expect(makeLabel(title, [])).toBe('あいうえおかきくけこさしすせそ…');
    expect(makeLabel(title, []).length).toBe(16);
  });
});

describe('collectAliases', () => {
  it('dedupes and caps at 8', () => {
    const a = collectAliases({
      title: '民法',
      egovAbbrevs: ['民法', '民'],
      jlawAliases: ['民', '民法'],
      bodyAliases: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    });
    expect(a[0]).toBe('民');
    expect(a).not.toContain('民法');
    expect(a.length).toBeLessThanOrEqual(8);
  });
});
