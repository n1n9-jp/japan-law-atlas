import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  categoryFlowsFileSchema,
  continentsFileSchema,
  lawEdgesFileSchema,
  lawRefsFileSchema,
  lawsFileSchema,
  manifestSchema,
} from './contract-schema';
import { LAW_STATUSES, LAW_TYPES, PARTS, REF_KINDS, type Manifest } from './contract';

const FIRST_FILES = ['manifest.json', 'laws.json', 'law-edges.json', 'continents.json', 'category-flows.json'] as const;
const MAX_FIRST_GZIP = 3 * 1024 * 1024;
const MAX_TOTAL = 150 * 1024 * 1024;

export interface ValidationIssue {
  path: string;
  message: string;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function checkLen(label: string, n: number, arrs: Record<string, unknown[]>, issues: ValidationIssue[], file: string): void {
  for (const [key, arr] of Object.entries(arrs)) {
    if (arr.length !== n) issues.push({ path: file, message: `${label}.${key} length ${arr.length} !== n ${n}` });
  }
}

function inRange(name: string, values: number[], lo: number, hi: number, issues: ValidationIssue[], file: string): void {
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < lo || v > hi) {
      issues.push({ path: file, message: `${name}[${i}]=${v} out of [${lo}, ${hi}]` });
      return;
    }
  }
}

function checkLawsOrder(
  n: number,
  status: number[],
  category: number[],
  id: string[],
  issues: ValidationIssue[],
): void {
  for (let i = 1; i < n; i++) {
    const a = [status[i - 1]!, category[i - 1]!, id[i - 1]!] as const;
    const b = [status[i]!, category[i]!, id[i]!] as const;
    const ok = a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])));
    if (!ok) {
      issues.push({ path: 'laws.json', message: `sort order broken at ${i}` });
      return;
    }
  }
}

function checkEdgesOrder(n: number, src: number[], tgt: number[], issues: ValidationIssue[]): void {
  for (let i = 1; i < n; i++) {
    const ok = src[i - 1]! < src[i]! || (src[i - 1] === src[i] && tgt[i - 1]! <= tgt[i]!);
    if (!ok) {
      issues.push({ path: 'law-edges.json', message: `sort order broken at ${i}` });
      return;
    }
  }
}

