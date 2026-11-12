import { REF_FLAGS } from '../../lib/ref-types.js';
import { parseKansuji, parseKansujiPrefix } from './kansuji.js';
import { formatPid, isKatakana, parsePid, type PidParts } from './pid.js';
import { matchingClose } from './preprocess.js';
import type { ProvisionKind } from './types.js';

export const IROHA = 'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセスン';

export function irohaIndex(ch: string): number | null {
  const i = IROHA.indexOf(ch);
  return i >= 0 ? i + 1 : null;
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && /[\s　]/.test(s[i]!)) i++;
  return i;
}

function isNo(s: string, i: number): boolean {
  return s[i] === 'の' || s[i] === 'ノ';
}

function consumeDaiNum(s: string, i: number): { value: number; end: number } | null {
  if (s[i] !== '第') return null;
  const n = parseKansujiPrefix(s, i + 1);
  if (!n) return null;
  return { value: n.value, end: n.end };
}

function consumeOfNums(s: string, i: number): { parts: number[]; end: number } {
  const parts: number[] = [];
  let p = i;
  while (isNo(s, p)) {
    const n = parseKansujiPrefix(s, p + 1);
    if (!n) break;
    parts.push(n.value);
    p = n.end;
  }
  return { parts, end: p };
}

function joinNum(head: number, ofParts: number[]): string {
  return [head, ...ofParts].join('_');
}

export interface ProvHit {
  end: number;
  tgtPid: string;
  tgtEnd: string | null;
  flags: number;
  kind: ProvisionKind;
}

interface Frag {
  end: number;
  parts: PidParts;
  kind: ProvisionKind;
}

function consumeIrohaItems(s: string, i: number, parts: PidParts): { end: number; parts: PidParts } {
  const idx = irohaIndex(s[i] ?? '');
  if (idx === null) return { end: i, parts };
  return { end: i + 1, parts: { ...parts, items: [...parts.items, String(idx)] } };
}

function consumeBareProvision(s: string, i: number, base: PidParts, fusokuRoot: string): Frag | null {
  let p = skipSpace(s, i);

  if (s.startsWith('附則', p)) {
    const dai = consumeDaiNum(s, p + 2);
    if (!dai) return null;
    if (s[dai.end] !== '条') return null;
    const of = consumeOfNums(s, dai.end + 1);
    const parts: PidParts = { root: fusokuRoot, article: joinNum(dai.value, of.parts), items: [] };
    const next = consumeAfterArticle(s, of.end, parts);
    return { ...next, kind: 'fusoku' };
  }

  if (s.startsWith('別表', p)) {
    const dai = consumeDaiNum(s, p + 2);
    if (dai) {
      let q = dai.end;
      if (isNo(s, q)) q++;
      const k = parseKansujiPrefix(s, q);
      if (k) {
        let r = k.end;
        if (isNo(s, r)) r++;
        if (s[r] === '項') {
          return {
            end: r + 1,
            parts: { root: `t${dai.value}`, items: [String(k.value)] },
            kind: 'appdx',
          };
        }
      }
      return { end: dai.end, parts: { root: `t${dai.value}`, items: [] }, kind: 'appdx' };
    }
    return { end: p + 2, parts: { root: 't1', items: [] }, kind: 'appdx' };
  }

  const dai = consumeDaiNum(s, p);
  if (!dai) {
    const iro = irohaIndex(s[p]!);
    if (iro === null) return null;
    if (isKatakana(s[p + 1])) return null;
    const parts: PidParts = {
      root: base.root,
      article: base.article,
      para: base.para,
      items: [...base.items, String(iro)],
    };
    return { end: p + 1, parts, kind: 'item' };
  }

  const afterNum = dai.end;
  if (s[afterNum] === '条') {
    const of = consumeOfNums(s, afterNum + 1);
    const parts: PidParts = { root: 'm', article: joinNum(dai.value, of.parts), items: [] };
    const next = consumeAfterArticle(s, of.end, parts);
    return { ...next, kind: 'article' };
  }
  if (s[afterNum] === '項') {
    const parts: PidParts = {
      root: base.root === 'e' ? 'm' : base.root,
      article: base.article,
      para: String(dai.value),
      items: [],
    };
    const next = consumeAfterPara(s, afterNum + 1, parts);
    return { ...next, kind: 'para' };
  }
  if (s[afterNum] === '号') {
    const of = consumeOfNums(s, afterNum + 1);
    const items = [joinNum(dai.value, of.parts)];
    const parts: PidParts = {
      root: base.root === 'e' ? 'm' : base.root,
      article: base.article,
      para: base.para,
      items,
    };
    const iro = consumeIrohaItems(s, of.end, parts);
    return { end: iro.end, parts: iro.parts, kind: 'item' };
  }
  return null;
}

