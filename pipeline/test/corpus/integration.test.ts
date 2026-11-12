import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCorpusLaw } from '../../src/corpus/build-law.ts';
import { xmlToEgovNode } from '../../src/corpus/xml-to-tree.ts';
import type { LawMeta } from '../../lib/corpus-types.ts';

const CACHE = '/tmp/hourei-cache/egov/20261009';

const files = {
  minpo: `${CACHE}/129AC0000000089_20260624_508AC0000000045/129AC0000000089_20260624_508AC0000000045.xml`,
  sozei: `${CACHE}/332CO0000000043_20260731_508CO0000000098/332CO0000000043_20260731_508CO0000000098.xml`,
  kaireki: `${CACHE}/105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml`,
};

function stub(lawId: string, revisionId: string, title: string): Omit<LawMeta, 'articleCount' | 'supplCount' | 'hasEnact'> {
  return {
    lawId,
    revisionId,
    title,
    kana: '',
    abbrevs: [],
    oldTitles: [],
    num: '',
    numNorm: '',
    lawType: 'Act',
    rawLawType: 'Act',
    category: '',
    promulgationDate: '1896-04-27',
    enforcementDate: null,
    status: 'current',
    repealDate: null,
    source: 'zip',
  };
}

const present = Object.values(files).every((p) => fs.existsSync(p));

describe.skipIf(!present)('integration: three landmark laws', () => {
  it('民法: article count, first/last pid, enact', () => {
    const law = buildCorpusLaw(xmlToEgovNode(fs.readFileSync(files.minpo, 'utf8')), stub('129AC0000000089', '129AC0000000089_20260624_508AC0000000045', '民法'));
    expect(law.meta.hasEnact).toBe(true);
    expect(law.meta.articleCount).toBe(1173);
    expect(law.articles[0]?.pid).toBe('m.a1');
    const main = law.articles.filter((a) => a.part === 'main');
    expect(main.at(-1)?.pid).toBe('m.a1050');
    expect(law.articles.at(-1)?.pid.startsWith('s')).toBe(true);
    expect(law.sentences.some((s) => s.pid === 'm.a398_2.p1')).toBe(true);
  });

  it('租税特別措置法施行令: many suppl provisions and first/last pids', () => {
    const law = buildCorpusLaw(
      xmlToEgovNode(fs.readFileSync(files.sozei, 'utf8')),
      stub('332CO0000000043', '332CO0000000043_20260731_508CO0000000098', '租税特別措置法施行令'),
    );
    expect(law.meta.hasEnact).toBe(true);
    expect(law.meta.articleCount).toBe(526);
    expect(law.meta.supplCount).toBe(498);
    expect(law.articles[0]?.pid).toBe('m.a1');
    expect(law.sentences.some((s) => s.pid === 's1.p1' && s.part === 'suppl')).toBe(true);
    expect(law.articles.some((a) => a.part === 'supplAmend' && a.pid.startsWith('s'))).toBe(true);
    expect(law.articles.at(-1)?.pid.startsWith('s')).toBe(true);
  });

  it('明治五年太政官布告第三百三十七号: no articles, starts at m.p1', () => {
    const law = buildCorpusLaw(
      xmlToEgovNode(fs.readFileSync(files.kaireki, 'utf8')),
      stub('105DF0000000337', '105DF0000000337_18721109_000000000000000', '改暦ノ布告'),
    );
    expect(law.meta.hasEnact).toBe(false);
    expect(law.meta.articleCount).toBe(0);
    expect(law.articles).toEqual([]);
    expect(law.sentences[0]?.pid).toBe('m.p1');
    expect(law.appdx.length).toBeGreaterThan(0);
    expect(law.appdx[0]?.pid).toBe('t1');
  });
});
