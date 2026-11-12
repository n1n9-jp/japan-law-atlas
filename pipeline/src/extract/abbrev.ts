import type { TargetStatus } from '../../lib/ref-types.js';
import { parseKansuji } from './kansuji.js';
import { hasLawTypeSuffix } from './names.js';
import { articleKey, parsePid } from './pid.js';
import type { AbbrevShape, LawDict, SentenceRec, SlimLaw } from './types.js';

export type AbbrevScope =
  | { kind: 'part'; parts: Set<string>; fromIndex: number }
  | { kind: 'article'; article: string; fromIndex: number }
  | { kind: 'paragraph'; pid: string; fromIndex: number }
  | { kind: 'item'; pid: string; fromIndex: number }
  | { kind: 'toc'; tocIndex: number; fromIndex: number };

export interface AbbrevDef {
  abbr: string;
  targetLaw: string | null;
  targetPid: string | null;
  tgtStatus: TargetStatus;
  self: boolean;
  scope: AbbrevScope;
  pid: string;
  sent: number;
  start: number;
  shape: AbbrevShape;
}

export type AbbrevTarget = { lawId: string | null; pid: string | null; status: TargetStatus };

export interface AbbrevFindResult {
  defs: AbbrevDef[];
  dropped: number;
  byShape: Record<AbbrevShape, number>;
  unrecorded: Record<string, number>;
}

const ABBREV_RE =
  /以下(?:(?:この)?(?:条|項|号|章|節|款|目)において|本(?:条|項)において|[^「。]{0,20}において)?(?:単に)?「([^」]{1,40})」という/g;

const SCOPED_RE =
  /(?:同|次|前|第[〇零一二三四五六七八九十百千元\d]+)(?:条|項|号)(?:(?:及び|並びに|、)(?:同|次|前|第[〇零一二三四五六七八九十百千元\d]+)?(?:条|項|号))*において(?:単に)?「([^」]{1,40})」という/g;

const DEF_SENT_RE = /「([^」]{1,40})」とは、([^。]{1,120}?)(?:をいう|のいう|をいい)/g;

const ERA_INNER =
  /((?:明治|大正|昭和|平成|令和)[〇零一二三四五六七八九十百千元\d]+年[^（）]*第[〇零一二三四五六七八九十百千元\d]+号)/;

const AMENDING_NAME =
  /一部を改正する|改正する(?:法律|政令|省令|規則)|整備(?:等)?に関する(?:法律|政令|省令)|廃止する(?:法律|政令)/;

