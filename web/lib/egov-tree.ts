export type { EgovNode, SentenceOut } from './shared/egov-tree';
export { collectSentences } from './shared/egov-tree';
import type { EgovNode } from './shared/egov-tree';

export function asEgovNode(raw: unknown): EgovNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { tag?: unknown; attr?: unknown; children?: unknown };
  if (typeof o.tag !== 'string') return null;
  const attr: Record<string, string> = {};
  if (o.attr && typeof o.attr === 'object') {
    for (const [k, v] of Object.entries(o.attr as Record<string, unknown>)) {
      attr[k] = String(v);
    }
  }
  const children: (EgovNode | string)[] = [];
  if (Array.isArray(o.children)) {
    for (const c of o.children) {
      if (typeof c === 'string') children.push(c);
      else {
        const n = asEgovNode(c);
        if (n) children.push(n);
      }
    }
  }
  return { tag: o.tag, attr, children };
}