async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await listFilesRecursive(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

export async function validateWebData(dir: string): Promise<{ ok: boolean; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  const manifestRaw = await readFile(path.join(dir, 'manifest.json'));
  const manifestJson: unknown = JSON.parse(manifestRaw.toString('utf8'));
  const manifestParsed = manifestSchema.safeParse(manifestJson);
  if (!manifestParsed.success) {
    issues.push({ path: 'manifest.json', message: manifestParsed.error.message });
    return { ok: false, issues };
  }
  const manifest: Manifest = manifestParsed.data;

  const lawsRaw = await readFile(path.join(dir, 'laws.json'));
  const edgesRaw = await readFile(path.join(dir, 'law-edges.json'));
  const continentsRaw = await readFile(path.join(dir, 'continents.json'));
  const flowsRaw = await readFile(path.join(dir, 'category-flows.json'));

  const lawsParsed = lawsFileSchema.safeParse(JSON.parse(lawsRaw.toString('utf8')));
  const edgesParsed = lawEdgesFileSchema.safeParse(JSON.parse(edgesRaw.toString('utf8')));
  const continentsParsed = continentsFileSchema.safeParse(JSON.parse(continentsRaw.toString('utf8')));
  const flowsParsed = categoryFlowsFileSchema.safeParse(JSON.parse(flowsRaw.toString('utf8')));

  if (!lawsParsed.success) issues.push({ path: 'laws.json', message: lawsParsed.error.message });
  if (!edgesParsed.success) issues.push({ path: 'law-edges.json', message: edgesParsed.error.message });
  if (!continentsParsed.success) issues.push({ path: 'continents.json', message: continentsParsed.error.message });
  if (!flowsParsed.success) issues.push({ path: 'category-flows.json', message: flowsParsed.error.message });
  if (!lawsParsed.success || !edgesParsed.success || !continentsParsed.success || !flowsParsed.success) {
    return { ok: false, issues };
  }

  const laws = lawsParsed.data;
  const edges = edgesParsed.data;
  const flows = flowsParsed.data;
  const nLaw = laws.n;
  const nCat = manifest.categories.length;

  checkLen('laws', nLaw, {
    id: laws.id, revisionId: laws.revisionId, title: laws.title, label: laws.label, kana: laws.kana,
    num: laws.num, numNorm: laws.numNorm, aliases: laws.aliases, type: laws.type, category: laws.category,
    promulgated: laws.promulgated, status: laws.status, x: laws.x, y: laws.y, r: laws.r, articles: laws.articles,
    inLaws: laws.inLaws, outLaws: laws.outLaws, inRefs: laws.inRefs, outRefs: laws.outRefs,
    pagerank: laws.pagerank, prRank: laws.prRank, parent: laws.parent, family: laws.family,
    community: laws.community, bridge: laws.bridge, delegations: laws.delegations,
  }, issues, 'laws.json');
  checkLen('edges', edges.n, {
    src: edges.src, tgt: edges.tgt, mainRefs: edges.mainRefs, supplRefs: edges.supplRefs,
    kindMask: edges.kindMask, domKind: edges.domKind, intraFamily: edges.intraFamily,
  }, issues, 'law-edges.json');
  checkLen('flows', flows.n, { src: flows.src, tgt: flows.tgt, refs: flows.refs }, issues, 'category-flows.json');

  inRange('type', laws.type, 0, LAW_TYPES.length - 1, issues, 'laws.json');
  inRange('status', laws.status, 0, LAW_STATUSES.length - 1, issues, 'laws.json');
  inRange('category', laws.category, 0, Math.max(0, nCat - 1), issues, 'laws.json');
  inRange('parent', laws.parent, -1, nLaw - 1, issues, 'laws.json');
  inRange('family', laws.family, 0, nLaw - 1, issues, 'laws.json');
  inRange('src', edges.src, 0, nLaw - 1, issues, 'law-edges.json');
  inRange('tgt', edges.tgt, 0, nLaw - 1, issues, 'law-edges.json');
  inRange('domKind', edges.domKind, 0, REF_KINDS.length - 1, issues, 'law-edges.json');
  inRange('intraFamily', edges.intraFamily, 0, 1, issues, 'law-edges.json');
  if (nCat > 0) {
    inRange('flow.src', flows.src, 0, nCat - 1, issues, 'category-flows.json');
    inRange('flow.tgt', flows.tgt, 0, nCat - 1, issues, 'category-flows.json');
  }

  checkLawsOrder(nLaw, laws.status, laws.category, laws.id, issues);
  checkEdgesOrder(edges.n, edges.src, edges.tgt, issues);

  if (manifest.counts.laws !== nLaw) issues.push({ path: 'manifest.json', message: `counts.laws ${manifest.counts.laws} !== laws.n ${nLaw}` });
  if (manifest.counts.lawEdges !== edges.n) issues.push({ path: 'manifest.json', message: `counts.lawEdges !== edges.n` });

  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  let totalBytes = 0;
  const diskFiles = await listFilesRecursive(dir);
  for (const rel of diskFiles) {
    const st = await stat(path.join(dir, rel));
    totalBytes += st.size;
  }
  if (totalBytes > MAX_TOTAL) issues.push({ path: dir, message: `total ${totalBytes} > 150MB` });

  for (const [rel, meta] of listed) {
    const full = path.join(dir, rel);
    let buf: Buffer;
    try {
      buf = await readFile(full);
    } catch {
      issues.push({ path: rel, message: 'listed in manifest.files but missing' });
      continue;
    }
    if (buf.length !== meta.bytes) issues.push({ path: rel, message: `bytes ${buf.length} !== manifest ${meta.bytes}` });
    const hash = sha256(buf);
    if (hash !== meta.sha256) issues.push({ path: rel, message: `sha256 mismatch` });
  }

  let firstGzip = 0;
  for (const name of FIRST_FILES) {
    const buf = await readFile(path.join(dir, name));
    firstGzip += gzipSync(buf).length;
  }
  if (firstGzip > MAX_FIRST_GZIP) issues.push({ path: dir, message: `first 5 gzip ${firstGzip} > 3MB` });

  const refsDir = path.join(dir, 'refs');
  try {
    const refFiles = await readdir(refsDir);
    for (const name of refFiles) {
      if (!name.endsWith('.json')) continue;
      const raw = await readFile(path.join(refsDir, name), 'utf8');
      const parsed = lawRefsFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        issues.push({ path: `refs/${name}`, message: parsed.error.message });
        continue;
      }
      const refs = parsed.data;
      const checkRows = (label: string, rows: typeof refs.out) => {
        const m = rows.other.length;
        checkLen(label, m, {
          other: rows.other, srcPid: rows.srcPid, tgtPid: rows.tgtPid, tgtEnd: rows.tgtEnd,
          kind: rows.kind, part: rows.part, flags: rows.flags, mention: rows.mention, ctx: rows.ctx,
        }, issues, `refs/${name}`);
        inRange(`${label}.other`, rows.other, 0, nLaw - 1, issues, `refs/${name}`);
        inRange(`${label}.kind`, rows.kind, 0, REF_KINDS.length - 1, issues, `refs/${name}`);
        inRange(`${label}.part`, rows.part, 0, PARTS.length - 1, issues, `refs/${name}`);
      };
      checkRows('out', refs.out);
      checkRows('in', refs.in);
    }
  } catch {
    // refs/ は空でもよい（仮データの途中）
  }

  return { ok: issues.length === 0, issues };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: tsx lib/shared/validate-web-data.ts <data-dir>');
    process.exit(2);
  }
  const result = await validateWebData(path.resolve(dir));
  if (!result.ok) {
    for (const issue of result.issues) console.error(`${issue.path}: ${issue.message}`);
    process.exit(1);
  }
  console.log('ok');
}

const isMain = process.argv[1] && path.basename(process.argv[1]).includes('validate-web-data');
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
