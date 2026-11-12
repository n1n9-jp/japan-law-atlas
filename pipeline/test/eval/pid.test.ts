import { describe, expect, it } from 'vitest';
import { articlePid, isIgnoredPredMention, isRelativeMention, pidStartsWith } from '../../src/eval/pid.ts';
import { parseJlawArticle } from '../../src/eval/jlaw-sample.ts';

describe('articlePid', () => {
  it('cuts at the article segment', () => {
    expect(articlePid('m.a398_2.p1.i1')).toBe('m.a398_2');
    expect(articlePid('s1.a1.p1')).toBe('s1.a1');
    expect(articlePid('m.p1')).toBe('m.p1');
    expect(articlePid(null)).toBeNull();
  });
});

describe('parseJlawArticle', () => {
  it('maps 第7-2条 to m.a7_2', () => {
    expect(parseJlawArticle('第7-2条')).toBe('m.a7_2');
    expect(parseJlawArticle('第61条')).toBe('m.a61');
  });
});

describe('isRelativeMention', () => {
  it('detects 前条 and 同項', () => {
    expect(isRelativeMention('前条')).toBe(true);
    expect(isRelativeMention('同項')).toBe(true);
    expect(isRelativeMention('前各項')).toBe(true);
    expect(isRelativeMention('前二条')).toBe(true);
    expect(isRelativeMention('民法')).toBe(false);
  });
});

describe('isIgnoredPredMention', () => {
  it('drops この法律 and 各号 only', () => {
    expect(isIgnoredPredMention('この法律')).toBe(true);
    expect(isIgnoredPredMention('本法')).toBe(true);
    expect(isIgnoredPredMention('各号')).toBe(true);
    expect(isIgnoredPredMention('この法律第三条')).toBe(false);
    expect(isIgnoredPredMention('同項ただし書')).toBe(false);
  });
});

describe('pidStartsWith', () => {
  it('treats article-only gold as coarser than paragraph pred', () => {
    expect(pidStartsWith('m.a3.p1', 'm.a3')).toBe(true);
    expect(pidStartsWith('m.a3', 'm.a3.p1')).toBe(false);
  });
});
