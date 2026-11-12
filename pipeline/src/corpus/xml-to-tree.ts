import { parseDocument } from 'htmlparser2';
import { isCDATA, isTag, isText, type ChildNode, type Element } from 'domhandler';
import type { EgovNode } from '../../lib/shared/egov-tree.ts';

function toNode(el: Element): EgovNode {
  const attr: Record<string, string> = {};
  for (const [key, value] of Object.entries(el.attribs)) {
    if (value !== undefined) attr[key] = value;
  }
  const children: (EgovNode | string)[] = [];
  for (const child of el.childNodes as ChildNode[]) {
    if (isTag(child)) children.push(toNode(child));
    else if (isText(child)) children.push(child.data);
    else if (isCDATA(child)) {
      const data = (child as { data?: string }).data;
      if (typeof data === 'string') children.push(data);
    }
  }
  return { tag: el.name, attr, children };
}

export function xmlToEgovNode(xml: string): EgovNode {
  const doc = parseDocument(xml, {
    xmlMode: true,
    decodeEntities: true,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
  });
  const root = doc.children.find((c) => isTag(c));
  if (!root || !isTag(root)) throw new Error('XML root element not found');
  return toNode(root);
}
