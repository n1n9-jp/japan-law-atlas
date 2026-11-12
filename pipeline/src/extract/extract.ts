import { REF_FLAGS, type Ref, type TargetStatus } from '../../lib/ref-types.js';
import {
  abbrStem,
  abbrevInScope,
  findAbbrevDefs,
  scopeLabel,
  type AbbrevDef,
  type AbbrevTarget,
} from './abbrev.js';
import { lookupNum } from './dict.js';
import { classifyKind, countDelegations, hasYomikae, isDefinedTermSentence } from './kind.js';
import { normalizeLawNum } from './kansuji.js';
import { hasLawTypeSuffix, isOldStylePrefix, NAME_PREFIXES } from './names.js';
import {
  articleKey,
  continuesLawName,
  formatPid,
  isKatakana,
  isKatakanaOnlySentence,
  parsePid,
} from './pid.js';
import { maskQuotes, matchingClose, parenDepths } from './preprocess.js';
import {
  AMENDING_TITLE_RE,
  attachFollowing,
  CITE_CONT,
  CITE_CONT_ARTICLE,
  consumeTablePos,
  isAbbrevScopeParenInner,
  isDefinitionParenInner,
  L5_EGOV_CONT,
  L5_RIGHT_PROV,
  mergePidWithContinuation,
  parseProvision,
  parseRelativeWord,
  resolveRelative,
  RYUKYU_PAREN,
  startsProvision,
  irohaIndex,
} from './provision.js';
import type {
  ExtractExtras,
  ExtractOptions,
  ExtractResult,
  LawDict,
  NameSource,
  SentenceRec,
  SlimLaw,
  Span,
} from './types.js';
import { emptyExtras } from './types.js';

const ERA_NUM =
  /（((?:明治|大正|昭和|平成|令和)[〇零一二三四五六七八九十百千元\d]+年[^（）]*第[〇零一二三四五六七八九十百千元\d]+号)/g;

const BARE_ERA_NUM =
  /((?:明治|大正|昭和|平成|令和)[〇零一二三四五六七八九十百千元\d]+年[^、。「」（）]{0,24}第[〇零一二三四五六七八九十百千元\d]+号)/g;

const AMENDING_NAME =
  /一部を改正する|改正する(?:法律|政令|省令|規則)|整備(?:等)?に関する(?:法律|政令|省令)|廃止する(?:法律|政令)/;

const SELF_WORDS = /^(この法律|この政令|この省令|この府令|この規則|この命令|本法)/;

const ANAPHORA_LAW = /^(同法|同令|同規則|同省令|同府令)/;
const ANAPHORA_PROV = /^(同条|同項|同号|同表)/;

const CONNECTOR = /^(?:[、，・　\s]|及び|又は|並びに|若しくは|から|まで)+/;

const LEFT_CHU = new Set(['条中', '項中', '号中', '表中']);

const ANAPHORA_TYPES: Record<string, Set<string>> = {
  同法: new Set(['Act', 'Constitution', 'Misc']),
  同令: new Set(['CabinetOrder', 'ImperialOrder', 'MinisterialOrdinance', 'Misc']),
  同規則: new Set(['Rule', 'MinisterialOrdinance']),
  同省令: new Set(['MinisterialOrdinance']),
  同府令: new Set(['MinisterialOrdinance']),
};

function ruleRank(rule: string): number {
  if (rule.startsWith('L1')) return 0;
  if (rule.startsWith('L2')) return 1;
  if (rule.startsWith('L3')) return 2;
  if (rule.startsWith('L4')) return 3;
  if (rule.startsWith('L5')) return 4;
  if (rule.startsWith('L6')) return 5;
  if (rule.startsWith('L7')) return 6;
  return 99;
}

const ERA_INNER =
  /((?:明治|大正|昭和|平成|令和)[〇零一二三四五六七八九十百千元\d]+年[^（）]*第[〇零一二三四五六七八九十百千元\d]+号)/;

const MAIN_PARTS = new Set(['main', 'enact', 'appdx']);

type Antecedent = {
  law: string | null;
  pid: string | null;
  endPid: string | null;
  status: TargetStatus;
  lawType: string | null;
};

type TableCtx = {
  pid: string;
  rowLaw: Antecedent | null;
  yomikaeLaw: Antecedent | null;
};

export function extractLaw(law: SlimLaw, dict: LawDict, opts: ExtractOptions = {}): ExtractResult {
  const abbrevs: AbbrevDef[] = [];
  const refs: Ref[] = [];
  const firstMainIndex = law.sentences.findIndex((s) => s.part === 'main');
  const extras = emptyExtras();

  for (let si = 0; si < law.sentences.length; si++) {
    const sent = law.sentences[si]!;
    const depths = parenDepths(sent.text);
    const found = findAbbrevDefs(sent.text, sent, si, law, dict, (t, end) =>
      resolveAbbrevTarget(t, end, depths, dict, law),
    );
    extras.droppedAbbrevs += found.dropped;
    for (const k of Object.keys(found.byShape) as (keyof typeof found.byShape)[]) {
      extras.abbrevByShape[k] += found.byShape[k];
    }
    for (const [k, v] of Object.entries(found.unrecorded)) {
      extras.abbrevUnrecorded[k] = (extras.abbrevUnrecorded[k] ?? 0) + v;
    }
    abbrevs.push(...found.defs);
  }

  const bodyAbbrs = new Set(abbrevs.map((d) => d.abbr));
  let articleAntecedents: Antecedent[] = [];
  let lastProv: Antecedent | null = null;
  let lastArticle = '';
  let tableCtx: TableCtx | null = null;
  let lastNonTable: { pid: string; text: string; spans: Span[] } | null = null;

  for (let si = 0; si < law.sentences.length; si++) {
    const sent = law.sentences[si]!;
    const text = sent.text;
    const masked = maskQuotes(text);
    const art = articleKey(sent.pid);
    if (art !== lastArticle) {
      articleAntecedents = [];
      lastProv = null;
      lastArticle = art;
    }

    if (sent.inTable) {
      if (!tableCtx || tableCtx.pid !== sent.pid) {
        tableCtx = {
          pid: sent.pid,
          rowLaw: null,
          yomikaeLaw: lastNonTable && lastNonTable.pid === sent.pid ? detectYomikaeLaw(lastNonTable, dict, law) : null,
        };
      }
    } else {
      tableCtx = null;
    }

    const active = abbrevs.filter((d) => abbrevInScope(d, sent, si, law));
    const kataOnly = isKatakanaOnlySentence(text);
    const spans = findSpans(text, masked, sent, law, dict, active, abbrevs, bodyAbbrs, opts, kataOnly, extras);
    let taken = pickSpans(spans);
    taken = insertEnumIroha(text, masked, sent, taken);
    applyChains(text, taken, extras, sent, law, dict, opts, tableCtx);
    markScopeParens(text, taken);
    const ana = insertAnaphora(text, masked, sent, taken, articleAntecedents, lastProv, law, dict, extras);
    extras.l3TypeSkips += ana.typeSkips;
    taken = ana.taken;
    applyTableContext(text, taken, sent, law, tableCtx, extras);
    applyJunyoCut(text, taken, tableCtx);
    applyExistCheck(text, taken, sent, law, dict, opts, tableCtx, extras);
    clipPids(taken, dict, opts);

    const yomikae = hasYomikae(text) ? REF_FLAGS.yomikae : 0;
    const isFirstMain = si === firstMainIndex;

    for (const sp of taken) {
      const kind = classifyKind({
        text,
        start: sp.start,
        end: sp.end,
        part: sent.part,
        srcMeta: law.meta,
        isFirstMainSentence: isFirstMain,
      });
      const tgtStatus = finalizeStatus(sp, law);
      const confidence = confidenceOf(sp, tgtStatus);
      const mention = text.slice(sp.start, sp.end);
      refs.push({
        id: `${law.meta.lawId}:${sent.pid}#${sent.sent}:${sp.start}`,
        srcLaw: law.meta.lawId,
        srcPid: sent.pid,
        sent: sent.sent,
        part: sent.part,
        start: sp.start,
        end: sp.end,
        mention,
        rawName: sp.rawName,
        tgtLaw: sp.tgtLaw,
        tgtStatus,
        tgtPid: sp.tgtPid,
        tgtEnd: sp.tgtEnd,
        kind,
        flags: sp.flags | yomikae,
        rule: sp.rule,
        confidence,
      });
      if (sp.source && sp.rule === 'L5-name') extras.l5BySource[sp.source]++;
      const lawType = sp.tgtLawType ?? lawTypeOf(sp, dict);
      const isOther =
        (sp.tgtLaw && sp.tgtLaw !== law.meta.lawId && tgtStatus !== 'unknown') || tgtStatus === 'amendingLaw';
      if (isOther) {
        articleAntecedents.push({
          law: sp.tgtLaw,
          pid: sp.tgtPid,
          endPid: sp.tgtEnd,
          status: tgtStatus,
          lawType,
        });
      }
      if (sp.tgtPid) {
        lastProv = {
          law: sp.tgtLaw,
          pid: sp.tgtPid,
          endPid: sp.tgtEnd,
          status: tgtStatus,
          lawType,
        };
      }
    }
    if (sent.inTable && tableCtx) {
      const row = detectRowLawCell(text, taken);
      if (row) tableCtx.rowLaw = row;
      const head = detectYomikaeHeader(text, taken, dict, law);
      if (head && !tableCtx.yomikaeLaw) tableCtx.yomikaeLaw = head;
    } else {
      lastNonTable = { pid: sent.pid, text, spans: taken };
    }
  }

  let delegations = 0;
  let definedTerms = 0;
  for (const s of law.sentences) {
    if (MAIN_PARTS.has(s.part)) delegations += countDelegations(s.text);
    if (isDefinedTermSentence(s.text)) definedTerms++;
  }
  const unresolvedMentions = refs.filter((r) => r.tgtStatus === 'unknown').length;

  return {
    refs,
    abbrevs: abbrevs.map((a) => ({
      lawId: law.meta.lawId,
      pid: a.pid,
      sent: a.sent,
      abbr: a.abbr,
      targetLaw: a.self ? law.meta.lawId : a.targetLaw,
      scope: scopeLabel(a),
    })),
    features: {
      lawId: law.meta.lawId,
      delegations,
      definedTerms,
      unresolvedMentions,
    },
    extras,
  };
}

