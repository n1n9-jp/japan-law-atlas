export interface GroupDef {
  id: number;
  name: string;
  hue: number;
  categories: string[];
}

export const GROUP_DEFS: GroupDef[] = [
  { id: 0, name: '統治', hue: 249, categories: ['憲法', '国会', '行政組織', '国家公務員', '行政手続', '統計'] },
  { id: 1, name: '地方', hue: 277, categories: ['地方自治', '地方財政'] },
  { id: 2, name: '司法・治安', hue: 0, categories: ['司法', '刑事', '警察', '消防'] },
  { id: 3, name: '民事・商事・金融', hue: 28, categories: ['民事', '商業', '金融・保険'] },
  { id: 4, name: '財政・税', hue: 55, categories: ['財務通則', '国有財産', '国債', '国税'] },
  { id: 5, name: '産業', hue: 83, categories: ['産業通則', '工業', '鉱業', '事業', '外国為替・貿易'] },
  { id: 6, name: '農林水産', hue: 111, categories: ['農業', '林業', '水産業'] },
  { id: 7, name: '国土・建設', hue: 138, categories: ['国土開発', '土地', '都市計画', '道路', '河川', '建築・住宅'] },
  { id: 8, name: '交通・通信', hue: 166, categories: ['陸運', '海運', '航空', '貨物運送', '観光', '郵務', '電気通信'] },
  { id: 9, name: '環境・災害', hue: 194, categories: ['環境保全', '災害対策'] },
  { id: 10, name: '社会保障・労働', hue: 222, categories: ['労働', '厚生', '社会福祉', '社会保険'] },
  { id: 11, name: '教育・文化', hue: 305, categories: ['教育', '文化'] },
  { id: 12, name: '外交・防衛', hue: 332, categories: ['外事', '防衛'] },
];

export const CATEGORY_NAMES: string[] = GROUP_DEFS.flatMap((g) => g.categories);

export function categoryIdByName(name: string): number {
  const i = CATEGORY_NAMES.indexOf(name);
  return i < 0 ? CATEGORY_NAMES.indexOf('行政組織') : i;
}

export function groupIdForCategory(categoryId: number): number {
  let acc = 0;
  for (const g of GROUP_DEFS) {
    if (categoryId < acc + g.categories.length) return g.id;
    acc += g.categories.length;
  }
  return 0;
}

export function spaced(n: number, a: number, b: number): number[] {
  if (n <= 1) return [(a + b) / 2];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}
