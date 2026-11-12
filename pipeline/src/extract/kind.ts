import type { Part, RefKind } from '../../lib/ref-types.js';
import type { SlimMeta } from './types.js';

const DELEGATION_RE = /(政令|内閣府令|省令|主務省令|府令|規則|命令)で定める/;

const IMPLEMENT_SRC = new Set(['CabinetOrder', 'MinisterialOrdinance', 'Rule', 'ImperialOrder']);

export function classifyKind(args: {
  text: string;
  start: number;
  end: number;
  part: Part;
  srcMeta: SlimMeta;
  isFirstMainSentence: boolean;
}): RefKind {
  const { text, start, end, part, srcMeta, isFirstMainSentence } = args;
  const after = text.slice(end);

  if (part === 'enact') return 'basis';
  if (
    isFirstMainSentence &&
    (srcMeta.lawType === 'MinisterialOrdinance' || srcMeta.lawType === 'Rule') &&
    /の規定に基づ?き/.test(text) &&
    text.slice(0, start).includes('規定に基') === false
  ) {
    const marker = text.search(/の規定に基づ?き/);
    if (marker >= 0 && end <= marker) return 'basis';
  }

  if (IMPLEMENT_SRC.has(srcMeta.lawType)) {
    const window = after.slice(0, 40);
    const stripped = window.replace(/^(の|に規定する)/, '');
    if (stripped.length <= 20 && DELEGATION_RE.test(stripped.slice(0, 20))) return 'implements';
    if (DELEGATION_RE.test(after.slice(0, 20))) return 'implements';
  }

  if (part === 'suppl' || part === 'supplAmend') {
    if (/^の一部を次のように改正する/.test(after)) return 'amend';
    if (/^の一部を改正する。/.test(after)) return 'amend';
    if (/^を廃止する。/.test(after)) return 'amend';
  }
  if (
    (text.includes('中「') || text.includes('を「')) &&
    (text.includes('改める') || text.includes('加える') || text.includes('削る'))
  ) {
    return 'amend';
  }

  if (text.slice(end).includes('準用する')) return 'junyo';

  const thirty = after.split('。')[0] ?? after;
  if (thirty.length <= 30 && thirty.includes('の例による')) return 'rei';
  if (after.slice(0, 30).includes('の例による') && !after.slice(0, after.indexOf('の例による') + 1 || 0).includes('。')) {
    const idx = after.indexOf('の例による');
    if (idx >= 0 && idx <= 30 && !after.slice(0, idx).includes('。')) return 'rei';
  }

  if (/^の規定[はを]/.test(after) && (after.includes('適用しない') || after.includes('適用を除外'))) {
    return 'exclude';
  }

  if (/^に規定する/.test(after) && !after.startsWith('に規定するところ')) return 'term';
  if (/^にいう/.test(after) && !after.startsWith('にいうところ')) return 'term';
  if (/^に定める/.test(after) && !/^に定めるところ/.test(after)) return 'term';

  return 'cite';
}

export function hasYomikae(text: string): boolean {
  return text.includes('とあるのは') && text.includes('読み替');
}

export function countDelegations(text: string): number {
  const re = /(政令|内閣府令|省令|主務省令|府令|規則|命令)で定める/g;
  return (text.match(re) ?? []).length;
}

export function isDefinedTermSentence(text: string): boolean {
  return /をいう。\s*$/.test(text);
}
