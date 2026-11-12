---
cursor:
  subagentId: "bc-4df76127-d762-50d3-a46d-8b372c20ac50"
---

# 法令アトラス 実装仕様の索引と作業ルール

計画書は `docs/plan.md`。ここにあるのは実装担当向けの仕様。1ファイルが1つの作業単位。判断が必要なところは仕様の中で決めてある。仕様と違うことをしたくなったら、先に coordinator に理由を添えて相談する。

## 仕様の一覧

- `00-data-contract.md` データ仕様（パイプライン内部とWebの契約、条項の位置ID、文の切り方）。全員が読む。
- `verified-facts.md` 計画の前に実測した e-Gov・lawvis・JLaw・Vercel・npm の事実。全員が読む。
- M1 データ基盤と抽出器
  - `m1-01-corpus.md` コーパスの取得と正規化
  - `m1-02-extractor.md` 参照抽出器 v1
  - `m1-03-gold-eval.md` ゴールドセットと評価（lawvis・JLaw との突き合わせ）
- M2 アトラス v1 の公開
  - `m2-01-graph-layout.md` グラフ構築・指標・レイアウト・配信データの書き出し
  - `m2-02-atlas-ui.md` アトラス v1 の UI
  - `m2-03-deploy.md` Vercel への公開と外部からの確認
- M3〜M5 の仕様は、M2 が公開できた時点で、M2 の結果を見てから書く。

## 依存関係と起動の順番

最初に同時に起動する4つ:

- A: `m1-01-corpus.md`
- B: `m1-02-extractor.md`（コーパスができるまでは規則と単体テストを先に作る）
- C: `m1-03-gold-eval.md`（コーパスができるまでは外部データ・手引き・評価スクリプトを先に作る）
- D: `m2-02-atlas-ui.md` と続けて `m2-03-deploy.md`（仮データで進め、`VERCEL_TOKEN` があれば仮データのまま1回目を公開）

あとから起動する:

- E: `m2-01-graph-layout.md` は、B が全件の参照を最初に出力したら起動する。
- C の二重注釈の2人目は、C が `gold/second-pass-input.jsonl` を用意したら、coordinator が別のモデルで起動する。
- D は、E が `data/web/{snapshotId}/` を書き出したら、本物のデータに切り替えて受け入れテストと公開をやり直す。

待ち合わせ:

- A → B、C: `shared/egov-tree.ts` と `data/corpus/{snapshotId}/`。
- B → C: `data/refs/{snapshotId}/`（評価の実行）。
- B → E: 同上。
- C → E: `data/eval/{snapshotId}/report.json`（`manifest.eval` に入れる。なくても書き出しはできる）。
- D → 全員: `shared/contract.ts`、`contract-schema.ts`、`validate-web-data.ts`。
- E → D: `data/web/{snapshotId}/`。

## store の使い方

store の場所: `/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3`（以下 `$STORE`）。

```text
shared/      共有コードの正本（contract.ts, contract-schema.ts, validate-web-data.ts, egov-tree.ts）
pipeline/    パイプライン（Node 22 + TypeScript + tsx）
  src/corpus/  m1-01    src/extract/  m1-02    src/eval/  m1-03    src/graph/  m2-01
  src/lib/     共通の小物（kansuji.ts は m1-01）
  lib/shared/  shared/ のコピー
  test/        担当ごとのサブディレクトリ（test/corpus/ など）
web/         Next.js（m2-02、m2-03）
$STORE/data/corpus/ m1-01   data/refs/ m1-02   data/eval/ m1-03   data/graph/ data/web/ m2-01   data/mock/ m2-02
$STORE/media/m2/        レビュー用の画像
```

- ソースの正本は GitHub リポジトリ（`web/` `pipeline/` `shared/`）。生成データは `$STORE/data/`。作業コピーは各VMの `~/work/`。
- 持ち場の外のファイルは store に戻さない。`pipeline/package.json` は m1-01 が作る。ほかの担当が依存を足すときは、戻す直前に store の最新を読み直してから足す（ほかの人の追加を消さない）。
- `node_modules`、`.next`、ZIP、展開した XML、キャッシュは store に置かない。キャッシュは `/tmp/hourei-cache/`。
- 生成データは、コマンドの出力先として store の `data/` に直接書いてよい（自分の持ち場のディレクトリだけ）。大きいファイルは `/tmp` で作ってから写してもよい。どちらの場合も、写した先の大きさと sha256 を確かめ、そのディレクトリの `manifest.json` を最後に書く。読む側は `manifest.json` がないディレクトリを未完成として扱う。
- 区切りごと（少なくとも1時間に1回）に store へ戻す。VM が消えても作業が残るように。

## パイプラインのパッケージ（m1-01 が最初に作る）

- `pipeline/package.json`: `"type": "module"`、`engines.node >= 22`。依存: htmlparser2、domhandler、graphology、graphology-metrics、graphology-communities-louvain、graphology-layout-forceatlas2、graphology-layout-noverlap、d3-contour、polylabel、culori、zod、@napi-rs/canvas。開発依存: typescript、tsx、vitest、@types/node。
- スクリプト: `corpus`、`extract`、`eval`、`graph`、`export`、`test`、`test:api`、`typecheck`、`sync:shared`、`check:shared`。それぞれ `tsx src/<段>/cli.ts` を呼ぶ。引数は `--snapshot {snapshotId}`（省略時は `data/corpus/LATEST`）と `--store <path>`（省略時は上の `$STORE`）。
- `tsconfig.json`: `strict: true`、`module: "NodeNext"`。

## コードの書き方

- TypeScript の strict。`any` を使わない。
- 外から来たデータ（API の応答、ファイル）は zod で検査してから使う。
- 乱数は `mulberry32(20261008)`（`pipeline/src/lib/random.ts` と `web/lib/random.ts`）。
- コメントは、コードから読み取れない制約だけを書く。何をしているかの説明は書かない。
- e-Gov への問い合わせは1秒に2件まで。失敗したら 1, 2, 4, 8, 16 秒待って5回まで再試行。

## 報告

- 各担当は、仕様の「受け入れ条件」を1つずつ確かめ、結果（数値と、確かめたコマンド）を `internal/reports/{仕様のファイル名}.md` に書いて、coordinator に要点だけ送る。
- 受け入れ条件に届かないものがあれば、届かない理由と、次に何をすれば届くかを書く。黙って条件を緩めない。
