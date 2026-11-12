import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import type { CorpusLaw, CorpusManifest, LawMeta } from '../../lib/corpus-types.ts';
import { argValue, hasFlag } from '../lib/args.ts';
import { shardIndex } from '../lib/fnv1a.ts';
import { egovFetchBuffer } from '../lib/http.ts';
import { normalizeLawNum } from '../lib/kansuji.ts';
import {
  cacheDir,
  corpusDir,
  jstTodayStamp,
  latestPath,
  readLatest,
  resolveStore,
  xmlPath,
} from '../lib/paths.ts';
import { buildCorpusLaw } from './build-law.ts';
import { parseLawListCsv } from './csv.ts';
import { fetchLawsPages, mapLawType, type LawListItem } from './egov-api.ts';
import { xmlToEgovNode } from './xml-to-tree.ts';

const BULK_URL = 'https://laws.e-gov.go.jp/bulkdownload?file_section=1&only_xml_flag=true';
const SHARD_COUNT = 32;

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function downloadZip(dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const res = spawnSync('curl', ['-L', '--retry', '5', '--retry-delay', '2', '-o', tmp, BULK_URL], {
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error(`curl zip failed: status ${res.status}`);
  fs.renameSync(tmp, dest);
}

function downloadZipFetch(dest: string): void {
  downloadZip(dest);
}

function ensureUnzipped(zipFile: string, dest: string): void {
  const sample = path.join(dest, 'all_law_list.csv');
  if (fs.existsSync(sample)) return;
  fs.mkdirSync(dest, { recursive: true });
  const res = spawnSync('unzip', ['-n', '-d', dest, zipFile], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`unzip failed: status ${res.status}`);
}

function abbrevsFrom(item: LawListItem): string[] {
  const raw = item.revision_info.abbrev;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function statusOf(item: LawListItem): LawMeta['status'] {
  const repeal = item.revision_info.repeal_status;
  if (repeal && repeal !== 'None') return 'repealed';
  if (item.revision_info.current_revision_status === 'UnEnforced') return 'notYetEffective';
  return 'current';
}

function metaFromItem(
  item: LawListItem,
  oldTitles: string[],
  source: LawMeta['source'],
  extras?: Partial<Pick<LawMeta, 'articleCount' | 'supplCount' | 'hasEnact'>>,
): LawMeta {
  const rawLawType = item.law_info.law_type;
  return {
    lawId: item.law_info.law_id,
    revisionId: item.revision_info.law_revision_id,
    title: item.revision_info.law_title ?? '',
    kana: item.revision_info.law_title_kana ?? '',
    abbrevs: abbrevsFrom(item),
    oldTitles,
    num: item.law_info.law_num,
    numNorm: normalizeLawNum(item.law_info.law_num),
    lawType: mapLawType(rawLawType),
    rawLawType,
    category: item.revision_info.category ?? '',
    promulgationDate: item.law_info.promulgation_date,
    enforcementDate: item.revision_info.amendment_enforcement_date ?? null,
    status: statusOf(item),
    repealDate: item.revision_info.repeal_date ?? null,
    articleCount: extras?.articleCount ?? 0,
    supplCount: extras?.supplCount ?? 0,
    hasEnact: extras?.hasEnact ?? false,
    source,
  };
}

function metaBase(
  item: LawListItem,
  oldTitles: string[],
  source: LawMeta['source'],
): Omit<LawMeta, 'articleCount' | 'supplCount' | 'hasEnact'> {
  const full = metaFromItem(item, oldTitles, source);
  return {
    lawId: full.lawId,
    revisionId: full.revisionId,
    title: full.title,
    kana: full.kana,
    abbrevs: full.abbrevs,
    oldTitles: full.oldTitles,
    num: full.num,
    numNorm: full.numNorm,
    lawType: full.lawType,
    rawLawType: full.rawLawType,
    category: full.category,
    promulgationDate: full.promulgationDate,
    enforcementDate: full.enforcementDate,
    status: full.status,
    repealDate: full.repealDate,
    source: full.source,
  };
}

function gzipJsonl(lines: string[]): Buffer {
  const payload = lines.length === 0 ? Buffer.from('') : Buffer.from(`${lines.join('\n')}\n`, 'utf8');
  const gz = gzipSync(payload, { level: 6 });
  gz.writeUInt32LE(0, 4);
  gz[9] = 255;
  return gz;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fetchMissingXml(revisionId: string, destFile: string): Promise<boolean> {
  const url = `https://laws.e-gov.go.jp/api/2/law_file/xml/${encodeURIComponent(revisionId)}`;
  const { status, body } = await egovFetchBuffer(url);
  if (status !== 200) return false;
  const head = body.subarray(0, 200).toString('utf8');
  if (!head.includes('<Law') && !head.includes('<?xml')) return false;
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, body);
  return true;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const store = resolveStore(argValue('store'));
  const today = jstTodayStamp();
  const snapshotId = argValue('snapshot') ?? readLatest(store) ?? today.snapshotId;
  const asof = `${snapshotId.replace(/-\d+$/, '').slice(0, 4)}-${snapshotId.replace(/-\d+$/, '').slice(4, 6)}-${snapshotId.replace(/-\d+$/, '').slice(6, 8)}`;
  const cache = cacheDir(snapshotId.replace(/-\d+$/, ''), argValue('cache'));
  const outDir = corpusDir(store, snapshotId);
  const skipDownload = hasFlag('skip-download');

  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const zipFile = path.join(cache, 'all_xml.zip');
  if (!fs.existsSync(zipFile) && !skipDownload) {
    console.log('downloading all_xml.zip …');
    try {
      downloadZip(zipFile);
    } catch {
      downloadZipFetch(zipFile);
    }
  }
  if (!fs.existsSync(zipFile)) throw new Error(`ZIP not found: ${zipFile}`);
  console.log(`unzipping into ${cache} …`);
  ensureUnzipped(zipFile, cache);

  const tZip = Date.now();
  console.log(`ZIP ready (${formatMs(tZip - t0)}). fetching law lists asof=${asof} …`);

  const listCache = path.join(cache, `api-lists-${asof}.json`);
  let currentItems: LawListItem[];
  let repealedItems: LawListItem[];
  if (fs.existsSync(listCache) && !hasFlag('refresh-list')) {
    const cached = JSON.parse(fs.readFileSync(listCache, 'utf8')) as {
      current: LawListItem[];
      repealed: LawListItem[];
    };
    currentItems = cached.current;
    repealedItems = cached.repealed;
    console.log(`using cached API lists (${currentItems.length} current, ${repealedItems.length} repealed)`);
  } else {
    currentItems = await fetchLawsPages(asof, 'None');
    const repeal = await fetchLawsPages(asof, 'Repeal');
    const expire = await fetchLawsPages(asof, 'Expire');
    const loss = await fetchLawsPages(asof, 'LossOfEffectiveness');
    repealedItems = [...repeal, ...expire, ...loss];
    fs.writeFileSync(listCache, JSON.stringify({ current: currentItems, repealed: repealedItems }));
  }

  const csvFile = path.join(cache, 'all_law_list.csv');
  const csvMap = fs.existsSync(csvFile)
    ? parseLawListCsv(fs.readFileSync(csvFile, 'utf8'))
    : new Map();

  currentItems.sort((a, b) => a.law_info.law_id.localeCompare(b.law_info.law_id));
  repealedItems.sort((a, b) => a.law_info.law_id.localeCompare(b.law_info.law_id));

  const shardLines: string[][] = Array.from({ length: SHARD_COUNT }, () => []);
  const laws: LawMeta[] = [];
  const missing: { lawId: string; revisionId: string; reason: string }[] = [];
  const fromApi: string[] = [];
  let sentences = 0;
  let articles = 0;
  let nCurrent = 0;
  let nNotYet = 0;
  let processed = 0;

  const tNorm0 = Date.now();
  for (const item of currentItems) {
    const lawId = item.law_info.law_id;
    const revisionId = item.revision_info.law_revision_id;
    const oldTitles = csvMap.get(lawId)?.oldTitles ?? [];
    let file = xmlPath(cache, revisionId);
    let source: LawMeta['source'] = 'zip';
    if (!fs.existsSync(file)) {
      const ok = await fetchMissingXml(revisionId, file);
      if (!ok) {
        missing.push({ lawId, revisionId, reason: 'ZIP に無く、law_file/xml でも本文を取得できなかった' });
        processed++;
        continue;
      }
      source = 'api';
      fromApi.push(lawId);
    }
    const xml = fs.readFileSync(file, 'utf8');
    const tree = xmlToEgovNode(xml);
    const law = buildCorpusLaw(tree, metaBase(item, oldTitles, source));
    const json = JSON.stringify(law);
    shardLines[shardIndex(lawId, SHARD_COUNT)]!.push(json);
    laws.push(law.meta);
    sentences += law.sentences.length;
    articles += law.meta.articleCount;
    if (law.meta.status === 'notYetEffective') nNotYet++;
    else nCurrent++;
    processed++;
    if (processed % 200 === 0) {
      console.log(`  ${processed}/${currentItems.length} laws (${formatMs(Date.now() - tNorm0)})`);
    }
  }

  const shardInfos: CorpusManifest['shards'] = [];
  for (let i = 0; i < SHARD_COUNT; i++) {
    const name = `text-${String(i).padStart(2, '0')}.jsonl.gz`;
    const buf = gzipJsonl(shardLines[i]!);
    const dest = path.join(outDir, name);
    fs.writeFileSync(dest, buf);
    shardInfos.push({
      path: name,
      laws: shardLines[i]!.length,
      bytes: buf.length,
      sha256: sha256(buf),
    });
  }

  laws.sort((a, b) => a.lawId.localeCompare(b.lawId));
  fs.writeFileSync(path.join(outDir, 'laws.json'), `${JSON.stringify(laws)}\n`);

  const repealed: LawMeta[] = repealedItems.map((item) =>
    metaFromItem(item, csvMap.get(item.law_info.law_id)?.oldTitles ?? [], 'api'),
  );
  fs.writeFileSync(path.join(outDir, 'repealed.json'), `${JSON.stringify(repealed)}\n`);

  const createdAt = new Date().toISOString();
  const manifest: CorpusManifest = {
    snapshotId,
    egovAsof: asof,
    createdAt,
    counts: {
      laws: laws.length,
      current: nCurrent,
      notYetEffective: nNotYet,
      repealedMeta: repealed.length,
      sentences,
      articles,
    },
    shards: shardInfos,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(latestPath(store), `${snapshotId}\n`);

  const elapsedNorm = Date.now() - tNorm0;
  const elapsedAll = Date.now() - t0;
  const corpusBytes = shardInfos.reduce((s, x) => s + x.bytes, 0) + fs.statSync(path.join(outDir, 'laws.json')).size + fs.statSync(path.join(outDir, 'repealed.json')).size + fs.statSync(path.join(outDir, 'manifest.json')).size;

  const report = [
    '# コーパス構築レポート',
    '',
    `- snapshotId: ${snapshotId}`,
    `- egovAsof: ${asof}`,
    `- createdAt: ${createdAt}`,
    `- ZIP 準備まで: ${formatMs(tZip - t0)}`,
    `- 正規化: ${formatMs(elapsedNorm)}`,
    `- 全体: ${formatMs(elapsedAll)}`,
    '',
    '## 件数',
    '',
    `- 対象法令 (laws.json): ${laws.length}`,
    `- current: ${nCurrent}`,
    `- notYetEffective: ${nNotYet}`,
    `- repealedMeta: ${repealed.length}`,
    `- 本則の条 articleCount 合計: ${articles}（2026-10-08 実測 242,823 との差 ${articles - 242823}）`,
    `- 文: ${sentences}`,
    `- 附則 SupplProvision 合計: ${laws.reduce((s, m) => s + m.supplCount, 0)}（2026-10-08 実測 160,987 との差 ${laws.reduce((s, m) => s + m.supplCount, 0) - 160987}）`,
    `- 制定文あり: ${laws.filter((m) => m.hasEnact).length}`,
    `- ZIP 由来: ${laws.filter((m) => m.source === 'zip').length}`,
    `- API 補完: ${laws.filter((m) => m.source === 'api').length}`,
    `- シャード合計バイト: ${corpusBytes}`,
    '',
    '## API で本文を補った法令',
    '',
    fromApi.length === 0 ? '- （なし）' : fromApi.map((id) => `- ${id}`).join('\n'),
    '',
    '## 本文が取れなかった法令',
    '',
    missing.length === 0
      ? '- （なし）対象の 100% に本文がある。'
      : missing.map((m) => `- ${m.lawId} (${m.revisionId}): ${m.reason}`).join('\n'),
    '',
    '## 既知の問題',
    '',
    '- スナップショット日付は日本時間。verified-facts の 2026-10-08 実測と日付が違う場合、条・附則の件数は ±1% の範囲で差が出うる。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`);

  console.log(`wrote ${outDir}`);
  console.log(`laws=${laws.length} sentences=${sentences} articles=${articles} missing=${missing.length} norm=${formatMs(elapsedNorm)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
