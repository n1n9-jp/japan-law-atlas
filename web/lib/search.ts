import type { LawsFile } from './shared/contract';
import { kansujiToArabicInString } from './kansuji';

export interface SearchHit {
  index: number;
  score: number;
  field: 'title' | 'label' | 'alias' | 'kana' | 'num';
  matched: string;
}

function kataToHira(s: string): string {
  return s.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function normalizeQuery(s: string): string {
  return kansujiToArabicInString(kataToHira(s.normalize('NFKC')).replace(/[\s\u3000]/g, ''));
}

function scoreField(normField: string, q: string, exact: number, prefix: number, partial: number): number {
  if (!q || !normField) return 0;
  if (normField === q) return exact;
  if (normField.startsWith(q)) return prefix;
  if (normField.includes(q)) return partial;
  return 0;
}

interface SearchIndex {
  title: string[];
  label: string[];
  kana: string[];
  num: string[];
  aliases: string[][];
}

let indexedLaws: LawsFile | null = null;
let index: SearchIndex | null = null;

export function buildSearchIndex(laws: LawsFile): SearchIndex {
  const title: string[] = Array.from({ length: laws.n });
  const label: string[] = Array.from({ length: laws.n });
  const kana: string[] = Array.from({ length: laws.n });
  const num: string[] = Array.from({ length: laws.n });
  const aliases: string[][] = Array.from({ length: laws.n });
  for (let i = 0; i < laws.n; i++) {
    title[i] = normalizeQuery(laws.title[i]!);
    label[i] = normalizeQuery(laws.label[i]!);
    kana[i] = normalizeQuery(laws.kana[i]!);
    num[i] = normalizeQuery(laws.numNorm[i]! || laws.num[i]!);
    aliases[i] = (laws.aliases[i] ?? []).map(normalizeQuery);
  }
  const built = { title, label, kana, num, aliases };
  indexedLaws = laws;
  index = built;
  return built;
}

function indexFor(laws: LawsFile): SearchIndex {
  if (indexedLaws === laws && index) return index;
  indexedLaws = laws;
  index = buildSearchIndex(laws);
  return index;
}

export function searchLaws(laws: LawsFile, query: string, limit = 20): SearchHit[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const ix = indexFor(laws);
  const hits: SearchHit[] = [];
  for (let i = 0; i < laws.n; i++) {
    const title = ix.title[i]!;
    const label = ix.label[i]!;
    const kana = ix.kana[i]!;
    const num = ix.num[i]!;
    let best = 0;
    let field: SearchHit['field'] = 'title';
    let matched = laws.title[i]!;

    const titleScore = Math.max(
      scoreField(title, q, 100, 80, 50),
      scoreField(label, q, 100, 80, 50),
    );
    if (titleScore > best) {
      best = titleScore;
      field = titleScore === scoreField(label, q, 100, 80, 50) && label.includes(q) ? 'label' : 'title';
      matched = field === 'label' ? laws.label[i]! : laws.title[i]!;
    }
    for (let a = 0; a < (ix.aliases[i] ?? []).length; a++) {
      const aliasNorm = ix.aliases[i]![a]!;
      const alias = laws.aliases[i]![a]!;
      const s = scoreField(aliasNorm, q, 100, 80, 50);
      if (s > best) {
        best = s;
        field = 'alias';
        matched = alias;
      }
    }
    const kanaScore = scoreField(kana, q, 70, 70, 40);
    if (kanaScore > best) {
      best = kanaScore;
      field = 'kana';
      matched = laws.kana[i]!;
    }
    const numScore = scoreField(num, q, 100, 80, 50);
    if (numScore > best) {
      best = numScore;
      field = 'num';
      matched = laws.num[i]!;
    }
    if (best > 0) hits.push({ index: i, score: best, field, matched });
  }
  hits.sort((a, b) => b.score - a.score || laws.prRank[a.index]! - laws.prRank[b.index]!);
  return hits.slice(0, limit);
}

export function highlightMatch(text: string, query: string): { before: string; hit: string; after: string } | null {
  const q = normalizeQuery(query);
  if (!q) return null;
  const src = text;
  const normChars: { ch: string; origIndex: number }[] = [];
  const tmp = normalizeQuery(src);
  // Map by scanning original with same normalize steps approximately via indexOf on normalized.
  const lower = normalizeQuery(src);
  const at = lower.indexOf(q);
  if (at < 0) {
    // fallback: find original query chars
    const raw = query.trim();
    const i = text.indexOf(raw);
    if (i < 0) return null;
    return { before: text.slice(0, i), hit: text.slice(i, i + raw.length), after: text.slice(i + raw.length) };
  }
  // Reconstruct using un-normalized by walking
  let ni = 0;
  let origAt = 0;
  const orig = text;
  const walkNorm = (s: string) => normalizeQuery(s);
  // greedy: find smallest original slice whose normalize contains q at start of remaining
  for (let i = 0; i < orig.length; i++) {
    const n = walkNorm(orig.slice(0, i));
    if (n.length === at) {
      origAt = i;
      break;
    }
    origAt = i;
  }
  let origEnd = orig.length;
  for (let j = origAt; j <= orig.length; j++) {
    if (walkNorm(orig.slice(origAt, j)).length >= q.length) {
      origEnd = j;
      break;
    }
  }
  void ni;
  void normChars;
  return { before: orig.slice(0, origAt), hit: orig.slice(origAt, origEnd), after: orig.slice(origEnd) };
}
