---
cursor:
  subagentId: "bc-4df76127-d762-50d3-a46d-8b372c20ac50"
---

# 00 データ仕様（パイプライン内部とWebの契約）

## 目的

パイプラインの各段（コーパス → 参照抽出 → グラフ・レイアウト → 書き出し）と Web が、同じ形のデータを前提に並行して作業できるようにする。この文書が唯一の正本である。ここにある型定義は、そのまま `shared/` のファイルに写す。変更が必要になったら、自分で直さずに coordinator に提案する（契約の版を上げる判断は coordinator がする）。

## 並行性と依存

- 依存なし。すべてのタスクの前提になる。
- 共有するコードの正本は `shared/` に置く。各パッケージは `npm run sync:shared` で `shared/*.ts` を自分の `lib/shared/` にコピーして使う（`web/lib/shared/`、`pipeline/lib/shared/`）。正本を直接 import しない（Next.js のビルドと Vercel のアップロードがパッケージの外を見ないため）。`npm run check:shared` でコピーと正本が一致することを確かめる。
- `shared/contract.ts`、`shared/contract-schema.ts`（zod による検査）、`shared/validate-web-data.ts`（検査用のコマンド）は m2-02 の UI 担当が最初に作る。`contract.ts` はこの文書の「Web契約の型」をそのまま写す。
- `shared/egov-tree.ts` は m1-01 のコーパス担当が「文の取り出し規則」に従って最初に作る。
- 作った後で、作った担当以外が `shared/` の中身を変えてはいけない。変えたいときは coordinator に頼む。

## 共通の約束

- スナップショットID（`snapshotId`）: コーパスを作った日の日本時間の日付 `YYYYMMDD`（例 `20261008`）。同じ日に作り直したら `20261008-2` のように枝番を付ける。`data/corpus/LATEST` に最新の `snapshotId` を1行で書く。以降の段はここを読む。
- 文字列は UTF-8。オフセットは JavaScript の文字列インデックス（UTF-16 コード単位）。
- 法令の識別には e-Gov の `law_id`（例 `129AC0000000089`）を使う。版は `law_revision_id`。
- 圧縮した JSON Lines は `.jsonl.gz`（gzip、1行1レコード）。
- 乱数を使う処理はすべて種を固定する（`mulberry32(20261008)`）。同じ入力から同じ出力が出ることを受け入れ条件にする。

## 条項の位置ID（pid）

全段で共通に使う、法令の中の位置の書き方。

- 文法: `<部>[.a<条>][.p<項>][.i<号>][.i<号の細分>…]`
- 部: `m` 本則、`e` 制定文、`s<k>` 附則（文書内の `SupplProvision` を出てきた順に 1 から数える）、`t<k>` 別表など（`AppdxTable`、`AppdxNote`、`AppdxStyle`、`AppdxFormat`、`AppdxFig`、`Appdx` をまとめて出てきた順に 1 から数える）。附則の中の別表は `s<k>.t<j>`。
- 条: XML の `Article@Num` をそのまま使う（`3`、`3_2`、`47_2_3`）。
- 項: `Paragraph@Num`（`1`、`2`…）。項番号のない第1項も `p1`。
- 号: `Item@Num`（`1`、`1_2`）。号の細分（`Subitem1`〜`Subitem10`）は、深さの順に `.i` を重ねる。`Subitem1@Num` が `1`（イ）なら `.i1`。
- 条のない法令は `m.p1` のように項から始める。
- 文の番号は pid とは別に持つ（`sent`、1 から）。参照の位置を表すときは `m.a3.p1#2` のように `#` で続けて書く。
- 例: 民法第三百九十八条の二第一項 → `m.a398_2.p1`。租税特別措置法施行令の最初の附則の第一条 → `s1.a1`。

## 文の取り出し規則（パイプラインと Web で同じ実装を使う）

API の JSON 木（`{tag, attr, children}`）と XML を同じ形に直してから、次の規則で文を取り出す。これを `shared/egov-tree.ts` の関数 `collectSentences(root: EgovNode, rootPid: string): SentenceOut[]` として1回だけ実装し、パイプラインと Web で共有する。

- 番地を持つ要素は `Article`、`Paragraph`、`Item`、`Subitem1`〜`Subitem10`。これらに入るたびに pid を伸ばす。
- `Sentence` 要素1つが文1つ。文の pid は、いちばん内側の番地を持つ祖先の pid。`sent` は、同じ pid を持つ文の中での文書順の番号（1 から）。表（`TableStruct`）や `Column` の中の `Sentence` も、外側の番地に属する文として数える。
- 文のテキストは、子孫の文字列を文書順につなげたもの。`Rt`（ルビの読み）の中身は捨て、`Ruby` の本体は残す。`Sup`、`Sub`、`Line` の中身は残す。XML の整形用の空白と改行（半角）は捨てる。全角空白は残す。NFKC などの正規化はしない（API の本文と1文字ずつ一致させるため）。
- `ArticleCaption`、`ParagraphCaption`、`ArticleTitle`、`ParagraphNum`、`ItemTitle` は文に含めない（見出しは別の欄に入れる）。
- 型:

