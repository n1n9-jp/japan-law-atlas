import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { csvToObjects, toCsv } from './csv.ts';
import {
  EXPECTED_JLAW_PAIR_ROWS,
  EXPECTED_LAWVIS_LAWS,
  EXPECTED_LAWVIS_PAIRS,
  FETCH_USER_AGENT,
  JLAW_CITES_URL,
  JLAW_PRECISION_URL,
  JLAW_RECALL_URL,
  LAWVIS_GRAPH_URL,
  LAWVIS_KEYS,
  MIN_INTERVAL_MS,
} from './expected.ts';
import { writeText } from './io.ts';
import type { EvalPaths } from './paths.ts';
import type { ExternalCounts } from './types.ts';

const RETRY_WAIT_MS = [1000, 2000, 4000, 8000, 16000];

export async function fetchExternal(paths: EvalPaths, cacheDir: string): Promise<ExternalCounts> {
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(path.join(cacheDir, 'lawvis'), { recursive: true });
  mkdirSync(paths.prefetchExternal, { recursive: true });
  mkdirSync(paths.externalDir, { recursive: true });

  const pairSet = new Set<string>();
  const lawSet = new Set<string>();
  let lastAt = 0;
  for (const key of LAWVIS_KEYS) {
    lastAt = await throttle(lastAt);
    const json = await fetchJson(LAWVIS_GRAPH_URL(key));
    const graph = parseLawvisGraph(json);
    for (const id of graph.laws) lawSet.add(id);
    for (const pair of graph.pairs) pairSet.add(pair);
  }

  const lawvisRows: string[][] = [['src_law_id', 'tgt_law_id']];
  for (const pair of [...pairSet].sort()) {
    const [src, tgt] = pair.split('\t');
    lawvisRows.push([src!, tgt!]);
  }
  const lawvisCsv = toCsv(lawvisRows);

  const citesText = await fetchText(JLAW_CITES_URL);
  const precisionText = await fetchText(JLAW_PRECISION_URL);
  const recallText = await fetchText(JLAW_RECALL_URL);
  const cites = csvToObjects(citesText);
  const jlawRows: string[][] = [['src_law_id', 'tgt_law_id', 'n_citations']];
  for (const row of cites) {
    jlawRows.push([row.src_law_id ?? '', row.tgt_law_id ?? '', row.n_citations ?? '']);
  }
  const jlawCsv = toCsv(jlawRows);

  writeText(path.join(paths.prefetchExternal, 'lawvis-pairs.csv'), lawvisCsv);
  writeText(path.join(paths.prefetchExternal, 'jlaw-pairs.csv'), jlawCsv);
  writeText(path.join(paths.prefetchExternal, 'jlaw-precision-sample.csv'), precisionText);
  writeText(path.join(paths.prefetchExternal, 'jlaw-recall-gold-sample.csv'), recallText);
  copyExternalIntoSnapshot(paths);

  const precision = csvToObjects(precisionText);
  const labelsFilled = precision.filter((r) => (r.label_O_X ?? '').trim() !== '').length;
  const counts: ExternalCounts = {
    lawvisLaws: lawSet.size,
    lawvisPairs: pairSet.size,
    lawvisLawsDelta: lawSet.size - EXPECTED_LAWVIS_LAWS,
    lawvisPairsDelta: pairSet.size - EXPECTED_LAWVIS_PAIRS,
    jlawRows: cites.length,
    jlawRowsDelta: cites.length - EXPECTED_JLAW_PAIR_ROWS,
    jlawPrecisionRecords: precision.length,
    jlawPrecisionLabelsFilled: labelsFilled,
  };
  writeFileSync(path.join(paths.prefetchExternal, 'counts.json'), JSON.stringify(counts, null, 2) + '\n');
  return counts;
}

export function copyExternalIntoSnapshot(paths: EvalPaths): void {
  mkdirSync(paths.externalDir, { recursive: true });
  const names = [
    'lawvis-pairs.csv',
    'jlaw-pairs.csv',
    'jlaw-precision-sample.csv',
    'jlaw-recall-gold-sample.csv',
  ] as const;
  for (const name of names) {
    const src = path.join(paths.prefetchExternal, name);
    if (!existsSync(src)) continue;
    copyFileSync(src, path.join(paths.externalDir, name));
  }
}

export function loadExternalCounts(paths: EvalPaths): ExternalCounts {
  const lawvisText = readExisting(
    paths.lawvisPairs,
    path.join(paths.prefetchExternal, 'lawvis-pairs.csv'),
  );
  const jlawText = readExisting(
    paths.jlawPairs,
    path.join(paths.prefetchExternal, 'jlaw-pairs.csv'),
  );
  const precisionText = readExisting(
    paths.jlawPrecision,
    path.join(paths.prefetchExternal, 'jlaw-precision-sample.csv'),
  );
  const lawvis = csvToObjects(lawvisText);
  const laws = new Set<string>();
  for (const row of lawvis) {
    if (row.src_law_id) laws.add(row.src_law_id);
    if (row.tgt_law_id) laws.add(row.tgt_law_id);
  }
  const jlaw = csvToObjects(jlawText);
  const precision = csvToObjects(precisionText);
  return {
    lawvisLaws: laws.size,
    lawvisPairs: lawvis.length,
    lawvisLawsDelta: laws.size - EXPECTED_LAWVIS_LAWS,
    lawvisPairsDelta: lawvis.length - EXPECTED_LAWVIS_PAIRS,
    jlawRows: jlaw.length,
    jlawRowsDelta: jlaw.length - EXPECTED_JLAW_PAIR_ROWS,
    jlawPrecisionRecords: precision.length,
    jlawPrecisionLabelsFilled: precision.filter((r) => (r.label_O_X ?? '').trim() !== '').length,
  };
}

function readExisting(primary: string, fallback: string): string {
  if (existsSync(primary)) return readFileSync(primary, 'utf8');
  if (existsSync(fallback)) return readFileSync(fallback, 'utf8');
  throw new Error(`missing external file: ${primary} (and ${fallback})`);
}

async function throttle(lastAt: number): Promise<number> {
  const wait = lastAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_WAIT_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': FETCH_USER_AGENT } });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= RETRY_WAIT_MS.length) break;
      await sleep(RETRY_WAIT_MS[attempt]!);
    }
  }
  throw lastError ?? new Error(`failed ${url}`);
}

async function fetchJson(url: string): Promise<unknown> {
  const text = await fetchText(url);
  return JSON.parse(text) as unknown;
}

function parseLawvisGraph(json: unknown): { laws: string[]; pairs: string[] } {
  if (typeof json !== 'object' || json === null) throw new Error('lawvis graph is not an object');
  const obj = json as { nodes?: unknown; edges?: unknown };
  const laws: string[] = [];
  if (Array.isArray(obj.nodes)) {
    for (const node of obj.nodes) {
      if (typeof node !== 'object' || node === null) continue;
      const rec = node as { id?: unknown; lawId?: unknown };
      const id = typeof rec.id === 'string' ? rec.id : typeof rec.lawId === 'string' ? rec.lawId : null;
      if (id) laws.push(id);
    }
  }
  const pairs: string[] = [];
  if (Array.isArray(obj.edges)) {
    for (const edge of obj.edges) {
      if (!Array.isArray(edge) || edge.length < 2) continue;
      const src = edge[0];
      const tgt = edge[1];
      if (typeof src === 'string' && typeof tgt === 'string') pairs.push(`${src}\t${tgt}`);
    }
  }
  return { laws, pairs };
}