function consumeAfterArticle(s: string, i: number, parts: PidParts): { end: number; parts: PidParts } {
  const dai = consumeDaiNum(s, i);
  if (dai && s[dai.end] === '項') {
    const next: PidParts = { ...parts, para: String(dai.value), items: [] };
    return consumeAfterPara(s, dai.end + 1, next);
  }
  return consumeAfterPara(s, i, parts);
}

function consumeAfterPara(s: string, i: number, parts: PidParts): { end: number; parts: PidParts } {
  const dai = consumeDaiNum(s, i);
  if (dai && s[dai.end] === '号') {
    const of = consumeOfNums(s, dai.end + 1);
    const next: PidParts = { ...parts, items: [joinNum(dai.value, of.parts)] };
    return consumeIrohaItems(s, of.end, next);
  }
  if (parts.items.length > 0) return consumeIrohaItems(s, i, parts);
  return { end: i, parts };
}

const RANGE_FROM = /^(から|乃至|ないし)/;

export function parseProvision(
  s: string,
  i: number,
  currentPid: string,
  opts?: { fusokuRoot?: string },
): ProvHit | null {
  const base = parsePid(currentPid);
  const fusokuRoot = opts?.fusokuRoot ?? 's1';
  const first = consumeBareProvision(s, i, base, fusokuRoot);
  if (!first) return null;
  let end = first.end;
  let flags = 0;
  let tgtEnd: string | null = null;

  const rest = s.slice(end);
  const rm = RANGE_FROM.exec(rest);
  if (rm) {
    const second = consumeBareProvision(s, end + rm[0].length, first.parts, fusokuRoot);
    if (second) {
      flags |= REF_FLAGS.range;
      tgtEnd = formatPid(second.parts);
      end = second.end;
      if (s.startsWith('まで', end)) end += 2;
    }
  }

  return { end, tgtPid: formatPid(first.parts), tgtEnd, flags, kind: first.kind };
}

export function startsProvision(s: string, i: number): boolean {
  const ch = s[i];
  return ch === '第' || s.startsWith('附則', i) || s.startsWith('別表', i);
}

