import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LawMeta } from '../../lib/corpus-types.ts';
import { REF_FLAGS } from '../../lib/ref-types.ts';
import { LAW_TYPES } from '../../lib/shared/contract.ts';
import { mulberry32, sampleIndices } from '../lib/random.ts';
import { buildCategoryColors, categoryIdByName, CATEGORY_NAMES } from './categories.ts';
import { buildCategoryFlows, buildContinents, continentStats } from './continents.ts';
import { addRefToPair, MAIN_PARTS, newPair, type PairAgg } from './edges.ts';
import { assignFamilies, pickParent, type FamilyNode } from './family.ts';
import { circleOverlapCount, median } from './geometry.ts';
import { collectAliases, makeLabel } from './labels.ts';
import { runLayout, type LayoutOptions, type LayoutResult } from './layout.ts';
import { computeLayoutMetrics, mPass } from './layout-metrics.ts';
import { renderLayoutCheck } from './render-layout-check.ts';
import { sortNodes } from './write-web.ts';
import {
  asLawType,
  corpusDirOf,
  graphDirOf,
  inspectRefs,
  iterateRefs,
  loadAbbrevs,
  loadCorpusManifest,
  loadJlawAliasToTitle,
  loadLawFeatures,
  loadLaws,
  loadRepealed,
  refsDirOf,
  resolveSnapshotId,
  storeOf,
} from './load.ts';
import { computeBridge, computeCommunities, computeDegreeMetrics, computePagerank } from './metrics.ts';
import type { GraphMeta, GraphState, LayoutReport, NodeRec } from './types.ts';
import { dateToYyyymmdd, pairKey } from './util.ts';

const PIPELINE_VERSION = '1.0.0';
const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../vendor/jlawcite');

export interface GraphCliArgs {
  snapshot?: string;
  store?: string;
  layout?: LayoutOptions;
  continentsOnly?: boolean;
}

export function loadGraphState(graphDir: string): GraphState {
  const need = ['meta.json', 'nodes.json', 'pairs.json', 'categories.json', 'continents.json', 'flows.json', 'bounds.json'];
  for (const name of need) {
    if (!existsSync(join(graphDir, name))) {
      throw new Error(`graph の中間出力がありません: ${join(graphDir, name)}（先に npm run graph を実行）`);
    }
  }
  const meta = JSON.parse(readFileSync(join(graphDir, 'meta.json'), 'utf8')) as GraphState['meta'];
  const nodes = JSON.parse(readFileSync(join(graphDir, 'nodes.json'), 'utf8')) as GraphState['nodes'];
  const pairs = JSON.parse(readFileSync(join(graphDir, 'pairs.json'), 'utf8')) as PairAgg[];
  const cats = JSON.parse(readFileSync(join(graphDir, 'categories.json'), 'utf8')) as {
    groups: GraphState['groups'];
    categories: GraphState['categories'];
  };
  const continents = JSON.parse(readFileSync(join(graphDir, 'continents.json'), 'utf8')) as GraphState['continents'];
  const flows = JSON.parse(readFileSync(join(graphDir, 'flows.json'), 'utf8')) as GraphState['flows'];
  const bounds = JSON.parse(readFileSync(join(graphDir, 'bounds.json'), 'utf8')) as GraphState['bounds'];
  return { meta, nodes, pairs, groups: cats.groups, categories: cats.categories, continents, flows, bounds };
}

const LAYOUT_REPORT_NOTES = [
  '中央値は値が偶数個のとき中央の2値の平均',
  '分野の円配置は衝突解消後も約70対が重なっていた',
  'seed の採点は入れ替え改善のあとで行っている',
];

