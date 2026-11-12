import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { LawRefsFile, LawsFile, LawEdgesFile, Manifest, RefRows } from '../../lib/shared/contract.ts';
import { CONTRACT_VERSION, LAW_STATUSES, LAW_TYPES, PARTS } from '../../lib/shared/contract.ts';
import { kindIndex, kindMaskOf, pickDomKind } from './edges.ts';
import { iterateRefs } from './load.ts';
import type { GraphState, NodeRec } from './types.ts';
import { naturalCmp } from './util.ts';

const ATTR = [
  '出典: e-Gov法令検索（https://laws.e-gov.go.jp/）の法令データを加工して作成',
  '略称辞書の一部に JLaw-CiteGraph（Apache-2.0）を使用',
];

export function sortNodes(nodes: NodeRec[]): NodeRec[] {
  return [...nodes].sort((a, b) => {
    const sa = LAW_STATUSES.indexOf(a.status);
    const sb = LAW_STATUSES.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    if (a.category !== b.category) return a.category - b.category;
    return a.lawId.localeCompare(b.lawId);
  });
}

export function toLawsFile(nodes: NodeRec[]): LawsFile {
  const ordered = sortNodes(nodes);
  const index = new Map(ordered.map((n, i) => [n.lawId, i]));
  return {
    n: ordered.length,
    id: ordered.map((n) => n.lawId),
    revisionId: ordered.map((n) => n.revisionId),
    title: ordered.map((n) => n.title),
    label: ordered.map((n) => n.label),
    kana: ordered.map((n) => n.kana),
    num: ordered.map((n) => n.num),
    numNorm: ordered.map((n) => n.numNorm),
    aliases: ordered.map((n) => n.aliases),
    type: ordered.map((n) => LAW_TYPES.indexOf(n.lawType)),
    category: ordered.map((n) => n.category),
    promulgated: ordered.map((n) => n.promulgated),
    status: ordered.map((n) => LAW_STATUSES.indexOf(n.status)),
    x: ordered.map((n) => n.x),
    y: ordered.map((n) => n.y),
    r: ordered.map((n) => n.r),
    articles: ordered.map((n) => n.articleCount),
    inLaws: ordered.map((n) => n.inLaws),
    outLaws: ordered.map((n) => n.outLaws),
    inRefs: ordered.map((n) => n.inRefs),
    outRefs: ordered.map((n) => n.outRefs),
    pagerank: ordered.map((n) => n.pagerank),
    prRank: ordered.map((n) => n.prRank),
    parent: ordered.map((n) => (n.parentLawId ? index.get(n.parentLawId) ?? -1 : -1)),
    family: ordered.map((n) => index.get(n.familyLawId) ?? index.get(n.lawId) ?? 0),
    community: ordered.map((n) => n.community),
    bridge: ordered.map((n) => n.bridge),
    delegations: ordered.map((n) => n.delegations),
  };
}

export function toEdgesFile(state: GraphState, index: Map<string, number>): LawEdgesFile {
  const familyOf = new Map(state.nodes.map((n) => [n.lawId, n.familyLawId]));
  const rows = state.pairs
    .map((p) => ({
      src: index.get(p.srcLaw)!,
      tgt: index.get(p.tgtLaw)!,
      mainRefs: p.mainRefs,
      supplRefs: p.supplRefs,
      kindMask: kindMaskOf(p.kindAll),
      domKind: pickDomKind(p.mainRefs, p.kindMain, p.kindSuppl),
      intraFamily: familyOf.get(p.srcLaw) === familyOf.get(p.tgtLaw) ? 1 : 0,
    }))
    .filter((r) => r.src !== undefined && r.tgt !== undefined)
    .sort((a, b) => a.src - b.src || a.tgt - b.tgt);
  return {
    n: rows.length,
    src: rows.map((r) => r.src),
    tgt: rows.map((r) => r.tgt),
    mainRefs: rows.map((r) => r.mainRefs),
    supplRefs: rows.map((r) => r.supplRefs),
    kindMask: rows.map((r) => r.kindMask),
    domKind: rows.map((r) => r.domKind),
    intraFamily: rows.map((r) => r.intraFamily),
  };
}

