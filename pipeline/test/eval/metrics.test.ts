import { describe, expect, it } from 'vitest';
import {
  articleLevelPrf,
  crossLawPrf,
  groupPreds,
  intraPidOk,
  isCrossLawGold,
  kindAccuracy,
  prf,
  relativeIntraPrf,
} from '../../src/eval/metrics.ts';
import type { GoldRef, GoldSentence, PredRef } from '../../src/eval/types.ts';

const sent: GoldSentence = {
  gid: 'g001',
  lawId: 'LAW_A',
  pid: 'm.a1.p1',
  sent: 1,
  part: 'main',
  text: '民法第九十条及び刑法第一条。前条を準用する。',
  articleText: '民法第九十条及び刑法第一条。前条を準用する。',
  stratum: 'Act|main',
};

function gold(partial: Partial<GoldRef> & Pick<GoldRef, 'start' | 'end' | 'mention'>): GoldRef {
  return {
    tgtLaw: null,
    tgtStatus: 'unknown',
    tgtPid: null,
    tgtEnd: null,
    kind: 'cite',
    yomikae: false,
    ...partial,
  };
}

function pred(partial: Partial<PredRef> & Pick<PredRef, 'start' | 'end' | 'mention'>): PredRef {
  return {
    id: `LAW_A:m.a1.p1#1:${partial.start}`,
    srcLaw: 'LAW_A',
    srcPid: 'm.a1.p1',
    sent: 1,
    part: 'main',
    rawName: null,
    tgtLaw: null,
    tgtStatus: 'unknown',
    tgtPid: null,
    tgtEnd: null,
    kind: 'cite',
    flags: 0,
    rule: 'test',
    confidence: 1,
    ...partial,
  };
}

describe('prf hand calculation', () => {
  it('matches tp=1 fp=1 fn=1 -> P=R=F1=0.5', () => {
    expect(prf(1, 1, 1)).toEqual({
      tp: 1,
      fp: 1,
      fn: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
    });
  });
});

describe('crossLawPrf', () => {
  it('counts law-id match as tp, extra pred as fp, missed gold as fn', () => {
    const golds = [
      gold({
        start: 0,
        end: 6,
        mention: '民法第九十条',
        tgtLaw: 'MINPO',
        tgtStatus: 'current',
        tgtPid: 'm.a90',
      }),
      gold({
        start: 8,
        end: 13,
        mention: '刑法第一条',
        tgtLaw: 'KEIHO',
        tgtStatus: 'current',
        tgtPid: 'm.a1',
      }),
    ];
    const preds = [
      pred({
        start: 0,
        end: 6,
        mention: '民法第九十条',
        tgtLaw: 'MINPO',
        tgtStatus: 'current',
        tgtPid: 'm.a90',
      }),
      pred({
        start: 20,
        end: 22,
        mention: '商法',
        tgtLaw: 'SHOHO',
        tgtStatus: 'current',
        tgtPid: null,
      }),
    ];
    const got = crossLawPrf([sent], new Map([['g001', golds]]), preds);
    expect(got).toEqual(prf(1, 1, 1));
  });
});

describe('articleLevelPrf', () => {
  it('requires the article pid prefix to match', () => {
    const golds = [
      gold({
        start: 0,
        end: 6,
        mention: '民法第九十条',
        tgtLaw: 'MINPO',
        tgtStatus: 'current',
        tgtPid: 'm.a90.p1',
      }),
    ];
    const predsOk = [
      pred({
        start: 0,
        end: 6,
        mention: '民法第九十条',
        tgtLaw: 'MINPO',
        tgtStatus: 'current',
        tgtPid: 'm.a90.p2',
      }),
    ];
    const predsBad = [
      pred({
        start: 0,
        end: 6,
        mention: '民法第九十条',
        tgtLaw: 'MINPO',
        tgtStatus: 'current',
        tgtPid: 'm.a91.p1',
      }),
    ];
    const byGid = new Map([['g001', golds]]);
    expect(articleLevelPrf([sent], byGid, predsOk)).toEqual(prf(1, 0, 0));
    expect(articleLevelPrf([sent], byGid, predsBad)).toEqual(prf(0, 1, 1));
  });
});

