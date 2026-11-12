import type { Part, RefKind } from '../../lib/shared/contract.ts';

export type TypeBucket = 'Act' | 'CabinetOrder' | 'MinisterialOrdinance' | 'Rule' | 'Other';

export type TgtStatus = 'current' | 'repealed' | 'amendingLaw' | 'self' | 'unknown';

export interface GoldSentence {
  gid: string;
  lawId: string;
  pid: string;
  sent: number;
  part: Part;
  text: string;
  articleText: string;
  stratum: string;
}

export interface GoldRef {
  start: number;
  end: number;
  mention: string;
  tgtLaw: string | null;
  tgtStatus: TgtStatus;
  tgtPid: string | null;
  tgtEnd: string | null;
  kind: RefKind;
  yomikae: boolean;
}

export interface GoldAnnotation {
  gid: string;
  annotator: string;
  refs: GoldRef[];
}

export interface PredRef {
  id: string;
  srcLaw: string;
  srcPid: string;
  sent: number;
  part: Part;
  start: number;
  end: number;
  mention: string;
  rawName: string | null;
  tgtLaw: string | null;
  tgtStatus: TgtStatus;
  tgtPid: string | null;
  tgtEnd: string | null;
  kind: RefKind;
  flags: number;
  rule: string;
  confidence: number;
}

export interface Span {
  start: number;
  end: number;
}

export interface MatchPair<G, P> {
  goldIndex: number;
  predIndex: number;
  overlap: number;
  gold: G;
  pred: P;
}

export interface Prf {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface PairSetCounts {
  ours: number;
  theirs: number;
  both: number;
  oursOnly: number;
  theirsOnly: number;
  lawsInBoth: number;
}

export type DiffClass = 'ourMiss' | 'ourError' | 'theirError' | 'definition' | 'unknown';

export interface DiffSample {
  srcLaw: string;
  tgtLaw: string;
  bucket: 'oursOnly' | 'theirsOnly';
  vs: 'lawvis' | 'jlaw';
  class: DiffClass | null;
  note: string;
}

export interface ExternalCounts {
  lawvisLaws: number;
  lawvisPairs: number;
  lawvisLawsDelta: number;
  lawvisPairsDelta: number;
  jlawRows: number;
  jlawRowsDelta: number;
  jlawPrecisionRecords: number;
  jlawPrecisionLabelsFilled: number;
}

export interface EvalReport {
  snapshotId: string;
  generatedAt: string;
  status: 'complete' | 'partial';
  missing: string[];
  gold: {
    sentences: number;
    refs: number;
    doubleAnnotated: number;
    spanAgreement: number | null;
    kindKappa: number | null;
  };
  crossLaw: Prf | null;
  articleLevel: Prf | null;
  relativeIntra: Prf | null;
  kind: {
    accuracy: number;
    n: number;
    confusion: Record<string, Record<string, number>>;
  } | null;
  vsJlawSample: {
    available: boolean;
    reason: string | null;
    oTotal: number;
    xTotal: number;
    unknown: number;
    jlawPrecision: number | null;
    ourCorrectRate: number | null;
    ourMissingRate: number | null;
    xWeFixed: number;
    matchedRows: number;
    unmatchedCorpus: number;
    labelAgreement: number | null;
    labelAgreementN: number;
    oAgree: number | null;
    xAvoid: number | null;
  };
  crossLawBootstrap: {
    f1: { lo: number; hi: number; mean: number; iters: number };
    precision: { lo: number; hi: number; mean: number; iters: number };
    recall: { lo: number; hi: number; mean: number; iters: number };
  } | null;
  articleLevelBootstrap: {
    f1: { lo: number; hi: number; mean: number; iters: number };
    precision: { lo: number; hi: number; mean: number; iters: number };
    recall: { lo: number; hi: number; mean: number; iters: number };
  } | null;
  intraLaw: {
    overall: Prf;
    relative: Prf;
    relativePid: Prf;
    relativeArticleRounded: { n: number; correct: number; rate: number };
    relativeByWord: Record<string, { n: number; tp: number }>;
    relativeBootstrap: { lo: number; hi: number; mean: number; iters: number };
    relativePrfBootstrap: {
      f1: { lo: number; hi: number; mean: number; iters: number };
      precision: { lo: number; hi: number; mean: number; iters: number };
      recall: { lo: number; hi: number; mean: number; iters: number };
    };
  } | null;
  vsLawvis: PairSetCounts | null;
  vsJlaw: PairSetCounts | null;
  diffClassification: {
    vsLawvis: Record<DiffClass, number> | null;
    vsJlaw: Record<DiffClass, number> | null;
    sampled: number;
    classified: number;
  };
  external: ExternalCounts;
}
