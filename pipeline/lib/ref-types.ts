export type RefKind =
  | 'basis'
  | 'implements'
  | 'amend'
  | 'junyo'
  | 'rei'
  | 'exclude'
  | 'term'
  | 'cite';

export type TargetStatus = 'current' | 'repealed' | 'amendingLaw' | 'self' | 'unknown';

export type Part = 'main' | 'enact' | 'appdx' | 'suppl' | 'supplAmend';

export const REF_FLAGS = {
  yomikae: 1 << 0,
  range: 1 << 1,
  viaAbbrev: 1 << 2,
  viaAnaphora: 1 << 3,
  enumCarry: 1 << 4,
  relative: 1 << 5,
  lawLevelOnly: 1 << 6,
} as const;

export type RefFlagName = keyof typeof REF_FLAGS;

export interface Ref {
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
  tgtStatus: TargetStatus;
  tgtPid: string | null;
  tgtEnd: string | null;
  kind: RefKind;
  flags: number;
  rule: string;
  confidence: number;
}

export interface AbbrevRec {
  lawId: string;
  pid: string;
  sent: number;
  abbr: string;
  targetLaw: string | null;
  scope: string;
}

export interface LawFeatures {
  lawId: string;
  delegations: number;
  definedTerms: number;
  unresolvedMentions: number;
}