describe('ignored この法律 pred is not an FP', () => {
  it('drops この法律 and 各号 and 同表 from grouped predictions', () => {
    const preds = [
      pred({ start: 40, end: 44, mention: 'この法律', tgtLaw: 'LAW_A', tgtStatus: 'self' }),
      pred({ start: 50, end: 52, mention: '各号', tgtLaw: 'LAW_A', tgtStatus: 'self', tgtPid: 'm.a1' }),
      pred({ start: 53, end: 55, mention: '同表', tgtLaw: 'LAW_A', tgtStatus: 'self', tgtPid: 'm.a1' }),
      pred({
        start: 0,
        end: 6,
        mention: '民法第九十条',
        tgtLaw: 'MINPO',
        tgtStatus: 'current',
        tgtPid: 'm.a90',
      }),
    ];
    const grouped = groupPreds(preds);
    const all = [...grouped.values()].flat();
    expect(all).toHaveLength(1);
    expect(all[0]?.mention).toBe('民法第九十条');
  });
});

describe('intraPidOk', () => {
  it('accepts gold coarser than pred and rejects pred coarser', () => {
    const g = gold({
      start: 14,
      end: 16,
      mention: '前条',
      tgtLaw: 'LAW_A',
      tgtStatus: 'self',
      tgtPid: 'm.a3',
      tgtEnd: null,
    });
    const fine = pred({
      start: 14,
      end: 16,
      mention: '前条',
      tgtLaw: 'LAW_A',
      tgtStatus: 'self',
      tgtPid: 'm.a3.p1',
    });
    const coarse = pred({
      start: 14,
      end: 16,
      mention: '前条',
      tgtLaw: 'LAW_A',
      tgtStatus: 'self',
      tgtPid: 'm',
    });
    expect(intraPidOk(g, fine)).toBe(true);
    expect(intraPidOk(g, coarse)).toBe(false);
  });
});

describe('isCrossLawGold', () => {
  it('does not count amendingLaw or unknown even when tgtLaw is set', () => {
    expect(
      isCrossLawGold(
        'LAW_A',
        gold({
          start: 0,
          end: 4,
          mention: '改正法',
          tgtLaw: 'OTHER',
          tgtStatus: 'amendingLaw',
        }),
      ),
    ).toBe(false);
    expect(
      isCrossLawGold(
        'LAW_A',
        gold({
          start: 0,
          end: 4,
          mention: '旧法',
          tgtLaw: 'OTHER',
          tgtStatus: 'unknown',
        }),
      ),
    ).toBe(false);
    expect(
      isCrossLawGold(
        'LAW_A',
        gold({
          start: 0,
          end: 6,
          mention: '民法第九十条',
          tgtLaw: 'MINPO',
          tgtStatus: 'current',
        }),
      ),
    ).toBe(true);
  });
});

describe('relativeIntraPrf', () => {
  it('scores 前条 as a relative self reference', () => {
    const golds = [
      gold({
        start: 14,
        end: 16,
        mention: '前条',
        tgtLaw: 'LAW_A',
        tgtStatus: 'self',
        tgtPid: 'm.a0',
        kind: 'junyo',
      }),
    ];
    const preds = [
      pred({
        start: 14,
        end: 16,
        mention: '前条',
        tgtLaw: 'LAW_A',
        tgtStatus: 'self',
        tgtPid: 'm.a0',
        kind: 'junyo',
      }),
    ];
    expect(relativeIntraPrf([sent], new Map([['g001', golds]]), preds)).toEqual(prf(1, 0, 0));
  });

  it('counts a pid-only mismatch as TP for lawOk', () => {
    const golds = [
      gold({
        start: 14,
        end: 16,
        mention: '前条',
        tgtLaw: 'LAW_A',
        tgtStatus: 'self',
        tgtPid: 'm.a0',
      }),
    ];
    const preds = [
      pred({
        start: 14,
        end: 16,
        mention: '前条',
        tgtLaw: 'LAW_A',
        tgtStatus: 'self',
        tgtPid: 'm.a3',
      }),
    ];
    expect(relativeIntraPrf([sent], new Map([['g001', golds]]), preds)).toEqual(prf(1, 0, 0));
  });
});

describe('kindAccuracy', () => {
  it('is 1 only when matched law and kind both agree', () => {
    const golds = [
      gold({
        start: 0,
        end: 6,
        mention: '民法第九十条',
        tgtLaw: 'MINPO',
        tgtStatus: 'current',
        kind: 'cite',
      }),
    ];
    const preds = [
      pred({
        start: 0,
        end: 6,
        mention: '民法第九十条',
        tgtLaw: 'MINPO',
        tgtStatus: 'current',
        kind: 'junyo',
      }),
    ];
    const got = kindAccuracy([sent], new Map([['g001', golds]]), preds);
    expect(got.n).toBe(1);
    expect(got.accuracy).toBe(0);
    expect(got.confusion.cite?.junyo).toBe(1);
  });
});
