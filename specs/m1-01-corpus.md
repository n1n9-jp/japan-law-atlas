---
cursor:
  subagentId: "bc-4df76127-d762-50d3-a46d-8b372c20ac50"
---

# M1-01 コーパスの取得と正規化

## 目的

施行中の全法令（約9,015件）の本文を e-Gov から取り、条文の木を「文」の単位に直した正規化コーパスを store に置く。後の抽出器、評価、Web の本文表示が、同じ文の切り方と同じ位置ID（pid）を使えるようにする。

## 並行性と依存

- 前提: `00-data-contract.md`、`verified-facts.md`、`README.md`（作業ルール）。
- すぐに着手できる。m1-02（抽出器）、m1-03（評価）、m2-02（UI）と並行して進める。
- 最初の成果物として `shared/egov-tree.ts`（文の取り出し規則）を作って store に置く。m1-02 と m2-02 がこれを使う。目安として、着手してから最初の同期のときに置く。
- 次に `data/corpus/{snapshotId}/` を置いたら、coordinator に知らせる（m1-02 と m1-03 の後半がこれを待っている）。

## 入力

- 一括XML: `https://laws.e-gov.go.jp/bulkdownload?file_section=1&only_xml_flag=true` を `/tmp/hourei-cache/egov/{snapshotId}/all_xml.zip` に保存する。
- 法令一覧: `GET https://laws.e-gov.go.jp/api/2/laws?asof={YYYY-MM-DD}&repeal_status=None&limit=1000&offset=…` を全ページ。`asof` はスナップショットの日付。
- 廃止法令の一覧: 同じ API で `repeal_status=Repeal`、`Expire`、`LossOfEffectiveness` を全ページ（本文は取らない）。
- 足りない本文: `GET https://laws.e-gov.go.jp/api/2/law_file/xml/{law_revision_id}`。

## 出力

- `shared/egov-tree.ts`（00 の仕様どおり）。
- `pipeline/` のコーパス関係のコード（`pipeline/src/corpus/`）とテスト。
- `data/corpus/{snapshotId}/manifest.json`、`laws.json`、`repealed.json`、`text-00.jsonl.gz`〜`text-31.jsonl.gz`。
- `data/corpus/LATEST`（`snapshotId` を1行）。
- `data/corpus/{snapshotId}/report.md`（件数、足りなかった法令と補った方法、処理時間、既知の問題）。

## 決めた手法

1. スナップショットの日付を日本時間の今日に決める。ZIP と API の一覧は同じ日に取る。
2. API の一覧（`repeal_status=None`）を「対象の法令」とする。各法令の `revision_info.law_revision_id` が使う版。`law_info.law_type` が `LAW_TYPES` にない複合値なら `lawType: 'Misc'`。`current_revision_status` が `UnEnforced` なら `status: 'notYetEffective'`、それ以外は `current`。
3. ZIP の中のフォルダ名は版IDなので、`law_revision_id` と一致するXMLを使う（`source: 'zip'`）。ZIP にない版は `law_file/xml/{law_revision_id}` で取る（`source: 'api'`、1秒に2件まで、失敗したら5回まで指数的に待って再試行）。
4. CSV の `旧法令名` を `oldTitles` に入れる。`法令名読み` が API の `law_title_kana` と違うときは API を採る。
5. XML の解析は `htmlparser2`（`xmlMode: true`）で DOM を作り、00 の `EgovNode` の形（API の JSON と同じ形）に直す。直した木を `collectSentences` に通して文を取り出す。こうすると Web が API から取る本文と同じ切り方になる。
6. 部の判定: `EnactStatement` → `enact`（pid は `e`、文は `EnactStatement` の文字列全体を1文とする。`collectSentences` は使わない）。`MainProvision` → `main`。`SupplProvision` は `AmendLawNum` の有無で `supplAmend` / `suppl`。別表など → `appdx`（`AppdxTable` などの中の `Sentence` を文として取る。見出しは `appdx[].title` に入れる）。
7. 目次（`TOC`）は使わず、本文の `Part`、`Chapter`、`Section`、`Subsection`、`Division` から `toc` を作る。
8. `articleCount` は `MainProvision` の中の `Article` の数。
9. 法令番号の正規化（`numNorm`）は 00 の規則どおり。漢数字の変換は `pipeline/src/lib/kansuji.ts` に1か所だけ実装し、m1-02 も使う。
10. 書き出し: `laws.json` は `LawMeta[]` を `lawId` 順に。本文は 32 シャードの gzip JSON Lines。`manifest.json` に件数とシャードごとの sha256 を書く。
11. 処理は Node 22 と `tsx` で動かす。メモリは 4GB 以内（法令を1つずつ処理し、木は使い終わったら捨てる）。

## 受け入れ条件

- 対象の法令の 100% に本文がある（ZIP か API のどちらか）。足りないものは `report.md` に理由とともに列挙する。
- 件数の検算: 本則の条の合計が 242,823 ± 1%、附則の数が 160,987 ± 1%（2026-10-08 の実測値。日付が違えば差を `report.md` に書く）。
- 文の一致テスト: 種固定で選んだ30条（本則に条がある法令から。附則は対象外）について、版IDを指定して API から JSON を取り、`collectSentences` の結果がコーパスの文と完全に一致する。
- 決定性: 同じ ZIP と一覧から2回作ったとき、シャードの sha256 がすべて一致する。
- 処理時間: ZIP を取ったあと、全件の正規化が 15分以内（このVMで）。
- store の `data/corpus/{snapshotId}/` の合計が 200MB 以内。

## テスト方法

- 単体テスト（vitest、`pipeline/test/corpus/`）:
  - `collectSentences`: ルビ（`Ruby`/`Rt`）、`Sup`、表の中の文、`Column`、号の細分（`Subitem1`〜）、条のない法令（`m.p1`）、枝番号（`3_2`）を含む小さな XML 断片を、手で書いた期待値と比べる。
  - 漢数字: 「元」「十」「二十三」「百二」「千九百」「〇」の変換。
  - 部の判定: `AmendLawNum` ありの附則、附則の中の別表、制定文。
- 結合テスト: 民法（`129AC0000000089`）、租税特別措置法施行令（`332CO0000000043`）、明治五年太政官布告第三百三十七号（`105DF0000000337`、条のない法令）の3件について、条の数、最初と最後の pid、制定文の有無を確かめる。
- API との一致テスト（ネットワークを使う。`npm run test:api`）: 上の30条。
- `npx tsc --noEmit`。