export const CITE_CONT =
  /^(第[〇零一二三四五六七八九十百千元\d]+条|附則第|別表|の規定|ノ規定|に規定する|に定める|の一部を|を廃止する|施行令|の施行|の適用|による|により|に基づ|[、，（(]|及び|又は|並びに|若しくは)/;

export const CITE_CONT_ARTICLE = /^第[〇零一二三四五六七八九十百千元\d]+条/;

export const L5_RIGHT_PROV = /^(第[〇零一二三四五六七八九十百千元\d]+条|附則第|別表|及び|又は|並びに|若しくは)/;

export const L5_EGOV_CONT =
  /^(第[〇零一二三四五六七八九十百千元\d]+条|附則第|別表|の規定|に規定する|に定める|による|により|に基づ|の施行|の適用|の一部を|を廃止する|（|[、，]|及び|又は|並びに|若しくは)/;

export const RYUKYU_PAREN =
  /^（千九百[〇零一二三四五六七八九十百千元\d]+年(?:立法|布令)第[〇零一二三四五六七八九十百千元\d]+号）/;

export const AMENDING_TITLE_RE =
  /^(等)?(の一部を改正する|を廃止する|の施行に伴う[^、。（）「」]*?|の施行等に伴う[^、。（）「」]*?)(法律|政令|省令|府令|規則|命令)/;

const REL_RE =
  /^(前各項|前各号|前[〇零一二三四五六七八九十]+(?:条|項|号)|次[〇零一二三四五六七八九十]+(?:条|項|号)|前項の表|次の表|この表|前条|次条|前項|次項|前号|次号|この条|この項|この号|本条|本項|各号|ただし書|但し書|前段|後段)/;

export function parseRelativeWord(s: string, i: number): { word: string; end: number } | null {
  const m = REL_RE.exec(s.slice(i));
  if (!m) return null;
  return { word: m[1]!, end: i + m[1]!.length };
}

export interface RelHit {
  tgtPid: string | null;
  tgtEnd: string | null;
  flags: number;
  countedByNumber: boolean;
}

function articleHead(article: string | undefined): { n: number; branched: boolean } | null {
  if (!article) return null;
  const bits = article.split('_');
  const n = Number(bits[0]);
  if (!Number.isFinite(n)) return null;
  return { n, branched: bits.length > 1 };
}

function numberedArticle(root: string, n: number): string {
  return formatPid({ root, article: String(n), items: [] });
}

function prevIsSequential(prevPid: string | undefined, n: number): boolean {
  if (!prevPid) return false;
  const h = articleHead(parsePid(prevPid).article);
  return !!h && h.n === n - 1;
}

function nextIsSequential(nextPid: string | undefined, n: number): boolean {
  if (!nextPid) return false;
  const h = articleHead(parsePid(nextPid).article);
  return !!h && h.n === n + 1;
}

export function resolveRelative(
  word: string,
  currentPid: string,
  articles: { pid: string }[],
): RelHit {
  const flags = REF_FLAGS.relative;
  const cur = parsePid(currentPid);
  const artPid = articlePidOfSafe(currentPid);
  const idx = articles.findIndex((a) => a.pid === artPid);
  const head = articleHead(cur.article);
  const none = { tgtPid: null, tgtEnd: null, flags, countedByNumber: false };

  const nPrefix = /^前([〇零一二三四五六七八九十]+)(条|項|号)$/.exec(word);
  const nNext = /^次([〇零一二三四五六七八九十]+)(条|項|号)$/.exec(word);

  if (word === '前条') {
    if (head && !head.branched && head.n > 1 && !prevIsSequential(articles[idx - 1]?.pid, head.n)) {
      return { tgtPid: numberedArticle(cur.root, head.n - 1), tgtEnd: null, flags, countedByNumber: true };
    }
    if (idx > 0) return { tgtPid: articles[idx - 1]!.pid, tgtEnd: null, flags, countedByNumber: false };
    return none;
  }
  if (word === '次条') {
    if (head && !head.branched && !nextIsSequential(articles[idx + 1]?.pid, head.n)) {
      return { tgtPid: numberedArticle(cur.root, head.n + 1), tgtEnd: null, flags, countedByNumber: true };
    }
    if (idx >= 0 && idx + 1 < articles.length) {
      return { tgtPid: articles[idx + 1]!.pid, tgtEnd: null, flags, countedByNumber: false };
    }
    return none;
  }
  if (word === '次の表' || word === 'この表') {
    return { tgtPid: currentPid, tgtEnd: null, flags, countedByNumber: false };
  }
  if (word === '前項の表') {
    const p = Number(cur.para ?? '1');
    if (p > 1) {
      return {
        tgtPid: formatPid({ ...cur, para: String(p - 1), items: [] }),
        tgtEnd: null,
        flags,
        countedByNumber: false,
      };
    }
    return none;
  }
  if (word === '本条' || word === 'この条') {
    return { tgtPid: artPid, tgtEnd: null, flags, countedByNumber: false };
  }
  if (word === 'この項' || word === '本項') {
    const pid = formatPid({ root: cur.root, article: cur.article, para: cur.para ?? '1', items: [] });
    return { tgtPid: pid, tgtEnd: null, flags, countedByNumber: false };
  }
  if (word === 'この号') {
    const items = cur.items.length > 0 ? [cur.items[0]!] : [];
    const pid = formatPid({ root: cur.root, article: cur.article, para: cur.para, items });
    return { tgtPid: pid, tgtEnd: null, flags, countedByNumber: false };
  }
  if (word === '前項') {
    const p = Number(cur.para ?? '1');
    if (p > 1) {
      return { tgtPid: formatPid({ ...cur, para: String(p - 1), items: [] }), tgtEnd: null, flags, countedByNumber: false };
    }
    return none;
  }
  if (word === '次項') {
    const p = Number(cur.para ?? '1');
    return { tgtPid: formatPid({ ...cur, para: String(p + 1), items: [] }), tgtEnd: null, flags, countedByNumber: false };
  }
  if (word === '前号') {
    const last = cur.items[0];
    const n = last ? Number(last) : NaN;
    if (n > 1) {
      return { tgtPid: formatPid({ ...cur, items: [String(n - 1)] }), tgtEnd: null, flags, countedByNumber: false };
    }
    return none;
  }
  if (word === '次号') {
    const last = cur.items[0];
    const n = last ? Number(last) : 0;
    return { tgtPid: formatPid({ ...cur, items: [String(n + 1)] }), tgtEnd: null, flags, countedByNumber: false };
  }
  if (word === '前各項') {
    const p = Number(cur.para ?? '1');
    if (p > 1) {
      return {
        tgtPid: formatPid({ root: cur.root, article: cur.article, para: '1', items: [] }),
        tgtEnd: formatPid({ root: cur.root, article: cur.article, para: String(p - 1), items: [] }),
        flags: flags | REF_FLAGS.range,
        countedByNumber: false,
      };
    }
    return { tgtPid: artPid, tgtEnd: null, flags, countedByNumber: false };
  }
  if (word === '前各号') {
    const n = cur.items[0] ? Number(cur.items[0]) : 1;
    if (n > 1) {
      return {
        tgtPid: formatPid({ ...cur, items: ['1'] }),
        tgtEnd: formatPid({ ...cur, items: [String(n - 1)] }),
        flags: flags | REF_FLAGS.range,
        countedByNumber: false,
      };
    }
    return { tgtPid: formatPid({ ...cur, items: [] }), tgtEnd: null, flags, countedByNumber: false };
  }
  if (word === '各号' || word === 'ただし書' || word === '但し書' || word === '前段' || word === '後段') {
    return { tgtPid: currentPid, tgtEnd: null, flags, countedByNumber: false };
  }
  if (nPrefix) {
    const n = parseKansuji(nPrefix[1]!);
    const unit = nPrefix[2]!;
    if (n === null) return none;
    if (unit === '条') {
      if (head && !head.branched && head.n > n && !prevIsSequential(articles[idx - 1]?.pid, head.n)) {
        const from = numberedArticle(cur.root, head.n - n);
        const to = numberedArticle(cur.root, head.n - 1);
        return {
          tgtPid: from,
          tgtEnd: n === 1 ? null : to,
          flags: n === 1 ? flags : flags | REF_FLAGS.range,
          countedByNumber: true,
        };
      }
      if (idx >= n) {
        const from = articles[idx - n]!.pid;
        const to = articles[idx - 1]!.pid;
        return {
          tgtPid: from,
          tgtEnd: n === 1 ? null : to,
          flags: n === 1 ? flags : flags | REF_FLAGS.range,
          countedByNumber: false,
        };
      }
      return none;
    }
    if (unit === '項') {
      const p = Number(cur.para ?? '1');
      if (p > n) {
        return {
          tgtPid: formatPid({ root: cur.root, article: cur.article, para: String(p - n), items: [] }),
          tgtEnd: n === 1 ? null : formatPid({ root: cur.root, article: cur.article, para: String(p - 1), items: [] }),
          flags: n === 1 ? flags : flags | REF_FLAGS.range,
          countedByNumber: false,
        };
      }
      return none;
    }
    if (unit === '号') {
      const curN = cur.items[0] ? Number(cur.items[0]) : 1;
      if (curN > n) {
        return {
          tgtPid: formatPid({ ...cur, items: [String(curN - n)] }),
          tgtEnd: n === 1 ? null : formatPid({ ...cur, items: [String(curN - 1)] }),
          flags: n === 1 ? flags : flags | REF_FLAGS.range,
          countedByNumber: false,
        };
      }
      return none;
    }
  }
  if (nNext) {
    const n = parseKansuji(nNext[1]!);
    const unit = nNext[2]!;
    if (n === null) return none;
    if (unit === '条') {
      if (head && !head.branched && !nextIsSequential(articles[idx + 1]?.pid, head.n)) {
        const from = numberedArticle(cur.root, head.n + 1);
        const to = numberedArticle(cur.root, head.n + n);
        return {
          tgtPid: from,
          tgtEnd: n === 1 ? null : to,
          flags: n === 1 ? flags : flags | REF_FLAGS.range,
          countedByNumber: true,
        };
      }
      if (idx >= 0 && idx + n < articles.length) {
        const from = articles[idx + 1]!.pid;
        const to = articles[idx + n]!.pid;
        return {
          tgtPid: from,
          tgtEnd: n === 1 ? null : to,
          flags: n === 1 ? flags : flags | REF_FLAGS.range,
          countedByNumber: false,
        };
      }
      return none;
    }
  }
  return { tgtPid: currentPid, tgtEnd: null, flags, countedByNumber: false };
}

function articlePidOfSafe(pid: string): string {
  const p = parsePid(pid);
  return formatPid({ root: p.root, article: p.article, items: [] });
}

export function isTransparentParenInner(inner: string): boolean {
  if (/において同じ/.test(inner) && !(/以下/.test(inner) && /という/.test(inner))) return true;
  return false;
}

export function isDefinitionParenInner(inner: string): boolean {
  if (/という/.test(inner) && (/以下/.test(inner) || /において/.test(inner))) return true;
  return false;
}

export function isAbbrevScopeParenInner(inner: string): boolean {
  if (/以下/.test(inner) && /という/.test(inner)) return true;
  if (/において同じ/.test(inner)) return true;
  if (/において[「『]/.test(inner)) return true;
  return false;
}

export function skipTransparentParen(text: string, i: number): number {
  if (text[i] !== '（' && text[i] !== '(') return i;
  const close = matchingClose(text, i);
  if (close < 0) return i;
  const inner = text.slice(i + 1, close);
  if (!isTransparentParenInner(inner)) return i;
  return close + 1;
}

const TOC_UNITS = new Set(['編', '章', '節', '款', '目']);

export function consumeLawLevelTail(s: string, i: number): number | null {
  if (s.startsWith('附則の規定', i)) return i + 5;
  if (s.startsWith('附則', i) && s[i + 2] !== '第') return i + 2;

  let p = i;
  let matched = false;
  while (p < s.length) {
    const dai = consumeDaiNum(s, p);
    if (!dai) break;
    const unit = s[dai.end];
    if (!unit || !TOC_UNITS.has(unit)) break;
    p = dai.end + 1;
    matched = true;
  }
  if (matched) return p;

  const yoshiki = /^第[〇零一二三四五六七八九十百千元\d]+号様式/.exec(s.slice(i));
  if (yoshiki) return i + yoshiki[0].length;
  const bettki = /^別記様式（第[〇零一二三四五六七八九十百千元\d]+号）/.exec(s.slice(i));
  if (bettki) return i + bettki[0].length;
  const yoshikiN = /^様式第[〇零一二三四五六七八九十百千元\d]+/.exec(s.slice(i));
  if (yoshikiN) return i + yoshikiN[0].length;
  return null;
}

export function consumeTablePos(s: string, i: number): number | null {
  if (!s.startsWith('の表', i)) return null;
  let p = i + 2;
  const dai = consumeDaiNum(s, p);
  if (!dai || s[dai.end] !== '号') return null;
  p = dai.end + 1;
  const of = consumeOfNums(s, p);
  p = of.end;
  const idx = irohaIndex(s[p] ?? '');
  if (idx !== null && !isKatakana(s[p + 1])) p += 1;
  return p;
}

export interface Attached {
  end: number;
  tgtPid: string | null;
  tgtEnd: string | null;
  flags: number;
  kind?: ProvisionKind;
  lawLevelOnly: boolean;
}

export function attachFollowing(
  text: string,
  i: number,
  currentPid: string,
  opts?: { fusokuRoot?: string },
): Attached | null {
  let p = skipTransparentParen(text, i);
  const lawLevel = consumeLawLevelTail(text, p);
  if (lawLevel != null) {
    return { end: lawLevel, tgtPid: null, tgtEnd: null, flags: REF_FLAGS.lawLevelOnly, lawLevelOnly: true };
  }
  const hit = parseProvision(text, p, currentPid, opts);
  if (hit) {
    let end = hit.end;
    const table = consumeTablePos(text, end);
    if (table) end = table;
    return {
      end,
      tgtPid: hit.tgtPid,
      tgtEnd: hit.tgtEnd,
      flags: hit.flags,
      kind: hit.kind,
      lawLevelOnly: false,
    };
  }
  if (p !== i) {
    return { end: p, tgtPid: null, tgtEnd: null, flags: 0, lawLevelOnly: false };
  }
  return null;
}

export function mergePidWithContinuation(basePid: string, contPid: string): string {
  const base = parsePid(basePid);
  const cont = parsePid(contPid);
  return formatPid({
    root: base.root || cont.root,
    article: cont.article ?? base.article,
    para: cont.para ?? base.para,
    items: cont.items.length > 0 ? cont.items : base.items,
  });
}
