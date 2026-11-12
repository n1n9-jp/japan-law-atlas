import { describe, expect, it } from 'vitest';
import { buildCorpusLaw } from '../../src/corpus/build-law.ts';
import { xmlToEgovNode } from '../../src/corpus/xml-to-tree.ts';
import type { LawMeta } from '../../lib/corpus-types.ts';

const baseMeta: Omit<LawMeta, 'articleCount' | 'supplCount' | 'hasEnact'> = {
  lawId: 'TEST',
  revisionId: 'TEST_REV',
  title: '試験法',
  kana: 'しけんほう',
  abbrevs: [],
  oldTitles: [],
  num: '令和元年法律第一号',
  numNorm: '令和1年法律第1号',
  lawType: 'Act',
  rawLawType: 'Act',
  category: '民事',
  promulgationDate: '2019-01-01',
  enforcementDate: '2019-01-01',
  status: 'current',
  repealDate: null,
  source: 'zip',
};

describe('part classification', () => {
  it('treats EnactStatement as one enact sentence without collectSentences numbering from main', () => {
    const xml = `<?xml version="1.0"?><Law><LawBody>
      <LawTitle Abbrev="試">試験法</LawTitle>
      <EnactStatement>内閣は、この政令を制定する。</EnactStatement>
      <MainProvision><Article Num="1"><ArticleTitle>第一条</ArticleTitle><Paragraph Num="1"><Sentence>本則。</Sentence></Paragraph></Article></MainProvision>
    </LawBody></Law>`;
    const law = buildCorpusLaw(xmlToEgovNode(xml), { ...baseMeta });
    expect(law.meta.hasEnact).toBe(true);
    expect(law.meta.abbrevs).toContain('試');
    expect(law.sentences.filter((s) => s.part === 'enact')).toEqual([
      expect.objectContaining({ pid: 'e', sent: 1, text: '内閣は、この政令を制定する。' }),
    ]);
    expect(law.sentences.filter((s) => s.part === 'main')[0]).toMatchObject({ pid: 'm.a1.p1', text: '本則。' });
  });

  it('marks SupplProvision with AmendLawNum as supplAmend', () => {
    const xml = `<Law><LawBody>
      <MainProvision><Article Num="1"><Paragraph Num="1"><Sentence>本則。</Sentence></Paragraph></Article></MainProvision>
      <SupplProvision AmendLawNum="昭和四四年四月八日政令第八六号">
        <Article Num="1"><ArticleTitle>第一条</ArticleTitle><Paragraph Num="1"><Sentence>改正附則。</Sentence></Paragraph></Article>
      </SupplProvision>
    </LawBody></Law>`;
    const law = buildCorpusLaw(xmlToEgovNode(xml), { ...baseMeta });
    expect(law.meta.supplCount).toBe(1);
    expect(law.articles.map((a) => a.pid)).toEqual(['m.a1', 's1.a1']);
    expect(law.articles[1]).toMatchObject({ part: 'supplAmend', pid: 's1.a1' });
    expect(law.sentences.find((s) => s.pid === 's1.a1.p1')).toMatchObject({
      part: 'supplAmend',
      supplIndex: 1,
      amendLawNum: '昭和四四年四月八日政令第八六号',
    });
  });

  it('numbers appendix inside a supplementary provision as s<k>.t<j>', () => {
    const xml = `<Law><LawBody>
      <MainProvision><Paragraph Num="1"><Sentence>本則。</Sentence></Paragraph></MainProvision>
      <SupplProvision>
        <Article Num="1"><Paragraph Num="1"><Sentence>附則。</Sentence></Paragraph></Article>
        <AppdxTable>
          <AppdxTableTitle>別表第一（第一条関係）</AppdxTableTitle>
          <TableStruct><Table><TableRow><TableColumn><Sentence>表の文</Sentence></TableColumn></TableRow></Table></TableStruct>
        </AppdxTable>
      </SupplProvision>
    </LawBody></Law>`;
    const law = buildCorpusLaw(xmlToEgovNode(xml), { ...baseMeta });
    expect(law.appdx).toEqual([{ pid: 's1.t1', title: '別表第一（第一条関係）' }]);
    expect(law.sentences.find((s) => s.text === '表の文')).toMatchObject({
      pid: 's1.t1',
      part: 'appdx',
      inTable: true,
      supplIndex: 1,
    });
    expect(law.sentences.find((s) => s.text === '附則。')).toMatchObject({ part: 'suppl', pid: 's1.a1.p1' });
  });
});
