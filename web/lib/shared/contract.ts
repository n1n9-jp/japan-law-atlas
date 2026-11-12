export const CONTRACT_VERSION = 1 as const;

export const LAW_TYPES = ['Constitution', 'Act', 'CabinetOrder', 'ImperialOrder', 'MinisterialOrdinance', 'Rule', 'Misc'] as const;
export type LawType = (typeof LAW_TYPES)[number];
export const LAW_TYPE_LABELS: Record<LawType, string> = {
  Constitution: '憲法', Act: '法律', CabinetOrder: '政令', ImperialOrder: '勅令',
  MinisterialOrdinance: '府省令', Rule: '規則', Misc: 'その他（太政官布告など）',
};

// 配列の順番が添字になる。並び順は種類の優先順位でもある（1つの参照に複数当てはまるときは前のものを採る）。
export const REF_KINDS = ['basis', 'implements', 'amend', 'junyo', 'rei', 'exclude', 'term', 'cite'] as const;
export type RefKind = (typeof REF_KINDS)[number];
export const REF_KIND_LABELS: Record<RefKind, string> = {
  basis: '制定の根拠', implements: '委任の受け皿', amend: '改正・廃止', junyo: '準用',
  rei: '例による', exclude: '適用除外', term: '定義・用語の借用', cite: '引用',
};

export const PARTS = ['main', 'enact', 'appdx', 'suppl', 'supplAmend'] as const;
export type Part = (typeof PARTS)[number];
export const PART_LABELS: Record<Part, string> = {
  main: '本則', enact: '制定文', appdx: '別表など', suppl: '附則（制定時）', supplAmend: '附則（改正法から）',
};
// 「本則系」= main, enact, appdx。「附則系」= suppl, supplAmend。

export const LAW_STATUSES = ['current', 'notYetEffective', 'repealed'] as const;
export type LawStatus = (typeof LAW_STATUSES)[number];

export const REF_FLAGS = {
  yomikae: 1 << 0,      // 読替えを伴う
  range: 1 << 1,        // 「から…まで」の範囲指定
  viaAbbrev: 1 << 2,    // 本文で定義された略称で解決
  viaAnaphora: 1 << 3,  // 「同法」「同条」などで解決
  enumCarry: 1 << 4,    // 並列（「、」「及び」など）で前の法令を引き継いだ
  relative: 1 << 5,     // 前条・次項など相対的な指定
  lawLevelOnly: 1 << 6, // 条まで特定できない
} as const;

export interface LatestPointer { contractVersion: 1; snapshotId: string; dataPath: string }

export interface CategoryGroup { id: number; name: string; hue: number }
export interface Category {
  id: number; name: string; groupId: number;
  color: [number, number, number];   // sRGB 0-255
  lawCount: number;
  labelPos: [number, number];        // 大陸ラベルの位置（ワールド座標）
}

export interface Manifest {
  contractVersion: 1;
  snapshotId: string;
  egovAsof: string;                  // YYYY-MM-DD
  builtAt: string;                   // ISO 8601
  pipelineVersion: string;           // 抽出器の版（semver）
  isMock: boolean;
  counts: { laws: number; ghostLaws: number; lawEdges: number; refs: number; crossLawRefs: number };
  bounds: [number, number, number, number]; // minX, minY, maxX, maxY
  groups: CategoryGroup[];
  categories: Category[];            // 添字 = id
  files: { path: string; bytes: number; sha256: string }[];
  eval: null | {
    crossLawF1: number; crossLawPrecision: number; crossLawRecall: number;
    articleLevelF1: number; kindAccuracy: number; goldSentences: number; goldRefs: number;
    vsLawvis: { ours: number; theirs: number; both: number };
    vsJlaw: { ours: number; theirs: number; both: number };
  };
  attribution: string[];             // 画面に出す出典表示の文
}

