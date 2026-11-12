const DIGIT: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  元: 1,
};

const KANSUJI_RUN = /[元〇零一二三四五六七八九十百千]+/g;
const WHITESPACE = /[\s\u3000]+/g;

export function kansujiToInt(s: string): number {
  let result = 0;
  let current = 0;
  for (const ch of s) {
    if (ch === '千') {
      result += (current || 1) * 1000;
      current = 0;
    } else if (ch === '百') {
      result += (current || 1) * 100;
      current = 0;
    } else if (ch === '十') {
      result += (current || 1) * 10;
      current = 0;
    } else if (ch in DIGIT) {
      current = DIGIT[ch];
    }
  }
  return result + current;
}

export function normalizeLawNum(s: string): string {
  return s.replace(WHITESPACE, '').replace(KANSUJI_RUN, (run) => String(kansujiToInt(run)));
}