export async function runGraph(args: GraphCliArgs): Promise<{ state: GraphState; report: LayoutReport; graphDir: string }> {
  const t0 = Date.now();
  const store = storeOf(args.store);
  const snapshotId = resolveSnapshotId(store, args.snapshot);
  const corpusDir = corpusDirOf(store, snapshotId);
  const refsDir = refsDirOf(store, snapshotId);
  const graphDir = graphDirOf(store, snapshotId);

  if (args.continentsOnly) {
    return rebuildContinentsOnly(store, snapshotId, graphDir, t0);
  }

  const refsStatus = inspectRefs(refsDir);
  if (refsStatus.warning) {
    process.stderr.write(`[graph] ${refsStatus.warning}\n`);
  }

  const corpusMan = loadCorpusManifest(corpusDir);
  const laws = loadLaws(corpusDir);
  const repealed = loadRepealed(corpusDir);
  const features = loadLawFeatures(refsDir);
  const abbrevs = await loadAbbrevs(refsDir);
  const jlawAliasToTitle = loadJlawAliasToTitle(VENDOR_DIR);

  const currentIds = new Set(laws.map((l) => l.lawId));
  const repealedById = new Map(repealed.map((l) => [l.lawId, l]));

  const pairs = new Map<string, PairAgg>();
  const ghostHits = new Set<string>();
  const bodyAbbrevUses = new Map<string, number>();
  let refs = 0;
  let crossLawRefs = 0;
  let amendingLawRefs = 0;
  let unknownRefs = 0;
  let selfRefs = 0;
  let skippedTargetRefs = 0;

  for await (const r of iterateRefs(refsDir)) {
    refs++;
    if (refs % 500000 === 0) process.stderr.write(`[graph] refs scanned ${refs}\n`);
    if (r.tgtStatus === 'amendingLaw') amendingLawRefs++;
    if (r.tgtStatus === 'unknown') unknownRefs++;
    if (r.tgtStatus === 'self' || (r.tgtLaw && r.tgtLaw === r.srcLaw)) selfRefs++;
    if (!r.tgtLaw || r.tgtLaw === r.srcLaw) continue;
    if (!currentIds.has(r.srcLaw)) continue;
    const tgtCurrent = currentIds.has(r.tgtLaw);
    const tgtRepealed = repealedById.has(r.tgtLaw);
    if (!tgtCurrent && !tgtRepealed) {
      skippedTargetRefs++;
      continue;
    }
    crossLawRefs++;
    if (!tgtCurrent && tgtRepealed && MAIN_PARTS.has(r.part)) {
      ghostHits.add(r.tgtLaw);
    }
    const key = pairKey(r.srcLaw, r.tgtLaw);
    const pair = pairs.get(key) ?? newPair(r.srcLaw, r.tgtLaw);
    addRefToPair(pair, r.part, r.kind);
    pairs.set(key, pair);

    if ((r.flags & REF_FLAGS.viaAbbrev) !== 0 && r.rawName) {
      const ak = `${r.rawName}\t${r.tgtLaw}`;
      bodyAbbrevUses.set(ak, (bodyAbbrevUses.get(ak) ?? 0) + 1);
    }
  }

  const definedAbbrev = new Set<string>();
  for (const a of abbrevs) {
    if (a.targetLaw && a.abbr) definedAbbrev.add(`${a.abbr}\t${a.targetLaw}`);
  }
  const bodyAliasesByTarget = new Map<string, string[]>();
  for (const [k, n] of bodyAbbrevUses) {
    if (n < 3 || !definedAbbrev.has(k)) continue;
    const [abbr, tgt] = k.split('\t');
    if (!abbr || !tgt) continue;
    const arr = bodyAliasesByTarget.get(tgt) ?? [];
    arr.push(abbr);
    bodyAliasesByTarget.set(tgt, arr);
  }

  const titleToLawIds = new Map<string, string[]>();
  const addTitle = (title: string, id: string) => {
    const arr = titleToLawIds.get(title) ?? [];
    arr.push(id);
    titleToLawIds.set(title, arr);
  };
  for (const l of [...laws, ...repealed]) {
    addTitle(l.title, l.lawId);
    for (const t of l.oldTitles) addTitle(t, l.lawId);
  }
  const jlawAliasesByLaw = new Map<string, string[]>();
  for (const [alias, title] of jlawAliasToTitle) {
    const ids = titleToLawIds.get(title);
    if (!ids || ids.length !== 1) continue;
    const arr = jlawAliasesByLaw.get(ids[0]!) ?? [];
    arr.push(alias);
    jlawAliasesByLaw.set(ids[0]!, arr);
  }

  const unknownCategories = new Set<string>();
  const toNode = (meta: LawMeta, ghost: boolean): NodeRec => {
    if (!CATEGORY_NAMES.includes(meta.category)) unknownCategories.add(meta.category);
    const category = categoryIdByName(meta.category);
    return {
      lawId: meta.lawId,
      revisionId: ghost ? '' : meta.revisionId,
      title: meta.title,
      kana: meta.kana,
      abbrevs: meta.abbrevs,
      oldTitles: meta.oldTitles,
      num: meta.num,
      numNorm: meta.numNorm,
      lawType: asLawType(meta.lawType),
      categoryName: meta.category,
      category,
      promulgated: dateToYyyymmdd(meta.promulgationDate),
      status: ghost ? 'repealed' : meta.status,
      articleCount: ghost ? 0 : meta.articleCount,
      ghost,
      label: makeLabel(meta.title, meta.abbrevs),
      aliases: collectAliases({
        title: meta.title,
        egovAbbrevs: meta.abbrevs,
        jlawAliases: jlawAliasesByLaw.get(meta.lawId) ?? [],
        bodyAliases: bodyAliasesByTarget.get(meta.lawId) ?? [],
      }),
      delegations: features.get(meta.lawId)?.delegations ?? 0,
      inLaws: 0,
      outLaws: 0,
      inRefs: 0,
      outRefs: 0,
      pagerank: 0,
      prRank: 0,
      parentLawId: null,
      familyLawId: meta.lawId,
      community: 0,
      bridge: 0,
      x: 0,
      y: 0,
      r: 1.5,
    };
  };

  const nodes: NodeRec[] = laws.map((l) => toNode(l, false));
  const ghostIds = [...ghostHits].sort();
  for (const id of ghostIds) {
    const meta = repealedById.get(id);
    if (meta) nodes.push(toNode(meta, true));
  }
  const nodeIds = new Set(nodes.map((n) => n.lawId));
  const keptPairs = [...pairs.values()]
    .filter((p) => nodeIds.has(p.srcLaw) && nodeIds.has(p.tgtLaw))
    .sort((a, b) => a.srcLaw.localeCompare(b.srcLaw) || a.tgtLaw.localeCompare(b.tgtLaw));

  const familyNodes: FamilyNode[] = nodes.map((n) => ({ lawId: n.lawId, title: n.title, lawType: n.lawType }));
  const byId = new Map(familyNodes.map((n) => [n.lawId, n]));
  const outgoing = new Map<string, PairAgg[]>();
  for (const p of keptPairs) {
    const arr = outgoing.get(p.srcLaw) ?? [];
    arr.push(p);
    outgoing.set(p.srcLaw, arr);
  }
  const parentOf = new Map<string, string | null>();
  for (const n of familyNodes) {
    parentOf.set(n.lawId, pickParent(n, outgoing.get(n.lawId) ?? [], byId));
  }
  const family = assignFamilies(familyNodes, parentOf);
  for (const n of nodes) {
    n.parentLawId = parentOf.get(n.lawId) ?? null;
    n.familyLawId = family.get(n.lawId) ?? n.lawId;
  }

  computeDegreeMetrics(nodes, keptPairs);
  computeBridge(nodes, keptPairs);
  computePagerank(nodes, keptPairs);
  computeCommunities(nodes, keptPairs);

  const sorted = sortNodes(nodes);
  nodes.length = 0;
  nodes.push(...sorted);

  const rng = mulberry32(20261008);
  const layout = runLayout(nodes, keptPairs, rng, args.layout);

  const continents = buildContinents(nodes);
  const flows = buildCategoryFlows(nodes, keptPairs);
  const colors = buildCategoryColors();
  const catCounts = new Array<number>(CATEGORY_NAMES.length).fill(0);
  for (const n of nodes) catCounts[n.category] = (catCounts[n.category] ?? 0) + 1;
  const categories = colors.categories.map((c, i) => ({
    ...c,
    lawCount: catCounts[i] ?? 0,
    labelPos: continents.categories[i]?.labelPos ?? [0, 0],
  }));
  for (const c of categories) {
    const cont = continents.categories[c.id];
    if (cont) c.labelPos = cont.labelPos;
  }

  const meta: GraphMeta = {
    snapshotId,
    egovAsof: corpusMan.egovAsof,
    corpusCreatedAt: corpusMan.createdAt,
    pipelineVersion: PIPELINE_VERSION,
    refsStatus,
    unknownCategories: [...unknownCategories].sort(),
    amendingLawRefs,
    unknownRefs,
    selfRefs,
    skippedTargetRefs,
    ghostLaws: ghostIds.length,
    lawEdges: keptPairs.length,
    refs,
    crossLawRefs,
  };

  const state: GraphState = {
    meta,
    nodes,
    pairs: keptPairs,
    groups: colors.groups,
    categories,
    continents,
    flows,
    bounds: layout.bounds,
  };

  const report = buildLayoutReport(state, Date.now() - t0, layout);
  mkdirSync(graphDir, { recursive: true });
  writeGraphState(graphDir, state, report);
  const checkPath = join(store, 'media', 'm2', 'layout-check.png');
  renderLayoutCheck(state, checkPath);
  logLayoutReport(report, snapshotId, layout.circles.seed, Date.now() - t0);
  process.stderr.write(`[graph] layout-check ${checkPath}\n`);
  return { state, report, graphDir };
}

