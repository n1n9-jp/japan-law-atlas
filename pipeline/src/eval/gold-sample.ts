import type { LawType, Part } from '../../lib/shared/contract.ts';
import {
  GOLD_SIZE,
  HARD_QUOTAS,
  SECOND_PASS_SIZE,
  SUPPL_MIN,
  TYPE_QUOTAS,
} from './expected.ts';
import { EVAL_SEED, mulberry32, shuffle } from './random.ts';
import type { GoldSentence, TypeBucket } from './types.ts';

export interface SampleCandidate {
  lawId: string;
  lawType: LawType | string;
  title: string;
  pid: string;
  sent: number;
  part: Part;
  text: string;
  articleText: string;
}

export interface HardFlags {
  anaphora: boolean;
  abbrevDef: boolean;
  range: boolean;
  junyo: boolean;
  yomikae: boolean;
  rei: boolean;
  exclude: boolean;
  seirei: boolean;
  noRef: boolean;
}

export const HARD_KEYS = [
  'anaphora',
  'abbrevDef',
  'range',
  'junyo',
  'yomikae',
  'rei',
  'exclude',
  'seirei',
  'noRef',
] as const;

export type HardKey = (typeof HARD_KEYS)[number];

export interface IndexRow {
  lawId: string;
  pid: string;
  sent: number;
  part: Part;
  bucket: TypeBucket;
  bits: number;
}

export function typeBucket(lawType: string): TypeBucket {
  if (lawType === 'Act') return 'Act';
  if (lawType === 'CabinetOrder') return 'CabinetOrder';
  if (lawType === 'MinisterialOrdinance') return 'MinisterialOrdinance';
  if (lawType === 'Rule') return 'Rule';
  return 'Other';
}

export function isSupplPart(part: Part): boolean {
  return part === 'suppl' || part === 'supplAmend';
}

export function looksLikeNoRef(text: string): boolean {
  if (/第[一二三四五六七八九十百千万〇零0-9]+条/.test(text)) return false;
  if (/同法|同条|同項|同号|前条|前項|次条|次項|前号|次号/.test(text)) return false;
  if (/法律第|政令第|府令第|省令第|規則第|勅令第/.test(text)) return false;
  if (/準用|読み替|の例による|適用しない/.test(text)) return false;
  if (/(?:法|政令|府令|省令|規則|勅令)（/.test(text)) return false;
  return true;
}

export function hardFlags(text: string, title: string): HardFlags {
  return {
    anaphora: /同法|同条/.test(text),
    abbrevDef: /以下「[^」]+」という/.test(text),
    range: /から.{1,40}まで/.test(text),
    junyo: /準用する/.test(text),
    yomikae: /読み替え/.test(text),
    rei: /の例による/.test(text),
    exclude: /適用しない/.test(text),
    seirei: title.includes('施行令') && /法第.+条の政令で定める/.test(text),
    noRef: looksLikeNoRef(text),
  };
}

export function hardBits(text: string, title: string): number {
  const f = hardFlags(text, title);
  let bits = 0;
  for (let i = 0; i < HARD_KEYS.length; i++) {
    if (f[HARD_KEYS[i]!]) bits |= 1 << i;
  }
  return bits;
}

export function bitsToFlags(bits: number): HardFlags {
  const out = {} as HardFlags;
  for (let i = 0; i < HARD_KEYS.length; i++) {
    out[HARD_KEYS[i]!] = (bits & (1 << i)) !== 0;
  }
  return out;
}

export function hasHard(bits: number, key: HardKey): boolean {
  return (bits & (1 << HARD_KEYS.indexOf(key))) !== 0;
}

export function rowKey(row: { lawId: string; pid: string; sent: number }): string {
  return `${row.lawId}:${row.pid}#${row.sent}`;
}

export interface SampleResult {
  sentences: GoldSentence[];
  typeCounts: Record<TypeBucket, number>;
  hardCounts: Record<keyof HardFlags, number>;
  supplCount: number;
  unmet: string[];
}

