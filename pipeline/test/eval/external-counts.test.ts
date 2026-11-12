import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvToObjects } from '../../src/eval/csv.ts';
import {
  EXPECTED_JLAW_PAIR_ROWS,
  EXPECTED_LAWVIS_LAWS,
  EXPECTED_LAWVIS_PAIRS,
} from '../../src/eval/expected.ts';
import { resolveStore } from '../../src/lib/paths.ts';

const EXT = `${resolveStore(undefined)}/data/eval/prefetch/external`;

describe.skipIf(!existsSync(`${EXT}/lawvis-pairs.csv`))('external pair files', () => {
  it('lawvis union is 8685 laws and 113641 directed pairs', () => {
    const rows = csvToObjects(readFileSync(`${EXT}/lawvis-pairs.csv`, 'utf8'));
    const laws = new Set<string>();
    for (const row of rows) {
      laws.add(row.src_law_id ?? '');
      laws.add(row.tgt_law_id ?? '');
    }
    laws.delete('');
    expect(rows.length).toBe(EXPECTED_LAWVIS_PAIRS);
    expect(laws.size).toBe(EXPECTED_LAWVIS_LAWS);
  });

  it('JLaw cites_law_to_law has 70577 rows', () => {
    const rows = csvToObjects(readFileSync(`${EXT}/jlaw-pairs.csv`, 'utf8'));
    expect(rows.length).toBe(EXPECTED_JLAW_PAIR_ROWS);
  });
});