export function findAbbrevDefs(
  text: string,
  sent: SentenceRec,
  sentIndex: number,
  law: SlimLaw,
  dict: LawDict,
  resolveName: (text: string, end: number) => AbbrevTarget | null,
): AbbrevFindResult {
  const out: AbbrevDef[] = [];
  const seen = new Set<string>();
  const unrecorded: Record<string, number> = {};
  const bump = (k: string) => {
    unrecorded[k] = (unrecorded[k] ?? 0) + 1;
  };
  let dropped = 0;

  const tryAdd = (
    abbr: string,
    matchIndex: number,
    head: string,
    shapeHint: AbbrevShape | null,
    targetEnd: number,
  ): boolean => {
    const key = `${matchIndex}:${abbr}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (!hasLawTypeSuffix(abbr)) {
      dropped++;
      bump('noLawSuffix');
      return false;
    }
    const open = abbrevOpenParen(text, targetEnd);
    const beforeEnd = open >= 0 ? open : targetEnd;
    const inner = open >= 0 ? text.slice(open + 1, matchingCloseSimple(text, open)) : '';
    const hasNum = open >= 0 && ERA_INNER.test(inner);
    let shape: AbbrevShape = shapeHint ?? 'paren';
    if (hasNum) shape = 'numParen';
    else if (shapeHint === 'scopedParen' || isScopedHead(head)) shape = 'scopedParen';
    else if (shapeHint === 'defSentence') shape = 'defSentence';
    else shape = 'paren';

    let target =
      resolveAmendTarget(text, beforeEnd, law, dict) ??
      resolveName(text, hasNum ? targetEnd : beforeEnd) ??
      resolveName(text, beforeEnd);
    if (!target && hasNum) {
      const nameStart = Math.max(0, beforeEnd - 80);
      const name = text.slice(nameStart, beforeEnd);
      target = AMENDING_NAME.test(name)
        ? { lawId: null, pid: null, status: 'amendingLaw' }
        : { lawId: null, pid: null, status: 'unknown' };
    }
    if (!target) {
      bump('noTarget');
      return false;
    }
    const lawLevel = target.pid === null || (!parsePid(target.pid).article && !parsePid(target.pid).para);
    if (!lawLevel && target.pid) {
      bump('provisionTarget');
      return false;
    }
    const scope = scopeFromMatch(head, sent, sentIndex, law);
    out.push({
      abbr,
      targetLaw: target.lawId,
      targetPid: target.pid,
      tgtStatus: target.status,
      self: target.lawId === law.meta.lawId,
      scope,
      pid: sent.pid,
      sent: sent.sent,
      start: matchIndex,
      shape,
    });
    return true;
  };

  ABBREV_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ABBREV_RE.exec(text))) {
    tryAdd(m[1]!, m.index, m[0], null, m.index);
  }

  SCOPED_RE.lastIndex = 0;
  while ((m = SCOPED_RE.exec(text))) {
    if (/以下/.test(m[0])) continue;
    tryAdd(m[1]!, m.index, m[0], 'scopedParen', m.index);
  }

  DEF_SENT_RE.lastIndex = 0;
  while ((m = DEF_SENT_RE.exec(text))) {
    const abbr = m[1]!;
    const y = m[2]!;
    const yAbsEnd = m.index + m[0].length - (m[0].endsWith('をいい') ? 3 : 3);
    void yAbsEnd;
    const yEndInMatch = m[0].lastIndexOf(y) + y.length;
    const yEnd = m.index + yEndInMatch;
    const key = `${m.index}:${abbr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!hasLawTypeSuffix(abbr)) {
      dropped++;
      bump('noLawSuffix');
      continue;
    }
    let target = resolveAmendTarget(text, yEnd, law, dict) ?? resolveName(text, yEnd);
    if (!target) {
      const yOpen = y.lastIndexOf('（');
      if (yOpen >= 0) {
        const beforeParen = text.slice(0, m.index + m[0].lastIndexOf(y) + yOpen);
        target = resolveName(beforeParen, beforeParen.length) ?? resolveAmendTarget(text, beforeParen.length, law, dict);
      }
    }
    if (!target) {
      bump('noTarget');
      continue;
    }
    if (target.pid && parsePid(target.pid).article) {
      bump('provisionTarget');
      continue;
    }
    out.push({
      abbr,
      targetLaw: target.lawId,
      targetPid: target.pid,
      tgtStatus: target.status,
      self: target.lawId === law.meta.lawId,
      scope: partScope(sent, sentIndex),
      pid: sent.pid,
      sent: sent.sent,
      start: m.index,
      shape: 'defSentence',
    });
  }

  const byShape: Record<AbbrevShape, number> = { paren: 0, scopedParen: 0, defSentence: 0, numParen: 0 };
  for (const d of out) byShape[d.shape]++;
  return { defs: out, dropped, byShape, unrecorded };
}

function isScopedHead(head: string): boolean {
  return /(?:同|次|前|第[〇零一二三四五六七八九十百千元\d]+)(?:条|項|号).*において/.test(head) && !/以下/.test(head);
}

function matchingCloseSimple(text: string, open: number): number {
  let d = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '（' || ch === '(') d++;
    else if (ch === '）' || ch === ')') {
      d--;
      if (d === 0) return i;
    }
  }
  return text.length;
}

function abbrevOpenParen(text: string, matchIndex: number): number {
  for (let i = matchIndex - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (ch === '）' || ch === ')') return -1;
    if (ch === '（' || ch === '(') return i;
    if (ch === '。') return -1;
  }
  return -1;
}

function resolveAmendTarget(
  text: string,
  end: number,
  law: SlimLaw,
  dict: LawDict,
): AbbrevTarget | null {
  const before = text.slice(0, end);
  let xLaw: string | null = null;
  let xStart = -1;
  for (let i = Math.max(0, end - 80); i < end; i++) {
    const hit = dict.longestName(before, i);
    if (hit && hit.end === end) {
      xLaw = hit.hit.lawId;
      xStart = i;
      break;
    }
  }
  if (!xLaw && law.meta.title && before.endsWith(law.meta.title)) {
    xLaw = law.meta.lawId;
    xStart = end - law.meta.title.length;
  }
  if (!xLaw || xStart < 0) return null;
  const pre = before.slice(0, xStart);
  if (!/(?:の規定による|による)?(?:改正(?:前|後)|廃止前)の?$/.test(pre) && !/(?:新|旧)$/.test(pre)) return null;
  if (!/(?:改正(?:前|後)|廃止前)/.test(pre) && !/(?:新|旧)$/.test(pre)) return null;
  return { lawId: xLaw, pid: null, status: xLaw === law.meta.lawId ? 'self' : 'current' };
}

