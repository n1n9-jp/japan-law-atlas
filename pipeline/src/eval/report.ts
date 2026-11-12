import { existsSync, readFileSync } from 'node:fs';
import { DIFF_SAMPLE_SIZE } from './expected.ts';
import { kindKappa, spanAgreement, indexAnnotations } from './kappa.ts';
import {
  articleLevelPrf,
  bootstrapPrf,
  crossLawPrf,
  intraLawMetrics,
  kindAccuracy,
} from './metrics.ts';
import { csvToObjects } from './csv.ts';
import { jlawLabeledEval } from './jlaw-sample.ts';
import {
  comparePairSets,
  lawsInPairs,
  ourComparablePairs,
  sampleDiffPairs,
} from './pairs.ts';
import { loadExternalCounts } from './fetch-external.ts';
import {
  goldRefsForEval,
  loadCorpusSentencesForLaws,
  loadPairCsv,
  loadPreds,
  loadStatusById,
  loadSupplement,
  predsForSentences,
  refsReady,
} from './load.ts';
import { readJsonl, writeJsonl, writeText } from './io.ts';
import type { EvalPaths } from './paths.ts';
import { diffSampleSchema } from './schemas.ts';
import type {
  DiffClass,
  DiffSample,
  EvalReport,
  GoldAnnotation,
  GoldSentence,
  PairSetCounts,
  PredRef,
} from './types.ts';

const DIFF_CLASSES: DiffClass[] = ['ourMiss', 'ourError', 'theirError', 'definition', 'unknown'];

