import { toKansuji } from './kansuji';

function articleToJa(num: string): string {
  const parts = num.split('_').map((p) => Number(p));
  let s = `第${toKansuji(parts[0] ?? 0)}条`;
  for (let i = 1; i < parts.length; i++) s += `の${toKansuji(parts[i]!)}`;
  return s;
}

function itemToJa(num: string): string {
  const parts = num.split('_').map((p) => Number(p));
  let s = `第${toKansuji(parts[0] ?? 0)}号`;
  for (let i = 1; i < parts.length; i++) s += `の${toKansuji(parts[i]!)}`;
  return s;
}

export function pidToJa(pid: string): string {
  const main = pid.split('#')[0] ?? pid;
  const segs = main.split('.').filter(Boolean);
  let out = '';
  for (const seg of segs) {
    if (seg === 'm') continue;
    if (seg === 'e') {
      out += '制定文';
      continue;
    }
    const s = /^s(\d+)$/.exec(seg);
    if (s) {
      out += Number(s[1]) <= 1 ? '附則' : `附則その${toKansuji(Number(s[1]))}`;
      continue;
    }
    const t = /^t(\d+)$/.exec(seg);
    if (t) {
      out += `別表${toKansuji(Number(t[1]))}`;
      continue;
    }
    if (seg.startsWith('a')) {
      out += articleToJa(seg.slice(1));
      continue;
    }
    if (seg.startsWith('p')) {
      out += `第${toKansuji(Number(seg.slice(1).replace('_', '')))}項`;
      continue;
    }
    if (seg.startsWith('i')) {
      out += itemToJa(seg.slice(1));
    }
  }
  return out;
}

export function parsePid(raw: string): { pid: string; sent: number | null; article: string | null; paragraph: string | null } {
  const [body, sentRaw] = raw.split('#');
  const pid = body ?? raw;
  const segs = pid.split('.');
  const a = segs.find((s) => s.startsWith('a'));
  const p = segs.find((s) => s.startsWith('p'));
  return {
    pid,
    sent: sentRaw ? Number(sentRaw) : null,
    article: a ? a.slice(1) : null,
    paragraph: p ? p.slice(1) : null,
  };
}

export function srcPidToTargetJa(srcPid: string, tgtPid: string | null): string {
  const left = pidToJa(srcPid);
  if (!tgtPid) return left;
  return `${left} → ${pidToJa(tgtPid)}`;
}
