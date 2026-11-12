import { REF_FLAGS, type Ref } from '../../lib/ref-types.js';
import type { ExtractResult } from './types.js';

const FLAG_NAMES = Object.entries(REF_FLAGS) as [string, number][];

export function formatDebug(lawId: string, result: ExtractResult): string {
  const lines: string[] = [];
  lines.push(`# ${lawId}`);
  lines.push(`refs=${result.refs.length} abbrevs=${result.abbrevs.length} delegations=${result.features.delegations} definedTerms=${result.features.definedTerms} unresolved=${result.features.unresolvedMentions}`);
  lines.push('');
  for (const r of result.refs) {
    lines.push(formatRef(r));
  }
  if (result.abbrevs.length > 0) {
    lines.push('');
    lines.push('## abbrevs');
    for (const a of result.abbrevs) {
      lines.push(`- ${a.abbr} → ${a.targetLaw ?? 'null'} scope=${a.scope} @ ${a.pid}#${a.sent}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function formatRef(r: Ref): string {
  const flags = FLAG_NAMES.filter(([, bit]) => (r.flags & bit) !== 0).map(([n]) => n);
  const tgt = r.tgtLaw ? `${r.tgtLaw}${r.tgtPid ? ' ' + r.tgtPid : ''}${r.tgtEnd ? '..' + r.tgtEnd : ''}` : r.tgtStatus;
  return `[${r.rule}] ${r.srcPid}#${r.sent} ${r.start}-${r.end} "${r.mention}" → ${tgt} kind=${r.kind} status=${r.tgtStatus} flags=${flags.join('|') || 'none'} conf=${r.confidence.toFixed(2)}`;
}
