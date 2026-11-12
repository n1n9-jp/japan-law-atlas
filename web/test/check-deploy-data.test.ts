import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '../lib/shared/contract.ts';
import { checkDeployData } from '../scripts/check-deploy-data.ts';

const emptyRows = {
  other: [] as number[],
  srcPid: [] as string[],
  tgtPid: [] as (string | null)[],
  tgtEnd: [] as (string | null)[],
  kind: [] as number[],
  part: [] as number[],
  flags: [] as number[],
  mention: [] as string[],
  ctx: [] as (string | null)[],
};

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function putJson(dir: string, rel: string, value: unknown): Promise<{ path: string; bytes: number; sha256: string }> {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  const buf = Buffer.from(JSON.stringify(value));
  await writeFile(full, buf);
  return { path: rel, bytes: buf.length, sha256: sha256(buf) };
}

async function writeLatest(root: string, snapshotId: string): Promise<void> {
  await putJson(root, 'latest.json', {
    contractVersion: CONTRACT_VERSION,
    snapshotId,
    dataPath: `/data/${snapshotId}/`,
  });
}

async function writeSnapshot(root: string, snapshotId: string, opts: { isMock: boolean; refs: number }): Promise<void> {
  const snap = path.join(root, snapshotId);
  await mkdir(path.join(snap, 'refs'), { recursive: true });

  const laws = {
    n: 1,
    id: ['LAW1'],
    revisionId: ['rev'],
    title: ['法令'],
    label: ['法令'],
    kana: ['ほうれい'],
    num: ['一'],
    numNorm: ['1'],
    aliases: [[]],
    type: [1],
    category: [0],
    promulgated: [20261009],
    status: [0],
    x: [0],
    y: [0],
    r: [1],
    articles: [1],
    inLaws: [0],
    outLaws: [0],
    inRefs: [0],
    outRefs: [0],
    pagerank: [1],
    prRank: [1],
    parent: [-1],
    family: [0],
    community: [0],
    bridge: [0],
    delegations: [0],
  };
  const edges = { n: 0, src: [], tgt: [], mainRefs: [], supplRefs: [], kindMask: [], domKind: [], intraFamily: [] };
  const continents = {
    categories: [{ id: 0, polygons: [] as number[][][], area: 1, labelPos: [0, 0] as [number, number] }],
    groups: [{ id: 0, polygons: [] as number[][][], labelPos: [0, 0] as [number, number] }],
  };
  const flows = { n: 0, src: [], tgt: [], refs: [] };

  const files: { path: string; bytes: number; sha256: string }[] = [];
  files.push(await putJson(snap, 'laws.json', laws));
  files.push(await putJson(snap, 'law-edges.json', edges));
  files.push(await putJson(snap, 'continents.json', continents));
  files.push(await putJson(snap, 'category-flows.json', flows));

  for (let i = 0; i < opts.refs; i++) {
    const id = `LAW${String(i).padStart(4, '0')}`;
    files.push(await putJson(snap, `refs/${id}.json`, {
      lawId: id,
      out: emptyRows,
      in: emptyRows,
      outTotal: 0,
      inTotal: 0,
    }));
  }

  const manifest = {
    contractVersion: CONTRACT_VERSION,
    snapshotId,
    egovAsof: '2026-10-09',
    builtAt: '2026-10-09T00:00:00.000Z',
    pipelineVersion: '1.0.0',
    isMock: opts.isMock,
    counts: { laws: 1, ghostLaws: 0, lawEdges: 0, refs: 0, crossLawRefs: 0 },
    bounds: [0, 0, 1, 1],
    groups: [{ id: 0, name: '統治', hue: 0 }],
    categories: [{ id: 0, name: '憲法', groupId: 0, color: [1, 2, 3], lawCount: 1, labelPos: [0, 0] }],
    files,
    eval: null,
    attribution: ['出典: e-Gov法令検索'],
  };
  await putJson(snap, 'manifest.json', manifest);
}

const temps: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hla-deploy-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('checkDeployData', () => {
  it('仮データは Preview では通り、本番では mock で落ちる', async () => {
    const root = await tempRoot();
    await writeLatest(root, 'mock-20261008');
    await writeSnapshot(root, 'mock-20261008', { isMock: true, refs: 2 });

    const preview = await checkDeployData({ dataRoot: root });
    expect(preview.ok).toBe(true);
    expect(preview.mode).toBe('preview');
    expect(preview.snapshotId).toBe('mock-20261008');

    const production = await checkDeployData({ dataRoot: root, production: true, minRefs: 1 });
    expect(production.ok).toBe(false);
    expect(production.mode).toBe('production');
    expect(production.issues.some((m) => m.includes('mock'))).toBe(true);
  });

  it('本物の形のデータなら本番でも通る', async () => {
    const root = await tempRoot();
    await writeLatest(root, '20261009');
    await writeSnapshot(root, '20261009', { isMock: false, refs: 1000 });

    const result = await checkDeployData({ dataRoot: root, production: true });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.snapshotId).toBe('20261009');
    expect(result.mode).toBe('production');
    expect(result.files).toBeGreaterThan(1000);
  });

  it('余分なスナップショットのディレクトリがあると落ちる', async () => {
    const root = await tempRoot();
    await writeLatest(root, '20261009');
    await writeSnapshot(root, '20261009', { isMock: false, refs: 2 });
    await mkdir(path.join(root, 'extra-snap'));

    const result = await checkDeployData({ dataRoot: root });
    expect(result.ok).toBe(false);
    expect(result.issues.some((m) => m.includes('extra-snap') || m.includes('だけ'))).toBe(true);
  });

  it('上限を差し替えるとサイズ超過で落ちる', async () => {
    const root = await tempRoot();
    await writeLatest(root, '20261009');
    await writeSnapshot(root, '20261009', { isMock: false, refs: 1000 });

    const result = await checkDeployData({ dataRoot: root, production: true, maxTotalBytes: 1 });
    expect(result.ok).toBe(false);
    expect(result.issues.some((m) => m.includes('上限') && m.includes('1 bytes'))).toBe(true);
  });
});