export async function buildReport(
  paths: EvalPaths,
  gold: {
    sentences: GoldSentence[];
    annotations: GoldAnnotation[];
    adjudicated: GoldAnnotation[];
  } | null,
): Promise<EvalReport> {
  const missing: string[] = [];
  if (!refsReady(paths)) missing.push('refs');
  const preds = await loadPreds(paths);
  if (!preds && refsReady(paths)) missing.push('refs');
  if (!gold) missing.push('gold');
  const external = loadExternalCounts(paths);

  const goldStats = gold
    ? summarizeGold(gold.sentences, gold.annotations, gold.adjudicated)
    : {
        sentences: 0,
        refs: 0,
        doubleAnnotated: 0,
        spanAgreement: null,
        kindKappa: null,
      };

  let crossLaw = null;
  let articleLevel = null;
  let relativeIntra = null;
  let crossLawBootstrap: EvalReport['crossLawBootstrap'] = null;
  let articleLevelBootstrap: EvalReport['articleLevelBootstrap'] = null;
  let intraLaw: EvalReport['intraLaw'] = null;
  let kind = null;
  let vsJlawSample: EvalReport['vsJlawSample'] = {
    available: false,
    reason: '抽出器出力またはゴールドがない',
    oTotal: 0,
    xTotal: 0,
    unknown: 0,
    jlawPrecision: null,
    ourCorrectRate: null,
    ourMissingRate: null,
    xWeFixed: 0,
    matchedRows: 0,
    unmatchedCorpus: 0,
    labelAgreement: null,
    labelAgreementN: 0,
    oAgree: null,
    xAvoid: null,
  };
  let vsLawvis: PairSetCounts | null = null;
  let vsJlaw: PairSetCounts | null = null;
  let sampled = 0;
  let classified = 0;
  let vsLawvisClass: Record<DiffClass, number> | null = null;
  let vsJlawClass: Record<DiffClass, number> | null = null;

  if (gold && preds) {
    const goldByGid = goldRefsForEval(gold.sentences, gold.annotations, gold.adjudicated);
    const extra = loadSupplement(paths);
    const intraSentences = extra ? [...gold.sentences, ...extra.sentences] : gold.sentences;
    const intraGold = new Map(goldByGid);
    if (extra) {
      for (const row of extra.annotations) intraGold.set(row.gid, row.refs);
    }
    const goldPreds = predsForSentences(intraSentences, preds);
    crossLaw = crossLawPrf(gold.sentences, goldByGid, goldPreds);
    articleLevel = articleLevelPrf(gold.sentences, goldByGid, goldPreds);
    crossLawBootstrap = bootstrapPrf(gold.sentences, goldByGid, goldPreds, crossLawPrf);
    articleLevelBootstrap = bootstrapPrf(gold.sentences, goldByGid, goldPreds, articleLevelPrf);
    kind = kindAccuracy(gold.sentences, goldByGid, goldPreds);
    intraLaw = intraLawMetrics(intraSentences, intraGold, goldPreds);
    relativeIntra = intraLaw.relative;
    const labeledPath = existsSync(paths.jlawPrecisionLabeled)
      ? paths.jlawPrecisionLabeled
      : paths.jlawPrecision;
    const labeledText = readFileSync(labeledPath, 'utf8');
    const sourceIds = new Set(
      csvToObjects(labeledText)
        .map((r) => r.source_id ?? '')
        .filter(Boolean),
    );
    const corpusByLaw = await loadCorpusSentencesForLaws(paths, sourceIds);
    const secondPass = existsSync(`${paths.externalDir}/jlaw-precision-second-pass-c2.csv`)
      ? readFileSync(`${paths.externalDir}/jlaw-precision-second-pass-c2.csv`, 'utf8')
      : null;
    vsJlawSample = jlawLabeledEval(labeledText, secondPass, preds, corpusByLaw);
  }

  const statusById = loadStatusById(paths);
  if (preds && statusById) {
    const ours = ourComparablePairs(preds, statusById);
    const ourLaws = new Set(statusById.keys());
    if (existsSync(paths.lawvisPairs) || existsSync(`${paths.prefetchExternal}/lawvis-pairs.csv`)) {
      const theirs = loadPairCsv(
        existsSync(paths.lawvisPairs)
          ? paths.lawvisPairs
          : `${paths.prefetchExternal}/lawvis-pairs.csv`,
      );
      const cmp = comparePairSets(ours, theirs, ourLaws, lawsInPairs(theirs));
      vsLawvis = stripPairLists(cmp);
      sampled += writeDiffIfNeeded(paths, 'lawvis', cmp.oursOnlyPairs, cmp.theirsOnlyPairs);
    } else missing.push('lawvis-pairs');
    if (existsSync(paths.jlawPairs) || existsSync(`${paths.prefetchExternal}/jlaw-pairs.csv`)) {
      const theirs = loadPairCsv(
        existsSync(paths.jlawPairs) ? paths.jlawPairs : `${paths.prefetchExternal}/jlaw-pairs.csv`,
      );
      const cmp = comparePairSets(ours, theirs, ourLaws, lawsInPairs(theirs));
      vsJlaw = stripPairLists(cmp);
      sampled += writeDiffIfNeeded(paths, 'jlaw', cmp.oursOnlyPairs, cmp.theirsOnlyPairs);
    } else missing.push('jlaw-pairs');
    const classifiedRows = loadClassified(paths);
    classified = classifiedRows.filter((r) => r.class !== null).length;
    vsLawvisClass = tally(classifiedRows.filter((r) => r.vs === 'lawvis' && r.class));
    vsJlawClass = tally(classifiedRows.filter((r) => r.vs === 'jlaw' && r.class));
    if (classifiedRows.length > 0 && classified < classifiedRows.length) {
      missing.push('diff-classification');
    }
    if (classifiedRows.length === 0) missing.push('diff-classification');
  } else if (!statusById) {
    missing.push('corpus-laws');
  }

  const status: EvalReport['status'] = missing.length === 0 ? 'complete' : 'partial';
  const report: EvalReport = {
    snapshotId: paths.snapshotId,
    generatedAt: new Date().toISOString(),
    status,
    missing,
    gold: goldStats,
    crossLaw,
    articleLevel,
    relativeIntra,
    crossLawBootstrap,
    articleLevelBootstrap,
    intraLaw,
    kind,
    vsJlawSample,
    vsLawvis,
    vsJlaw,
    diffClassification: {
      vsLawvis: vsLawvisClass,
      vsJlaw: vsJlawClass,
      sampled,
      classified,
    },
    external,
  };
  writeText(paths.reportJson, JSON.stringify(report, null, 2) + '\n');
  writeText(paths.reportMd, renderReportMd(report));
  return report;
}

