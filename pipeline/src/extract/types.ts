import type { Part, Ref, TargetStatus } from '../../lib/ref-types.js';

export interface SlimMeta {
  lawId: string;
  title: string;
  abbrevs: string[];
  oldTitles: string[];
  num: string;
  numNorm: string;
  lawType: string;
  status: 'current' | 'notYetEffective' | 'repealed';
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

export interface SlimLaw {
  meta: SlimMeta;
  toc: TocEntry[];
  articles: ArticleEntry[];
  sentences: SentenceRec[];
}

export type NameSource = 'title' | 'oldTitle' | 'egovAbbrev' | 'jlaw';

export type ProvisionKind = 'article' | 'para' | 'item' | 'fusoku' | 'appdx';

export type AbbrevShape = 'paren' | 'scopedParen' | 'defSentence' | 'numParen';

export interface Span {
  start: number;
  end: number;
  rule: string;
  rawName: string | null;
  tgtLaw: string | null;
  tgtStatus: TargetStatus;
  tgtPid: string | null;
  tgtEnd: string | null;
  flags: number;
  viaJlawOnly: boolean;
  source?: NameSource;
  tgtLawType?: string | null;
  bareKind?: ProvisionKind;
  skipClip?: boolean;
  countedByNumber?: boolean;
  scopeParen?: boolean;
  isTable?: boolean;
  fromChain?: boolean;
  fromAnaphora?: boolean;
}

export interface DictStats {
  ambiguousNames: string[];
  nameCount: number;
  numCount: number;
  droppedAmbiguous: number;
  droppedNames: number;
}

export type NameHit = {
  lawId: string;
  title: string;
  source: NameSource;
};

export interface LawDict {
  byNum: Map<string, string[]>;
  byId: Map<string, SlimMeta>;
  stats: DictStats;
  longestName(text: string, i: number): { end: number; hit: NameHit } | null;
}

export interface ExtractOptions {
  targetPids?: Map<string, Set<string>>;
}

export interface ExtractExtras {
  l3TypeSkips: number;
  l5BySource: Record<NameSource, number>;
  parenCarry: number;
  mergedDojo: number;
  l7CountedByNumber: number;
  prefixHits: number;
  droppedAbbrevs: number;
  abbrevByShape: Record<AbbrevShape, number>;
  abbrevUnrecorded: Record<string, number>;
  l2Fallback: number;
  dictSkippedDueToBodyDef: number;
  tableContext: { rowLaw: number; yomikae: number };
  existRetarget: number;
  dojoAnte: {
    sameSent: number;
    prevSent: number;
    inParen: number;
    chain: number;
    anaphora: number;
    otherLaw: number;
    self: number;
  };
  dohyoAnte: { self: number; other: number; miss: number };
  ryukyu: number;
  dojoLastOtherButSelf: number;
}

export interface ExtractResult {
  refs: Ref[];
  abbrevs: {
    lawId: string;
    pid: string;
    sent: number;
    abbr: string;
    targetLaw: string | null;
    scope: string;
  }[];
  features: {
    lawId: string;
    delegations: number;
    definedTerms: number;
    unresolvedMentions: number;
  };
  extras: ExtractExtras;
}

export function emptyExtras(): ExtractExtras {
  return {
    l3TypeSkips: 0,
    l5BySource: { title: 0, oldTitle: 0, egovAbbrev: 0, jlaw: 0 },
    parenCarry: 0,
    mergedDojo: 0,
    l7CountedByNumber: 0,
    prefixHits: 0,
    droppedAbbrevs: 0,
    abbrevByShape: { paren: 0, scopedParen: 0, defSentence: 0, numParen: 0 },
    abbrevUnrecorded: {},
    l2Fallback: 0,
    dictSkippedDueToBodyDef: 0,
    tableContext: { rowLaw: 0, yomikae: 0 },
    existRetarget: 0,
    dojoAnte: {
      sameSent: 0,
      prevSent: 0,
      inParen: 0,
      chain: 0,
      anaphora: 0,
      otherLaw: 0,
      self: 0,
    },
    dohyoAnte: { self: 0, other: 0, miss: 0 },
    ryukyu: 0,
    dojoLastOtherButSelf: 0,
  };
}
