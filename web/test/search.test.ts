import { describe, expect, it } from 'vitest';
import { normalizeQuery, searchLaws } from '../lib/search';
import type { LawsFile } from '../lib/shared/contract';

function emptyLaws(n: number): LawsFile {
  const z = () => Array.from({ length: n }, () => 0);
  const s = () => Array.from({ length: n }, () => '');
  return {
    n, id: s(), revisionId: s(), title: s(), label: s(), kana: s(), num: s(), numNorm: s(),
    aliases: Array.from({ length: n }, () => []), type: z(), category: z(), promulgated: z(),
    status: z(), x: z(), y: z(), r: z(), articles: z(), inLaws: z(), outLaws: z(), inRefs: z(),
    outRefs: z(), pagerank: z(), prRank: z(), parent: z(), family: z(), community: z(),
    bridge: z(), delegations: z(),
  };
}

describe('normalizeQuery', () => {
  it('NFKC・空白除去・カナ→ひらがな・漢数字', () => {
    expect(normalizeQuery('　ミンポウ  ')).toBe('みんぽう');
    expect(normalizeQuery('平成十五年法律第五十七号')).toBe('平成15年法律第57号');
  });
});

describe('searchLaws', () => {
  const laws = emptyLaws(4);
  laws.id = ['a', 'b', 'c', 'd'];
  laws.title = ['民法', '商法', '個人情報の保護に関する法律', '刑法'];
  laws.label = ['民法', '商法', '個人情報保護法', '刑法'];
  laws.kana = ['みんぽう', 'しょうほう', 'こじんじょうほうのほごにかんするほうりつ', 'けいほう'];
  laws.num = ['明治二十九年法律第八十九号', '明治三十二年法律第四十八号', '平成十五年法律第五十七号', '明治四十年法律第四十五号'];
  laws.numNorm = ['明治29年法律第89号', '明治32年法律第48号', '平成15年法律第57号', '明治40年法律第45号'];
  laws.aliases = [[], [], ['個人情報保護法'], []];
  laws.prRank = [1, 5, 8, 3];

  it('みんぽう → 民法が1位', () => {
    const hits = searchLaws(laws, 'みんぽう');
    expect(laws.title[hits[0]!.index]).toBe('民法');
  });

  it('個人情報保護法 → 上位3位以内', () => {
    const hits = searchLaws(laws, '個人情報保護法');
    expect(hits.slice(0, 3).map((h) => laws.title[h.index])).toContain('個人情報の保護に関する法律');
  });

  it('平成15年法律第57号 → 1位', () => {
    const hits = searchLaws(laws, '平成15年法律第57号');
    expect(laws.title[hits[0]!.index]).toBe('個人情報の保護に関する法律');
  });
});