interface PendingRef {
  srcLaw: string;
  tgtLaw: string;
  srcPid: string;
  tgtPid: string | null;
  tgtEnd: string | null;
  kind: number;
  part: number;
  flags: number;
  mention: string;
  start: number;
  end: number;
  needCtx: boolean;
}

function emptyRows(): RefRows {
  return {
    other: [], srcPid: [], tgtPid: [], tgtEnd: [], kind: [], part: [], flags: [], mention: [], ctx: [],
  };
}

export async function collectCrossRefs(
  refsDir: string,
  nodeIds: Set<string>,
): Promise<PendingRef[]> {
  const out: PendingRef[] = [];
  for await (const r of iterateRefs(refsDir)) {
    if (!r.tgtLaw || r.tgtLaw === r.srcLaw) continue;
    if (!nodeIds.has(r.srcLaw) || !nodeIds.has(r.tgtLaw)) continue;
    const part = PARTS.indexOf(r.part);
    out.push({
      srcLaw: r.srcLaw,
      tgtLaw: r.tgtLaw,
      srcPid: `${r.srcPid}#${r.sent}`,
      tgtPid: r.tgtPid,
      tgtEnd: r.tgtEnd,
      kind: kindIndex(r.kind),
      part: part < 0 ? PARTS.indexOf('main') : part,
      flags: r.flags,
      mention: r.mention,
      start: r.start,
      end: r.end,
      needCtx: r.part !== 'main',
    });
  }
  return out;
}

