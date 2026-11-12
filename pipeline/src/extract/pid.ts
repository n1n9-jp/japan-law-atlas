export interface PidParts {
  root: string;
  article?: string;
  para?: string;
  items: string[];
}

export function parsePid(pid: string): PidParts {
  const m = /^(m|e|s\d+(?:\.t\d+)?|t\d+)(?:\.a([^.#]+))?(?:\.p([^.#]+))?((?:\.i[^.#]+)*)/.exec(pid);
  if (!m) return { root: pid, items: [] };
  const itemStr = m[4] ?? '';
  const items = itemStr.length === 0 ? [] : itemStr.split('.').filter(Boolean).map((x) => x.slice(1));
  return {
    root: m[1]!,
    article: m[2],
    para: m[3],
    items,
  };
}

export function formatPid(p: PidParts): string {
  let s = p.root;
  if (p.article) s += `.a${p.article}`;
  if (p.para) s += `.p${p.para}`;
  for (const it of p.items) s += `.i${it}`;
  return s;
}

export function articleKey(pid: string): string {
  const p = parsePid(pid);
  if (p.article) return `${p.root}.a${p.article}`;
  return p.root;
}

export function articlePidOf(pid: string): string {
  const p = parsePid(pid);
  return formatPid({ root: p.root, article: p.article, items: [] });
}

export function paraPidOf(pid: string): string {
  const p = parsePid(pid);
  return formatPid({ root: p.root, article: p.article, para: p.para, items: [] });
}

export function itemPidOf(pid: string): string {
  const p = parsePid(pid);
  if (p.items.length === 0) return paraPidOf(pid);
  return formatPid({ root: p.root, article: p.article, para: p.para, items: [p.items[0]!] });
}

export function isKatakana(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  return (c >= 0x30a1 && c <= 0x30fa) || c === 0x30fc;
}

export function isHiragana(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  return c >= 0x3041 && c <= 0x3096;
}

export function isKanji(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  if (c >= 0x4e00 && c <= 0x9fff) return true;
  if (c >= 0x3400 && c <= 0x4dbf) return true;
  if (c === 0x3005) return true;
  return false;
}

export function isKanjiOrKatakana(ch: string | undefined): boolean {
  return isKanji(ch) || isKatakana(ch);
}

/** カタカナ書きの文ではカタカナを語の続きと見なさない。 */
export function continuesLawName(ch: string | undefined, katakanaOnly: boolean): boolean {
  if (!ch) return false;
  if (isKanji(ch)) return true;
  if (isKatakana(ch)) return !katakanaOnly;
  return false;
}

export function isKatakanaOnlySentence(text: string): boolean {
  for (const ch of text) {
    if (isHiragana(ch)) return false;
  }
  return true;
}
