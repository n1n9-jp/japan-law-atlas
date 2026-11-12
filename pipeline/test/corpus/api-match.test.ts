import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CorpusLaw, LawMeta } from '../../lib/corpus-types.ts';
import { collectSentences, type EgovNode } from '../../lib/shared/egov-tree.ts';
import { fetchLawArticleJson } from '../../src/corpus/egov-api.ts';
import { mulberry32, sampleIndices } from '../../src/lib/random.ts';
import { readLatest, resolveStore } from '../../src/lib/paths.ts';

const run = process.env.RUN_API === '1';

function loadCorpus(store: string, snapshotId: string): CorpusLaw[] {
  const dir = path.join(store, 'data', 'corpus', snapshotId);
  const laws: CorpusLaw[] = [];
  for (let i = 0; i < 32; i++) {
    const file = path.join(dir, `text-${String(i).padStart(2, '0')}.jsonl.gz`);
    if (!fs.existsSync(file)) continue;
    const raw = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    for (const line of raw.split('\n')) {
      if (line.length === 0) continue;
      laws.push(JSON.parse(line) as CorpusLaw);
    }
  }
  return laws;
}

describe.skipIf(!run)('API JSON vs corpus sentences (30 articles)', () => {
  it('matches character-for-character on a seeded sample of 30 main articles', async () => {
    const store = resolveStore(process.env.HOUREI_STORE);
    const snapshotId = process.env.HOUREI_SNAPSHOT ?? readLatest(store);
    expect(snapshotId).toBeTruthy();
    const corpus = loadCorpus(store, snapshotId!);
    expect(corpus.length).toBeGreaterThan(100);

    const pool: { law: CorpusLaw; articleNum: string; pidPrefix: string }[] = [];
    for (const law of corpus) {
      if (law.meta.articleCount === 0) continue;
      for (const art of law.articles) {
        if (art.part !== 'main') continue;
        const m = /^m\.a(.+)$/.exec(art.pid);
        if (!m) continue;
        pool.push({ law, articleNum: m[1]!, pidPrefix: art.pid });
      }
    }
    expect(pool.length).toBeGreaterThan(30);
    const rng = mulberry32(20261008);
    const picked = sampleIndices(pool.length, 30, rng).map((i) => pool[i]!);

    const mismatches: string[] = [];
    for (const item of picked) {
      const json = (await fetchLawArticleJson(item.law.meta.revisionId, item.articleNum)) as EgovNode;
      const fromApi = collectSentences(json, item.pidPrefix);
      const fromCorpus = item.law.sentences
        .filter((s) => s.pid === item.pidPrefix || s.pid.startsWith(`${item.pidPrefix}.`))
        .filter((s) => s.part === 'main')
        .map((s) => ({ pid: s.pid, sent: s.sent, text: s.text, inTable: s.inTable }));
      const a = JSON.stringify(fromApi);
      const b = JSON.stringify(fromCorpus);
      if (a !== b) {
        mismatches.push(
          `${item.law.meta.lawId} ${item.pidPrefix} api=${fromApi.length} corpus=${fromCorpus.length} api0=${JSON.stringify(fromApi[0])} corpus0=${JSON.stringify(fromCorpus[0])}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  }, 180_000);
});

describe.skipIf(!run)('laws.json shape', () => {
  it('is sorted by lawId', () => {
    const store = resolveStore(process.env.HOUREI_STORE);
    const snapshotId = process.env.HOUREI_SNAPSHOT ?? readLatest(store);
    const laws = JSON.parse(fs.readFileSync(path.join(store, 'data', 'corpus', snapshotId!, 'laws.json'), 'utf8')) as LawMeta[];
    const ids = laws.map((l) => l.lawId);
    expect([...ids].sort()).toEqual(ids);
  });
});