function summarizeGold(
  sentences: GoldSentence[],
  annotations: GoldAnnotation[],
  adjudicated: GoldAnnotation[],
): EvalReport['gold'] {
  const byAnn = new Map<string, GoldAnnotation[]>();
  for (const row of annotations) {
    const list = byAnn.get(row.annotator) ?? [];
    list.push(row);
    byAnn.set(row.annotator, list);
  }
  const annotators = [...byAnn.keys()].filter((a) => a !== 'final');
  const goldByGid = goldRefsForEval(sentences, annotations, adjudicated);
  let refs = 0;
  for (const r of goldByGid.values()) refs += r.length;

  let span: number | null = null;
  let kappa: number | null = null;
  let double = 0;
  if (annotators.length >= 2) {
    const a = annotators[0]!;
    const b = annotators[1]!;
    const overlapGids = sentences.filter(
      (s) =>
        (byAnn.get(a) ?? []).some((x) => x.gid === s.gid) &&
        (byAnn.get(b) ?? []).some((x) => x.gid === s.gid),
    );
    double = overlapGids.length;
    span = spanAgreement(overlapGids, indexAnnotations(byAnn.get(a)!), indexAnnotations(byAnn.get(b)!));
    kappa = kindKappa(overlapGids, indexAnnotations(byAnn.get(a)!), indexAnnotations(byAnn.get(b)!));
  }
  return {
    sentences: sentences.length,
    refs,
    doubleAnnotated: double,
    spanAgreement: span,
    kindKappa: kappa,
  };
}

function stripPairLists(cmp: ReturnType<typeof comparePairSets>): PairSetCounts {
  return {
    ours: cmp.ours,
    theirs: cmp.theirs,
    both: cmp.both,
    oursOnly: cmp.oursOnly,
    theirsOnly: cmp.theirsOnly,
    lawsInBoth: cmp.lawsInBoth,
  };
}

function writeDiffIfNeeded(
  paths: EvalPaths,
  vs: 'lawvis' | 'jlaw',
  oursOnly: string[],
  theirsOnly: string[],
): number {
  const existing = loadClassified(paths).filter((r) => r.vs === vs);
  if (existing.length >= DIFF_SAMPLE_SIZE * 2) return existing.length;
  const sample = sampleDiffPairs(vs, oursOnly, theirsOnly);
  const others = loadClassified(paths).filter((r) => r.vs !== vs);
  writeJsonl(paths.diffSample, [...others, ...sample]);
  return sample.length;
}

function loadClassified(paths: EvalPaths): DiffSample[] {
  const file = existsSync(paths.diffClassified)
    ? paths.diffClassified
    : existsSync(paths.diffSample)
      ? paths.diffSample
      : null;
  if (!file) return [];
  return readJsonl(file, diffSampleSchema);
}

function tally(rows: DiffSample[]): Record<DiffClass, number> | null {
  if (rows.length === 0) return null;
  const out = Object.fromEntries(DIFF_CLASSES.map((c) => [c, 0])) as Record<DiffClass, number>;
  for (const row of rows) {
    if (row.class) out[row.class] += 1;
  }
  return out;
}

