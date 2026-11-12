export type EgovNode = { tag: string; attr: Record<string, string>; children: (EgovNode | string)[] };
export type SentenceOut = { pid: string; sent: number; text: string; inTable: boolean };

const ADDRESS_TAGS = new Set([
  'Article',
  'Paragraph',
  'Item',
  'Subitem1',
  'Subitem2',
  'Subitem3',
  'Subitem4',
  'Subitem5',
  'Subitem6',
  'Subitem7',
  'Subitem8',
  'Subitem9',
  'Subitem10',
]);

const SKIP_TAGS = new Set([
  'ArticleCaption',
  'ParagraphCaption',
  'ArticleTitle',
  'ParagraphNum',
  'ItemTitle',
]);

const ASCII_WS = /[ \t\n\r\f\v]+/g;

export function extractNodeText(node: EgovNode | string): string {
  if (typeof node === 'string') return node.replace(ASCII_WS, '');
  if (node.tag === 'Rt') return '';
  let out = '';
  for (const child of node.children) out += extractNodeText(child);
  return out;
}

function extendPid(pid: string, node: EgovNode): string {
  const num = node.attr.Num ?? (node.tag === 'Paragraph' ? '1' : '');
  if (node.tag === 'Article') return `${pid}.a${num}`;
  if (node.tag === 'Paragraph') return `${pid}.p${num}`;
  return `${pid}.i${num}`;
}

export function collectSentences(root: EgovNode, rootPid: string): SentenceOut[] {
  const out: SentenceOut[] = [];
  const counts = new Map<string, number>();

  const emit = (pid: string, text: string, inTable: boolean): void => {
    const sent = (counts.get(pid) ?? 0) + 1;
    counts.set(pid, sent);
    out.push({ pid, sent, text, inTable });
  };

  const walk = (node: EgovNode | string, pid: string, inTable: boolean): void => {
    if (typeof node === 'string') return;
    if (SKIP_TAGS.has(node.tag)) return;
    if (node.tag === 'Sentence') {
      emit(pid, extractNodeText(node), inTable);
      return;
    }
    const nextPid = ADDRESS_TAGS.has(node.tag) ? extendPid(pid, node) : pid;
    const nextTable = inTable || node.tag === 'TableStruct';
    for (const child of node.children) walk(child, nextPid, nextTable);
  };

  if (root.tag === 'Sentence') {
    emit(rootPid, extractNodeText(root), false);
    return out;
  }
  const rootTable = root.tag === 'TableStruct';
  for (const child of root.children) walk(child, rootPid, rootTable);
  return out;
}
