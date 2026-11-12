import { describe, expect, it } from 'vitest';
import { buildDict } from '../../src/extract/dict.js';
import { normalizeLawNum, parseKansuji } from '../../src/extract/kansuji.js';
import { maskQuotes, parenDepths } from '../../src/extract/preprocess.js';
import { parseProvision, parseRelativeWord, resolveRelative } from '../../src/extract/provision.js';
import { Trie } from '../../src/extract/trie.js';
import { fnv1a32, shardOf } from '../../src/extract/hash.js';
import { CATALOG } from './helpers.js';

describe('kansuji', () => {
  it.each([
    ['元', 1],
    ['十', 10],
    ['二十三', 23],
    ['百二', 102],
    ['千九百', 1900],
    ['〇', 0],
    ['三十二', 32],
    ['二十六', 26],
    ['八十九', 89],
    ['三百九十八', 398],
  ])('%s → %s', (raw, n) => {
    expect(parseKansuji(raw)).toBe(n);
  });

  it('normalizes law numbers', () => {
    expect(normalizeLawNum('昭和三十二年法律第二十六号')).toBe('昭和32年法律第26号');
    expect(normalizeLawNum('明治二十九年法律第八十九号')).toBe('明治29年法律第89号');
    expect(normalizeLawNum('平成十五年法律第五十七号')).toBe('平成15年法律第57号');
  });
});

describe('provision parser', () => {
  it('parses 第三条の二第三項第一号イ', () => {
    const h = parseProvision('第三条の二第三項第一号イ', 0, 'm.a1.p1');
    expect(h?.tgtPid).toBe('m.a3_2.p3.i1.i1');
  });
  it('parses range から', () => {
    const h = parseProvision('第三条から第五条まで', 0, 'm.a1.p1');
    expect(h?.tgtPid).toBe('m.a3');
    expect(h?.tgtEnd).toBe('m.a5');
  });
  it('parses 乃至', () => {
    const h = parseProvision('第二十五条乃至第二十九条', 0, 'm.a1.p1');
    expect(h?.tgtPid).toBe('m.a25');
    expect(h?.tgtEnd).toBe('m.a29');
  });
  it('parses 附則第三条', () => {
    expect(parseProvision('附則第三条', 0, 'm.a1.p1')?.tgtPid).toBe('s1.a3');
  });
  it('parses 附則第三条 in supplAmend s2', () => {
    expect(parseProvision('附則第三条', 0, 's2.a1.p1', { fusokuRoot: 's2' })?.tgtPid).toBe('s2.a3');
  });
  it('reads only one iroha after 号 (ホニ)', () => {
    const h = parseProvision('第一号ホニ規定スル', 0, 'm.a1.p1');
    expect(h?.tgtPid).toBe('m.a1.p1.i1.i5');
    expect(h?.end).toBe('第一号ホ'.length);
  });
  it('parses 別表第一', () => {
    expect(parseProvision('別表第一', 0, 'm.a1.p1')?.tgtPid).toBe('t1');
  });
  it('parses 第二十九条の四の二', () => {
    expect(parseProvision('第二十九条の四の二第八項', 0, 'm.a1.p1')?.tgtPid).toBe('m.a29_4_2.p8');
  });
  it('parses relative 前二条', () => {
    expect(parseRelativeWord('前二条の規定は', 0)?.word).toBe('前二条');
  });
});

describe('mask quotes', () => {
  it('masks inner 「第三条」', () => {
    const t = '前条中「第三条」とあるのは';
    const m = maskQuotes(t);
    expect(m.includes('第三条')).toBe(false);
    expect(m.startsWith('前条中「')).toBe(true);
  });
  it('keeps nested lengths', () => {
    const t = '「甲「乙」丙」';
    expect(maskQuotes(t).length).toBe(t.length);
  });
});

describe('paren depth', () => {
  it('tracks depth', () => {
    const t = '甲（乙（丙）丁）';
    const d = parenDepths(t);
    expect(d[2]).toBe(1);
    expect(d[4]).toBe(2);
  });
});

describe('trie', () => {
  it('longest match prefers 民法施行法 over 民法', () => {
    const t = new Trie<string>();
    t.insert('民法', 'a');
    t.insert('民法施行法', 'b');
    expect(t.longestMatch('民法施行法第二条', 0)).toEqual({ end: 5, value: 'b' });
  });
});

describe('dict name filter', () => {
  it('drops 監督 fragments and keeps 民法', () => {
    const dict = buildDict(
      [
        ...CATALOG,
        {
          lawId: '999AC0000000001',
          title: '仮想監督法',
          abbrevs: ['許可', '対象事業者'],
          oldTitles: ['監督', '旧仮想監督法、監督'],
          num: '',
          numNorm: '',
          lawType: 'Act',
          status: 'current',
        },
      ],
      { aliasToTitle: new Map([['監督', '仮想監督法']]) },
    );
    expect(dict.longestName('監督処分', 0)).toBeNull();
    expect(dict.longestName('民法第九十条', 0)?.hit.title).toBe('民法');
    expect(dict.stats.droppedNames).toBeGreaterThan(0);
  });
});

describe('relative count-by-number', () => {
  it('counts 前条 by article number in 抄', () => {
    const hit = resolveRelative('前条', 's77.a3.p1', [{ pid: 's77.a1' }, { pid: 's77.a3' }]);
    expect(hit.tgtPid).toBe('s77.a2');
    expect(hit.countedByNumber).toBe(true);
  });
  it('counts 次条 by article number in 抄', () => {
    const hit = resolveRelative('次条', 's90.a1.p1', [{ pid: 's90.a1' }, { pid: 's90.a4' }]);
    expect(hit.tgtPid).toBe('s90.a2');
    expect(hit.countedByNumber).toBe(true);
  });
});

describe('fnv shard', () => {
  it('is stable', () => {
    expect(shardOf('129AC0000000089')).toBe(fnv1a32('129AC0000000089') % 32);
    expect(shardOf('129AC0000000089')).toBe(shardOf('129AC0000000089'));
  });
});
