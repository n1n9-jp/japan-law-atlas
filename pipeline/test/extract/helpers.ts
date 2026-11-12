import { REF_FLAGS, type Part, type RefKind } from '../../lib/ref-types.js';
import { buildDict, loadJlawMaps } from '../../src/extract/dict.js';
import { extractLaw } from '../../src/extract/extract.js';
import { normalizeLawNum } from '../../src/extract/kansuji.js';
import type { ArticleEntry, SlimLaw, SlimMeta } from '../../src/extract/types.js';

export const CATALOG: SlimMeta[] = [
  meta('129AC0000000089', '民法', '明治二十九年法律第八十九号', 'Act', ['民法']),
  meta('131AC0000000011', '民法施行法', '明治三十一年法律第十一号', 'Act', []),
  meta('332AC0000000026', '租税特別措置法', '昭和三十二年法律第二十六号', 'Act', ['措置法', '租特法']),
  meta('332CO0000000043', '租税特別措置法施行令', '昭和三十二年政令第四十三号', 'CabinetOrder', ['租特法施行令']),
  meta('322AC0000000049', '労働基準法', '昭和二十二年法律第四十九号', 'Act', ['労基法']),
  meta('322M40000100023', '労働基準法施行規則', '昭和二十二年厚生省令第二十三号', 'MinisterialOrdinance', ['労基法施行規則']),
  meta('323AC0000000025', '金融商品取引法', '昭和二十三年法律第二十五号', 'Act', ['金商法']),
  meta('322AC0000000067', '地方自治法', '昭和二十二年法律第六十七号', 'Act', []),
  meta('331AC0000000080', '空港法', '昭和三十一年法律第八十号', 'Act', []),
  meta('331CO0000000232', '空港法施行令', '昭和三十一年政令第二百三十二号', 'CabinetOrder', []),
  meta('354AC0000000004', '民事執行法', '昭和五十四年法律第四号', 'Act', []),
  meta('324AC0000000121', '水先法', '昭和二十四年法律第百二十一号', 'Act', []),
  meta('325AC0000000226', '地方税法', '昭和二十五年法律第二百二十六号', 'Act', ['地税法']),
  meta('327AC0000000292', '地方公営企業法', '昭和二十七年法律第二百九十二号', 'Act', []),
  meta('143AC0000000054', '関税定率法', '明治四十三年法律第五十四号', 'Act', []),
  meta('322AC0000000135', '海難審判法', '昭和二十二年法律第百三十五号', 'Act', []),
  meta('117DF1000000032', '爆発物取締罰則', '明治十七年太政官布告第三十二号', 'Misc', []),
  meta('322AC0000000026', '学校教育法', '昭和二十二年法律第二十六号', 'Act', ['学教法']),
  meta('329AC0000000061', '関税法', '昭和二十九年法律第六十一号', 'Act', []),
  meta('343AC0000000100', '都市計画法', '昭和四十三年法律第百号', 'Act', ['都計法']),
  meta('344CO0000000158', '都市計画法施行令', '昭和四十四年政令第百五十八号', 'CabinetOrder', ['都計法施行令']),
  meta('408AC0000000109', '民事訴訟法', '平成八年法律第百九号', 'Act', ['民訴法']),
  meta('329AC0000000115', '厚生年金保険法', '昭和二十九年法律第百十五号', 'Act', ['厚生年金法']),
  meta('417AC0000000086', '会社法', '平成十七年法律第八十六号', 'Act', []),
  meta('361AC0000000092', '鉄道事業法', '昭和六十一年法律第九十二号', 'Act', []),
  meta('325AC1000000202', '建築士法', '昭和二十五年法律第二百二号', 'Act', ['建築士法']),
  meta('413AC0000000093', '農林中央金庫法', '平成十三年法律第九十三号', 'Act', []),
  meta('332AC0000000185', '中小企業団体の組織に関する法律', '昭和三十二年法律第百八十五号', 'Act', []),
  meta('322AC0000000035', '会計法', '昭和二十二年法律第三十五号', 'Act', []),
  meta('212AC0000000048', '恩給法', '大正十二年法律第四十八号', 'Act', []),
  meta('000COENKYUUREI', '恩給法施行令', '大正十二年勅令第三百六十七号', 'CabinetOrder', []),
  meta('340CO0000000096', '所得税法施行令', '昭和四十年政令第九十六号', 'CabinetOrder', []),
  meta('411AC0000000042', '行政機関の保有する情報の公開に関する法律', '平成十一年法律第四十二号', 'Act', []),
  meta('326M50000800091', '船舶職員及び小型船舶操縦者法施行規則', '昭和二十六年運輸省令第九十一号', 'MinisterialOrdinance', []),
  meta('326M50000800075', '道路運送法施行規則', '昭和二十六年運輸省令第七十五号', 'MinisterialOrdinance', []),
  meta('356AC0000000059', '銀行法', '昭和五十六年法律第五十九号', 'Act', []),
  meta('414AC0000000053', '土壌汚染対策法', '平成十四年法律第五十三号', 'Act', []),
  meta('322AC0000000100', '船員法', '昭和二十二年法律第百号', 'Act', []),
  meta('326AC0100000226', '診療放射線技師法', '昭和二十六年法律第二百二十六号', 'Act', []),
  meta('143AC0000000054', '関税定率法', '明治四十三年法律第五十四号', 'Act', []),
  meta('329CO0000000155', '関税定率法施行令', '昭和二十九年政令第百五十五号', 'CabinetOrder', []),
  meta('325AC0000000132', '放送法', '昭和二十五年法律第百三十二号', 'Act', []),
  meta('330AC0000000097', '自動車損害賠償保障法', '昭和三十年法律第九十七号', 'Act', []),
  meta('403AC0000000077', '暴力団員による不当な行為の防止等に関する法律', '平成三年法律第七十七号', 'Act', []),
  meta('324AC0000000185', '産業標準化法', '昭和二十四年法律第百八十五号', 'Act', []),
  meta('357M50000040015', '信用金庫法施行規則', '昭和五十七年大蔵省令第十五号', 'MinisterialOrdinance', []),
  meta('334AC0000000141', '国民年金法', '昭和三十四年法律第百四十一号', 'Act', []),
  meta('314AC0000000073', '船員保険法', '昭和十四年法律第七十三号', 'Act', []),
  meta('340AC0000000033', '所得税法', '昭和四十年法律第三十三号', 'Act', []),
  meta('416AC0000000099', '高速道路株式会社法', '平成十六年法律第九十九号', 'Act', []),
  meta('416AC0000000100', '独立行政法人日本高速道路保有・債務返済機構法', '平成十六年法律第百号', 'Act', []),
  meta('416AC0000000102', '日本道路公団等民営化関係法施行法', '平成十六年法律第百二号', 'Act', []),
  meta('339AC0000000129', '母子及び父子並びに寡婦福祉法', '昭和三十九年法律第百二十九号', 'Act', []),
  meta('324CO0000000231', '労働組合法施行令', '昭和二十四年政令第二百三十一号', 'CabinetOrder', []),
  meta('321IO0000000478', '労働関係調整法施行令', '昭和二十四年政令第四百七十八号', 'CabinetOrder', []),
  meta('346AC0000000040', '民事訴訟費用等に関する法律', '昭和四十六年法律第四十号', 'Act', []),
  meta('347CO0000000151', '沖縄の復帰に伴う国税関係法令の適用の特別措置等に関する政令', '昭和四十七年政令第百五十一号', 'CabinetOrder', []),
  meta('332M50400000002', '犯罪捜査規範', '昭和三十二年国家公安委員会規則第二号', 'Rule', []),
  meta('340M50000400054', '電気関係報告規則', '昭和四十年通商産業省令第五十四号', 'MinisterialOrdinance', []),
  meta('407AC0000000105', '保険業法', '平成七年法律第百五号', 'Act', []),
];

