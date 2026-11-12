import { kansujiToInt, normalizeLawNum as normalizeFromLib } from '../lib/kansuji.js';

const KANSUJI_CHAR = /[〇零一二三四五六七八九十百千元]/;

export function parseKansuji(raw: string): number | null {
  if (raw.length === 0) return null;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (!/^[〇零一二三四五六七八九十百千元]+$/.test(raw)) return null;
  return kansujiToInt(raw);
}

export function parseKansujiPrefix(text: string, i: number): { value: number; raw: string; end: number } | null {
  let j = i;
  while (j < text.length && (KANSUJI_CHAR.test(text[j]!) || /[0-9]/.test(text[j]!))) j++;
  if (j === i) return null;
  const raw = text.slice(i, j);
  const value = parseKansuji(raw);
  if (value === null) return null;
  return { value, raw, end: j };
}

export const normalizeLawNum = normalizeFromLib;
