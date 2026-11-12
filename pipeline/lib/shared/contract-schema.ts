import { z } from 'zod';
import { CONTRACT_VERSION, LAW_STATUSES, LAW_TYPES, PARTS, REF_KINDS } from './contract';

const rgb = z.tuple([z.number(), z.number(), z.number()]);
const xy = z.tuple([z.number(), z.number()]);

export const latestPointerSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  snapshotId: z.string().min(1),
  dataPath: z.string().min(1),
});

export const categoryGroupSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  hue: z.number(),
});

export const categorySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  groupId: z.number().int().nonnegative(),
  color: rgb,
  lawCount: z.number().int().nonnegative(),
  labelPos: xy,
});

export const manifestSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  snapshotId: z.string().min(1),
  egovAsof: z.string().min(1),
  builtAt: z.string().min(1),
  pipelineVersion: z.string().min(1),
  isMock: z.boolean(),
  counts: z.object({
    laws: z.number().int().nonnegative(),
    ghostLaws: z.number().int().nonnegative(),
    lawEdges: z.number().int().nonnegative(),
    refs: z.number().int().nonnegative(),
    crossLawRefs: z.number().int().nonnegative(),
  }),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  groups: z.array(categoryGroupSchema),
  categories: z.array(categorySchema),
  files: z.array(z.object({
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().length(64),
  })),
  eval: z.union([
    z.null(),
    z.object({
      crossLawF1: z.number(),
      crossLawPrecision: z.number(),
      crossLawRecall: z.number(),
      articleLevelF1: z.number(),
      kindAccuracy: z.number(),
      goldSentences: z.number(),
      goldRefs: z.number(),
      vsLawvis: z.object({ ours: z.number(), theirs: z.number(), both: z.number() }),
      vsJlaw: z.object({ ours: z.number(), theirs: z.number(), both: z.number() }),
    }),
  ]),
  attribution: z.array(z.string()),
});

const numberArray = z.array(z.number());
const stringArray = z.array(z.string());

export const lawsFileSchema = z.object({
  n: z.number().int().nonnegative(),
  id: stringArray,
  revisionId: stringArray,
  title: stringArray,
  label: stringArray,
  kana: stringArray,
  num: stringArray,
  numNorm: stringArray,
  aliases: z.array(z.array(z.string())),
  type: numberArray,
  category: numberArray,
  promulgated: numberArray,
  status: numberArray,
  x: numberArray,
  y: numberArray,
  r: numberArray,
  articles: numberArray,
  inLaws: numberArray,
  outLaws: numberArray,
  inRefs: numberArray,
  outRefs: numberArray,
  pagerank: numberArray,
  prRank: numberArray,
  parent: numberArray,
  family: numberArray,
  community: numberArray,
  bridge: numberArray,
  delegations: numberArray,
});

export const lawEdgesFileSchema = z.object({
  n: z.number().int().nonnegative(),
  src: numberArray,
  tgt: numberArray,
  mainRefs: numberArray,
  supplRefs: numberArray,
  kindMask: numberArray,
  domKind: numberArray,
  intraFamily: numberArray,
});

const polygonSchema = z.array(z.array(z.array(z.number())));

export const continentsFileSchema = z.object({
  categories: z.array(z.object({
    id: z.number().int().nonnegative(),
    polygons: polygonSchema,
    area: z.number(),
    labelPos: xy,
  })),
  groups: z.array(z.object({
    id: z.number().int().nonnegative(),
    polygons: polygonSchema,
    labelPos: xy,
  })),
});

export const categoryFlowsFileSchema = z.object({
  n: z.number().int().nonnegative(),
  src: numberArray,
  tgt: numberArray,
  refs: numberArray,
});

export const refRowsSchema = z.object({
  other: numberArray,
  srcPid: stringArray,
  tgtPid: z.array(z.union([z.string(), z.null()])),
  tgtEnd: z.array(z.union([z.string(), z.null()])),
  kind: numberArray,
  part: numberArray,
  flags: numberArray,
  mention: stringArray,
  ctx: z.array(z.union([z.string(), z.null()])),
});

export const lawRefsFileSchema = z.object({
  lawId: z.string(),
  out: refRowsSchema,
  in: refRowsSchema,
  outTotal: z.number().int().nonnegative(),
  inTotal: z.number().int().nonnegative(),
});

export const LAW_TYPE_COUNT = LAW_TYPES.length;
export const LAW_STATUS_COUNT = LAW_STATUSES.length;
export const REF_KIND_COUNT = REF_KINDS.length;
export const PART_COUNT = PARTS.length;