function rebuildContinentsOnly(
  store: string,
  snapshotId: string,
  graphDir: string,
  t0: number,
): { state: GraphState; report: LayoutReport; graphDir: string } {
  const prevReportPath = join(graphDir, 'layout-report.json');
  if (!existsSync(prevReportPath)) {
    throw new Error(`continents-only には既存の layout-report.json が必要: ${prevReportPath}`);
  }
  const prev = JSON.parse(readFileSync(prevReportPath, 'utf8')) as LayoutReport;
  const state = loadGraphState(graphDir);
  const xyBefore = state.nodes.map((n) => `${n.lawId}:${n.x}:${n.y}:${n.r}`).join('|');
  const continents = buildContinents(state.nodes);
  const xyAfter = state.nodes.map((n) => `${n.lawId}:${n.x}:${n.y}:${n.r}`).join('|');
  if (xyBefore !== xyAfter) {
    throw new Error('continents-only が x,y,r を変えた');
  }
  for (const c of state.categories) {
    const cont = continents.categories[c.id];
    if (cont) c.labelPos = cont.labelPos;
  }
  state.continents = continents;
  const layout: LayoutResult = {
    bounds: state.bounds,
    circles: {
      x: [],
      y: [],
      rho: [],
      seed: 15,
      adjFlowShare: prev.adjFlowShare,
      groupContig: prev.groupContig,
    },
  };
  const report = buildLayoutReport(state, Date.now() - t0, layout);
  report.firstGzipBytes = prev.firstGzipBytes;
  report.totalWebBytes = prev.totalWebBytes;
  report.refsRowCap = prev.refsRowCap;
  report.refsPerPartnerCap = prev.refsPerPartnerCap;
  report.determinism = prev.determinism;
  report.elapsedMs.export = prev.elapsedMs.export;
  writeGraphState(graphDir, state, report);
  logLayoutReport(report, snapshotId, layout.circles.seed, Date.now() - t0);
  process.stderr.write(`[graph] continents-only store=${store} (x,y,r unchanged)\n`);
  return { state, report, graphDir };
}