function lawTypeOf(sp: Span, dict: LawDict): string | null {
  if (sp.tgtLaw) return dict.byId.get(sp.tgtLaw)?.lawType ?? null;
  if (sp.tgtStatus === 'amendingLaw') return lawTypeFromAmendingName(sp.rawName ?? '');
  return sp.tgtLawType ?? null;
}

function lawTypeFromAmendingName(name: string): string {
  if (name.endsWith('省令') || name.endsWith('府令')) return 'MinisterialOrdinance';
  if (name.endsWith('政令') || name.endsWith('命令')) return 'CabinetOrder';
  if (name.endsWith('規則')) return 'Rule';
  if (name.endsWith('法律') || name.endsWith('法')) return 'Act';
  return 'Misc';
}

function finalizeStatus(sp: Span, law: SlimLaw): TargetStatus {
  if (sp.tgtStatus === 'amendingLaw' || sp.tgtStatus === 'unknown' || sp.tgtStatus === 'self') return sp.tgtStatus;
  if (sp.tgtLaw === law.meta.lawId) return 'self';
  if (!sp.tgtLaw) return sp.tgtStatus;
  return sp.tgtStatus;
}

function confidenceOf(sp: Span, status: TargetStatus): number {
  if (status === 'unknown' || sp.rule === 'L3-anaphora-miss') return 0;
  switch (sp.rule) {
    case 'L1-number':
      return 1;
    case 'L2-abbrev':
      return 0.95;
    case 'L2-abbrev-fallback':
      return 0.7;
    case 'L4-self':
      return 1;
    case 'L5-name':
      return sp.viaJlawOnly || sp.source === 'jlaw' ? 0.8 : 0.9;
    case 'L6-provision':
      return sp.flags & REF_FLAGS.enumCarry ? 0.9 : 0.95;
    case 'L6-provision-table':
      return 0.85;
    case 'L6-provision-exist':
      return 0.8;
    case 'L3-anaphora':
      return 0.85;
    case 'L7-relative':
      return 0.95;
    default:
      return 0.5;
  }
}

function findSpans(
  text: string,
  masked: string,
  sent: SentenceRec,
  law: SlimLaw,
  dict: LawDict,
  active: AbbrevDef[],
  allAbbrevs: AbbrevDef[],
  bodyAbbrs: Set<string>,
  opts: ExtractOptions,
  kataOnly: boolean,
  extras: ExtractExtras,
): Span[] {
  const spans: Span[] = [];
  spans.push(...findL1(text, masked, sent, dict, law));
  spans.push(...findL2(text, masked, sent, active, allAbbrevs, law, dict, kataOnly, extras));
  spans.push(...findL4(text, masked, sent, law, kataOnly));
  spans.push(...findL5(text, masked, sent, dict, law, kataOnly, extras, active, bodyAbbrs));
  spans.push(...findL6(text, masked, sent, law, opts));
  spans.push(...findL7(text, masked, sent, law, kataOnly, extras));
  return spans;
}

function pidFlags(base: number, tgtPid: string | null, tgtStatus: TargetStatus): number {
  let flags = base;
  if (tgtStatus !== 'amendingLaw' && !tgtPid) flags |= REF_FLAGS.lawLevelOnly;
  return flags;
}

function forceFusokuS1(tgtPid: string | null, kind: string | undefined): string | null {
  if (!tgtPid || kind !== 'fusoku') return tgtPid;
  const p = parsePid(tgtPid);
  return formatPid({ ...p, root: 's1' });
}

function insertAnaphora(
  text: string,
  masked: string,
  sent: SentenceRec,
  taken: Span[],
  articleAntecedents: Antecedent[],
  lastProv: Antecedent | null,
  law: SlimLaw,
  dict: LawDict,
  extras: ExtractExtras,
): { taken: Span[]; typeSkips: number } {
  const extra = findL3(text, masked, sent, articleAntecedents, lastProv, law, taken, dict, extras);
  return { taken: pickSpans([...taken, ...extra.spans]), typeSkips: extra.typeSkips };
}

function findL1(text: string, masked: string, sent: SentenceRec, dict: LawDict, law: SlimLaw): Span[] {
  const out: Span[] = [];
  ERA_NUM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ERA_NUM.exec(masked))) {
    const open = m.index;
    if (masked[open] !== '（') continue;
    const numRaw = m[1]!;
    const numNorm = normalizeLawNum(numRaw);
    const close = matchingClose(text, open);
    const afterNum = open + m[0].length;
    const rest = close >= 0 ? text.slice(afterNum, close) : '';
    const innerHasDoho = /同法|同令|同規則|同省令|同府令/.test(rest);
    const isDef = close >= 0 && isDefinitionParenInner(text.slice(open + 1, close));
    const numberOnly = !isDef && (rest.trim() === '' || rest === '。');
    const meta = lookupNum(dict, numNorm);
    const nameStart = nameStartOf(text, open, meta?.title, meta?.oldTitles ?? []);
    if (isMaskedAt(masked, nameStart)) continue;

    let tgtLaw: string | null = null;
    let tgtStatus: TargetStatus = 'unknown';
    const rawName = text.slice(nameStart, open);
    if (meta) {
      tgtLaw = meta.lawId;
      tgtStatus = meta.status === 'repealed' ? 'repealed' : meta.lawId === law.meta.lawId ? 'self' : 'current';
      if (meta.status === 'notYetEffective') tgtStatus = 'current';
    } else if (AMENDING_NAME.test(rawName)) {
      tgtStatus = 'amendingLaw';
    }
    const tgtLawType = meta?.lawType ?? (tgtStatus === 'amendingLaw' ? lawTypeFromAmendingName(rawName) : null);

    if (isDef) {
      out.push({
        start: nameStart,
        end: afterNum,
        rule: 'L1-number',
        rawName: rawName || null,
        tgtLaw,
        tgtStatus,
        tgtPid: null,
        tgtEnd: null,
        flags: pidFlags(0, null, tgtStatus),
        viaJlawOnly: false,
        tgtLawType,
      });
      if (close >= 0) {
        const attached = attachProvision(text, close + 1, sent);
        if (attached && attached.end > close + 1 && !attached.lawLevelOnly) {
          let tgtPid = forceFusokuS1(attached.tgtPid ?? null, attached.kind);
          let tgtEnd = attached.tgtEnd ?? null;
          if (attached.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
          out.push({
            start: close + 1,
            end: attached.end,
            rule: 'L1-number',
            rawName: null,
            tgtLaw,
            tgtStatus,
            tgtPid,
            tgtEnd,
            flags: pidFlags(REF_FLAGS.enumCarry | (attached.flags ?? 0), tgtPid, tgtStatus),
            viaJlawOnly: false,
            tgtLawType,
            bareKind: attached.kind,
            fromChain: true,
          });
        }
      }
      continue;
    }

    let afterParen: number;
    if (close >= 0 && numberOnly) {
      afterParen = close + 1;
    } else if (innerHasDoho) {
      afterParen = afterNum;
    } else {
      afterParen = close >= 0 ? close + 1 : afterNum;
    }
    const attached = attachProvision(text, afterParen, sent);
    const end = attached ? attached.end : afterParen;
    let tgtPid = forceFusokuS1(attached?.tgtPid ?? null, attached?.kind);
    let tgtEnd = attached?.tgtEnd ?? null;
    if (attached?.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
    const flags = pidFlags(attached?.flags ?? 0, tgtPid, tgtStatus);

    out.push({
      start: nameStart,
      end,
      rule: 'L1-number',
      rawName: rawName || null,
      tgtLaw,
      tgtStatus,
      tgtPid,
      tgtEnd,
      flags,
      viaJlawOnly: false,
      tgtLawType,
      bareKind: attached?.kind,
    });
  }
  out.push(...findL1Bare(text, masked, sent, dict, law, out));
  return out;
}

function findL1Bare(
  text: string,
  masked: string,
  sent: SentenceRec,
  dict: LawDict,
  law: SlimLaw,
  already: Span[],
): Span[] {
  const out: Span[] = [];
  BARE_ERA_NUM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_ERA_NUM.exec(masked))) {
    const start = m.index;
    if (text[start - 1] === '（') continue;
    if (isMaskedAt(masked, start)) continue;
    if (already.some((s) => s.start <= start && start < s.end) || out.some((s) => s.start <= start && start < s.end)) {
      continue;
    }
    const numRaw = m[1]!;
    const numNorm = normalizeLawNum(numRaw);
    const after = start + m[0].length;
    const meta = lookupNum(dict, numNorm);
    let tgtLaw: string | null = null;
    let tgtStatus: TargetStatus = 'amendingLaw';
    if (meta) {
      tgtLaw = meta.lawId;
      tgtStatus = meta.status === 'repealed' ? 'repealed' : meta.lawId === law.meta.lawId ? 'self' : 'current';
      if (meta.status === 'notYetEffective') tgtStatus = 'current';
    }
    const attached = attachProvision(text, after, sent);
    const end = attached ? attached.end : after;
    let tgtPid = forceFusokuS1(attached?.tgtPid ?? null, attached?.kind);
    let tgtEnd = attached?.tgtEnd ?? null;
    if (attached?.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
    const flags = pidFlags(attached?.flags ?? 0, tgtPid, tgtStatus);
    out.push({
      start,
      end,
      rule: 'L1-number',
      rawName: numRaw,
      tgtLaw,
      tgtStatus,
      tgtPid,
      tgtEnd,
      flags,
      viaJlawOnly: false,
      tgtLawType: meta?.lawType ?? 'Act',
      bareKind: attached?.kind,
    });
  }
  return out;
}

function nameStartOf(text: string, open: number, title: string | undefined, oldTitles: string[]): number {
  const before = text.slice(0, open);
  const candidates = [title, ...oldTitles].filter((x): x is string => !!x).sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    if (before.endsWith(c)) return open - c.length;
  }
  const seps = ['及び', '又は', '並びに', '若しくは'];
  let i = open - 1;
  while (i >= 0) {
    const ch = before[i]!;
    if ('、。「」（）　'.includes(ch) || ch === '\n') return i + 1;
    for (const s of seps) {
      if (before.endsWith(s, i + 1)) return i + 1;
    }
    i--;
  }
  return 0;
}