export function sampleIndex(rows: readonly IndexRow[], seed = EVAL_SEED): {
  selected: IndexRow[];
  typeCounts: Record<TypeBucket, number>;
  hardCounts: Record<keyof HardFlags, number>;
  supplCount: number;
  unmet: string[];
} {
  const rng = mulberry32(seed);
  const shuffled = shuffle(
    rows.map((r) => ({ ...r, key: rowKey(r) })),
    rng,
  );
  const selected: typeof shuffled = [];
  const selectedKeys = new Set<string>();
  const typeCounts: Record<TypeBucket, number> = {
    Act: 0,
    CabinetOrder: 0,
    MinisterialOrdinance: 0,
    Rule: 0,
    Other: 0,
  };
  const hardCounts: Record<keyof HardFlags, number> = {
    anaphora: 0,
    abbrevDef: 0,
    range: 0,
    junyo: 0,
    yomikae: 0,
    rei: 0,
    exclude: 0,
    seirei: 0,
    noRef: 0,
  };

  const take = (s: (typeof shuffled)[number]): void => {
    selected.push(s);
    selectedKeys.add(s.key);
    typeCounts[s.bucket] += 1;
    for (const k of HARD_KEYS) {
      if (hasHard(s.bits, k)) hardCounts[k] += 1;
    }
  };

  const typeFull = (bucket: TypeBucket): boolean => typeCounts[bucket] >= TYPE_QUOTAS[bucket];
  const hardUnfilled = (s: (typeof shuffled)[number]): boolean =>
    (Object.keys(HARD_QUOTAS) as (keyof typeof HARD_QUOTAS)[]).some(
      (k) => hasHard(s.bits, k) && hardCounts[k] < HARD_QUOTAS[k],
    );

  for (const s of shuffled) {
    if (selected.length >= GOLD_SIZE) break;
    if (typeFull(s.bucket)) continue;
    if (!hardUnfilled(s)) continue;
    take(s);
  }
  for (const s of shuffled) {
    if (selected.length >= GOLD_SIZE) break;
    if (selectedKeys.has(s.key)) continue;
    if (typeFull(s.bucket)) continue;
    take(s);
  }

  let supplCount = selected.filter((s) => isSupplPart(s.part)).length;
  if (supplCount < SUPPL_MIN) {
    const unusedSuppl = shuffled.filter((s) => !selectedKeys.has(s.key) && isSupplPart(s.part));
    for (const incoming of unusedSuppl) {
      if (supplCount >= SUPPL_MIN) break;
      const victimIdx = selected.findIndex(
        (s) => !isSupplPart(s.part) && s.bucket === incoming.bucket,
      );
      if (victimIdx < 0) continue;
      drop(selected, selectedKeys, typeCounts, hardCounts, victimIdx);
      take(incoming);
      supplCount = selected.filter((s) => isSupplPart(s.part)).length;
    }
  }

  for (const k of Object.keys(HARD_QUOTAS) as (keyof typeof HARD_QUOTAS)[]) {
    if (hardCounts[k] >= HARD_QUOTAS[k]) continue;
    const unused = shuffled.filter((s) => !selectedKeys.has(s.key) && hasHard(s.bits, k));
    for (const incoming of unused) {
      if (hardCounts[k] >= HARD_QUOTAS[k]) break;
      const victimIdx = selected.findIndex((s) => s.bucket === incoming.bucket && !hasHard(s.bits, k));
      if (victimIdx < 0) continue;
      drop(selected, selectedKeys, typeCounts, hardCounts, victimIdx);
      take(incoming);
    }
  }

  selected.sort((a, b) => a.key.localeCompare(b.key));
  const picked = selected.slice(0, GOLD_SIZE).map(({ key: _key, ...row }) => row);
  const unmet: string[] = [];
  (Object.keys(TYPE_QUOTAS) as TypeBucket[]).forEach((k) => {
    if (typeCounts[k] < TYPE_QUOTAS[k]) unmet.push(`type:${k}:${typeCounts[k]}/${TYPE_QUOTAS[k]}`);
  });
  (Object.keys(HARD_QUOTAS) as (keyof typeof HARD_QUOTAS)[]).forEach((k) => {
    if (hardCounts[k] < HARD_QUOTAS[k]) unmet.push(`hard:${k}:${hardCounts[k]}/${HARD_QUOTAS[k]}`);
  });
  supplCount = picked.filter((s) => isSupplPart(s.part)).length;
  if (supplCount < SUPPL_MIN) unmet.push(`suppl:${supplCount}/${SUPPL_MIN}`);
  if (picked.length < GOLD_SIZE) unmet.push(`size:${picked.length}/${GOLD_SIZE}`);
  return { selected: picked, typeCounts, hardCounts, supplCount, unmet };
}

function drop(
  selected: { key: string; bucket: TypeBucket; bits: number }[],
  selectedKeys: Set<string>,
  typeCounts: Record<TypeBucket, number>,
  hardCounts: Record<keyof HardFlags, number>,
  victimIdx: number,
): void {
  const victim = selected[victimIdx]!;
  selectedKeys.delete(victim.key);
  selected.splice(victimIdx, 1);
  typeCounts[victim.bucket] -= 1;
  for (const k of HARD_KEYS) {
    if (hasHard(victim.bits, k)) hardCounts[k] -= 1;
  }
}

export function toGoldSentences(
  selected: readonly IndexRow[],
  textByKey: ReadonlyMap<string, { text: string; articleText: string }>,
): GoldSentence[] {
  return selected.map((s, i) => {
    const body = textByKey.get(rowKey(s));
    return {
      gid: `g${String(i + 1).padStart(3, '0')}`,
      lawId: s.lawId,
      pid: s.pid,
      sent: s.sent,
      part: s.part,
      text: body?.text ?? '',
      articleText: body?.articleText ?? '',
      stratum: stratumOf(s.bucket, s.part, bitsToFlags(s.bits)),
    };
  });
}

export function sampleGold(candidates: readonly SampleCandidate[], seed = EVAL_SEED): SampleResult {
  const rows: IndexRow[] = candidates.map((c) => ({
    lawId: c.lawId,
    pid: c.pid,
    sent: c.sent,
    part: c.part,
    bucket: typeBucket(c.lawType),
    bits: hardBits(c.text, c.title),
  }));
  const picked = sampleIndex(rows, seed);
  const textByKey = new Map<string, { text: string; articleText: string }>();
  for (const c of candidates) {
    textByKey.set(rowKey(c), { text: c.text, articleText: c.articleText });
  }
  return {
    sentences: toGoldSentences(picked.selected, textByKey),
    typeCounts: picked.typeCounts,
    hardCounts: picked.hardCounts,
    supplCount: picked.supplCount,
    unmet: picked.unmet,
  };
}

export function chooseSecondPass(gids: readonly string[], seed = EVAL_SEED): string[] {
  const sorted = [...gids].sort();
  return shuffle(sorted, mulberry32(seed)).slice(0, SECOND_PASS_SIZE);
}

function stratumOf(bucket: TypeBucket, part: Part, hard: HardFlags): string {
  const flags = HARD_KEYS.filter((k) => hard[k]);
  return [bucket, isSupplPart(part) ? 'suppl' : 'main', ...flags].join('|');
}