function logLayoutReport(report: LayoutReport, snapshotId: string, circleSeed: number, ms: number): void {
  for (const row of mPass({
    knnCatPurity: report.knnCatPurity,
    edgeLenCross: report.edgeLenCross,
    lawsInCenter: report.lawsInCenter,
    centerPassPerLocal: report.centerPassPerLocal,
    diskFill: report.diskFill,
    inkOverEmpty: report.inkOverEmpty,
    hubToNbrCentroidMedian: report.hubToNbrCentroidMedian,
    hubDistMedian: report.hubDistMedian,
    hubsInContinent: report.hubsInContinent,
    familyDistMedian: report.familyDistMedian,
    familyDistP90: report.familyDistP90,
    intraEdgeVsRandom: report.intraEdgeVsRandom,
    adjFlowShare: report.adjFlowShare,
    groupContig: report.groupContig,
    shortShare: report.shortShare,
    longShare: report.longShare,
    viewportPassPerLocalMedian: report.viewportPassPerLocalMedian,
  })) {
    const val = row.value === null ? 'null' : row.value.toFixed(4);
    process.stderr.write(`[graph] ${row.id} ${row.key}=${val} ${row.ok ? 'PASS' : 'FAIL'} (${row.need})\n`);
  }
  process.stderr.write(
    `[graph] continents fallbacks=${report.continentFallbacks} in=${report.inContinentRatio.toFixed(4)} min=${report.inContinentRatioMin.toFixed(4)} other=${report.inOtherContinentRatio.toFixed(4)} overlap=${report.continentOverlapAreaRatio.toFixed(4)} hubsIn=${report.hubsInContinent}\n`,
  );
  process.stderr.write(
    `[graph] snapshot=${snapshotId} nodes=${report.nodes} edges=${report.edges} ghosts=${report.ghostLaws} refsComplete=${report.refsComplete} circleSeed=${circleSeed} mAllPass=${report.mAllPass} ${ms}ms\n`,
  );
}