```ts
// shared/egov-tree.ts
export type EgovNode = { tag: string; attr: Record<string, string>; children: (EgovNode | string)[] };
export type SentenceOut = { pid: string; sent: number; text: string; inTable: boolean };
export function collectSentences(root: EgovNode, rootPid: string): SentenceOut[];
// rootPid は root の位置。Article を渡すなら "m.a3"、MainProvision 全体なら "m"。
```

## パイプライン内部のデータ（store の `data/`）

置き場所は store（`/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/data/`）。生のZIPと展開したXMLは store に置かず、各VMの `/tmp/hourei-cache/` に置く。

### data/corpus/{snapshotId}/（作る人: m1-01）

- `manifest.json`: `{ snapshotId, egovAsof, createdAt, counts: { laws, current, notYetEffective, repealedMeta, sentences, articles }, shards: [{ path, laws, bytes, sha256 }] }`
- `laws.json`: `LawMeta[]`。施行中の全法令（9,015件前後）。順序は `lawId` の昇順。
- `repealed.json`: `LawMeta[]`。廃止・失効・失効扱いの法令（約561件）のメタデータだけ（本文なし）。参照先の解決にだけ使う。
- `text-{00..31}.jsonl.gz`: `CorpusLaw` を1行1法令で。シャードは `fnv1a32(lawId) % 32`。

```ts
// pipeline/lib/corpus-types.ts
export type LawStatus = 'current' | 'notYetEffective' | 'repealed';
export type Part = 'main' | 'enact' | 'appdx' | 'suppl' | 'supplAmend';

export interface LawMeta {
  lawId: string;
  revisionId: string;          // API の revision_info.law_revision_id（asof=snapshot 日付で取得したもの）
  title: string;               // 法令名
  kana: string;                // 法令名読み（ひらがな）
  abbrevs: string[];           // e-Gov の abbrev をカンマで分けたもの + XML の LawTitle@Abbrev
  oldTitles: string[];         // CSV の旧法令名（「、」区切り）
  num: string;                 // 法令番号（漢数字のまま）
  numNorm: string;             // 漢数字を算用数字にした法令番号（例 "平成15年法律第57号"）
  lawType: LawType;            // 下の LAW_TYPES の値。複合値は 'Misc'
  rawLawType: string;          // API の law_info.law_type そのまま
  category: string;            // e-Gov の分類名（50種）
  promulgationDate: string;    // YYYY-MM-DD
  enforcementDate: string | null;
  status: LawStatus;
  repealDate: string | null;
  articleCount: number;        // 本則の Article の数
  supplCount: number;          // SupplProvision の数
  hasEnact: boolean;
  source: 'zip' | 'api';
}

export interface TocEntry {     // 本則の編・章・節・款・目
  kind: 'Part' | 'Chapter' | 'Section' | 'Subsection' | 'Division';
  num: string;                 // 要素の Num 属性
  title: string;               // 「第二章　所得税法の特例」
  depth: number;               // 編=0 から
  firstArticle: string | null; // 含まれる最初の条の pid
  lastArticle: string | null;
}

export interface ArticleEntry {
  pid: string;                 // "m.a3_2", "s1.a1"
  part: Part;
  title: string;               // 「第三条の二」
  caption: string | null;      // 「（定義）」
  toc: number[];               // 祖先の TocEntry の添字（外側から）
}

export interface SentenceRec {
  pid: string; sent: number; part: Part; text: string; inTable: boolean;
  supplIndex: number | null;   // s<k> の k
  amendLawNum: string | null;  // 附則の AmendLawNum 属性
}

export interface CorpusLaw {
  meta: LawMeta;
  toc: TocEntry[];
  articles: ArticleEntry[];    // 本則・附則のすべての条を文書順に
  appdx: { pid: string; title: string }[]; // 別表等の見出し（「別表第一（第三条関係）」など）
  sentences: SentenceRec[];    // 文書順。制定文は part 'enact'、pid 'e'
}
```

- 附則の部の判定: `SupplProvision` に `AmendLawNum` 属性があれば `supplAmend`、なければ `suppl`。
- 法令番号の正規化（`numNorm`）: 漢数字（〇一二三四五六七八九十百千、「元」年は1）を算用数字にし、空白を除く。

### data/refs/{snapshotId}/（作る人: m1-02）

- `refs-{00..31}.jsonl.gz`: `Ref` を1行1参照。シャードは参照元の法令の `fnv1a32(lawId) % 32`。法令内の参照（前条、同項など）も含める。
- `abbrevs.jsonl.gz`: 本文から取り出した略称の定義 `{ lawId, pid, sent, abbr, targetLaw, scope }`。
- `law-features.jsonl`: 法令ごとの付加情報 `{ lawId, delegations, definedTerms, unresolvedMentions }`。`delegations` は本則と別表の中の「（政令|内閣府令|省令|主務省令|府令|規則|命令）で定める」の数。
- `stats.json`: 規則ごと・種類ごと・部ごとの件数、未解決の率、処理時間。
- `unresolved-sample.jsonl`: 未解決の言及から500件（種固定で抽出）。
- `manifest.json`: `{ snapshotId, corpusSha256, createdAt, files: [{ path, bytes, sha256 }] }`。最後に書く。これがなければ未完成。

