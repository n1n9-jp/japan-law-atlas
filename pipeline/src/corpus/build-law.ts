import type { ArticleEntry, CorpusLaw, LawMeta, Part, SentenceRec, TocEntry } from '../../lib/corpus-types.ts';
import {
  collectSentences,
  extractNodeText,
  type EgovNode,
} from '../../lib/shared/egov-tree.ts';

const APPDX_TAGS = new Set(['AppdxTable', 'AppdxNote', 'AppdxStyle', 'AppdxFormat', 'AppdxFig', 'Appdx']);
const TOC_DEPTH: Record<string, number> = {
  Part: 0,
  Chapter: 1,
  Section: 2,
  Subsection: 3,
  Division: 4,
};
const TOC_KINDS = new Set(Object.keys(TOC_DEPTH));

function isNode(x: EgovNode | string): x is EgovNode {
  return typeof x !== 'string';
}

function childByTag(node: EgovNode, tag: string): EgovNode | undefined {
  return node.children.find((c): c is EgovNode => isNode(c) && c.tag === tag);
}

function childText(node: EgovNode, tag: string): string {
  const ch = childByTag(node, tag);
  return ch ? extractNodeText(ch) : '';
}

function withoutTags(node: EgovNode, tags: Set<string>): EgovNode {
  return {
    tag: node.tag,
    attr: node.attr,
    children: node.children
      .filter((c) => typeof c === 'string' || !tags.has(c.tag))
      .map((c) => (typeof c === 'string' ? c : withoutTags(c, tags))),
  };
}

function collectTagged(node: EgovNode, tags: Set<string>): EgovNode[] {
  const out: EgovNode[] = [];
  const walk = (n: EgovNode): void => {
    if (tags.has(n.tag)) {
      out.push(n);
      return;
    }
    for (const c of n.children) if (isNode(c)) walk(c);
  };
  walk(node);
  return out;
}

function appdxTitle(node: EgovNode): string {
  const titleTag = `${node.tag}Title`;
  const titled = childByTag(node, titleTag) ?? node.children.find((c): c is EgovNode => isNode(c) && c.tag.endsWith('Title'));
  return titled ? extractNodeText(titled) : '';
}

function toRecs(
  sents: { pid: string; sent: number; text: string; inTable: boolean }[],
  part: Part,
  supplIndex: number | null,
  amendLawNum: string | null,
): SentenceRec[] {
  return sents.map((s) => ({
    pid: s.pid,
    sent: s.sent,
    part,
    text: s.text,
    inTable: s.inTable,
    supplIndex,
    amendLawNum,
  }));
}

function collectArticles(
  root: EgovNode,
  pidPrefix: string,
  part: Part,
  withToc: boolean,
): { toc: TocEntry[]; articles: ArticleEntry[] } {
  const toc: TocEntry[] = [];
  const articles: ArticleEntry[] = [];

  const walk = (node: EgovNode, tocPath: number[]): void => {
    if (node.tag === 'Article') {
      const num = node.attr.Num ?? '';
      const captionRaw = childText(node, 'ArticleCaption');
      articles.push({
        pid: `${pidPrefix}.a${num}`,
        part,
        title: childText(node, 'ArticleTitle'),
        caption: captionRaw.length > 0 ? captionRaw : null,
        toc: tocPath,
      });
      return;
    }
    if (withToc && TOC_KINDS.has(node.tag)) {
      const index = toc.length;
      const kind = node.tag as TocEntry['kind'];
      toc.push({
        kind,
        num: node.attr.Num ?? '',
        title: childText(node, `${node.tag}Title`),
        depth: TOC_DEPTH[node.tag] ?? 0,
        firstArticle: null,
        lastArticle: null,
      });
      const start = articles.length;
      const nextPath = [...tocPath, index];
      for (const c of node.children) if (isNode(c)) walk(c, nextPath);
      const slice = articles.slice(start);
      toc[index]!.firstArticle = slice[0]?.pid ?? null;
      toc[index]!.lastArticle = slice.at(-1)?.pid ?? null;
      return;
    }
    for (const c of node.children) if (isNode(c)) walk(c, tocPath);
  };

  walk(root, []);
  return { toc, articles };
}

