const ERA_PREFIX = /^(明治|大正|昭和|平成|令和)/;
const PAREN = /（([^）]+)）/;

export function displayBaseTitle(title: string): string {
  const paren = PAREN.exec(title);
  if (ERA_PREFIX.test(title) && paren?.[1]) return paren[1];
  return title;
}

export function makeLabel(title: string, abbrevs: string[]): string {
  const base = displayBaseTitle(title);
  const first = abbrevs.find((a) => a.length > 0);
  let label = first && first.length < base.length ? first : base;
  if (label.length > 16) label = `${label.slice(0, 15)}…`;
  return label;
}

export function collectAliases(opts: {
  title: string;
  egovAbbrevs: string[];
  jlawAliases: string[];
  bodyAliases: string[];
  max?: number;
}): string[] {
  const max = opts.max ?? 8;
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (!t || t === opts.title || seen.has(t) || out.length >= max) return;
    seen.add(t);
    out.push(t);
  };
  for (const a of opts.egovAbbrevs) push(a);
  for (const a of opts.jlawAliases) push(a);
  for (const a of opts.bodyAliases) push(a);
  return out;
}