export async function loadNeededSentences(
  corpusDir: string,
  needed: Set<string>,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  if (needed.size === 0) return texts;
  for (let i = 0; i < 32; i++) {
    const p = join(corpusDir, `text-${String(i).padStart(2, '0')}.jsonl.gz`);
    if (!existsSync(p)) continue;
    const rl = createInterface({ input: createReadStream(p).pipe(createGunzip()) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const law = JSON.parse(line) as {
        meta: { lawId: string };
        sentences: { pid: string; sent: number; text: string }[];
      };
      const id = law.meta.lawId;
      for (const s of law.sentences) {
        const k = `${id}\t${s.pid}\t${s.sent}`;
        if (needed.has(k)) texts.set(k, s.text);
      }
    }
  }
  return texts;
}

function makeCtx(text: string | undefined, start: number, end: number, mention: string): string {
  if (!text) return `⟦${mention}⟧`;
  const a = Math.max(0, start);
  const b = Math.max(a, Math.min(text.length, end));
  return `${text.slice(Math.max(0, a - 30), a)}⟦${mention}⟧${text.slice(b, b + 30)}`;
}

export function buildLawRefFiles(
  pending: PendingRef[],
  index: Map<string, number>,
  prRank: Map<string, number>,
  sentences: Map<string, string>,
  partnerCap = 20,
  dirCap = 5000,
): Map<string, LawRefsFile> {
  type Row = {
    other: number;
    otherRank: number;
    srcPid: string;
    tgtPid: string | null;
    tgtEnd: string | null;
    kind: number;
    part: number;
    flags: number;
    mention: string;
    ctx: string | null;
  };
  const outMap = new Map<string, Row[]>();
  const inMap = new Map<string, Row[]>();
  const push = (map: Map<string, Row[]>, lawId: string, row: Row) => {
    const arr = map.get(lawId) ?? [];
    arr.push(row);
    map.set(lawId, arr);
  };

  for (const r of pending) {
    const srcI = index.get(r.srcLaw);
    const tgtI = index.get(r.tgtLaw);
    if (srcI === undefined || tgtI === undefined) continue;
    const pidKey = r.srcPid;
    const hash = pidKey.lastIndexOf('#');
    const pid = hash >= 0 ? pidKey.slice(0, hash) : pidKey;
    const sent = hash >= 0 ? Number(pidKey.slice(hash + 1)) : 1;
    const ctx = r.needCtx ? makeCtx(sentences.get(`${r.srcLaw}\t${pid}\t${sent}`), r.start, r.end, r.mention) : null;
    push(outMap, r.srcLaw, {
      other: tgtI,
      otherRank: prRank.get(r.tgtLaw) ?? 1e9,
      srcPid: r.srcPid,
      tgtPid: r.tgtPid,
      tgtEnd: r.tgtEnd,
      kind: r.kind,
      part: r.part,
      flags: r.flags,
      mention: r.mention,
      ctx,
    });
    push(inMap, r.tgtLaw, {
      other: srcI,
      otherRank: prRank.get(r.srcLaw) ?? 1e9,
      srcPid: r.srcPid,
      tgtPid: r.tgtPid,
      tgtEnd: r.tgtEnd,
      kind: r.kind,
      part: r.part,
      flags: r.flags,
      mention: r.mention,
      ctx,
    });
  }

  const sortRows = (rows: Row[]) =>
    rows.sort((a, b) => a.otherRank - b.otherRank || naturalCmp(a.srcPid, b.srcPid));

  const capPerPartner = (rows: Row[], k: number): Row[] => {
    const n = new Map<number, number>();
    const out: Row[] = [];
    for (const r of rows) {
      const c = n.get(r.other) ?? 0;
      if (c >= k) continue;
      n.set(r.other, c + 1);
      out.push(r);
    }
    return out;
  };

  const toRows = (rows: Row[]): RefRows => {
    const out = emptyRows();
    for (const r of rows) {
      out.other.push(r.other);
      out.srcPid.push(r.srcPid);
      out.tgtPid.push(r.tgtPid);
      out.tgtEnd.push(r.tgtEnd);
      out.kind.push(r.kind);
      out.part.push(r.part);
      out.flags.push(r.flags);
      out.mention.push(r.mention);
      out.ctx.push(r.ctx);
    }
    return out;
  };

  const laws = new Set([...outMap.keys(), ...inMap.keys()]);
  const files = new Map<string, LawRefsFile>();
  for (const lawId of laws) {
    const outAll = sortRows(outMap.get(lawId) ?? []);
    const inAll = sortRows(inMap.get(lawId) ?? []);
    files.set(lawId, {
      lawId,
      out: toRows(capPerPartner(outAll, partnerCap).slice(0, dirCap)),
      in: toRows(capPerPartner(inAll, partnerCap).slice(0, dirCap)),
      outTotal: outAll.length,
      inTotal: inAll.length,
    });
  }
  return files;
}

export function sha256Of(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function writeWebBundle(opts: {
  state: GraphState;
  destDir: string;
  refsDir: string;
  corpusDir: string;
  evalBlock: Manifest['eval'];
}): Promise<{ firstGzip: number; totalBytes: number; files: Manifest['files']; refsRowCap: number; refsPerPartnerCap: number }> {
  const { state, destDir, refsDir, corpusDir, evalBlock } = opts;
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(join(destDir, 'refs'), { recursive: true });

  const laws = toLawsFile(state.nodes);
  const index = new Map(laws.id.map((id, i) => [id, i]));
  const edges = toEdgesFile(state, index);

  const nodeIds = new Set(state.nodes.map((n) => n.lawId));
  const pending = await collectCrossRefs(refsDir, nodeIds);
  const needed = new Set<string>();
  for (const r of pending) {
    if (!r.needCtx) continue;
    const hash = r.srcPid.lastIndexOf('#');
    const pid = hash >= 0 ? r.srcPid.slice(0, hash) : r.srcPid;
    const sent = hash >= 0 ? r.srcPid.slice(hash + 1) : '1';
    needed.add(`${r.srcLaw}\t${pid}\t${sent}`);
  }
  const sentences = await loadNeededSentences(corpusDir, needed);
  const prRank = new Map(state.nodes.map((n) => [n.lawId, n.prRank]));
  const DIR_CAP = 5000;
  const MAX_TOTAL = 150_000_000;
  let partnerCap = 20;
  let refFiles = buildLawRefFiles(pending, index, prRank, sentences, partnerCap, DIR_CAP);

  const writeJson = (rel: string, obj: unknown): Buffer => {
    const buf = Buffer.from(JSON.stringify(obj));
    writeFileSync(join(destDir, rel), buf);
    return buf;
  };

  const fileBufs = new Map<string, Buffer>();
  fileBufs.set('laws.json', writeJson('laws.json', laws));
  fileBufs.set('law-edges.json', writeJson('law-edges.json', edges));
  fileBufs.set('continents.json', writeJson('continents.json', state.continents));
  fileBufs.set('category-flows.json', writeJson('category-flows.json', state.flows));
  for (const [lawId, rec] of [...refFiles.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    fileBufs.set(`refs/${lawId}.json`, writeJson(`refs/${lawId}.json`, rec));
  }

  const filesMeta = [...fileBufs.entries()]
    .map(([path, buf]) => ({ path, bytes: buf.length, sha256: sha256Of(buf) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const manifest: Manifest = {
    contractVersion: CONTRACT_VERSION,
    snapshotId: state.meta.snapshotId,
    egovAsof: state.meta.egovAsof,
    builtAt: state.meta.corpusCreatedAt,
    pipelineVersion: state.meta.pipelineVersion,
    isMock: false,
    counts: {
      laws: laws.n,
      ghostLaws: state.meta.ghostLaws,
      lawEdges: edges.n,
      refs: state.meta.refs,
      crossLawRefs: state.meta.crossLawRefs,
    },
    bounds: state.bounds,
    groups: state.groups,
    categories: state.categories,
    files: filesMeta,
    eval: evalBlock,
    attribution: ATTR,
  };
  writeJson('manifest.json', manifest);

  const { readdirSync, statSync } = await import('node:fs');
  const walkBytes = (dir: string): number => {
    let t = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) t += walkBytes(full);
      else t += statSync(full).size;
    }
    return t;
  };
  let total = walkBytes(destDir);
  for (const k of [20, 15, 10] as const) {
    if (k !== partnerCap) {
      partnerCap = k;
      refFiles = buildLawRefFiles(pending, index, prRank, sentences, partnerCap, DIR_CAP);
      for (const [lawId, rec] of [...refFiles.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        fileBufs.set(`refs/${lawId}.json`, writeJson(`refs/${lawId}.json`, rec));
      }
    }
    const filesMetaK = [...fileBufs.entries()]
      .map(([path, buf]) => ({ path, bytes: buf.length, sha256: sha256Of(buf) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    manifest.files = filesMetaK;
    writeJson('manifest.json', manifest);
    total = walkBytes(destDir);
    if (total <= MAX_TOTAL) break;
  }
  if (total > MAX_TOTAL) {
    throw new Error(`150,000,000 バイト制約を満たせない (total=${total}, refsPerPartnerCap=${partnerCap})`);
  }
  process.stderr.write(`[export] refsPerPartnerCap=${partnerCap} dirCap=${DIR_CAP} total=${total}\n`);

  const { gzipSync } = await import('node:zlib');
  let firstGzip = 0;
  for (const name of ['manifest.json', 'laws.json', 'law-edges.json', 'continents.json', 'category-flows.json']) {
    firstGzip += gzipSync(readFileSync(join(destDir, name))).length;
  }
  const walk = walkBytes;

  const pipelineRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  process.stderr.write(`[export] validate-web-data ${destDir}\n`);
  const validated = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'lib/shared/validate-web-data.ts', destDir],
    { cwd: pipelineRoot, encoding: 'utf8' },
  );
  if (validated.status !== 0) {
    throw new Error(`validate-web-data 失敗:\n${validated.stdout}${validated.stderr}`);
  }

  return { firstGzip, totalBytes: walk(destDir), files: manifest.files, refsRowCap: DIR_CAP, refsPerPartnerCap: partnerCap };
}