// 列指向。すべての配列の長さは n。添字 i が「法令番号 i」（lawIndex）。
// 並び順: status（current, notYetEffective, repealed）→ category の id → lawId。
export interface LawsFile {
  n: number;
  id: string[];          // law_id
  revisionId: string[];  // 本文取得に使う版ID（廃止法令は ""）
  title: string[];
  label: string[];       // 地図に出す短い名前（作り方は m2-01）
  kana: string[];
  num: string[];         // 法令番号（漢数字）
  numNorm: string[];     // 算用数字にした法令番号
  aliases: string[][];   // 検索用の略称（重複なし、最大8個）
  type: number[];        // LAW_TYPES の添字
  category: number[];    // Category.id
  promulgated: number[]; // 公布日 yyyymmdd の整数
  status: number[];      // LAW_STATUSES の添字。repealed は参照されている廃止法令（ゴースト）
  x: number[]; y: number[]; // ワールド座標（小数1桁）
  r: number[];           // 半径（ワールド単位、小数1桁）
  articles: number[];    // 本則の条数
  inLaws: number[];      // この法令を参照する法令の数（本則系）
  outLaws: number[];     // この法令が参照する法令の数（本則系）
  inRefs: number[];      // 被参照の言及数（本則系）
  outRefs: number[];
  pagerank: number[];    // 有効数字4桁
  prRank: number[];      // PageRank の順位（1 が最上位）
  parent: number[];      // 親法令の lawIndex。なければ -1
  family: number[];      // 法令ファミリーの根の lawIndex（根なら自分）
  community: number[];   // Louvain のコミュニティ番号
  bridge: number[];      // この法令を参照する法令の分野の数
  delegations: number[]; // 委任の言い回しの数
}

// 列指向。法令ペア（参照する側 src → 参照される側 tgt）ごとに1行。自己参照は含めない。
// 並び順: src → tgt。
export interface LawEdgesFile {
  n: number;
  src: number[]; tgt: number[];  // lawIndex
  mainRefs: number[];   // 本則系の言及数
  supplRefs: number[];  // 附則系の言及数
  kindMask: number[];   // 出てくる RefKind のビット（全部の部）
  domKind: number[];    // いちばん多い RefKind の添字（mainRefs > 0 なら本則系で数え、0 なら附則系で数える。同数なら REF_KINDS の順で前のもの）
  intraFamily: number[];// 1 = 同じ法令ファミリーの中の参照
}

// ring は [x0, y0, x1, y1, ...] の平らな配列。polygon は [外周, 穴, 穴, ...]。
export interface ContinentsFile {
  categories: { id: number; polygons: number[][][]; area: number; labelPos: [number, number] }[];
  groups: { id: number; polygons: number[][][]; labelPos: [number, number] }[];
}

// 分野 → 分野の参照量（本則系）。自分の分野への参照は除き、多い順に最大300行。
export interface CategoryFlowsFile { n: number; src: number[]; tgt: number[]; refs: number[] }

// /data/{snapshotId}/refs/{lawId}.json。参照が1つでもある法令だけ作る。
export interface RefRows {
  other: number[];            // 相手の法令の lawIndex
  srcPid: string[];           // 参照元の位置 "m.a3.p1#2"
  tgtPid: (string | null)[];  // 参照先の位置（分からなければ null）
  tgtEnd: (string | null)[];  // 範囲の終わり
  kind: number[];             // REF_KINDS の添字
  part: number[];             // PARTS の添字
  flags: number[];            // REF_FLAGS
  mention: string[];          // 本文での書かれ方（例 "民法第九十条"）
  ctx: (string | null)[];     // 前後の文脈。part が main のときは null（本文は API から取る）。それ以外は前30字＋⟦言及⟧＋後30字
}
export interface LawRefsFile {
  lawId: string;
  out: RefRows; in: RefRows;  // 他法令への参照 / 他法令からの参照（法令内の参照は M3 で別ファイル）
  outTotal: number; inTotal: number; // 切り詰める前の行数
}
// 並び順: other の prRank の昇順 → srcPid の自然順。相手の法令ごとに先頭 K 行（K ≤ 20。値は m2-01 が決める）だけ残し、そのうえで各方向5,000行で切り詰める。
// 相手ごとの本当の件数は law-edges.json の mainRefs + supplRefs（UI は「ほか n 件」をこれで出す）。
