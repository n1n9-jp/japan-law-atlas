import { z } from 'zod';
import type { EgovNode } from '../../lib/shared/egov-tree.ts';
import { egovFetchJson } from '../lib/http.ts';

export const LAW_TYPES = [
  'Constitution',
  'Act',
  'CabinetOrder',
  'ImperialOrder',
  'MinisterialOrdinance',
  'Rule',
  'Misc',
] as const;

const revisionInfoSchema = z
  .object({
    law_revision_id: z.string(),
    law_type: z.string().nullable().optional(),
    law_title: z.string().nullable().optional(),
    law_title_kana: z.string().nullable().optional(),
    abbrev: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    current_revision_status: z.string().nullable().optional(),
    amendment_enforcement_date: z.string().nullable().optional(),
    repeal_status: z.string().nullable().optional(),
    repeal_date: z.string().nullable().optional(),
  })
  .passthrough();

const lawInfoSchema = z
  .object({
    law_id: z.string(),
    law_num: z.string(),
    law_type: z.string(),
    promulgation_date: z.string(),
  })
  .passthrough();

export const lawListItemSchema = z
  .object({
    law_info: lawInfoSchema,
    revision_info: revisionInfoSchema,
  })
  .passthrough();

export type LawListItem = z.infer<typeof lawListItemSchema>;

const lawsPageSchema = z
  .object({
    total_count: z.number(),
    count: z.number().optional(),
    next_offset: z.number().nullable().optional(),
    laws: z.array(lawListItemSchema),
  })
  .passthrough();

export const egovNodeSchema: z.ZodType<EgovNode> = z.lazy(() =>
  z.object({
    tag: z.string(),
    attr: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .default({})
      .transform((rec) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(rec)) out[k] = String(v);
        return out;
      }),
    children: z.array(z.union([z.string(), egovNodeSchema])),
  }),
);

const lawDataSchema = z
  .object({
    law_full_text: egovNodeSchema,
  })
  .passthrough();

export type EgovJsonNode = EgovNode;

const API_BASE = 'https://laws.e-gov.go.jp/api/2';

export async function fetchLawsPages(asof: string, repealStatus: string): Promise<LawListItem[]> {
  const out: LawListItem[] = [];
  let offset = 0;
  for (;;) {
    const url = `${API_BASE}/laws?asof=${asof}&repeal_status=${repealStatus}&limit=1000&offset=${offset}`;
    const page = lawsPageSchema.parse(await egovFetchJson(url));
    out.push(...page.laws);
    if (page.laws.length === 0) break;
    if (page.next_offset === null || page.next_offset === undefined) {
      if (page.laws.length < 1000) break;
      offset += page.laws.length;
    } else if (page.next_offset <= offset) {
      break;
    } else {
      offset = page.next_offset;
    }
    if (out.length >= page.total_count) break;
  }
  return out;
}

export async function fetchLawArticleJson(revisionId: string, articleNum: string): Promise<EgovJsonNode> {
  const elm = `MainProvision-Article_${articleNum}`;
  const url = `${API_BASE}/law_data/${encodeURIComponent(revisionId)}?law_full_text_format=json&elm=${encodeURIComponent(elm)}`;
  const data = lawDataSchema.parse(await egovFetchJson(url));
  return data.law_full_text;
}

export function mapLawType(raw: string): (typeof LAW_TYPES)[number] {
  if (raw === 'Constitution' || raw === 'Act' || raw === 'CabinetOrder' || raw === 'ImperialOrder' || raw === 'MinisterialOrdinance' || raw === 'Rule') {
    return raw;
  }
  return 'Misc';
}
