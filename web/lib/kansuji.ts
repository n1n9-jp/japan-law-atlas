const DIGIT: Record<string, number> = {
  〇: 0, 零: 0, '○': 0, 一: 1, 二: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 元: 1,
};
const UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
const KAN_CHAR = /[〇零○元一二三四五六七八九十百千万]+/g;

export function parseKansuji(s: string): number {
  let total = 0;
  let curr = 0;
  for (const ch of s) {
    if (ch in DIGIT) {
      curr = DIGIT[ch]!;
    } else if (ch in UNIT) {
      const u = UNIT[ch]!;
      total += (curr === 0 ? 1 : curr) * u;
      curr = 0;
    }
  }
  return total + curr;
}

export function kansujiToArabicInString(s: string): string {
  return s.replace(KAN_CHAR, (m) => String(parseKansuji(m)));
}

const ONES = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function toKansuji(n: number): string {
  if (n === 0) return '〇';
  if (n < 0 || !Number.isFinite(n)) return String(n);
  const v = Math.floor(n);
  if (v >= 10000) return String(v);
  const thou = Math.floor(v / 1000);
  const hund = Math.floor((v % 1000) / 100);
  const ten = Math.floor((v % 100) / 10);
  const one = v % 10;
  let out = '';
  if (thou) out += (thou === 1 ? '' : ONES[thou]) + '千';
  if (hund) out += (hund === 1 ? '' : ONES[hund]) + '百';
  if (ten) out += (ten === 1 ? '' : ONES[ten]) + '十';
  if (one) out += ONES[one];
  return out;
}
