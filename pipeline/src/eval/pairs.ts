import { PARTS, type Part } from '../../lib/shared/contract.ts';
import { EVAL_SEED, mulberry32, pickN } from './random.ts';
import type { DiffSample, PairSetCounts, PredRef } from './types.ts';
import { DIFF_SAMPLE_SIZE } from './expected.ts';

const MAIN_PARTS = new Set<Part>(['main', 'enact', 'appdx']);

export interface LawStatusRow {
  lawId: string;
  status: string;
}

export function ourComparablePairs(
  refs: readonly PredRef[],
  statusById: ReadonlyMap<string, string>,
): Set<string> {
  const pairs = new Set<string>();
  for (const ref of refs) {
    if (!MAIN_PARTS.has(ref.part)) continue;
    if (ref.kind === 'amend') continue;
    if (ref.tgtLaw === null || ref.tgtLaw === ref.srcLaw) continue;
    if (statusById.get(ref.srcLaw) !== 'current') continue;
    if (statusById.get(ref.tgtLaw) !== 'current') continue;
    pairs.add(`${ref.srcLaw}\t${ref.tgtLaw}`);
  }
  return pairs;
}

export function pairKey(src: string, tgt: string): string {
  return `${src}\t${tgt}`;
}

export function comparePairSets(
  ours: ReadonlySet<string>,
  theirs: ReadonlySet<string>,
  ourLaws: ReadonlySet<string>,
  theirLaws: ReadonlySet<string>,
): PairSetCounts & { oursOnlyPairs: string[]; theirsOnlyPairs: string[] } {
  const bothLaws = new Set([...ourLaws].filter((id) => theirLaws.has(id)));
  const oursF = new Set<string>();
  const theirsF = new Set<string>();
  for (const p of ours) {
    const [s, t] = p.split('\t');
    if (s && t && bothLaws.has(s) && bothLaws.has(t)) oursF.add(p);
  }
  for (const p of theirs) {
    const [s, t] = p.split('\t');
    if (s && t && bothLaws.has(s) && bothLaws.has(t)) theirsF.add(p);
  }
  const both: string[] = [];
  const oursOnly: string[] = [];
  const theirsOnly: string[] = [];
  for (const p of oursF) {
    if (theirsF.has(p)) both.push(p);
    else oursOnly.push(p);
  }
  for (const p of theirsF) {
    if (!oursF.has(p)) theirsOnly.push(p);
  }
  return {
    ours: oursF.size,
    theirs: theirsF.size,
    both: both.length,
    oursOnly: oursOnly.length,
    theirsOnly: theirsOnly.length,
    lawsInBoth: bothLaws.size,
    oursOnlyPairs: oursOnly.sort(),
    theirsOnlyPairs: theirsOnly.sort(),
  };
}

export function sampleDiffPairs(
  vs: 'lawvis' | 'jlaw',
  oursOnly: readonly string[],
  theirsOnly: readonly string[],
  seed = EVAL_SEED,
): DiffSample[] {
  const rng = mulberry32(seed);
  const ours = pickN(oursOnly, DIFF_SAMPLE_SIZE, rng);
  const theirs = pickN(theirsOnly, DIFF_SAMPLE_SIZE, rng);
  const out: DiffSample[] = [];
  for (const p of ours) {
    const [srcLaw, tgtLaw] = p.split('\t');
    out.push({
      srcLaw: srcLaw ?? '',
      tgtLaw: tgtLaw ?? '',
      bucket: 'oursOnly',
      vs,
      class: null,
      note: '',
    });
  }
  for (const p of theirs) {
    const [srcLaw, tgtLaw] = p.split('\t');
    out.push({
      srcLaw: srcLaw ?? '',
      tgtLaw: tgtLaw ?? '',
      bucket: 'theirsOnly',
      vs,
      class: null,
      note: '',
    });
  }
  return out;
}

export function lawsInPairs(pairs: ReadonlySet<string>): Set<string> {
  const laws = new Set<string>();
  for (const p of pairs) {
    const [s, t] = p.split('\t');
    if (s) laws.add(s);
    if (t) laws.add(t);
  }
  return laws;
}

export { PARTS, MAIN_PARTS };
