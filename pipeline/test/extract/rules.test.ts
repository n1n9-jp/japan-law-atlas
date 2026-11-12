import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REF_FLAGS } from '../../lib/ref-types.js';
import { formatDebug } from '../../src/extract/debug.js';
import { flagsOf, makeLaw, runCase, type CaseLaw, type ExpectedRef } from './helpers.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface FixtureFile {
  id: string;
  rule: string;
  lawId: string;
  title?: string;
  lawType?: string;
  pid: string;
  part?: CaseLaw['part'];
  sent?: number;
  text: string;
  sentences?: CaseLaw['sentences'];
  articles?: string[];
  inTable?: boolean;
  targetPids?: Record<string, string[]>;
  expected: Array<ExpectedRef & { flagsNamed?: (keyof typeof REF_FLAGS)[] }>;
  exact?: boolean;
  expectedPid?: string;
  forbiddenMentions?: string[];
}

function loadFixtures(): FixtureFile[] {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  const all: FixtureFile[] = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as FixtureFile | FixtureFile[];
    const arr = Array.isArray(raw) ? raw : [raw];
    all.push(...arr);
  }
  return all;
}

const fixtures = loadFixtures();

describe('extractor fixtures', () => {
  it('has at least 80 cases', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(80);
  });

  const byRule = new Map<string, number>();
  for (const f of fixtures) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  for (const rule of ['L1-number', 'L2-abbrev', 'L3-anaphora', 'L4-self', 'L5-name', 'L6-provision', 'L7-relative']) {
    it(`has >=5 cases for ${rule}`, () => {
      expect(byRule.get(rule) ?? 0).toBeGreaterThanOrEqual(5);
    });
  }

  for (const fx of fixtures) {
    it(`${fx.id} (${fx.rule})`, () => {
      const result = runCase({
        lawId: fx.lawId,
        title: fx.title,
        lawType: fx.lawType,
        pid: fx.pid,
        part: fx.part,
        sent: fx.sent,
        text: fx.text,
        sentences: fx.sentences,
        articles: fx.articles,
        inTable: fx.inTable,
        targetPids: fx.targetPids,
      });
      const refs = fx.expectedPid ? result.refs.filter((r) => r.srcPid === fx.expectedPid) : result.refs;
      for (const exp of fx.expected) {
        const flags = exp.flagsNamed ? flagsOf(...exp.flagsNamed) : exp.flags;
        const hit = refs.find((r) => {
          if (r.mention !== exp.mention) return false;
          if (exp.tgtLaw !== undefined && r.tgtLaw !== exp.tgtLaw) return false;
          if (exp.tgtPid !== undefined && r.tgtPid !== exp.tgtPid) return false;
          if (exp.tgtEnd !== undefined && r.tgtEnd !== exp.tgtEnd) return false;
          if (exp.kind && r.kind !== exp.kind) return false;
          if (exp.rule && r.rule !== exp.rule) return false;
          if (exp.tgtStatus && r.tgtStatus !== exp.tgtStatus) return false;
          if (flags !== undefined && (r.flags & flags) !== flags) return false;
          return true;
        });
        expect(hit, `missing ${JSON.stringify(exp)}\n${formatDebug(fx.lawId, result)}`).toBeTruthy();
      }
      if (fx.exact) {
        expect(refs.map((r) => r.mention)).toEqual(fx.expected.map((e) => e.mention));
      }
      for (const bad of fx.forbiddenMentions ?? []) {
        expect(refs.some((r) => r.mention === bad || r.mention.startsWith(bad)), `should not extract ${bad}`).toBe(false);
      }
    });
  }
});

describe('mini-law snapshots', () => {
  const laws: { id: string; cases: CaseLaw[] }[] = [
    {
      id: '332CO0000000043',
      cases: [
        {
          lawId: '332CO0000000043',
          pid: 'e',
          part: 'enact',
          text: '内閣は、租税特別措置法（昭和三十二年法律第二十六号）の規定に基き、及び同法を実施するため、この政令を制定する。',
        },
      ],
    },
    {
      id: '322M40000100023',
      cases: [
        {
          lawId: '322M40000100023',
          pid: 'm.a7_2.p1.i2',
          part: 'main',
          lawType: 'MinisterialOrdinance',
          text: '当該労働者が指定する金融商品取引業者（金融商品取引法（昭和二十三年法律第二十五号。以下「金商法」という。）第二条第九項に規定する金融商品取引業者（金商法第二十八条第一項に規定する第一種金融商品取引業を行う者に限り、金商法第二十九条の四の二第八項に規定する第一種少額電子募集取扱業者及び金商法第二十九条の四の四第七項に規定する非上場有価証券特例仲介等業者を除く。）をいう。以下この号において同じ。）に対する当該労働者の預り金（次の要件を満たすものに限る。）への払込み',
        },
      ],
    },
    {
      id: '129AC0000000089',
      cases: [
        {
          lawId: '129AC0000000089',
          pid: 'm.a245.p1',
          articles: ['m.a243', 'm.a244', 'm.a245'],
          text: '前二条の規定は、所有者を異にする物が混和して識別することができなくなった場合について準用する。',
        },
      ],
    },
    {
      id: '322AC0000000067',
      cases: [
        {
          lawId: '322AC0000000067',
          pid: 'm.a3.p1',
          articles: ['m.a1', 'm.a2', 'm.a3'],
          text: '前二条の規定は、前項の規定により裁判所が検査役を選任した場合について準用する。',
        },
      ],
    },
  ];

  for (const law of laws) {
    it(`snapshot ${law.id}`, () => {
      const merged = makeLaw(law.cases[0]!);
      if (law.cases.length > 1) {
        merged.sentences = law.cases.flatMap((c) => makeLaw(c).sentences);
      }
      const result = runCase(law.cases[0]!);
      expect(formatDebug(law.id, result)).toMatchSnapshot();
    });
  }
});
