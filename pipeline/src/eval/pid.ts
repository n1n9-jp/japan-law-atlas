export function articlePid(pid: string | null): string | null {
  if (pid === null || pid === '') return null;
  const core = pid.split('#')[0]!;
  const withArticle = core.match(/^((?:s\d+|t\d+|m|e)(?:\.t\d+)?\.a[^.]*)/);
  if (withArticle) return withArticle[1]!;
  const withPara = core.match(/^((?:s\d+|t\d+|m|e)(?:\.t\d+)?\.p[^.]*)/);
  if (withPara) return withPara[1]!;
  return core;
}

export function sentenceKey(lawId: string, pid: string, sent: number): string {
  return `${lawId}\t${pid}\t${sent}`;
}

/** Predictions whose mention is exactly one of these are neither TP nor FP. */
export const IGNORED_PRED_MENTION =
  /^(?:この(?:法律|政令|省令|府令|規則|命令)|本法)$|^(?:各号|ただし書|但し書|本文|前段|後段|次の表|同表)$/;

export function isIgnoredPredMention(mention: string): boolean {
  return IGNORED_PRED_MENTION.test(mention);
}

/** Gold/pred mention filter for the relative intra-law metric. */
export const RELATIVE_MENTION =
  /^(?:前|次)(?:条|項|号)|^(?:前各)(?:項|号)|^(?:前|次)[二三四五六七八九十]+(?:条|項|号)|^(?:同)(?:条|項|号)|^(?:本)(?:条|項)|^(?:この)(?:条|項|号)/;

export function isRelativeMention(mention: string): boolean {
  return RELATIVE_MENTION.test(mention);
}

export function relativeHead(mention: string): string {
  const m = mention.match(
    /^(?:前各項|前各号|次各項|次各号|前[二三四五六七八九十]+(?:条|項|号)|次[二三四五六七八九十]+(?:条|項|号)|前条|次条|前項|次項|前号|次号|同条|同項|同号|本条|この条|この項|この号)/,
  );
  return m?.[0] ?? mention;
}

export function pidStartsWith(pred: string | null, gold: string | null): boolean {
  if (!pred || !gold) return false;
  if (pred === gold) return true;
  return pred.startsWith(gold) && pred.length > gold.length && pred[gold.length] === '.';
}
