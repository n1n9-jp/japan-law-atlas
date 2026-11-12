import {
  categoryFlowsFileSchema,
  continentsFileSchema,
  lawEdgesFileSchema,
  lawRefsFileSchema,
  latestPointerSchema,
  lawsFileSchema,
  manifestSchema,
} from './shared/contract-schema';
import type {
  CategoryFlowsFile,
  ContinentsFile,
  LatestPointer,
  LawEdgesFile,
  LawRefsFile,
  LawsFile,
  Manifest,
} from './shared/contract';

export interface AtlasData {
  pointer: LatestPointer;
  manifest: Manifest;
  laws: LawsFile;
  edges: LawEdgesFile;
  continents: ContinentsFile;
  flows: CategoryFlowsFile;
}

export async function loadAtlasData(): Promise<AtlasData> {
  const latestRes = await fetch('/data/latest.json', { cache: 'no-store' });
  if (!latestRes.ok) throw new Error('latest.json を読めません');
  const pointer = latestPointerSchema.parse(await latestRes.json());
  if (pointer.contractVersion !== 1) throw new Error('データの版が合いません');
  const base = pointer.dataPath.endsWith('/') ? pointer.dataPath : `${pointer.dataPath}/`;
  const [manifest, laws, edges, continents, flows] = await Promise.all([
    fetchJson(`${base}manifest.json`, manifestSchema, { dropFiles: true }),
    fetchJson(`${base}laws.json`, lawsFileSchema),
    fetchJson(`${base}law-edges.json`, lawEdgesFileSchema),
    fetchJson(`${base}continents.json`, continentsFileSchema),
    fetchJson(`${base}category-flows.json`, categoryFlowsFileSchema),
  ]);
  return { pointer, manifest, laws, edges, continents, flows };
}

function fetchJson<T>(url: string, schema: { parse: (v: unknown) => T }, opts?: { dropFiles?: boolean }): Promise<T> {
  return fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    const raw: unknown = await res.json();
    if (opts?.dropFiles && raw && typeof raw === 'object' && 'files' in raw) {
      (raw as { files: unknown }).files = [];
    }
    return schema.parse(raw);
  });
}

const refsCache = new Map<string, LawRefsFile>();

export async function loadLawRefs(dataPath: string, lawId: string): Promise<LawRefsFile> {
  const hit = refsCache.get(lawId);
  if (hit) return hit;
  const base = dataPath.endsWith('/') ? dataPath : `${dataPath}/`;
  const res = await fetch(`${base}refs/${lawId}.json`);
  if (!res.ok) throw new Error('refs missing');
  const parsed = lawRefsFileSchema.parse(await res.json());
  refsCache.set(lawId, parsed);
  return parsed;
}