function partScope(sent: SentenceRec, sentIndex: number): AbbrevScope {
  const parts = new Set<string>();
  if (sent.part === 'enact') {
    parts.add('enact');
    parts.add('main');
    parts.add('suppl');
    parts.add('supplAmend');
    parts.add('appdx');
  } else if (sent.part === 'main') {
    parts.add('main');
    parts.add('suppl');
    parts.add('supplAmend');
    parts.add('appdx');
  } else if (sent.part === 'appdx') {
    parts.add('appdx');
  } else {
    parts.add(sent.part);
  }
  return { kind: 'part', parts, fromIndex: sentIndex };
}

function scopeFromMatch(head: string, sent: SentenceRec, sentIndex: number, law: SlimLaw): AbbrevScope {
  if (/この条において|本条において|同条において/.test(head)) {
    return { kind: 'article', article: articleKey(sent.pid), fromIndex: sentIndex };
  }
  if (/次条において/.test(head)) {
    return { kind: 'article', article: articleKey(sent.pid), fromIndex: sentIndex };
  }
  if (/この項において|本項において/.test(head)) {
    return { kind: 'paragraph', pid: paragraphKey(sent.pid), fromIndex: sentIndex };
  }
  const daiKou = /第([〇零一二三四五六七八九十百千元\d]+)項において/.exec(head);
  if (daiKou) {
    const n = parseKansuji(daiKou[1]!);
    if (n != null) {
      const art = articleKey(sent.pid);
      return { kind: 'paragraph', pid: `${art}.p${n}`, fromIndex: sentIndex };
    }
  }
  if (/同項において/.test(head)) {
    return { kind: 'article', article: articleKey(sent.pid), fromIndex: sentIndex };
  }
  if (/この号において|同号において/.test(head)) {
    return { kind: 'item', pid: sent.pid, fromIndex: sentIndex };
  }
  const daiGou = /第([〇零一二三四五六七八九十百千元\d]+)号において/.exec(head);
  if (daiGou) {
    return { kind: 'item', pid: sent.pid, fromIndex: sentIndex };
  }
  const tocKind = /この(章|節|款|目)において/.exec(head)?.[1];
  if (tocKind) {
    const kindMap = { 章: 'Chapter', 節: 'Section', 款: 'Subsection', 目: 'Division' } as const;
    const want = kindMap[tocKind as keyof typeof kindMap];
    const art = law.articles.find((a) => a.pid === articleKey(sent.pid) || a.pid === sent.pid);
    if (art) {
      for (let i = art.toc.length - 1; i >= 0; i--) {
        const te = law.toc[art.toc[i]!];
        if (te && te.kind === want) {
          return { kind: 'toc', tocIndex: art.toc[i]!, fromIndex: sentIndex };
        }
      }
    }
    return { kind: 'article', article: articleKey(sent.pid), fromIndex: sentIndex };
  }
  return partScope(sent, sentIndex);
}

function paragraphKey(pid: string): string {
  const p = parsePid(pid);
  return [p.root, p.article ? `a${p.article}` : null, p.para ? `p${p.para}` : null].filter(Boolean).join('.');
}

export function abbrevInScope(def: AbbrevDef, sent: SentenceRec, sentIndex: number, law: SlimLaw): boolean {
  if (sentIndex < def.scope.fromIndex) return false;
  const sc = def.scope;
  if (sc.kind === 'part') return sc.parts.has(sent.part);
  if (sc.kind === 'article') return articleKey(sent.pid) === sc.article;
  if (sc.kind === 'paragraph') return paragraphKey(sent.pid) === sc.pid;
  if (sc.kind === 'item') {
    return sent.pid === sc.pid || sent.pid.startsWith(`${sc.pid}.`);
  }
  if (sc.kind === 'toc') {
    const art = law.articles.find((a) => a.pid === articleKey(sent.pid) || sent.pid.startsWith(`${a.pid}.`) || a.pid === sent.pid);
    return !!art && art.toc.includes(sc.tocIndex);
  }
  return false;
}

export function scopeLabel(def: AbbrevDef): string {
  const sc = def.scope;
  if (sc.kind === 'part') return [...sc.parts].join('+');
  if (sc.kind === 'article') return `article:${sc.article}`;
  if (sc.kind === 'paragraph') return `paragraph:${sc.pid}`;
  if (sc.kind === 'item') return `item:${sc.pid}`;
  return `toc:${sc.tocIndex}`;
}

export function abbrStem(abbr: string): string {
  return abbr.replace(/^(?:新|旧|改正前の|改正後の|廃止前の)/, '');
}