function findL2(
  text: string,
  masked: string,
  sent: SentenceRec,
  active: AbbrevDef[],
  allAbbrevs: AbbrevDef[],
  law: SlimLaw,
  dict: LawDict,
  kataOnly: boolean,
  extras: ExtractExtras,
): Span[] {
  const out: Span[] = [];
  const sorted = [...active].sort((a, b) => b.abbr.length - a.abbr.length);
  for (let i = 0; i < masked.length; ) {
    if (masked[i] === '\u0000') {
      i++;
      continue;
    }
    let hit: AbbrevDef | null = null;
    for (const d of sorted) {
      if (d.abbr.length === 0) continue;
      if (masked.startsWith(d.abbr, i) && masked.slice(i, i + d.abbr.length).includes('\u0000') === false) {
        hit = d;
        break;
      }
    }
    if (!hit) {
      i++;
      continue;
    }
    const prefix = matchNamePrefix(text, i, kataOnly);
    const prefixedDefined = prefix ? sorted.some((d) => d.abbr === prefix + hit.abbr) : false;
    if (continuesLawName(text[i - 1], kataOnly) && !prefix) {
      i++;
      continue;
    }
    if (prefix && prefixedDefined) {
      i++;
      continue;
    }
    const after = masked.slice(i + hit.abbr.length);
    const shortStart = hit.abbr.length <= 2 && (i === 0 || /[。；;]/.test(text[i - 1] ?? ''));
    if (
      !CITE_CONT.test(after) &&
      !CITE_CONT_ARTICLE.test(after) &&
      !/^（/.test(after) &&
      !/^及び|^又は|^並びに|^若しくは/.test(after) &&
      !(shortStart && /^(の規定|の施行|の適用|により|による)/.test(after))
    ) {
      i++;
      continue;
    }
    const start = prefix && !prefixedDefined ? i - prefix.length : i;
    if (prefix && !prefixedDefined) extras.prefixHits++;
    const split = splitDefParenAfter(text, i + hit.abbr.length, sent);
    if (split) {
      const tgt = l2Target(hit, law);
      out.push({
        start,
        end: i + hit.abbr.length,
        rule: 'L2-abbrev',
        rawName: hit.abbr,
        tgtLaw: tgt.law,
        tgtStatus: tgt.status,
        tgtPid: null,
        tgtEnd: null,
        flags: pidFlags(REF_FLAGS.viaAbbrev, null, tgt.status),
        viaJlawOnly: false,
        tgtLawType: tgt.law ? dict.byId.get(tgt.law)?.lawType ?? null : null,
        skipClip: isOldStylePrefix(prefix),
      });
      if (split.prov) out.push(l2ProvSpan(split.prov, tgt, dict, hit.abbr, 'L2-abbrev'));
      i = split.next;
      continue;
    }
    const attached = attachProvision(text, i + hit.abbr.length, sent);
    const end = attached ? attached.end : i + hit.abbr.length;
    const tgt = l2Target(hit, law);
    let tgtPid = forceFusokuS1(attached?.tgtPid ?? null, attached?.kind);
    let tgtEnd = attached?.tgtEnd ?? null;
    if (attached?.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
    const flags = pidFlags(REF_FLAGS.viaAbbrev | (attached?.flags ?? 0), tgtPid, tgt.status);
    out.push({
      start,
      end,
      rule: 'L2-abbrev',
      rawName: hit.abbr,
      tgtLaw: tgt.law,
      tgtStatus: tgt.status,
      tgtPid,
      tgtEnd,
      flags,
      viaJlawOnly: false,
      tgtLawType: tgt.law ? dict.byId.get(tgt.law)?.lawType ?? null : null,
      bareKind: attached?.kind,
      skipClip: isOldStylePrefix(prefix),
    });
    i = end;
  }
  out.push(...findL2Fallback(text, masked, sent, active, allAbbrevs, law, dict, extras, out));
  return out;
}

function l2Target(hit: AbbrevDef, law: SlimLaw): { law: string | null; status: TargetStatus } {
  if (hit.self) return { law: law.meta.lawId, status: 'self' };
  if (hit.tgtStatus === 'amendingLaw') return { law: null, status: 'amendingLaw' };
  if (hit.targetLaw) return { law: hit.targetLaw, status: hit.tgtStatus || 'current' };
  return { law: null, status: hit.tgtStatus || 'unknown' };
}

function l2ProvSpan(
  att: { end: number; start: number; tgtPid: string | null; tgtEnd: string | null; flags: number; kind?: Span['bareKind'] },
  tgt: { law: string | null; status: TargetStatus },
  dict: LawDict,
  abbr: string,
  rule: string,
): Span {
  let tgtPid = forceFusokuS1(att.tgtPid, att.kind);
  let tgtEnd = att.tgtEnd;
  if (att.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
  return {
    start: att.start,
    end: att.end,
    rule,
    rawName: null,
    tgtLaw: tgt.law,
    tgtStatus: tgt.status,
    tgtPid,
    tgtEnd,
    flags: pidFlags(REF_FLAGS.viaAbbrev | REF_FLAGS.enumCarry | att.flags, tgtPid, tgt.status),
    viaJlawOnly: false,
    tgtLawType: tgt.law ? dict.byId.get(tgt.law)?.lawType ?? null : null,
    bareKind: att.kind,
    fromChain: true,
  };
}

function splitDefParenAfter(
  text: string,
  i: number,
  sent: SentenceRec,
): { next: number; prov: { start: number; end: number; tgtPid: string | null; tgtEnd: string | null; flags: number; kind?: Span['bareKind'] } | null } | null {
  if (text[i] !== '（' && text[i] !== '(') return null;
  const close = matchingClose(text, i);
  if (close < 0) return null;
  const inner = text.slice(i + 1, close);
  if (!isDefinitionParenInner(inner)) return null;
  if (ERA_INNER.test(inner) && !isDefinitionParenInner(inner)) return null;
  const attached = attachProvision(text, close + 1, sent);
  if (attached && !attached.lawLevelOnly && attached.end > close + 1) {
    return {
      next: attached.end,
      prov: {
        start: close + 1,
        end: attached.end,
        tgtPid: attached.tgtPid,
        tgtEnd: attached.tgtEnd,
        flags: attached.flags,
        kind: attached.kind,
      },
    };
  }
  return { next: close + 1, prov: null };
}

function findL2Fallback(
  text: string,
  masked: string,
  sent: SentenceRec,
  active: AbbrevDef[],
  allAbbrevs: AbbrevDef[],
  law: SlimLaw,
  dict: LawDict,
  extras: ExtractExtras,
  already: Span[],
): Span[] {
  const out: Span[] = [];
  const activeSet = new Set(active.map((d) => d.abbr));
  const byAbbr = new Map<string, AbbrevDef[]>();
  const byStem = new Map<string, AbbrevDef[]>();
  for (const d of allAbbrevs) {
    if (d.scope.kind !== 'part') continue;
    const arr = byAbbr.get(d.abbr) ?? [];
    arr.push(d);
    byAbbr.set(d.abbr, arr);
    const st = abbrStem(d.abbr);
    const stArr = byStem.get(st) ?? [];
    stArr.push(d);
    byStem.set(st, stArr);
  }

  const tryWord = (word: string, i: number): boolean => {
    if (activeSet.has(word)) return false;
    if (covered(already, i) || out.some((s) => s.start <= i && i < s.end)) return false;
    if (continuesLawName(text[i - 1], isKatakanaOnlySentence(text))) return false;
    const stem = abbrStem(word);
    const dictHit = dict.longestName(stem, 0);
    if (dictHit && dictHit.end === stem.length) {
      return false;
    }
    const after = text.slice(i + word.length);
    if (!CITE_CONT.test(after) && !CITE_CONT_ARTICLE.test(after) && !/^附則第|^別表|^の規定/.test(after)) return false;
    const same = uniqueTargets(byAbbr.get(word) ?? []);
    const stemHits = uniqueTargets(byStem.get(abbrStem(word)) ?? []);
    const chosen = same ?? stemHits;
    const prefix = matchNamePrefix(text, i, isKatakanaOnlySentence(text));
    const start = prefix ? i - prefix.length : i;
    const attached = attachProvision(text, i + word.length, sent);
    const end = attached ? attached.end : i + word.length;
    if (chosen) {
      extras.l2Fallback++;
      const tgtLaw = chosen.self ? law.meta.lawId : chosen.targetLaw;
      const tgtStatus: TargetStatus = chosen.self
        ? 'self'
        : chosen.tgtStatus === 'amendingLaw'
          ? 'amendingLaw'
          : tgtLaw
            ? chosen.tgtStatus || 'current'
            : 'unknown';
      let tgtPid = forceFusokuS1(attached?.tgtPid ?? null, attached?.kind);
      let tgtEnd = attached?.tgtEnd ?? null;
      if (attached?.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
      out.push({
        start,
        end,
        rule: 'L2-abbrev-fallback',
        rawName: word,
        tgtLaw: tgtStatus === 'amendingLaw' ? null : tgtLaw,
        tgtStatus,
        tgtPid,
        tgtEnd,
        flags: pidFlags(REF_FLAGS.viaAbbrev | (attached?.flags ?? 0), tgtPid, tgtStatus),
        viaJlawOnly: false,
        tgtLawType: tgtLaw ? dict.byId.get(tgtLaw)?.lawType ?? null : null,
        bareKind: attached?.kind,
        skipClip: isOldStylePrefix(prefix) || /^(旧|改正前|廃止前)/.test(word),
      });
      return true;
    }
    if (
      /^(?:旧|新|改正前の|改正後の)/.test(word) &&
      hasLawTypeSuffix(word) &&
      !isGenericAbbrevStem(stem) &&
      !/(?:それぞれ|次に掲|関係法律|各法律|又は|若しくは|及び|による)/.test(word)
    ) {
      out.push({
        start,
        end,
        rule: 'L2-abbrev-fallback',
        rawName: word,
        tgtLaw: null,
        tgtStatus: 'unknown',
        tgtPid: attached?.tgtPid ?? null,
        tgtEnd: attached?.tgtEnd ?? null,
        flags: pidFlags(REF_FLAGS.viaAbbrev | (attached?.flags ?? 0), attached?.tgtPid ?? null, 'unknown'),
        viaJlawOnly: false,
        skipClip: true,
      });
      extras.l2Fallback++;
      return true;
    }
    return false;
  };

  const candidates = [...new Set([...byAbbr.keys(), ...[...byStem.keys()].flatMap((st) => [`旧${st}`, `新${st}`, `改正前の${st}`, `改正後の${st}`, st])])].sort(
    (a, b) => b.length - a.length,
  );
  const UNDEF =
    /(?:旧|新|改正前の|改正後の)[\u4E00-\u9FFFぁ-んァ-ヶーA-Za-z0-9０-９・]{1,24}(?:法律|政令|省令|府令|規則|令|法)/g;
  for (let i = 0; i < masked.length; ) {
    if (masked[i] === '\u0000') {
      i++;
      continue;
    }
    let matched = false;
    for (const w of candidates) {
      if (!w || w.length === 0) continue;
      if (masked.startsWith(w, i) && !masked.slice(i, i + w.length).includes('\u0000')) {
        if (tryWord(w, i)) {
          i += w.length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) i++;
  }
  UNDEF.lastIndex = 0;
  let um: RegExpExecArray | null;
  while ((um = UNDEF.exec(masked))) {
    tryWord(um[0]!, um.index);
  }
  void sent;
  return out;
}

function uniqueTargets(defs: AbbrevDef[]): AbbrevDef | null {
  if (defs.length === 0) return null;
  const keys = new Set(defs.map((d) => `${d.targetLaw ?? ''}|${d.tgtStatus}|${d.self}`));
  if (keys.size !== 1) return null;
  return defs[0]!;
}

function covered(taken: Span[], i: number): boolean {
  return taken.some((t) => t.start <= i && i < t.end);
}

function findL3(
  text: string,
  masked: string,
  sent: SentenceRec,
  articleAntecedents: Antecedent[],
  lastProv: Antecedent | null,
  law: SlimLaw,
  taken: Span[],
  dict: LawDict,
  extras: ExtractExtras,
): { spans: Span[]; typeSkips: number } {
  const out: Span[] = [];
  let typeSkips = 0;
  for (let i = 0; i < masked.length; ) {
    if (masked[i] === '\u0000' || covered(taken, i)) {
      i++;
      continue;
    }
    const lawM = ANAPHORA_LAW.exec(masked.slice(i));
    const provM = ANAPHORA_PROV.exec(masked.slice(i));
    if (lawM) {
      const word = lawM[1]!;
      const attached = attachProvision(text, i + word.length, sent);
      const end = attached ? attached.end : i + word.length;
      const inNum = enclosingNumberSpan(taken, i, text);
      const resolved = inNum
        ? {
            hit: {
              law: inNum.tgtLaw,
              pid: inNum.tgtPid,
              endPid: inNum.tgtEnd,
              status: inNum.tgtStatus,
              lawType: inNum.tgtLawType ?? dict.byId.get(inNum.tgtLaw ?? '')?.lawType ?? null,
            } satisfies Antecedent,
            skips: 0,
          }
        : resolveLawAnaphora(word, i, taken, articleAntecedents, dict, law);
      typeSkips += resolved.skips;
      const miss = !resolved.hit;
      const amending = resolved.hit?.status === 'amendingLaw';
      let tgtPid = attached ? forceFusokuS1(attached.tgtPid, attached.kind) : (resolved.hit?.pid ?? null);
      let tgtEnd = attached?.tgtEnd ?? resolved.hit?.endPid ?? null;
      if (attached?.kind === 'fusoku') {
        tgtPid = forceFusokuS1(attached.tgtPid, 'fusoku');
        if (tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
      }
      const tgtStatus: TargetStatus = miss ? 'unknown' : amending ? 'amendingLaw' : resolved.hit!.status;
      const flags = pidFlags(REF_FLAGS.viaAnaphora | (attached?.flags ?? 0), tgtPid, tgtStatus);
      out.push({
        start: i,
        end,
        rule: miss ? 'L3-anaphora-miss' : 'L3-anaphora',
        rawName: word,
        tgtLaw: amending ? null : (resolved.hit?.law ?? null),
        tgtStatus,
        tgtPid,
        tgtEnd,
        flags,
        viaJlawOnly: false,
        tgtLawType: resolved.hit?.lawType ?? null,
        bareKind: attached?.kind,
      });
      i = end;
      continue;
    }
    if (provM) {
      const word = provM[1]!;
      const pool = [...taken, ...out];
      const earlierSpan =
        word === '同表' ? lastTableAntecedent(pool, i, text) : lastProvAntecedent(pool, i, text);
      const fromPrev = !earlierSpan;
      const resolved = earlierSpan
        ? {
            law: earlierSpan.tgtLaw,
            pid: earlierSpan.tgtPid,
            endPid: earlierSpan.tgtEnd,
            status: earlierSpan.tgtStatus,
            lawType: earlierSpan.tgtLawType ?? null,
          }
        : word === '同表'
          ? null
          : lastProv;
      const miss = !resolved?.pid;
      let tgtPid: string | null = null;
      if (resolved?.pid) {
        if (word === '同条') tgtPid = articleOnly(resolved.pid);
        else if (word === '同項') {
          const rp = parsePid(resolved.pid);
          if (rp.root.startsWith('t') && rp.items.length > 0) tgtPid = resolved.pid;
          else tgtPid = paraOnly(resolved.pid) ?? articleOnly(resolved.pid);
        } else if (word === '同表') tgtPid = resolved.pid;
        else tgtPid = resolved.pid;
      }
      let end = i + word.length;
      let tgtEnd: string | null = null;
      let attFlags = 0;
      if (tgtPid && word === '同表') {
        const att = parseProvision(text, end, tgtPid, { fusokuRoot: 's1' });
        if (att) {
          end = att.end;
          extras.mergedDojo++;
        }
      } else if (tgtPid && (word === '同条' || word === '同項' || word === '同号')) {
        const att = parseProvision(text, end, tgtPid, { fusokuRoot: 's1' });
        if (att && att.end > end) {
          tgtPid = mergePidWithContinuation(tgtPid, att.tgtPid);
          tgtEnd = att.tgtEnd;
          attFlags = att.flags;
          end = att.end;
          extras.mergedDojo++;
        }
      }
      const otherLaw = !!(resolved?.law && resolved.law !== law.meta.lawId) || resolved?.status === 'amendingLaw';
      const tgtStatus: TargetStatus = miss
        ? 'unknown'
        : resolved?.status === 'amendingLaw'
          ? 'amendingLaw'
          : otherLaw
            ? (resolved?.status ?? 'current')
            : resolved?.law === law.meta.lawId
              ? 'self'
              : (resolved?.status ?? 'unknown');
      const tgtLaw = resolved?.status === 'amendingLaw' ? null : miss ? null : (resolved?.law ?? law.meta.lawId);
      if (word === '同表') {
        if (miss) extras.dohyoAnte.miss++;
        else if (otherLaw) extras.dohyoAnte.other++;
        else extras.dohyoAnte.self++;
      } else {
        if (fromPrev) extras.dojoAnte.prevSent++;
        else extras.dojoAnte.sameSent++;
        if (earlierSpan) {
          const depths = parenDepths(text);
          if ((depths[earlierSpan.start] ?? 0) > 0) extras.dojoAnte.inParen++;
          if (earlierSpan.fromChain || earlierSpan.flags & REF_FLAGS.enumCarry) extras.dojoAnte.chain++;
          if (earlierSpan.fromAnaphora || earlierSpan.rule.startsWith('L3')) extras.dojoAnte.anaphora++;
        }
        if (otherLaw) extras.dojoAnte.otherLaw++;
        else if (!miss) extras.dojoAnte.self++;
        if (!miss && otherLaw && tgtLaw === law.meta.lawId && tgtStatus === 'self') extras.dojoLastOtherButSelf++;
      }
      out.push({
        start: i,
        end,
        rule: miss ? 'L3-anaphora-miss' : 'L3-anaphora',
        rawName: word,
        tgtLaw,
        tgtStatus,
        tgtPid,
        tgtEnd,
        flags: REF_FLAGS.viaAnaphora | attFlags | (tgtPid ? 0 : REF_FLAGS.lawLevelOnly),
        viaJlawOnly: false,
        tgtLawType: resolved?.lawType ?? null,
        fromAnaphora: true,
        isTable: word === '同表',
      });
      i = end;
      continue;
    }
    i++;
  }
  return { spans: out, typeSkips };
}

function enclosingNumberSpan(taken: Span[], i: number, text: string): Span | null {
  for (let k = taken.length - 1; k >= 0; k--) {
    const s = taken[k]!;
    if (s.rule !== 'L1-number') continue;
    if (s.start >= i) continue;
    const open = text.indexOf('（', s.start);
    if (open < 0 || open >= i) continue;
    const close = matchingClose(text, open);
    if (close > i) return s;
  }
  return null;
}

function resolveLawAnaphora(
  word: string,
  i: number,
  taken: Span[],
  articleAntecedents: Antecedent[],
  dict: LawDict,
  law: SlimLaw,
): { hit: Antecedent | null; skips: number } {
  let skips = 0;
  for (let k = taken.length - 1; k >= 0; k--) {
    const s = taken[k]!;
    if (s.start >= i) continue;
    const ant = spanAsAntecedent(s, dict, law);
    if (!ant) continue;
    if (!typeMatches(word, ant.lawType)) {
      skips++;
      continue;
    }
    return { hit: ant, skips };
  }
  for (let k = articleAntecedents.length - 1; k >= 0; k--) {
    const ant = articleAntecedents[k]!;
    if (!typeMatches(word, ant.lawType)) {
      skips++;
      continue;
    }
    return { hit: ant, skips };
  }
  return { hit: null, skips };
}

function spanAsAntecedent(s: Span, dict: LawDict, law: SlimLaw): Antecedent | null {
  if (s.tgtStatus === 'unknown') return null;
  if (s.tgtStatus === 'amendingLaw') {
    return {
      law: null,
      pid: s.tgtPid,
      endPid: s.tgtEnd,
      status: 'amendingLaw',
      lawType: s.tgtLawType ?? lawTypeFromAmendingName(s.rawName ?? ''),
    };
  }
  if (!s.tgtLaw || s.tgtLaw === law.meta.lawId) return null;
  return {
    law: s.tgtLaw,
    pid: s.tgtPid,
    endPid: s.tgtEnd,
    status: s.tgtStatus,
    lawType: s.tgtLawType ?? dict.byId.get(s.tgtLaw)?.lawType ?? null,
  };
}

function typeMatches(word: string, lawType: string | null): boolean {
  const allowed = ANAPHORA_TYPES[word];
  if (!allowed) return false;
  if (!lawType) return false;
  return allowed.has(lawType);
}

function lastPidBefore(taken: Span[], i: number): Span | null {
  return lastProvAntecedent(taken, i, '');
}

function lastProvAntecedent(taken: Span[], i: number, _text: string): Span | null {
  const cands = taken.filter((s) => s.start < i && s.tgtPid && !s.scopeParen);
  const outer = cands.filter(
    (s) => !cands.some((o) => o !== s && o.start <= s.start && o.end >= s.end && o.end - o.start > s.end - s.start),
  );
  outer.sort((a, b) => a.start - b.start);
  return outer.at(-1) ?? null;
}

function lastTableAntecedent(taken: Span[], i: number, text: string): Span | null {
  let last: Span | null = null;
  const sorted = [...taken].sort((a, b) => a.start - b.start);
  for (const s of sorted) {
    if (s.start >= i) break;
    if (s.scopeParen) continue;
    if (isTableSpan(s, text)) last = s;
  }
  return last;
}

function isTableSpan(s: Span, text: string): boolean {
  if (s.isTable) return true;
  if (s.tgtPid && parsePid(s.tgtPid).root.startsWith('t')) return true;
  const m = text.slice(s.start, s.end);
  if (/表/.test(m)) return true;
  return false;
}

function markScopeParens(text: string, spans: Span[]): void {
  const depths = parenDepths(text);
  for (const sp of spans) {
    const d = depths[sp.start] ?? 0;
    if (d <= 0) continue;
    const open = enclosingOpen(text, sp.start);
    if (open < 0) continue;
    const close = matchingClose(text, open);
    if (close < 0) continue;
    const inner = text.slice(open + 1, close);
    if (isAbbrevScopeParenInner(inner)) sp.scopeParen = true;
  }
}

function articleOnly(pid: string): string {
  const p = parsePid(pid);
  return [p.root, p.article ? `a${p.article}` : null].filter(Boolean).join('.');
}

function paraOnly(pid: string): string | null {
  const p = parsePid(pid);
  if (!p.para) return null;
  return [p.root, p.article ? `a${p.article}` : null, `p${p.para}`].filter(Boolean).join('.');
}

function findL4(text: string, masked: string, sent: SentenceRec, law: SlimLaw, kataOnly: boolean): Span[] {
  const out: Span[] = [];
  const amending = sent.part === 'supplAmend';
  for (let i = 0; i < masked.length; ) {
    if (masked[i] === '\u0000') {
      i++;
      continue;
    }
    const m = SELF_WORDS.exec(masked.slice(i));
    if (!m) {
      i++;
      continue;
    }
    if (continuesLawName(text[i - 1], kataOnly)) {
      i++;
      continue;
    }
    const word = m[1]!;
    const attached = attachProvision(text, i + word.length, sent);
    const end = attached ? attached.end : i + word.length;
    const tgtStatus: TargetStatus = amending ? 'amendingLaw' : 'self';
    let tgtPid = forceFusokuS1(attached?.tgtPid ?? null, attached?.kind);
    let tgtEnd = attached?.tgtEnd ?? null;
    if (attached?.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
    const flags = pidFlags(attached?.flags ?? 0, tgtPid, tgtStatus);
    out.push({
      start: i,
      end,
      rule: 'L4-self',
      rawName: word,
      tgtLaw: amending ? null : law.meta.lawId,
      tgtStatus,
      tgtPid,
      tgtEnd,
      flags,
      viaJlawOnly: false,
      tgtLawType: amending ? lawTypeFromAmendingName(word) : law.meta.lawType,
      bareKind: attached?.kind,
    });
    i = end;
  }
  return out;
}

function matchNamePrefix(text: string, i: number, kataOnly: boolean): string | null {
  for (const p of NAME_PREFIXES) {
    if (i < p.length) continue;
    if (text.slice(i - p.length, i) !== p) continue;
    if (p === '新' || p === '旧') {
      if (continuesLawName(text[i - p.length - 1], kataOnly)) continue;
    }
    return p;
  }
  return null;
}

function leftBoundaryOk(text: string, i: number, kataOnly: boolean): boolean {
  if (matchNamePrefix(text, i, kataOnly)) return true;
  if (!continuesLawName(text[i - 1], kataOnly)) return true;
  if (i < 2) return false;
  if (LEFT_CHU.has(text.slice(i - 2, i))) return true;
  if (text[i - 1] === '中' && i >= 3 && LEFT_CHU.has(text.slice(i - 3, i - 1) + '中')) return true;
  return false;
}

function rightBoundaryOk(text: string, end: number, kataOnly: boolean): boolean {
  const after = text.slice(end);
  if (L5_RIGHT_PROV.test(after)) return true;
  if (after.startsWith('附則') || after.startsWith('別表')) return true;
  if (consumeLawLevelStart(after)) return true;
  if (continuesLawName(text[end], kataOnly)) return false;
  return true;
}

function consumeLawLevelStart(after: string): boolean {
  return /^(第[〇零一二三四五六七八九十百千元\d]+(?:編|章|節|款|目)|第[〇零一二三四五六七八九十百千元\d]+号様式|別記様式|様式第)/.test(
    after,
  );
}

function l5ContinuationOk(source: NameSource, after: string): boolean {
  if (source === 'title' || source === 'oldTitle') return true;
  if (source === 'egovAbbrev') return L5_EGOV_CONT.test(after);
  return CITE_CONT_ARTICLE.test(after);
}

function findL5(
  text: string,
  masked: string,
  sent: SentenceRec,
  dict: LawDict,
  law: SlimLaw,
  kataOnly: boolean,
  extras: ExtractExtras,
  active: AbbrevDef[],
  bodyAbbrs: Set<string>,
): Span[] {
  const out: Span[] = [];
  const activeAbbrs = new Set(active.map((d) => d.abbr));
  for (let i = 0; i < masked.length; ) {
    if (masked[i] === '\u0000') {
      i++;
      continue;
    }
    const hit = dict.longestName(masked, i);
    if (!hit) {
      i++;
      continue;
    }
    if (!leftBoundaryOk(text, i, kataOnly)) {
      i++;
      continue;
    }
    const name = masked.slice(i, hit.end);
    if (hit.hit.source === 'jlaw' && bodyAbbrs.has(name)) {
      extras.dictSkippedDueToBodyDef++;
      i++;
      continue;
    }
    if ((hit.hit.source === 'jlaw' || hit.hit.source === 'egovAbbrev') && activeAbbrs.has(name)) {
      extras.dictSkippedDueToBodyDef++;
      i++;
      continue;
    }
    const prefix = matchNamePrefix(text, i, kataOnly);
    const after = text.slice(hit.end);
    const okinawa = text.slice(i - 3, i) === '沖縄の';
    const ryukyu = RYUKYU_PAREN.exec(after);
    if (okinawa || ryukyu) {
      const start = okinawa ? i - 3 : prefix ? i - prefix.length : i;
      const parenEnd = ryukyu ? hit.end + ryukyu[0].length : hit.end;
      extras.ryukyu++;
      out.push({
        start,
        end: parenEnd,
        rule: 'L5-name',
        rawName: text.slice(i, hit.end),
        tgtLaw: null,
        tgtStatus: 'unknown',
        tgtPid: null,
        tgtEnd: null,
        flags: REF_FLAGS.lawLevelOnly,
        viaJlawOnly: false,
        source: hit.hit.source,
      });
      i = parenEnd;
      continue;
    }
    const amendM = AMENDING_TITLE_RE.exec(after);
    const start = prefix ? i - prefix.length : i;
    if (amendM) {
      const titleEnd = hit.end + amendM[0].length;
      const fullTitle = text.slice(i, titleEnd);
      const exact = dict.longestName(fullTitle, 0);
      const resolved = exact && exact.end === fullTitle.length ? exact.hit : null;
      const meta = resolved ? dict.byId.get(resolved.lawId) : undefined;
      const tgtStatus: TargetStatus = resolved
        ? meta?.status === 'repealed'
          ? 'repealed'
          : resolved.lawId === law.meta.lawId
            ? 'self'
            : 'current'
        : 'amendingLaw';
      const attached = attachProvision(text, titleEnd, sent);
      const end = attached ? attached.end : titleEnd;
      let tgtPid = forceFusokuS1(attached?.tgtPid ?? null, attached?.kind);
      let tgtEnd = attached?.tgtEnd ?? null;
      if (attached?.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
      if (attached?.lawLevelOnly) {
        tgtPid = null;
        tgtEnd = null;
      }
      const flags = pidFlags(attached?.flags ?? 0, tgtPid, tgtStatus);
      if (prefix) extras.prefixHits++;
      out.push({
        start,
        end,
        rule: 'L5-name',
        rawName: fullTitle,
        tgtLaw: resolved?.lawId ?? null,
        tgtStatus,
        tgtPid,
        tgtEnd,
        flags,
        viaJlawOnly: resolved?.source === 'jlaw',
        source: resolved?.source ?? hit.hit.source,
        tgtLawType: meta?.lawType ?? lawTypeFromAmendingName(fullTitle),
        bareKind: attached?.kind,
        skipClip: isOldStylePrefix(prefix),
      });
      i = end;
      continue;
    }
    const defSplit = splitDefParenAfter(text, hit.end, sent);
    if (defSplit) {
      if (!rightBoundaryOk(text, hit.end, kataOnly) && !l5ContinuationOk(hit.hit.source, after)) {
        i++;
        continue;
      }
      const meta0 = dict.byId.get(hit.hit.lawId);
      const tgtLaw0 = hit.hit.lawId;
      const tgtStatus0: TargetStatus =
        tgtLaw0 === law.meta.lawId ? 'self' : meta0?.status === 'repealed' ? 'repealed' : 'current';
      if (prefix) extras.prefixHits++;
      out.push({
        start,
        end: hit.end,
        rule: 'L5-name',
        rawName: text.slice(i, hit.end),
        tgtLaw: tgtLaw0,
        tgtStatus: tgtStatus0,
        tgtPid: null,
        tgtEnd: null,
        flags: pidFlags(0, null, tgtStatus0),
        viaJlawOnly: hit.hit.source === 'jlaw',
        source: hit.hit.source,
        tgtLawType: meta0?.lawType ?? null,
        skipClip: isOldStylePrefix(prefix),
      });
      if (defSplit.prov) {
        let tgtPid = forceFusokuS1(defSplit.prov.tgtPid, defSplit.prov.kind);
        let tgtEnd = defSplit.prov.tgtEnd;
        if (defSplit.prov.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
        out.push({
          start: defSplit.prov.start,
          end: defSplit.prov.end,
          rule: 'L5-name',
          rawName: null,
          tgtLaw: tgtLaw0,
          tgtStatus: tgtStatus0,
          tgtPid,
          tgtEnd,
          flags: pidFlags(REF_FLAGS.enumCarry | defSplit.prov.flags, tgtPid, tgtStatus0),
          viaJlawOnly: hit.hit.source === 'jlaw',
          source: hit.hit.source,
          tgtLawType: meta0?.lawType ?? null,
          bareKind: defSplit.prov.kind,
          fromChain: true,
          skipClip: isOldStylePrefix(prefix),
        });
      }
      i = defSplit.next;
      continue;
    }
    if (!rightBoundaryOk(text, hit.end, kataOnly)) {
      i++;
      continue;
    }
    if (!l5ContinuationOk(hit.hit.source, after)) {
      i++;
      continue;
    }
    const meta = dict.byId.get(hit.hit.lawId);
    const attached = attachProvision(text, hit.end, sent);
    const end = attached ? attached.end : hit.end;
    const tgtLaw = hit.hit.lawId;
    const tgtStatus: TargetStatus =
      tgtLaw === law.meta.lawId ? 'self' : meta?.status === 'repealed' ? 'repealed' : 'current';
    let tgtPid = forceFusokuS1(attached?.tgtPid ?? null, attached?.kind);
    let tgtEnd = attached?.tgtEnd ?? null;
    if (attached?.kind === 'fusoku' && tgtEnd) tgtEnd = forceFusokuS1(tgtEnd, 'fusoku');
    if (attached?.lawLevelOnly) {
      tgtPid = null;
      tgtEnd = null;
    }
    const flags = pidFlags(attached?.flags ?? 0, tgtPid, tgtStatus);
    if (prefix) extras.prefixHits++;
    out.push({
      start,
      end,
      rule: 'L5-name',
      rawName: text.slice(i, hit.end),
      tgtLaw,
      tgtStatus,
      tgtPid,
      tgtEnd,
      flags,
      viaJlawOnly: hit.hit.source === 'jlaw',
      source: hit.hit.source,
      tgtLawType: meta?.lawType ?? null,
      bareKind: attached?.kind,
      skipClip: isOldStylePrefix(prefix),
      isTable: attached ? /の表/.test(text.slice(hit.end, attached.end)) || (tgtPid ? parsePid(tgtPid).root.startsWith('t') : false) : false,
    });
    i = end;
  }
  return out;
}

function fusokuRootOf(sent: SentenceRec): string {
  if (sent.part === 'supplAmend' && sent.supplIndex != null) return `s${sent.supplIndex}`;
  if (sent.part === 'suppl' && sent.supplIndex != null) return `s${sent.supplIndex}`;
  return 's1';
}

function hasArticlePid(law: SlimLaw, pid: string, opts: ExtractOptions): boolean {
  const art = articleOnly(pid);
  const set = opts.targetPids?.get(law.meta.lawId);
  if (set) return set.has(pid) || set.has(art);
  for (const a of law.articles) {
    if (a.pid === pid || a.pid === art || a.pid.startsWith(art + '.')) return true;
  }
  for (const s of law.sentences) {
    if (s.pid === pid || s.pid === art || s.pid.startsWith(art + '.')) return true;
  }
  return false;
}

function findL6(text: string, masked: string, sent: SentenceRec, law: SlimLaw, opts: ExtractOptions): Span[] {
  const out: Span[] = [];
  const fusokuRoot = fusokuRootOf(sent);
  for (let i = 0; i < masked.length; ) {
    if (masked[i] === '\u0000') {
      i++;
      continue;
    }
    if (!startsProvision(masked, i)) {
      i++;
      continue;
    }
    const hit = parseProvision(masked, i, sent.pid, { fusokuRoot });
    if (!hit) {
      i++;
      continue;
    }
    const tableEnd = consumeTablePos(text, hit.end);
    const end = tableEnd ?? hit.end;
    let tgtLaw: string | null = law.meta.lawId;
    let tgtStatus: TargetStatus = 'self';
    let tgtPid = hit.tgtPid;
    let tgtEnd = hit.tgtEnd;
    if (sent.part === 'supplAmend' && hit.kind === 'article') {
      tgtLaw = null;
      tgtStatus = 'amendingLaw';
      const p = parsePid(hit.tgtPid);
      tgtPid = formatPid({ ...p, root: 'm' });
      if (tgtEnd) {
        const e = parsePid(tgtEnd);
        tgtEnd = formatPid({ ...e, root: 'm' });
      }
    } else if (sent.part === 'supplAmend' && hit.kind === 'fusoku') {
      if (!hasArticlePid(law, hit.tgtPid, opts)) {
        tgtLaw = null;
        tgtStatus = 'amendingLaw';
        const p = parsePid(hit.tgtPid);
        tgtPid = formatPid({ ...p, root: 's1' });
        if (tgtEnd) {
          const e = parsePid(tgtEnd);
          tgtEnd = formatPid({ ...e, root: 's1' });
        }
      }
    }
    out.push({
      start: i,
      end,
      rule: 'L6-provision',
      rawName: null,
      tgtLaw,
      tgtStatus,
      tgtPid,
      tgtEnd,
      flags: pidFlags(hit.flags, tgtPid, tgtStatus),
      viaJlawOnly: false,
      tgtLawType: tgtStatus === 'amendingLaw' ? 'Act' : law.meta.lawType,
      bareKind: hit.kind,
      isTable: hit.kind === 'appdx' || tableEnd != null,
    });
    i = end;
  }
  return out;
}

function findL7(
  text: string,
  masked: string,
  sent: SentenceRec,
  law: SlimLaw,
  kataOnly: boolean,
  extras: ExtractExtras,
): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < masked.length; ) {
    if (masked[i] === '\u0000') {
      i++;
      continue;
    }
    const w = parseRelativeWord(masked, i);
    if (!w) {
      i++;
      continue;
    }
    const selfStart = /^(この|本)/.test(w.word);
    if (!selfStart && continuesLawName(text[i - 1], kataOnly)) {
      i++;
      continue;
    }
    const rel = resolveRelative(w.word, sent.pid, law.articles);
    let end = w.end;
    let tgtPid = rel.tgtPid;
    let tgtEnd = rel.tgtEnd;
    let flags = rel.flags;
    if (tgtPid && /^(前条|次条|前項|次項|前号|次号|本条|本項|この条|この項|この号)/.test(w.word)) {
      const att = parseProvision(text, end, tgtPid, { fusokuRoot: 's1' });
      if (att && att.end > end) {
        tgtPid = mergePidWithContinuation(tgtPid, att.tgtPid);
        tgtEnd = att.tgtEnd ?? tgtEnd;
        flags |= att.flags;
        end = att.end;
        extras.mergedDojo++;
      }
    }
    if (rel.countedByNumber) extras.l7CountedByNumber++;
    out.push({
      start: i,
      end,
      rule: 'L7-relative',
      rawName: w.word,
      tgtLaw: law.meta.lawId,
      tgtStatus: 'self',
      tgtPid,
      tgtEnd,
      flags,
      viaJlawOnly: false,
      tgtLawType: law.meta.lawType,
      skipClip: rel.countedByNumber,
      countedByNumber: rel.countedByNumber,
      isTable: /表/.test(w.word),
    });
    i = end;
  }
  return out;
}

function insertEnumIroha(text: string, masked: string, sent: SentenceRec, spans: Span[]): Span[] {
  if (spans.length === 0) return spans;
  const extra: Span[] = [];
  for (const sp of spans) {
    let pos = sp.end;
    while (pos < text.length) {
      const m = CONNECTOR.exec(text.slice(pos));
      if (!m || m[0].length === 0) break;
      pos += m[0].length;
      if (covered(spans, pos) || extra.some((e) => e.start <= pos && pos < e.end)) break;
      if (masked[pos] === '\u0000') break;
      const idx = irohaIndex(text[pos]!);
      if (idx === null) break;
      if (isKatakana(text[pos + 1])) break;
      const tgtPid = irohaPidFromPrev(sp.tgtPid, extra.at(-1)?.tgtPid ?? null, idx);
      extra.push({
        start: pos,
        end: pos + 1,
        rule: 'L6-provision',
        rawName: null,
        tgtLaw: sp.tgtLaw,
        tgtStatus: sp.tgtStatus,
        tgtPid,
        tgtEnd: null,
        flags: REF_FLAGS.enumCarry,
        viaJlawOnly: false,
        tgtLawType: sp.tgtLawType,
        bareKind: 'item',
      });
      pos += 1;
    }
  }
  void sent;
  if (extra.length === 0) return spans;
  return pickSpans([...spans, ...extra]);
}

function irohaPidFromPrev(firstPid: string | null, lastExtraPid: string | null, iroIdx: number): string | null {
  const src = lastExtraPid ?? firstPid;
  if (!src) return null;
  const p = parsePid(src);
  if (p.items.length >= 2) {
    return formatPid({ ...p, items: [...p.items.slice(0, -1), String(iroIdx)] });
  }
  if (p.items.length === 1) {
    return formatPid({ ...p, items: [...p.items, String(iroIdx)] });
  }
  return formatPid({ ...p, items: [String(iroIdx)] });
}

function attachProvision(text: string, i: number, sent: SentenceRec) {
  return attachFollowing(text, i, sent.pid, { fusokuRoot: 's1' });
}

function isMaskedAt(masked: string, i: number): boolean {
  return i >= 0 && i < masked.length && masked[i] === '\u0000';
}

function pickSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const ra = ruleRank(a.rule);
    const rb = ruleRank(b.rule);
    if (ra !== rb) return ra - rb;
    return b.end - a.end;
  });
  const taken: Span[] = [];
  for (const s of sorted) {
    if (s.end <= s.start) continue;
    const hit = taken.find((t) => overlap(t, s));
    if (!hit) {
      taken.push(s);
      continue;
    }
    const ra = ruleRank(s.rule);
    const rb = ruleRank(hit.rule);
    if (s.start < hit.start || (s.start === hit.start && (s.end - s.start > hit.end - hit.start || ra < rb))) {
      taken.splice(taken.indexOf(hit), 1, s);
    }
  }
  taken.sort((a, b) => a.start - b.start);
  return taken;
}

function overlap(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function applyChains(
  text: string,
  spans: Span[],
  extras: ExtractExtras,
  sent: SentenceRec,
  _law: SlimLaw,
  _dict: LawDict,
  _opts: ExtractOptions,
  _tableCtx: TableCtx | null,
): void {
  if (spans.length === 0) return;
  const depths = parenDepths(text);
  let i = 0;
  while (i < spans.length) {
    let j = i + 1;
    while (j < spans.length) {
      if (!isConnectorRange(text, spans[j - 1]!.end, spans[j]!.start)) break;
      j++;
    }
    const pre = i > 0 && isConnectorRange(text, spans[i - 1]!.end, spans[i]!.start) ? spans[i - 1]! : null;
    type Carry = { law: string | null; status: TargetStatus; art?: string; root: string; para?: string; pid: string | null };
    const fromSpan = (sp: Span): Carry => {
      const p = parsePid(sp.tgtPid ?? 'm');
      return { law: sp.tgtLaw, status: sp.tgtStatus, art: p.article, root: p.root || 'm', para: p.para, pid: sp.tgtPid };
    };
    let outer: Carry = fromSpan(pre ?? spans[i]!);
    let outerBeforeJunyo: Carry | null = null;
    let junyoActive = false;
    for (let k = i; k < j; k++) {
      const sp = spans[k]!;
      const d = depths[sp.start] ?? 0;
      const p = parsePid(sp.tgtPid ?? '');
      const bare = (sp.rule === 'L6-provision' || sp.rule.startsWith('L6')) && !sp.rawName;
      const before = text.slice(Math.max(0, sp.start - 16), sp.start);
      if (/において準用する$/.test(before) && (sp.tgtLaw || sp.rawName)) {
        junyoActive = true;
        outerBeforeJunyo = { ...outer };
      }
      let inheritFrom: Carry | null = null;
      if (d > 0) {
        const open = enclosingOpen(text, sp.start);
        const inner = text.slice(open + 1, matchingClose(text, open));
        if (isAbbrevScopeParenInner(inner)) {
          inheritFrom = null;
        } else if (isTsuginiKakageruParen(text, open) && sp.bareKind === 'item') {
          inheritFrom = null;
        } else {
          const preParen = lastShallower(spans, k, depths, d);
          inheritFrom = preParen ? fromSpan(preParen) : outer;
        }
      } else {
        const inherited = k > i || pre != null;
        inheritFrom = inherited ? outer : null;
        if (junyoActive && inheritFrom && outerBeforeJunyo && isWeakConnector(text, spans[k - 1]?.end ?? sp.start, sp.start)) {
          inheritFrom = outerBeforeJunyo;
          outer = { ...outerBeforeJunyo };
          junyoActive = false;
        }
      }
      if (bare && inheritFrom && (inheritFrom.law || inheritFrom.status === 'amendingLaw')) {
        const hasLawClue = !!sp.rawName;
        if (!hasLawClue) {
          sp.tgtLaw = inheritFrom.law;
          sp.tgtStatus = inheritFrom.status;
          sp.flags |= REF_FLAGS.enumCarry;
          sp.fromChain = true;
          if (d > 0) extras.parenCarry++;
          if (sp.bareKind === 'fusoku') {
            const fp = parsePid(sp.tgtPid ?? '');
            sp.tgtPid = formatPid({ ...fp, root: 's1' });
            if (sp.tgtEnd) {
              const e = parsePid(sp.tgtEnd);
              sp.tgtEnd = formatPid({ ...e, root: 's1' });
            }
          } else if (sp.bareKind === 'item') {
            sp.tgtPid = formatPid({
              root: inheritFrom.root,
              article: inheritFrom.art ?? p.article,
              para: inheritFrom.para,
              items: p.items,
            });
          } else if (sp.bareKind === 'para') {
            sp.tgtPid = formatPid({
              root: inheritFrom.root,
              article: inheritFrom.art ?? p.article,
              para: p.para,
              items: [],
            });
          } else if (sp.bareKind === 'appdx') {
            // keep t<k> pid; only the law is inherited
          } else if (!p.article && inheritFrom.art) {
            sp.tgtPid = formatPid({
              ...p,
              root: inheritFrom.root,
              article: inheritFrom.art,
              para: p.para ?? inheritFrom.para,
            });
          } else if (p.article && inheritFrom.root) {
            sp.tgtPid = formatPid({ ...p, root: inheritFrom.root });
          }
        }
      }
      if (d === 0) {
        if (sp.tgtLaw || sp.tgtStatus === 'amendingLaw') {
          if (junyoActive && /の規定[、，]/.test(text.slice(sp.end, sp.end + 6)) && outerBeforeJunyo) {
            // keep outer as pre-junyo after this span's の規定、
          } else {
            outer.law = sp.tgtLaw;
            outer.status = sp.tgtStatus;
          }
        }
        const p2 = parsePid(sp.tgtPid ?? '');
        if (p2.article) {
          if (!(junyoActive && /の規定[、，]/.test(text.slice(sp.end, sp.end + 6)) && outerBeforeJunyo)) {
            outer.art = p2.article;
            outer.root = p2.root;
            outer.para = p2.para;
            outer.pid = sp.tgtPid;
          }
        } else if (p2.root && (p2.root.startsWith('t') || p2.root.startsWith('s'))) {
          outer.root = p2.root;
        }
        if (junyoActive && /の規定[、，]/.test(text.slice(sp.end, sp.end + 8)) && outerBeforeJunyo) {
          outer = { ...outerBeforeJunyo };
          junyoActive = false;
        }
      }
    }
    i = Math.max(j, i + 1);
  }
  void sent;
}

function enclosingOpen(text: string, i: number): number {
  let depth = 0;
  for (let k = i; k >= 0; k--) {
    const ch = text[k]!;
    if (ch === '）' || ch === ')') depth++;
    else if (ch === '（' || ch === '(') {
      if (depth === 0) return k;
      depth--;
    }
  }
  return -1;
}

function lastShallower(spans: Span[], k: number, depths: Int16Array, d: number): Span | null {
  for (let i = k - 1; i >= 0; i--) {
    if ((depths[spans[i]!.start] ?? 0) < d) return spans[i]!;
  }
  return null;
}

const SKIP_AFTER = /^(本文|ただし書|但し書|前段|後段|各号|の規定|ノ規定)/;

function isConnectorRange(text: string, from: number, to: number): boolean {
  if (to < from) return false;
  const depths = parenDepths(text);
  let i = from;
  while (i < to) {
    const depth = depths[i] ?? 0;
    if (depth > 0) {
      i++;
      continue;
    }
    if (/[、，・　\s]/.test(text[i]!)) {
      i++;
      continue;
    }
    if (text.startsWith('及び', i)) {
      i += 2;
      continue;
    }
    if (text.startsWith('又は', i)) {
      i += 2;
      continue;
    }
    if (text.startsWith('並びに', i)) {
      i += 3;
      continue;
    }
    if (text.startsWith('若しくは', i)) {
      i += 4;
      continue;
    }
    if (text.startsWith('から', i) || text.startsWith('まで', i)) {
      i += 2;
      continue;
    }
    const skip = SKIP_AFTER.exec(text.slice(i));
    if (skip) {
      i += skip[0].length;
      continue;
    }
    return false;
  }
  return true;
}

function clipPids(spans: Span[], dict: LawDict, opts: ExtractOptions): void {
  const index = opts.targetPids;
  if (!index) return;
  for (const sp of spans) {
    if (sp.tgtStatus === 'amendingLaw') continue;
    if (sp.skipClip || sp.countedByNumber) continue;
    if (!sp.tgtLaw || !sp.tgtPid) continue;
    const set = index.get(sp.tgtLaw);
    if (!set) continue;
    if (set.has(sp.tgtPid)) continue;
    const art = articleOnly(sp.tgtPid);
    if (set.has(art)) {
      sp.tgtPid = art;
      sp.tgtEnd = sp.tgtEnd ? articleOnly(sp.tgtEnd) : null;
      continue;
    }
    sp.tgtPid = null;
    sp.tgtEnd = null;
    sp.flags |= REF_FLAGS.lawLevelOnly;
  }
  void dict;
}

function isTsuginiKakageruParen(text: string, open: number): boolean {
  if (open < 0) return false;
  return /次に掲げる[^（）]{0,40}$/.test(text.slice(0, open));
}

function isWeakConnector(text: string, from: number, to: number): boolean {
  if (to <= from) return false;
  const mid = text.slice(from, to);
  if (/の規定[、，]|の規定並びに|の規定及び|本文並びに|）[、，]/.test(mid)) return true;
  return false;
}

function detectYomikaeLaw(
  prev: { text: string; spans: Span[] },
  dict: LawDict,
  law: SlimLaw,
): Antecedent | null {
  const t = prev.text;
  if (!/次の表/.test(t)) return null;
  if (!/上欄に掲げる/.test(t) && !/規定中/.test(t) && !/の適用については/.test(t)) return null;
  for (let k = prev.spans.length - 1; k >= 0; k--) {
    const s = prev.spans[k]!;
    if (s.tgtLaw || s.tgtStatus === 'amendingLaw') {
      return {
        law: s.tgtLaw,
        pid: s.tgtPid,
        endPid: s.tgtEnd,
        status: s.tgtStatus,
        lawType: s.tgtLawType ?? (s.tgtLaw ? dict.byId.get(s.tgtLaw)?.lawType ?? null : null),
      };
    }
  }
  void law;
  return null;
}

function detectRowLawCell(text: string, spans: Span[]): Antecedent | null {
  const lawSpans = spans.filter((s) => (s.tgtLaw || s.tgtStatus === 'amendingLaw') && !s.scopeParen);
  if (lawSpans.length !== 1) return null;
  const sp = lawSpans[0]!;
  const rest = (text.slice(0, sp.start) + text.slice(sp.end)).replace(/の規定/g, '').replace(/[、。．\s　]/g, '');
  if (rest.length > 0) return null;
  return {
    law: sp.tgtLaw,
    pid: sp.tgtPid,
    endPid: sp.tgtEnd,
    status: sp.tgtStatus,
    lawType: sp.tgtLawType ?? null,
  };
}

function detectYomikaeHeader(text: string, spans: Span[], dict: LawDict, law: SlimLaw): Antecedent | null {
  if (!/読み替える規定/.test(text) && !/の規定中/.test(text) && !/^.{1,40}の規定$/.test(text.trim())) return null;
  const lawSpans = spans.filter((s) => (s.tgtLaw || s.tgtStatus === 'amendingLaw') && !s.scopeParen);
  if (lawSpans.length > 0) {
    const sp = lawSpans[0]!;
    return {
      law: sp.tgtLaw,
      pid: sp.tgtPid,
      endPid: sp.tgtEnd,
      status: sp.tgtStatus,
      lawType: sp.tgtLawType ?? (sp.tgtLaw ? dict.byId.get(sp.tgtLaw)?.lawType ?? null : null),
    };
  }
  return detectRowLawCell(text, spans) ?? detectYomikaeLaw({ text, spans }, dict, law);
}

function applyTableContext(
  text: string,
  spans: Span[],
  sent: SentenceRec,
  law: SlimLaw,
  tableCtx: TableCtx | null,
  extras: ExtractExtras,
): void {
  if (!sent.inTable || !tableCtx) return;
  const ctx = tableCtx.rowLaw ?? tableCtx.yomikaeLaw;
  if (!ctx || (!ctx.law && ctx.status !== 'amendingLaw')) return;
  const kind: 'rowLaw' | 'yomikae' = tableCtx.rowLaw ? 'rowLaw' : 'yomikae';
  for (const sp of spans) {
    if (sp.rule !== 'L6-provision') continue;
    if (sp.rawName) continue;
    const stillSelf = sp.tgtStatus === 'self' || sp.tgtLaw === law.meta.lawId;
    if (!stillSelf) continue;
    sp.tgtLaw = ctx.law;
    sp.tgtStatus = ctx.status;
    sp.rule = 'L6-provision-table';
    sp.flags |= REF_FLAGS.enumCarry;
    extras.tableContext[kind]++;
  }
  void text;
}

function applyJunyoCut(text: string, spans: Span[], tableCtx: TableCtx | null): void {
  for (let k = 1; k < spans.length; k++) {
    const sp = spans[k]!;
    if (!(sp.rule === 'L6-provision' || sp.rule === 'L6-provision-table') || sp.rawName) continue;
    const prev = spans[k - 1]!;
    const mid = text.slice(prev.end, sp.start);
    if (!/の規定[、，]/.test(mid)) continue;
    const beforePrev = text.slice(Math.max(0, prev.start - 16), prev.start);
    if (!/において準用する$/.test(beforePrev)) continue;
    const src = k >= 2 ? spans[k - 2]! : null;
    const carryLaw = src?.tgtLaw ?? tableCtx?.rowLaw?.law ?? tableCtx?.yomikaeLaw?.law ?? null;
    const carryStatus = src?.tgtStatus ?? tableCtx?.rowLaw?.status ?? tableCtx?.yomikaeLaw?.status ?? sp.tgtStatus;
    if (!carryLaw && carryStatus !== 'amendingLaw' && carryStatus !== 'self') continue;
    sp.tgtLaw = carryLaw ?? sp.tgtLaw;
    sp.tgtStatus = carryStatus;
    if (tableCtx?.rowLaw || tableCtx?.yomikaeLaw) sp.rule = 'L6-provision-table';
    sp.flags |= REF_FLAGS.enumCarry;
    const p = parsePid(sp.tgtPid ?? '');
    const spid = src?.tgtPid ? parsePid(src.tgtPid) : null;
    if (p.article) {
      sp.tgtPid = formatPid({ ...p, root: spid?.root && spid.root !== 'e' ? spid.root : p.root || 'm' });
    }
  }
}

function articleExists(
  lawId: string | null,
  pid: string | null,
  status: TargetStatus,
  self: SlimLaw,
  opts: ExtractOptions,
): boolean {
  if (!pid) return false;
  if (status === 'amendingLaw') return true;
  if (!lawId) return false;
  const art = articleOnly(pid);
  if (lawId === self.meta.lawId) return hasArticlePid(self, pid, opts);
  const set = opts.targetPids?.get(lawId);
  if (!set) return true;
  if (set.has(pid) || set.has(art)) return true;
  for (const p of set) {
    if (p === art || p.startsWith(`${art}.`)) return true;
  }
  return false;
}

function applyExistCheck(
  text: string,
  spans: Span[],
  sent: SentenceRec,
  law: SlimLaw,
  dict: LawDict,
  opts: ExtractOptions,
  tableCtx: TableCtx | null,
  extras: ExtractExtras,
): void {
  for (let k = 1; k < spans.length; k++) {
    const prev = spans[k - 1]!;
    const sp = spans[k]!;
    if (!(sp.rule === 'L6-provision' || sp.rule === 'L6-provision-table') || !sp.fromChain) continue;
    if (!isWeakConnector(text, prev.end, sp.start)) continue;
    if (articleExists(sp.tgtLaw, sp.tgtPid, sp.tgtStatus, law, opts)) continue;
    const candidates: Antecedent[] = [];
    if (tableCtx?.rowLaw) candidates.push(tableCtx.rowLaw);
    if (tableCtx?.yomikaeLaw) candidates.push(tableCtx.yomikaeLaw);
    const open = enclosingOpen(text, sp.start);
    if (open >= 0) {
      const pre = lastShallower(spans, k, parenDepths(text), parenDepths(text)[sp.start] ?? 0);
      if (pre) {
        candidates.push({
          law: pre.tgtLaw,
          pid: pre.tgtPid,
          endPid: pre.tgtEnd,
          status: pre.tgtStatus,
          lawType: pre.tgtLawType ?? null,
        });
      }
    }
    candidates.push({
      law: law.meta.lawId,
      pid: sent.pid,
      endPid: null,
      status: 'self',
      lawType: law.meta.lawType,
    });
    let chosen: Antecedent | null = null;
    for (const c of candidates) {
      const trialPid = retargetPid(sp.tgtPid, c);
      if (articleExists(c.law, trialPid, c.status, law, opts)) {
        chosen = c;
        break;
      }
    }
    if (!chosen) continue;
    const trialPid = retargetPid(sp.tgtPid, chosen);
    sp.tgtLaw = chosen.law;
    sp.tgtStatus = chosen.status;
    sp.tgtPid = trialPid;
    sp.rule = 'L6-provision-exist';
    extras.existRetarget++;
  }
  void dict;
}

function retargetPid(pid: string | null, ant: Antecedent): string | null {
  if (!pid) return ant.pid;
  const p = parsePid(pid);
  const a = ant.pid ? parsePid(ant.pid) : null;
  return formatPid({
    root: a?.root && a.root !== 'e' ? a.root : p.root || 'm',
    article: p.article,
    para: p.para,
    items: p.items,
  });
}

function resolveAbbrevTarget(
  text: string,
  end: number,
  _depths: Int16Array,
  dict: LawDict,
  law: SlimLaw,
): AbbrevTarget | null {
  const before = text.slice(0, end);
  const re = new RegExp(ERA_NUM.source, 'g');
  let lastNum: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before))) lastNum = m;
  if (lastNum) {
    const numEnd = lastNum.index + lastNum[0].length;
    const between = before.slice(numEnd);
    if (/^[。．\s　]*$/.test(between)) {
      const numNorm = normalizeLawNum(lastNum[1]!);
      const meta = lookupNum(dict, numNorm);
      if (meta) {
        return {
          lawId: meta.lawId,
          pid: null,
          status: meta.status === 'repealed' ? 'repealed' : meta.lawId === law.meta.lawId ? 'self' : 'current',
        };
      }
      const nameStart = nameStartOf(text, lastNum.index, undefined, []);
      const name = text.slice(nameStart, lastNum.index);
      const hit = dict.longestName(name, 0);
      if (hit && hit.end === name.length) {
        return { lawId: hit.hit.lawId, pid: null, status: hit.hit.lawId === law.meta.lawId ? 'self' : 'current' };
      }
      if (AMENDING_NAME.test(name)) return { lawId: null, pid: null, status: 'amendingLaw' };
      return { lawId: null, pid: null, status: 'unknown' };
    }
  }
  for (let i = Math.max(0, before.length - 80); i < before.length; i++) {
    const hit = dict.longestName(before, i);
    if (hit && hit.end === before.length) {
      return { lawId: hit.hit.lawId, pid: null, status: hit.hit.lawId === law.meta.lawId ? 'self' : 'current' };
    }
  }
  if (law.meta.title && before.endsWith(law.meta.title)) {
    return { lawId: law.meta.lawId, pid: null, status: 'self' };
  }
  return null;
}

const GENERIC_ABBREV_STEM =
  /^(?:法令|法律|政令|勅令|省令|府令|規則|規程|細則|命令|関係法律|各法律|関係政令|関係省令|法|令)$/;

function isGenericAbbrevStem(stem: string): boolean {
  return stem.length < 2 || GENERIC_ABBREV_STEM.test(stem);
}
