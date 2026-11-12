import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { addRefToPair, newPair } from '../../src/graph/edges.ts';
import { runLayout } from '../../src/graph/layout.ts';
import { buildCategoryFlows, buildContinents } from '../../src/graph/continents.ts';
import { buildCategoryColors } from '../../src/graph/categories.ts';
import { toEdgesFile, toLawsFile } from '../../src/graph/write-web.ts';
import { mulberry32 } from '../../src/lib/random.ts';
import type { NodeRec } from '../../src/graph/types.ts';
import type { PairAgg } from '../../src/graph/edges.ts';
import { CONTRACT_VERSION } from '../../lib/shared/contract.ts';

function node(i: number, category: number): NodeRec {
  return {
    lawId: `L${String(i).padStart(3, '0')}`,
    revisionId: `R${i}`,
    title: `法令${i}`,
    kana: '',
    abbrevs: [],
    oldTitles: [],
    num: `法律第${i}号`,
    numNorm: `法律第${i}号`,
    lawType: i % 3 === 0 ? 'Act' : 'CabinetOrder',
    categoryName: ['憲法', '国会', '行政組織'][category]!,
    category,
    promulgated: 20200101,
    status: 'current',
    articleCount: 5 + (i % 7),
    ghost: false,
    label: `法令${i}`,
    aliases: [],
    delegations: 0,
    inLaws: 0, outLaws: 0, inRefs: 0, outRefs: 0,
    pagerank: 0.01, prRank: i + 1,
    parentLawId: null, familyLawId: `L${String(i).padStart(3, '0')}`,
    community: 0, bridge: 1,
    x: 0, y: 0, r: 1.5,
  };
}

function buildMini(): { nodes: NodeRec[]; pairs: PairAgg[] } {
  const nodes = Array.from({ length: 30 }, (_, i) => node(i, i % 3));
  const pairs: PairAgg[] = [];
  for (let i = 0; i < 30; i++) {
    const tgt = (i + 1) % 30;
    const p = newPair(nodes[i]!.lawId, nodes[tgt]!.lawId);
    addRefToPair(p, 'main', i % 2 === 0 ? 'cite' : 'basis');
    addRefToPair(p, 'main', 'cite');
    pairs.push(p);
  }
  return { nodes, pairs };
}

describe('small layout pipeline', () => {
  it('is deterministic and contract-shaped', async () => {
    const a = buildMini();
    const b = buildMini();
    const la = runLayout(a.nodes, a.pairs, mulberry32(20261008), {
      categoryIterations: 40,
      lawIterations: 80,
      noverlapIterations: 40,
    });
    const lb = runLayout(b.nodes, b.pairs, mulberry32(20261008), {
      categoryIterations: 40,
      lawIterations: 80,
      noverlapIterations: 40,
    });
    expect(a.nodes.map((n) => [n.x, n.y, n.r])).toEqual(b.nodes.map((n) => [n.x, n.y, n.r]));
    expect(la.bounds).toEqual(lb.bounds);

    const continents = buildContinents(a.nodes);
    const flows = buildCategoryFlows(a.nodes, a.pairs);
    const colors = buildCategoryColors();
    const categories = colors.categories.map((c, i) => ({
      ...c,
      lawCount: a.nodes.filter((n) => n.category === i).length,
      labelPos: continents.categories[i]?.labelPos ?? [0, 0],
    }));
    const laws = toLawsFile(a.nodes);
    const edges = toEdgesFile({
      meta: {
        snapshotId: 'test',
        egovAsof: '2026-10-09',
        corpusCreatedAt: '2026-10-08T00:00:00.000Z',
        pipelineVersion: '1.0.0',
        refsStatus: {
          complete: false, dir: '', warning: null, manifest: null, fingerprint: 't', shardCount: 0,
        },
        unknownCategories: [],
        amendingLawRefs: 0, unknownRefs: 0, selfRefs: 0, skippedTargetRefs: 0,
        ghostLaws: 0, lawEdges: a.pairs.length, refs: 0, crossLawRefs: 0,
      },
      nodes: a.nodes,
      pairs: a.pairs,
      groups: colors.groups,
      categories,
      continents,
      flows,
      bounds: la.bounds,
    }, new Map(laws.id.map((id, i) => [id, i])));

    expect(laws.n).toBe(30);
    expect(laws.id).toHaveLength(30);
    expect(edges.n).toBe(30);
    expect(continents.categories.length).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), 'hourei-mini-'));
    const { writeFileSync: w } = await import('node:fs');
    const manifest = {
      contractVersion: CONTRACT_VERSION,
      snapshotId: 'test',
      egovAsof: '2026-10-09',
      builtAt: '2026-10-08T00:00:00.000Z',
      pipelineVersion: '1.0.0',
      isMock: true,
      counts: { laws: 30, ghostLaws: 0, lawEdges: edges.n, refs: 0, crossLawRefs: 0 },
      bounds: la.bounds,
      groups: colors.groups,
      categories,
      files: [] as { path: string; bytes: number; sha256: string }[],
      eval: null,
      attribution: ['test'],
    };
    const { createHash } = await import('node:crypto');
    const put = (name: string, obj: unknown) => {
      const buf = Buffer.from(JSON.stringify(obj));
      w(join(dir, name), buf);
      manifest.files.push({ path: name, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
    };
    put('laws.json', laws);
    put('law-edges.json', edges);
    put('continents.json', continents);
    put('category-flows.json', flows);
    manifest.files.sort((x, y) => x.path.localeCompare(y.path));
    w(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const checked = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'lib/shared/validate-web-data.ts', dir],
      { cwd: join(import.meta.dirname, '../..'), encoding: 'utf8' },
    );
    expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
  });
});