export function renderReportMd(r: EvalReport): string {
  const lead = leadParagraph(r);
  const lines = [
    `# 評価レポート（${r.snapshotId}）`,
    '',
    lead,
    '',
    `状態: **${r.status}**` + (r.missing.length ? `（不足: ${r.missing.join(', ')}）` : ''),
    '',
    '## ゴールドセット',
    '',
    `- 文: ${r.gold.sentences}`,
    `- 参照: ${r.gold.refs}`,
    `- 二重注釈: ${r.gold.doubleAnnotated} 文`,
    `- 参照単位の一致率: ${fmt(r.gold.spanAgreement)}`,
    `- 種類の κ: ${fmt(r.gold.kindKappa)}`,
    '',
    '## 抽出器（ゴールド照合）',
    '',
    metricBlock('他法令・法令単位', r.crossLaw),
    r.crossLawBootstrap
      ? `- 他法令 F1 のブートストラップ95%区間: ${fmt(r.crossLawBootstrap.f1.lo)}–${fmt(r.crossLawBootstrap.f1.hi)}（平均 ${fmt(r.crossLawBootstrap.f1.mean)}）\n- 他法令 P のブートストラップ95%区間: ${fmt(r.crossLawBootstrap.precision.lo)}–${fmt(r.crossLawBootstrap.precision.hi)}\n- 他法令 R のブートストラップ95%区間: ${fmt(r.crossLawBootstrap.recall.lo)}–${fmt(r.crossLawBootstrap.recall.hi)}`
      : '',
    metricBlock('条単位', r.articleLevel),
    r.articleLevelBootstrap
      ? `- 条単位 F1 のブートストラップ95%区間: ${fmt(r.articleLevelBootstrap.f1.lo)}–${fmt(r.articleLevelBootstrap.f1.hi)}（平均 ${fmt(r.articleLevelBootstrap.f1.mean)}）`
      : '',
    metricBlock('法令内の参照（全体）', r.intraLaw?.overall ?? null),
    metricBlock('法令内の相対参照（法令が合う）', r.intraLaw?.relative ?? r.relativeIntra),
    metricBlock('法令内の相対参照（pid も合う）', r.intraLaw?.relativePid ?? null),
    r.intraLaw
      ? `- 相対参照の条まで丸めた一致: ${fmt(r.intraLaw.relativeArticleRounded.rate)}（${r.intraLaw.relativeArticleRounded.correct}/${r.intraLaw.relativeArticleRounded.n}）\n- 相対参照 F1 のブートストラップ95%区間: ${fmt(r.intraLaw.relativeBootstrap.lo)}–${fmt(r.intraLaw.relativeBootstrap.hi)}（平均 ${fmt(r.intraLaw.relativeBootstrap.mean)}、${r.intraLaw.relativeBootstrap.iters} 回）\n- 語ごとの件数: ${wordCounts(r.intraLaw.relativeByWord)}`
      : '',
    r.kind
      ? `- 種類の一致率: ${fmt(r.kind.accuracy)}（n=${r.kind.n}）`
      : '- 種類の一致率: （未計算）',
    '',
    '## JLaw precision_sample',
    '',
    r.vsJlawSample.available
      ? [
          `- JLaw 適合率（? を除く）: ${fmt(r.vsJlawSample.jlawPrecision)}（O=${r.vsJlawSample.oTotal} X=${r.vsJlawSample.xTotal} ?=${r.vsJlawSample.unknown}）`,
          `- 対応がついた行で我々が正しい法令に解いた割合: ${fmt(r.vsJlawSample.ourCorrectRate)}（${r.vsJlawSample.matchedRows} 行）`,
          `- 我々が参照を出さなかった行の割合: ${fmt(r.vsJlawSample.ourMissingRate)}`,
          `- X 行のうち我々が正しく解いた数: ${r.vsJlawSample.xWeFixed}`,
          `- 本文の版の違いで対応なし: ${r.vsJlawSample.unmatchedCorpus}`,
          `- 二重ラベル一致率: ${fmt(r.vsJlawSample.labelAgreement)}（n=${r.vsJlawSample.labelAgreementN}）`,
        ].join('\n')
      : `- 未計算: ${r.vsJlawSample.reason ?? ''}`,
    '',
    '## 法令ペアの突き合わせ',
    '',
    pairBlock('lawvis', r.vsLawvis),
    pairBlock('JLaw', r.vsJlaw),
    '',
    '## 差の分類',
    '',
    classBlock('lawvis', r.diffClassification.vsLawvis),
    classBlock('JLaw', r.diffClassification.vsJlaw),
    `- サンプル数: ${r.diffClassification.sampled}、分類済み: ${r.diffClassification.classified}`,
    '',
    '## 外部データの検算',
    '',
    `- lawvis: 法令 ${r.external.lawvisLaws}（期待 8685、差 ${r.external.lawvisLawsDelta}）、ペア ${r.external.lawvisPairs}（期待 113641、差 ${r.external.lawvisPairsDelta}）`,
    `- JLaw cites_law_to_law: ${r.external.jlawRows} 行（期待 70577、差 ${r.external.jlawRowsDelta}）`,
    `- JLaw precision_sample: レコード ${r.external.jlawPrecisionRecords}、label_O_X 記入 ${r.external.jlawPrecisionLabelsFilled}`,
    '',
    '出典: JLaw-CiteGraph データは CC BY 4.0（e-Gov 法令データ）。lawvis の生データは社内比較のみ。',
    '',
  ];
  return lines.join('\n');
}