function meta(
  lawId: string,
  title: string,
  num: string,
  lawType: string,
  abbrevs: string[],
  status: SlimMeta['status'] = 'current',
): SlimMeta {
  return {
    lawId,
    title,
    abbrevs,
    oldTitles: [],
    num,
    numNorm: normalizeLawNum(num),
    lawType,
    status,
  };
}

export function flagsOf(...names: (keyof typeof REF_FLAGS)[]): number {
  return names.reduce((acc, n) => acc | REF_FLAGS[n], 0);
}

export interface CaseLaw {
  lawId: string;
  title?: string;
  lawType?: string;
  part?: Part;
  pid: string;
  sent?: number;
  text: string;
  sentences?: { pid: string; sent: number; part: Part; text: string; supplIndex?: number | null; inTable?: boolean }[];
  articles?: string[];
  inTable?: boolean;
  targetPids?: Record<string, string[]>;
}

export function makeLaw(c: CaseLaw): SlimLaw {
  const catalog = CATALOG.find((m) => m.lawId === c.lawId);
  const meta: SlimMeta = catalog
    ? { ...catalog, title: c.title ?? catalog.title, lawType: c.lawType ?? catalog.lawType }
    : {
        lawId: c.lawId,
        title: c.title ?? c.lawId,
        abbrevs: [],
        oldTitles: [],
        num: '',
        numNorm: '',
        lawType: c.lawType ?? 'Act',
        status: 'current',
      };
  const sentences = (c.sentences ?? [{ pid: c.pid, sent: c.sent ?? 1, part: c.part ?? 'main', text: c.text }]).map(
    (s) => ({
      pid: s.pid,
      sent: s.sent,
      part: s.part,
      text: s.text,
      inTable: s.inTable ?? c.inTable ?? false,
      supplIndex: s.supplIndex ?? supplIndexOf(s.pid, s.part),
      amendLawNum: s.part === 'supplAmend' ? 'dummy' : null,
    }),
  );
  const articlePids = c.articles ?? unique(sentences.map((s) => articlePid(s.pid)).filter((p) => p.includes('.a') || p === 'e'));
  const articles: ArticleEntry[] = articlePids.map((pid) => ({
    pid,
    part: 'main',
    title: pid,
    caption: null,
    toc: [],
  }));
  return { meta, toc: [], articles, sentences };
}

