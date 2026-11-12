import { describe, expect, it } from 'vitest';
import { addRefToPair, newPair, type PairAgg } from '../../src/graph/edges.ts';
import { assignFamilies, pickParent, type FamilyNode } from '../../src/graph/family.ts';

function pair(src: string, tgt: string, kind: 'basis' | 'implements' | 'cite', n = 1, part: 'main' | 'suppl' = 'main'): PairAgg {
  const p = newPair(src, tgt);
  for (let i = 0; i < n; i++) addRefToPair(p, part, kind);
  return p;
}

describe('pickParent', () => {
  const act: FamilyNode = { lawId: 'A', title: '河川法', lawType: 'Act' };
  const order: FamilyNode = { lawId: 'O', title: '河川法施行令', lawType: 'CabinetOrder' };
  const rule: FamilyNode = { lawId: 'R', title: '河川法施行規則', lawType: 'MinisterialOrdinance' };
  const otherAct: FamilyNode = { lawId: 'B', title: '民法', lawType: 'Act' };
  const cabinet: FamilyNode = { lawId: 'C', title: '内閣法', lawType: 'Act' };
  const byId = new Map([act, order, rule, otherAct, cabinet].map((n) => [n.lawId, n]));

  it('stage 1: basis*3 + implements が最大の親', () => {
    const outgoing = [
      pair('O', 'A', 'basis', 1),
      pair('O', 'B', 'implements', 4),
    ];
    // A: 1*3=3, B: 4 → B wins
    expect(pickParent(order, outgoing, byId)).toBe('B');
  });

  it('stage 1: basis が implements より重い', () => {
    const outgoing = [
      pair('O', 'A', 'basis', 2),
      pair('O', 'B', 'implements', 5),
    ];
    expect(pickParent(order, outgoing, byId)).toBe('A');
  });

  it('stage 2: 法令名プレフィックスの法律', () => {
    const outgoing = [pair('O', 'A', 'cite', 3), pair('O', 'B', 'cite', 10)];
    expect(pickParent(order, outgoing, byId)).toBe('A');
  });

  it('stage 3: 親なし', () => {
    const outgoing = [pair('O', 'B', 'cite', 2)];
    expect(pickParent(order, outgoing, byId)).toBeNull();
  });

  it('法律自身は親を持たない', () => {
    expect(pickParent(act, [pair('A', 'B', 'basis', 5)], byId)).toBeNull();
  });
});

describe('assignFamilies cycle', () => {
  it('循環したら循環内の最小 lawId を根にする', () => {
    const nodes: FamilyNode[] = [
      { lawId: 'X', title: '甲令', lawType: 'CabinetOrder' },
      { lawId: 'Y', title: '乙令', lawType: 'CabinetOrder' },
      { lawId: 'Z', title: '丙令', lawType: 'MinisterialOrdinance' },
    ];
    const parentOf = new Map<string, string | null>([
      ['X', 'Y'],
      ['Y', 'X'],
      ['Z', 'Y'],
    ]);
    const fam = assignFamilies(nodes, parentOf);
    expect(fam.get('X')).toBe('X');
    expect(fam.get('Y')).toBe('X');
    expect(fam.get('Z')).toBe('X');
  });

  it('法律に着いたらそこが根', () => {
    const nodes: FamilyNode[] = [
      { lawId: 'ACT', title: '河川法', lawType: 'Act' },
      { lawId: 'ORD', title: '河川法施行令', lawType: 'CabinetOrder' },
      { lawId: 'RUL', title: '河川法施行規則', lawType: 'MinisterialOrdinance' },
    ];
    const parentOf = new Map<string, string | null>([
      ['ACT', null],
      ['ORD', 'ACT'],
      ['RUL', 'ORD'],
    ]);
    const fam = assignFamilies(nodes, parentOf);
    expect(fam.get('ACT')).toBe('ACT');
    expect(fam.get('ORD')).toBe('ACT');
    expect(fam.get('RUL')).toBe('ACT');
  });
});