function countTag(node: EgovNode, tag: string): number {
  let n = 0;
  const walk = (el: EgovNode): void => {
    if (el.tag === tag) n++;
    for (const c of el.children) if (isNode(c)) walk(c);
  };
  walk(node);
  return n;
}

export function buildCorpusLaw(root: EgovNode, meta: Omit<LawMeta, 'articleCount' | 'supplCount' | 'hasEnact'>): CorpusLaw {
  const lawBody = childByTag(root, 'LawBody') ?? root;
  const sentences: SentenceRec[] = [];
  const articles: ArticleEntry[] = [];
  const appdx: { pid: string; title: string }[] = [];
  let toc: TocEntry[] = [];
  let articleCount = 0;
  let supplCount = 0;
  let hasEnact = false;
  let topAppdx = 0;
  let enactSent = 0;

  const lawTitle = childByTag(lawBody, 'LawTitle');
  const xmlAbbrev = lawTitle?.attr.Abbrev?.trim();
  if (xmlAbbrev && !meta.abbrevs.includes(xmlAbbrev)) {
    meta = { ...meta, abbrevs: [...meta.abbrevs, xmlAbbrev] };
  }

  const pushAppdx = (node: EgovNode, pid: string, supplIndex: number | null, amendLawNum: string | null): void => {
    appdx.push({ pid, title: appdxTitle(node) });
    sentences.push(...toRecs(collectSentences(node, pid), 'appdx', supplIndex, amendLawNum));
  };

  for (const child of lawBody.children) {
    if (!isNode(child)) continue;
    if (child.tag === 'EnactStatement') {
      hasEnact = true;
      enactSent += 1;
      sentences.push({
        pid: 'e',
        sent: enactSent,
        part: 'enact',
        text: extractNodeText(child),
        inTable: false,
        supplIndex: null,
        amendLawNum: null,
      });
      continue;
    }
    if (child.tag === 'MainProvision') {
      const cleaned = withoutTags(child, APPDX_TAGS);
      articleCount = countTag(cleaned, 'Article');
      const collected = collectArticles(cleaned, 'm', 'main', true);
      toc = collected.toc;
      articles.push(...collected.articles);
      sentences.push(...toRecs(collectSentences(cleaned, 'm'), 'main', null, null));
      for (const ap of collectTagged(child, APPDX_TAGS)) {
        topAppdx += 1;
        pushAppdx(ap, `t${topAppdx}`, null, null);
      }
      continue;
    }
    if (child.tag === 'SupplProvision') {
      supplCount += 1;
      const k = supplCount;
      const amend = child.attr.AmendLawNum ?? null;
      const part: Part = amend ? 'supplAmend' : 'suppl';
      const cleaned = withoutTags(child, APPDX_TAGS);
      const prefix = `s${k}`;
      articles.push(...collectArticles(cleaned, prefix, part, false).articles);
      sentences.push(...toRecs(collectSentences(cleaned, prefix), part, k, amend));
      let j = 0;
      for (const ap of collectTagged(child, APPDX_TAGS)) {
        j += 1;
        pushAppdx(ap, `${prefix}.t${j}`, k, amend);
      }
      continue;
    }
    if (APPDX_TAGS.has(child.tag)) {
      topAppdx += 1;
      pushAppdx(child, `t${topAppdx}`, null, null);
    }
  }

  return {
    meta: {
      lawId: meta.lawId,
      revisionId: meta.revisionId,
      title: meta.title,
      kana: meta.kana,
      abbrevs: meta.abbrevs,
      oldTitles: meta.oldTitles,
      num: meta.num,
      numNorm: meta.numNorm,
      lawType: meta.lawType,
      rawLawType: meta.rawLawType,
      category: meta.category,
      promulgationDate: meta.promulgationDate,
      enforcementDate: meta.enforcementDate,
      status: meta.status,
      repealDate: meta.repealDate,
      articleCount,
      supplCount,
      hasEnact,
      source: meta.source,
    },
    toc,
    articles,
    appdx,
    sentences,
  };
}
