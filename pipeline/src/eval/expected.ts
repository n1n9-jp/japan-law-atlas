export const LAWVIS_KEYS = [
  'bouei',
  'bunka',
  'chihoujichi',
  'chihouzaisei',
  'denkitsushin',
  'douro',
  'gaiji',
  'gaikokukawaseboueki',
  'gyouseisoshiki',
  'gyouseitetsuzuki',
  'jigyou',
  'kaiun',
  'kamotsuunsou',
  'kankou',
  'kankyohozen',
  'kasen',
  'keiji',
  'keisatsu',
  'kenchikujutaku',
  'kenpo',
  'kinyuhoken',
  'kokudokaihatsu',
  'kokusai',
  'kokuyuzaisan',
  'kokuzei',
  'kotsukai',
  'kotsukakoumuin',
  'kougyo',
  'kougyo2',
  'kouku',
  'kousei',
  'kyouiku',
  'minji',
  'nougyou',
  'rikuun',
  'ringyou',
  'roudou',
  'saigaitaisaku',
  'sangyotsusoku',
  'shihou',
  'suisangyou',
  'syakaifukushi',
  'syakaihoshou',
  'syoubou',
  'syougyou',
  'tochi',
  'toshikeikaku',
  'toukei',
  'yumu',
  'zaimutsusoku',
] as const;

export const EXPECTED_LAWVIS_LAWS = 8685;
export const EXPECTED_LAWVIS_PAIRS = 113641;
export const EXPECTED_JLAW_PAIR_ROWS = 70577;

export const JLAW_CITES_URL =
  'https://raw.githubusercontent.com/yabooung/jp-law-citation-graph/main/data/cites_law_to_law.csv';
export const JLAW_PRECISION_URL =
  'https://raw.githubusercontent.com/yabooung/jp-law-citation-graph/main/eval/precision_sample.csv';
export const JLAW_RECALL_URL =
  'https://raw.githubusercontent.com/yabooung/jp-law-citation-graph/main/eval/recall_gold_sample.csv';

export const LAWVIS_GRAPH_URL = (key: string): string =>
  `https://www.lawvis.info/data/graphs/${key}.json`;

export const FETCH_USER_AGENT = 'HoureiAtlas/0.1 (eval; research)';
export const MIN_INTERVAL_MS = 500;

export const GOLD_SIZE = 300;
export const SECOND_PASS_SIZE = 100;
export const SUPPL_MIN = 40;
export const RELATIVE_EXTRA_SIZE = 40;
export const JLAW_SECOND_PASS_SIZE = 80;
export const JLAW_PRECISION_SIZE = 400;
export const BOOTSTRAP_ITERS = 1000;

export const TYPE_QUOTAS = {
  Act: 120,
  CabinetOrder: 70,
  MinisterialOrdinance: 80,
  Rule: 15,
  Other: 15,
} as const;

export const HARD_QUOTAS = {
  anaphora: 40,
  abbrevDef: 30,
  range: 30,
  junyo: 40,
  yomikae: 20,
  rei: 20,
  exclude: 15,
  seirei: 25,
  noRef: 20,
} as const;

export { EVAL_SEED } from './random.ts';

export const DIFF_SAMPLE_SIZE = 50;

export const JLAW_ATTRIBUTION =
  'JLaw-CiteGraph (yabooung/jp-law-citation-graph), data CC BY 4.0, source: e-Gov 法令データ';