function supplIndexOf(pid: string, part: Part): number | null {
  if (part !== 'suppl' && part !== 'supplAmend') return null;
  const m = /^s(\d+)/.exec(pid);
  return m ? Number(m[1]) : 1;
}

function articlePid(pid: string): string {
  const m = /^(.*\.a[^.#]+)/.exec(pid);
  return m ? m[1]! : pid;
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

export interface ExpectedRef {
  mention: string;
  tgtLaw: string | null;
  tgtPid?: string | null;
  tgtEnd?: string | null;
  kind: RefKind;
  flags?: number;
  rule?: string;
  tgtStatus?: string;
}

export function runCase(c: CaseLaw) {
  const law = makeLaw(c);
  const dict = buildDict(CATALOG, loadJlawMaps());
  if (!c.targetPids) return extractLaw(law, dict);
  const targetPids = new Map<string, Set<string>>();
  for (const [k, v] of Object.entries(c.targetPids)) targetPids.set(k, new Set(v));
  const selfSet = targetPids.get(law.meta.lawId) ?? new Set<string>();
  for (const a of law.articles) selfSet.add(a.pid);
  for (const s of law.sentences) selfSet.add(s.pid);
  targetPids.set(law.meta.lawId, selfSet);
  return extractLaw(law, dict, { targetPids });
}

export function findRef(refs: { mention: string }[], mention: string) {
  return refs.filter((r) => r.mention === mention);
}
