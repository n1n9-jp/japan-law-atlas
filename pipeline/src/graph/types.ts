import type { LawType } from '../../lib/shared/contract.ts';
import type { Category, CategoryGroup, ContinentsFile, CategoryFlowsFile } from '../../lib/shared/contract.ts';
import type { PairAgg } from './edges.ts';

export interface RefsManifest {
  snapshotId: string;
  corpusSha256: string;
  createdAt: string;
  files: { path: string; bytes: number; sha256: string }[];
}

export interface RefsStatus {
  complete: boolean;
  dir: string;
  warning: string | null;
  manifest: RefsManifest | null;
  fingerprint: string;
  shardCount: number;
}

export interface NodeRec {
  lawId: string;
  revisionId: string;
  title: string;
  kana: string;
  abbrevs: string[];
  oldTitles: string[];
  num: string;
  numNorm: string;
  lawType: LawType;
  categoryName: string;
  category: number;
  promulgated: number;
  status: 'current' | 'notYetEffective' | 'repealed';
  articleCount: number;
  ghost: boolean;
  label: string;
  aliases: string[];
  delegations: number;
  inLaws: number;
  outLaws: number;
  inRefs: number;
  outRefs: number;
  pagerank: number;
  prRank: number;
  parentLawId: string | null;
  familyLawId: string;
  community: number;
  bridge: number;
  x: number;
  y: number;
  r: number;
}

export interface GraphMeta {
  snapshotId: string;
  egovAsof: string;
  corpusCreatedAt: string;
  pipelineVersion: string;
  refsStatus: RefsStatus;
  unknownCategories: string[];
  amendingLawRefs: number;
  unknownRefs: number;
  selfRefs: number;
  skippedTargetRefs: number;
  ghostLaws: number;
  lawEdges: number;
  refs: number;
  crossLawRefs: number;
}

export interface GraphState {
  meta: GraphMeta;
  nodes: NodeRec[];
  pairs: PairAgg[];
  groups: CategoryGroup[];
  categories: Category[];
  continents: ContinentsFile;
  flows: CategoryFlowsFile;
  bounds: [number, number, number, number];
}

export interface LayoutReport {
  snapshotId: string;
  refsComplete: boolean;
  refsFingerprint: string;
  nodes: number;
  edges: number;
  ghostLaws: number;
  overlapPairs: number;
  overlapRatio: number;
  continentFallbacks: number;
  inContinentRatio: number;
  inContinentRatioMin: number;
  inContinentRatioByCategory: number[];
  inOtherContinentRatio: number;
  continentOverlapAreaRatio: number;
  intraMedian: number;
  interMedian: number;
  lengthRatio: number;
  enforcers: number;
  enforcersWithParent: number;
  enforcerParentRatio: number;
  familySample: { lawId: string; title: string; parentId: string | null; parentTitle: string | null; ok: boolean }[];
  familySampleCorrect: number;
  firstGzipBytes: number | null;
  totalWebBytes: number | null;
  refsRowCap: number | null;
  refsPerPartnerCap: number | null;
  knnCatPurity: number;
  edgeLenCross: number;
  lawsInCenter: number;
  centerPassPerLocal: number | null;
  diskFill: number;
  inkOverEmpty: number;
  hubToNbrCentroidMedian: number;
  hubDistMedian: number;
  hubsInContinent: number;
  familyDistMedian: number;
  familyDistP90: number;
  intraEdgeVsRandom: number;
  adjFlowShare: number;
  groupContig: number;
  shortShare: number;
  longShare: number;
  viewportPassPerLocalMedian: number;
  mAllPass: boolean;
  mFailed: string[];
  notes: string[];
  determinism: { files: number; matches: number; listingSha256: string } | null;
  elapsedMs: { graph: number; export: number | null };
}
