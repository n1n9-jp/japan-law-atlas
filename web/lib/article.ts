import { asEgovNode, collectSentences, type SentenceOut } from './egov-tree';
import { parsePid } from './pid';

interface LawDataResponse {
  law_full_text?: unknown;
}

export async function fetchArticleSentences(revisionId: string, srcPid: string): Promise<SentenceOut[]> {
  const parsed = parsePid(srcPid);
  const elm = parsed.article
    ? `MainProvision-Article_${parsed.article}`
    : `MainProvision-Paragraph_${parsed.paragraph ?? '1'}`;
  const url = `https://laws.e-gov.go.jp/api/2/law_data/${encodeURIComponent(revisionId)}?law_full_text_format=json&elm=${encodeURIComponent(elm)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`e-Gov ${res.status}`);
  const json = await res.json() as LawDataResponse;
  const node = asEgovNode(json.law_full_text);
  if (!node) throw new Error('law_full_text missing');
  const rootPid = parsed.article ? `m.a${parsed.article}` : 'm';
  return collectSentences(node, rootPid);
}
