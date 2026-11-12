/** 辞書・略称に使う法令の種類の語。長いものから試す。 */
export const LAW_TYPE_SUFFIX_RE =
  /(?:法律|政令|勅令|省令|府令|規則|規程|細則|条約|協定|憲法|布告|達|令|法)$/;

export function hasLawTypeSuffix(name: string): boolean {
  return LAW_TYPE_SUFFIX_RE.test(name);
}

export function isAcceptableDictName(name: string, source: 'title' | 'oldTitle' | 'egovAbbrev' | 'jlaw'): boolean {
  if (!name || !hasLawTypeSuffix(name)) return false;
  if (source === 'title') return name.length >= 2;
  return name.length >= 3;
}

/** mention に含める前置き。前の「の規定による」は含めない。 */
export const NAME_PREFIXES = ['廃止前の', '改正前の', '改正後の', '改正前', '改正後', '新', '旧'] as const;

export function isOldStylePrefix(prefix: string | null | undefined): boolean {
  if (!prefix) return false;
  return /旧|改正前|廃止前/.test(prefix);
}
