import type { SentenceOut } from './egov-tree';
import { parsePid } from './pid';

export interface MentionHit {
  pid: string;
  sent: number;
  start: number;
  end: number;
  text: string;
}

export function findMention(
  sentences: SentenceOut[],
  srcPid: string,
  mention: string,
): MentionHit | null {
  if (!mention) return null;
  const parsed = parsePid(srcPid);
  const sentNo = parsed.sent;
  const samePid = sentences.filter((s) => s.pid === parsed.pid);
  const preferred = sentNo != null ? samePid.find((s) => s.sent === sentNo) : undefined;
  const order: SentenceOut[] = [];
  if (preferred) order.push(preferred);
  for (const s of samePid) if (s !== preferred) order.push(s);
  for (const s of sentences) if (!samePid.includes(s)) order.push(s);

  for (const s of order) {
    const at = s.text.indexOf(mention);
    if (at >= 0) {
      return { pid: s.pid, sent: s.sent, start: at, end: at + mention.length, text: s.text };
    }
  }
  return null;
}

export function splitHighlight(text: string, start: number, end: number): { before: string; hit: string; after: string } {
  return { before: text.slice(0, start), hit: text.slice(start, end), after: text.slice(end) };
}
