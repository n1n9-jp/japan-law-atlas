import { describe, expect, it } from 'vitest';
import { findMention } from '../lib/mention';

describe('findMention', () => {
  const sentences = [
    { pid: 'm.a3.p1', sent: 1, text: 'この法律は、民法第九十条の規定により無効とする。', inTable: false },
    { pid: 'm.a3.p1', sent: 2, text: '前項の場合においては、会社法を準用する。', inTable: false },
    { pid: 'm.a4.p1', sent: 1, text: '民法第九十条', inTable: false },
  ];

  it('指定した文から mention を探す', () => {
    const hit = findMention(sentences, 'm.a3.p1#1', '民法第九十条');
    expect(hit?.sent).toBe(1);
    expect(hit?.pid).toBe('m.a3.p1');
    expect(sentences[0]!.text.slice(hit!.start, hit!.end)).toBe('民法第九十条');
  });

  it('文に無ければ同じ pid、さらに条全体から探す', () => {
    const hit = findMention(sentences, 'm.a3.p1#1', '会社法');
    expect(hit?.sent).toBe(2);
  });

  it('見つからなければ null', () => {
    expect(findMention(sentences, 'm.a3.p1#1', '存在しない言及')).toBeNull();
  });
});
