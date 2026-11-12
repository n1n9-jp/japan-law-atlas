import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvToObjects, parseCsv } from '../../src/eval/csv.ts';
import { resolveStore } from '../../src/lib/paths.ts';

describe('parseCsv', () => {
  it('keeps commas inside quotes and multiline fields', () => {
    const text = 'a,b\n"x,y","line1\nline2"\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x,y', 'line1\nline2'],
    ]);
  });
});

const samplePath = `${resolveStore(undefined)}/data/eval/prefetch/external/jlaw-precision-sample.csv`;

describe.skipIf(!existsSync(samplePath))('jlaw precision sample file', () => {
  it('parses 400 records with empty label_O_X', () => {
    const p = samplePath;
    const rows = csvToObjects(readFileSync(p, 'utf8'));
    expect(rows.length).toBe(400);
    expect(rows.every((r) => (r.label_O_X ?? '').trim() === '')).toBe(true);
    expect(new Set(rows.map((r) => r.via)).size).toBe(8);
  });
});