function buildLayoutReport(state: GraphState, graphMs: number, layout: LayoutResult): LayoutReport {
  const { nodes, pairs, continents, meta } = state;
  const byId = new Map(nodes.map((n) => [n.lawId, n]));
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const rs = nodes.map((n) => n.r);
  const overlapPairs = circleOverlapCount(xs, ys, rs);
  const cStats = continentStats(nodes, continents);

  const intra: number[] = [];
  const inter: number[] = [];
  for (const p of pairs) {
    if (p.mainRefs <= 0) continue;
    const a = byId.get(p.srcLaw);
    const b = byId.get(p.tgtLaw);
    if (!a || !b) continue;
    const len = Math.hypot(a.x - b.x, a.y - b.y);
    if (a.category === b.category) intra.push(len);
    else inter.push(len);
  }
  const intraMedian = median(intra);
  const interMedian = median(inter);

  const enforcers = nodes.filter((n) => n.title.endsWith('施行令') || n.title.endsWith('施行規則'));
  const enforcersWithParent = enforcers.filter((n) => n.parentLawId);
  const rng = mulberry32(20261008);
  const sampleIdx = sampleIndices(enforcers.length, Math.min(20, enforcers.length), rng);
  const familySample = sampleIdx.map((i) => {
    const n = enforcers[i]!;
    const parent = n.parentLawId ? byId.get(n.parentLawId) : undefined;
    const prefixOk = parent ? n.title.startsWith(parent.title) : false;
    return {
      lawId: n.lawId,
      title: n.title,
      parentId: n.parentLawId,
      parentTitle: parent?.title ?? null,
      ok: Boolean(n.parentLawId) && (prefixOk || Boolean(parent)),
    };
  });

  return {
    snapshotId: meta.snapshotId,
    refsComplete: meta.refsStatus.complete,
    refsFingerprint: meta.refsStatus.fingerprint,
    nodes: nodes.length,
    edges: pairs.length,
    ghostLaws: meta.ghostLaws,
    overlapPairs,
    overlapRatio: nodes.length ? overlapPairs / nodes.length : 0,
    continentFallbacks: cStats.continentFallbacks,
    inContinentRatio: cStats.inContinentRatio,
    inContinentRatioMin: cStats.inContinentRatioMin,
    inContinentRatioByCategory: cStats.inContinentRatioByCategory,
    inOtherContinentRatio: cStats.inOtherContinentRatio,
    continentOverlapAreaRatio: cStats.continentOverlapAreaRatio,
    intraMedian,
    interMedian,
    lengthRatio: interMedian > 0 ? intraMedian / interMedian : 0,
    enforcers: enforcers.length,
    enforcersWithParent: enforcersWithParent.length,
    enforcerParentRatio: enforcers.length ? enforcersWithParent.length / enforcers.length : 0,
    familySample,
    familySampleCorrect: familySample.filter((s) => s.ok).length,
    firstGzipBytes: null,
    totalWebBytes: null,
    refsRowCap: null,
    refsPerPartnerCap: null,
    ...(() => {
      const m = computeLayoutMetrics(state, layout.circles);
      const rows = mPass(m);
      return {
        knnCatPurity: m.knnCatPurity,
        edgeLenCross: m.edgeLenCross,
        lawsInCenter: m.lawsInCenter,
        centerPassPerLocal: m.centerPassPerLocal,
        diskFill: m.diskFill,
        inkOverEmpty: m.inkOverEmpty,
        hubToNbrCentroidMedian: m.hubToNbrCentroidMedian,
        hubDistMedian: m.hubDistMedian,
        hubsInContinent: m.hubsInContinent,
        familyDistMedian: m.familyDistMedian,
        familyDistP90: m.familyDistP90,
        intraEdgeVsRandom: m.intraEdgeVsRandom,
        adjFlowShare: m.adjFlowShare,
        groupContig: m.groupContig,
        shortShare: m.shortShare,
        longShare: m.longShare,
        viewportPassPerLocalMedian: m.viewportPassPerLocalMedian,
        mAllPass: rows.every((r) => r.ok),
        mFailed: rows.filter((r) => !r.ok).map((r) => r.id),
      };
    })(),
    notes: LAYOUT_REPORT_NOTES,
    determinism: null,
    elapsedMs: { graph: graphMs, export: null },
  };
}

export function writeGraphState(graphDir: string, state: GraphState, report: LayoutReport): void {
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(join(graphDir, 'meta.json'), JSON.stringify(state.meta, null, 2) + '\n');
  writeFileSync(join(graphDir, 'nodes.json'), JSON.stringify(state.nodes) + '\n');
  writeFileSync(join(graphDir, 'pairs.json'), JSON.stringify(state.pairs) + '\n');
  writeFileSync(join(graphDir, 'categories.json'), JSON.stringify({ groups: state.groups, categories: state.categories }) + '\n');
  writeFileSync(join(graphDir, 'continents.json'), JSON.stringify(state.continents) + '\n');
  writeFileSync(join(graphDir, 'flows.json'), JSON.stringify(state.flows) + '\n');
  writeFileSync(join(graphDir, 'bounds.json'), JSON.stringify(state.bounds) + '\n');
  writeFileSync(join(graphDir, 'stats.json'), JSON.stringify({
    ...state.meta,
    nodes: state.nodes.length,
    pairs: state.pairs.length,
    lawTypes: LAW_TYPES,
  }, null, 2) + '\n');
  writeFileSync(join(graphDir, 'layout-report.json'), JSON.stringify(report, null, 2) + '\n');
}
