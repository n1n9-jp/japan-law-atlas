import type { LawType } from './shared/contract.ts';

export type { LawType };
export type LawStatus = 'current' | 'notYetEffective' | 'repealed';
export type Part = 'main' | 'enact' | 'appdx' | 'suppl' | 'supplAmend';

export interface LawMeta {
  lawId: string;
  revisionId: string;
  title: string;
  kana: string;
  abbrevs: string[];
  oldTitles: string[];
  num: string;
  numNorm: string;
  lawType: LawType;
  rawLawType: string;
  category: string;
  promulgationDate: string;
  enforcementDate: string | null;
  status: LawStatus;
  repealDate: string | null;
  articleCount: number;
  supplCount: number;
  hasEnact: boolean;
  source: 'zip' | 'api';
}

export interface TocEntry {
  kind: 'Part' | 'Chapter' | 'Section' | 'Subsection' | 'Division';
  num: string;
  title: string;
  depth: number;
  firstArticle: string | null;
  lastArticle: string | null;
}

export interface ArticleEntry {
  pid: string;
  part: Part;
  title: string;
  caption: string | null;
  toc: number[];
}

export interface SentenceRec {
  pid: string;
  sent: number;
  part: Part;
  text: string;
  inTable: boolean;
  supplIndex: number | null;
  amendLawNum: string | null;
}

export interface CorpusLaw {
  meta: LawMeta;
  toc: TocEntry[];
  articles: ArticleEntry[];
  appdx: { pid: string; title: string }[];
  sentences: SentenceRec[];
}

export interface CorpusManifest {
  snapshotId: string;
  egovAsof: string;
  createdAt: string;
  counts: {
    laws: number;
    current: number;
    notYetEffective: number;
    repealedMeta: number;
    sentences: number;
    articles: number;
  };
  shards: { path: string; laws: number; bytes: number; sha256: string }[];
}
