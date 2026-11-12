import { describe, expect, it } from 'vitest';
import { kansujiToInt, normalizeLawNum } from '../../src/lib/kansuji.ts';

describe('kansujiToInt', () => {
  it('converts the specified cases', () => {
    expect(kansujiToInt('元')).toBe(1);
    expect(kansujiToInt('十')).toBe(10);
    expect(kansujiToInt('二十三')).toBe(23);
    expect(kansujiToInt('百二')).toBe(102);
    expect(kansujiToInt('千九百')).toBe(1900);
    expect(kansujiToInt('〇')).toBe(0);
  });
});

describe('normalizeLawNum', () => {
  it('turns 民法 into arabic numerals and strips spaces', () => {
    expect(normalizeLawNum('明治二十九年法律第八十九号')).toBe('明治29年法律第89号');
    expect(normalizeLawNum('平成十五年法律第五十七号')).toBe('平成15年法律第57号');
    expect(normalizeLawNum('明治五年太政官布告第三百三十七号')).toBe('明治5年太政官布告第337号');
  });
});