```ts
// pipeline/lib/ref-types.ts
export type RefKind = 'basis' | 'implements' | 'amend' | 'junyo' | 'rei' | 'exclude' | 'term' | 'cite';
export type TargetStatus = 'current' | 'repealed' | 'amendingLaw' | 'self' | 'unknown';

export interface Ref {
  id: string;                  // `${srcLaw}:${srcPid}#${sent}:${start}`
  srcLaw: string; srcPid: string; sent: number; part: Part;
  start: number; end: number;  // 文の中のオフセット（言及の範囲。法令名から条項まで）
  mention: string;             // 文の text.slice(start, end)
  rawName: string | null;      // 法令名として書かれていた文字列（略称・「同法」などを含む）
  tgtLaw: string | null;       // 解決できた法令の lawId。改正法や不明は null
  tgtStatus: TargetStatus;
  tgtPid: string | null;       // 条項まで分かれば pid。法令単位なら null
  tgtEnd: string | null;       // 範囲指定（から…まで）の終わりの pid
  kind: RefKind;
  flags: number;               // REF_FLAGS のビット
  rule: string;                // 解決に使った規則ID（m1-02 の表記。例 "L1-number"）
  confidence: number;          // 0〜1
}
```

### data/eval/{snapshotId}/（作る人: m1-03）

- `gold/sentences.jsonl`、`gold/annotations.jsonl`、`gold/guideline.md`、`external/lawvis-pairs.csv`、`external/jlaw-pairs.csv`、`report.json`、`report.md`。形式は m1-03 の仕様に書く。

### data/graph/{snapshotId}/（作る人: m2-01）

- 中間ファイル（グラフ、レイアウトの途中経過、指標）。形式は m2-01 が自由に決めてよい。Web はここを読まない。

### data/web/{snapshotId}/（作る人: m2-01 の書き出し。読む人: Web）

下の「Web契約」の形で書き出す。デプロイのときに `web/public/data/{snapshotId}/` にコピーする。

### data/mock/{snapshotId}/（作る人: m2-02）

Web契約と同じ形の仮データ。`snapshotId` は `mock-20261008` とする。

## Web契約（公開URLの `/data/` 以下）

- `/data/latest.json`: `{ "contractVersion": 1, "snapshotId": "20261008", "dataPath": "/data/20261008/" }`。キャッシュしない（`Cache-Control: no-cache`）。
- `/data/{snapshotId}/` 以下のファイルは変更しない前提で、`Cache-Control: public, max-age=31536000, immutable` を付ける。
- ファイルはすべて JSON（Vercel が br/gzip で圧縮して返す）。バイナリは使わない。
- 初回に読むのは `manifest.json`、`laws.json`、`law-edges.json`、`continents.json`、`category-flows.json` の5つ。圧縮後の合計は 3MB 以内。`refs/{lawId}.json` は法令を選んだときに読む。
- `data/web/{snapshotId}/` 全体（展開時）は 150MB 以内。

`shared/contract.ts` には、次をそのまま書く（説明のコメントも含めて写してよい）。

```ts
// shared/contract.ts
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
```

## 条文本文の取得（Web）

- 本則の条: `GET https://laws.e-gov.go.jp/api/2/law_data/{revisionId}?law_full_text_format=json&elm=MainProvision-Article_{条}`。条のない法令は `elm=MainProvision-Paragraph_{項}`。版IDを固定するので、抽出したときと同じ本文が返る。
- 返ってきた `law_full_text` を `collectSentences(node, "m.a{条}")` に通し、`srcPid` と `#文番号` で文を特定する。言及の強調は、その文の中で `mention` を探して行う（オフセットは使わない。見つからなければ条全体から探し、それでもなければ強調なしで表示する）。
- 附則・別表・制定文の参照は `ctx` を表示し、全文は e-Gov の法令ページ `https://laws.e-gov.go.jp/law/{lawId}` へのリンクにする。

## 受け入れ条件

- `shared/` の4ファイルがこの文書のとおりに存在し、コピー先を含めて `tsc --noEmit` が通る。
- m1-01 の受け入れテストで、30条（無作為、種固定）について「XML から作った文」と「API の JSON から `collectSentences` で作った文」が1文字残らず一致する。
- m2-01 の書き出しと m2-02 の仮データの両方が `validate-web-data.ts` を通る。

## テスト方法

- 型: `npx tsc --noEmit`（`web` と `pipeline` の両方）。
- 契約の検査: `npx tsx lib/shared/validate-web-data.ts <データのディレクトリ>`（どちらのパッケージからでも実行できる）。zod で型を検査したうえで、配列の長さがすべて `n` と等しいこと、添字が範囲内にあること、並び順、`manifest.files` のサイズと sha256、初回読み込み5ファイルの gzip 後の合計が 3MB 以内であること、全体が 150MB 以内であることを確かめる。