function leadParagraph(r: EvalReport): string {
  if (r.missing.includes('refs') && !r.crossLaw) {
    return `抽出が未完成である（data/refs/${r.snapshotId}/manifest.json なし）。ゴールド ${r.gold.sentences} 文、lawvis ${r.external.lawvisPairs} ペア、JLaw ${r.external.jlawRows} 行まで揃っている。`;
  }
  if (r.status !== 'complete' || !r.crossLaw || !r.vsLawvis || !r.vsJlaw) {
    return `評価は未完了である。ゴールド ${r.gold.sentences} 文、外部データは lawvis ${r.external.lawvisPairs} ペア・JLaw ${r.external.jlawRows} 行まで揃っている。不足は ${r.missing.join('、') || 'なし'}。精度と比較の結論は、抽出器出力と注釈が揃ってから出す。`;
  }
  const c = r.crossLaw;
  const rel = r.intraLaw?.relative ?? r.relativeIntra;
  const f1ci = r.crossLawBootstrap ? `（95%区間 ${pct(r.crossLawBootstrap.f1.lo)}–${pct(r.crossLawBootstrap.f1.hi)}）` : '';
  const relci = r.intraLaw ? `（95%区間 ${pct(r.intraLaw.relativeBootstrap.lo)}–${pct(r.intraLaw.relativeBootstrap.hi)}）` : '';
  return `他法令の法令単位は適合率 ${pct(c.precision)}・再現率 ${pct(c.recall)}・F値 ${pct(c.f1)}${f1ci}、条単位 F値 ${pct(r.articleLevel?.f1 ?? 0)}、法令内相対参照（法令が合う）F値 ${pct(rel?.f1 ?? 0)}${relci}、種類の一致率 ${pct(r.kind?.accuracy ?? 0)}。lawvis との法令ペアは共通 ${r.vsLawvis.both}、我々だけ ${r.vsLawvis.oursOnly}、相手だけ ${r.vsLawvis.theirsOnly}。JLaw とは共通 ${r.vsJlaw.both}、我々だけ ${r.vsJlaw.oursOnly}、相手だけ ${r.vsJlaw.theirsOnly}。二重注釈の参照単位一致率は ${pct(r.gold.spanAgreement ?? 0)}。`;
}

function wordCounts(by: Record<string, { n: number; tp: number }>): string {
  const parts = Object.entries(by)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([w, v]) => `${w} ${v.tp}/${v.n}`);
  return parts.length ? parts.join('、') : 'なし';
}

function metricBlock(title: string, m: EvalReport['crossLaw']): string {
  if (!m) return `- ${title}: （未計算）`;
  return `- ${title}: P=${fmt(m.precision)} R=${fmt(m.recall)} F1=${fmt(m.f1)}（tp=${m.tp} fp=${m.fp} fn=${m.fn}）`;
}

function pairBlock(name: string, p: PairSetCounts | null): string {
  if (!p) return `- ${name}: （未計算）`;
  return `- ${name}: 我々 ${p.ours}、相手 ${p.theirs}、共通 ${p.both}、我々だけ ${p.oursOnly}、相手だけ ${p.theirsOnly}（両方に法令がある範囲 ${p.lawsInBoth} 法令）`;
}

function classBlock(name: string, t: Record<DiffClass, number> | null): string {
  if (!t) return `- ${name}: （未分類）`;
  return `- ${name}: 取りこぼし ${t.ourMiss}、我々の誤り ${t.ourError}、相手の誤り ${t.theirError}、定義の違い ${t.definition}、判断できない ${t.unknown}`;
}

function fmt(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  return n.toFixed(3);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
