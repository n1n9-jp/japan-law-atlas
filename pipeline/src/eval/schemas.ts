import { PARTS, REF_KINDS } from '../../lib/shared/contract.ts';
import { z } from 'zod';

export const partSchema = z.enum(PARTS);
export const kindSchema = z.enum(REF_KINDS);
export const tgtStatusSchema = z.enum([
  'current',
  'repealed',
  'amendingLaw',
  'self',
  'unknown',
]);

export const goldSentenceSchema = z.object({
  gid: z.string(),
  lawId: z.string(),
  pid: z.string(),
  sent: z.number().int().positive(),
  part: partSchema,
  text: z.string(),
  articleText: z.string(),
  stratum: z.string(),
});

export const goldRefSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  mention: z.string(),
  tgtLaw: z.string().nullable(),
  tgtStatus: tgtStatusSchema,
  tgtPid: z.string().nullable(),
  tgtEnd: z.string().nullable(),
  kind: kindSchema,
  yomikae: z.boolean(),
});

export const goldAnnotationSchema = z.object({
  gid: z.string(),
  annotator: z.string(),
  refs: z.array(goldRefSchema),
});

export const predRefSchema = z
  .object({
    id: z.string(),
    srcLaw: z.string(),
    srcPid: z.string(),
    sent: z.number().int().positive(),
    part: partSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    mention: z.string(),
    rawName: z.string().nullable().optional().default(null),
    tgtLaw: z.string().nullable(),
    tgtStatus: tgtStatusSchema,
    tgtPid: z.string().nullable(),
    tgtEnd: z.string().nullable().optional().default(null),
    kind: kindSchema,
    flags: z.number().int().optional().default(0),
    rule: z.string().optional().default(''),
    confidence: z.number().optional().default(1),
  })
  .passthrough();

export const lawMetaSchema = z.object({
  lawId: z.string(),
  title: z.string(),
  lawType: z.string(),
  status: z.string(),
}).passthrough();

export const sentenceRecSchema = z.object({
  pid: z.string(),
  sent: z.number().int().positive(),
  part: partSchema,
  text: z.string(),
  inTable: z.boolean().optional(),
}).passthrough();

export const corpusLawSchema = z.object({
  meta: lawMetaSchema,
  sentences: z.array(sentenceRecSchema),
}).passthrough();

export const diffClassSchema = z.enum([
  'ourMiss',
  'ourError',
  'theirError',
  'definition',
  'unknown',
]);

export const diffSampleSchema = z.object({
  srcLaw: z.string(),
  tgtLaw: z.string(),
  bucket: z.enum(['oursOnly', 'theirsOnly']),
  vs: z.enum(['lawvis', 'jlaw']),
  class: diffClassSchema.nullable(),
  note: z.string(),
});
