import { describe, expect, it } from 'vitest';
import type { Part } from '../../lib/shared/contract.ts';
import { GOLD_SIZE, HARD_QUOTAS, SUPPL_MIN, TYPE_QUOTAS } from '../../src/eval/expected.ts';
import {
  hardFlags,
  looksLikeNoRef,
  sampleGold,
  type SampleCandidate,
} from '../../src/eval/gold-sample.ts';
import { EVAL_SEED } from '../../src/eval/random.ts';

function cand(
  i: number,
  opts: {
    type: SampleCandidate['lawType'];
    part: Part;
    text: string;
    title?: string;
  },
): SampleCandidate {
  return {
    lawId: `L${opts.type}${i}`,
    lawType: opts.type,
    title: opts.title ?? 'テスト法',
    pid: opts.part === 'suppl' ? 's1.a1.p1' : 'm.a1.p1',
    sent: 1,
    part: opts.part,
    text: opts.text,
    articleText: opts.text,
  };
}

function many(
  n: number,
  start: number,
  opts: { type: SampleCandidate['lawType']; part: Part; text: string; title?: string },
): SampleCandidate[] {
  return Array.from({ length: n }, (_, i) => cand(start + i, opts));
}

describe('looksLikeNoRef', () => {
  it('accepts a commencement sentence and rejects 同法', () => {
    expect(looksLikeNoRef('この省令は、公布の日から施行する。')).toBe(true);
    expect(looksLikeNoRef('同法第三条の規定を準用する。')).toBe(false);
  });
});

describe('sampleGold', () => {
  it('fills type, hard, and suppl quotas on a synthetic pool', () => {
    const pool: SampleCandidate[] = [
      ...many(200, 0, { type: 'Act', part: 'main', text: '同法第三条を準用する。から第五条まで読み替えの例による。適用しない。以下「略」という。' }),
      ...many(80, 200, { type: 'Act', part: 'suppl', text: '同法第三条を準用する。から第五条まで。' }),
      ...many(100, 300, { type: 'CabinetOrder', part: 'main', text: '法第十二条の政令で定める事項は次のとおり。準用する。', title: 'テスト法施行令' }),
      ...many(40, 400, { type: 'CabinetOrder', part: 'suppl', text: 'この政令は、公布の日から施行する。' }),
      ...many(120, 500, { type: 'MinisterialOrdinance', part: 'main', text: '以下「略」という。読み替え。の例による。' }),
      ...many(30, 700, { type: 'MinisterialOrdinance', part: 'suppl', text: '適用しない。' }),
      ...many(40, 800, { type: 'Rule', part: 'main', text: 'この省令は、公布の日から施行する。' }),
      ...many(40, 900, { type: 'ImperialOrder', part: 'main', text: 'この勅令は、公布の日から施行する。' }),
    ];
    const result = sampleGold(pool, EVAL_SEED);
    expect(result.sentences).toHaveLength(GOLD_SIZE);
    expect(result.typeCounts.Act).toBe(TYPE_QUOTAS.Act);
    expect(result.typeCounts.CabinetOrder).toBe(TYPE_QUOTAS.CabinetOrder);
    expect(result.typeCounts.MinisterialOrdinance).toBe(TYPE_QUOTAS.MinisterialOrdinance);
    expect(result.typeCounts.Rule).toBe(TYPE_QUOTAS.Rule);
    expect(result.typeCounts.Other).toBe(TYPE_QUOTAS.Other);
    expect(result.supplCount).toBeGreaterThanOrEqual(SUPPL_MIN);
    for (const k of Object.keys(HARD_QUOTAS) as (keyof typeof HARD_QUOTAS)[]) {
      expect(result.hardCounts[k], k).toBeGreaterThanOrEqual(HARD_QUOTAS[k]);
    }
    expect(result.unmet).toEqual([]);
    const again = sampleGold(pool, EVAL_SEED);
    expect(again.sentences.map((s) => s.gid + s.lawId)).toEqual(result.sentences.map((s) => s.gid + s.lawId));
  });
});

describe('hardFlags', () => {
  it('flags 施行令 + 法第…条の政令で定める', () => {
    const h = hardFlags('法第十二条の政令で定める事項は、次のとおり。', '地方自治法施行令');
    expect(h.seirei).toBe(true);
  });
});
