import { describe, expect, it } from 'vitest';
import { collectSentences, type EgovNode } from '../../lib/shared/egov-tree.ts';
import { xmlToEgovNode } from '../../src/corpus/xml-to-tree.ts';

function parse(xml: string): EgovNode {
  return xmlToEgovNode(xml);
}

describe('collectSentences', () => {
  it('keeps ruby body and drops Rt', () => {
    const root = parse(
      `<Article Num="1"><Paragraph Num="1"><Sentence>この<Ruby>法律<Rt>ほうりつ</Rt></Ruby>は</Sentence></Paragraph></Article>`,
    );
    const s = collectSentences(root, 'm.a1');
    expect(s).toEqual([{ pid: 'm.a1.p1', sent: 1, text: 'この法律は', inTable: false }]);
  });

  it('keeps Sup contents', () => {
    const root = parse(`<MainProvision><Paragraph Num="1"><Sentence>M<Sup>2</Sup>乗</Sentence></Paragraph></MainProvision>`);
    const s = collectSentences(root, 'm');
    expect(s[0]).toMatchObject({ pid: 'm.p1', text: 'M2乗' });
  });

  it('marks table sentences and keeps outer pid', () => {
    const root = parse(
      `<MainProvision><Paragraph Num="1"><TableStruct><Table><TableRow><TableColumn><Sentence>一月大</Sentence></TableColumn></TableRow></Table></TableStruct></Paragraph></MainProvision>`,
    );
    const s = collectSentences(root, 'm');
    expect(s).toEqual([{ pid: 'm.p1', sent: 1, text: '一月大', inTable: true }]);
  });

  it('counts Column sentences under the outer address', () => {
    const root = parse(
      `<MainProvision><Paragraph Num="1"><Item Num="1"><ItemTitle>一</ItemTitle><ItemSentence><Column Num="1"><Sentence>甲</Sentence></Column><Column Num="2"><Sentence>乙</Sentence></Column></ItemSentence></Item></Paragraph></MainProvision>`,
    );
    const s = collectSentences(root, 'm.a1');
    expect(s.map((x) => x.pid)).toEqual(['m.a1.p1.i1', 'm.a1.p1.i1']);
    expect(s.map((x) => x.sent)).toEqual([1, 2]);
    expect(s.map((x) => x.text)).toEqual(['甲', '乙']);
  });

  it('stacks Subitem pids', () => {
    const root = parse(
      `<MainProvision><Paragraph Num="1"><Item Num="1"><Subitem1 Num="1"><Subitem1Title>イ</Subitem1Title><Subitem1Sentence><Sentence>イの文</Sentence></Subitem1Sentence></Subitem1></Item></Paragraph></MainProvision>`,
    );
    const s = collectSentences(root, 'm.a1');
    expect(s[0]).toMatchObject({ pid: 'm.a1.p1.i1.i1', text: 'イの文', sent: 1 });
  });

  it('starts from paragraphs when there is no article', () => {
    const root = parse(
      `<MainProvision><Paragraph Num="1"><ParagraphNum/><ParagraphSentence><Sentence>今般改暦</Sentence></ParagraphSentence></Paragraph></MainProvision>`,
    );
    const s = collectSentences(root, 'm');
    expect(s[0]).toMatchObject({ pid: 'm.p1', text: '今般改暦' });
  });

  it('uses branched article numbers as-is', () => {
    const root = parse(
      `<MainProvision><Article Num="3_2"><ArticleTitle>第三条の二</ArticleTitle><Paragraph Num="1"><Sentence>枝番号</Sentence></Paragraph></Article></MainProvision>`,
    );
    const s = collectSentences(root, 'm');
    expect(s[0]?.pid).toBe('m.a3_2.p1');
  });

  it('skips captions and titles', () => {
    const root = parse(
      `<Article Num="1"><ArticleCaption>（目的）</ArticleCaption><ArticleTitle>第一条</ArticleTitle><Paragraph Num="1"><ParagraphNum>１</ParagraphNum><Sentence>本文。</Sentence></Paragraph></Article>`,
    );
    const s = collectSentences(root, 'm.a1');
    expect(s).toEqual([{ pid: 'm.a1.p1', sent: 1, text: '本文。', inTable: false }]);
  });

  it('numbers sentences that share a pid in document order', () => {
    const root = parse(
      `<MainProvision><Article Num="1"><Paragraph Num="1"><Sentence>一。</Sentence><Sentence>二。</Sentence></Paragraph></Article></MainProvision>`,
    );
    const s = collectSentences(root, 'm');
    expect(s.map((x) => x.sent)).toEqual([1, 2]);
    expect(s.every((x) => x.pid === 'm.a1.p1')).toBe(true);
  });

  it('drops half-width xml whitespace and keeps ideographic space', () => {
    const root = parse(`<Sentence>甲\n  乙　丙</Sentence>`);
    const s = collectSentences(root, 'm.p1');
    expect(s[0]?.text).toBe('甲乙　丙');
  });
});
