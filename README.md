# 法令アトラス

日本の施行中の全法令（約 9,015 件）を、参照関係でつながった 1 枚の地図として見る Web 作品です。分野の大陸、参照の種類、その場で読める条文本文を一つの画面にまとめています。

公開 URL: [https://hourei-atlas.vercel.app](https://hourei-atlas.vercel.app)

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `web/` | Next.js 16.4.4 のサイト（deck.gl） |
| `pipeline/` | コーパス・参照抽出・評価・グラフ・配信データの作成 |
| `shared/` | Web とパイプラインが共有する契約・スキーマ・文の取り出し |
| `scripts/` | 公開スクリプト（`publish-atlas.sh` など） |
| `docs/` | 計画と先行事例 |
| `specs/` | 実装仕様 |

生成データ（生 XML、コーパス、参照、配信 JSON）は Git に入れていません。正本は Cursor Project の Context です。

```
/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/data/
  corpus/  refs/  eval/  graph/  web/  mock/
```

パイプラインと `web` の `data:copy` は、環境変数 `HOUREI_STORE`（なければ `STORE`）でこの場所を指します。省略時の既定値も同じパスです。

## セットアップ

Node.js 22 が必要です。リポジトリに入っている仮データ（`web/public/data/mock-20261008/`）だけでサイトはビルドできます。

```bash
cd web
npm ci
npm test
npm run build
npm run dev
```

パイプラインの単体テスト:

```bash
cd pipeline
npm ci
npm test
```

共有コードを変えたら、各パッケージでコピーを揃えます。

```bash
cd web && npm run sync:shared
cd ../pipeline && npm run sync:shared
```

## データの作り方

本番用データは Context の `data/` に書き出します。e-Gov への問い合わせは 1 秒に 2 件までです。キャッシュは `/tmp/hourei-cache/`。

```bash
export HOUREI_STORE=/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3
cd pipeline
npm ci
npm run corpus -- --snapshot 20261009
npm run extract -- --snapshot 20261009
npm run eval -- --snapshot 20261009
npm run graph -- --snapshot 20261009
npm run export -- --snapshot 20261009
```

Web に載せる:

```bash
export HOUREI_STORE=/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3
cd web
npm run data:copy -- --snapshot 20261009
```

`data/web/{id}/refs` が欠けるときは、`data/graph/{id}/web.tar.gz` を展開したものを使います（`data:copy` が自動で試します）。検査は `--validate` を付けたときだけです。

各段の入出力と受け入れ条件は `specs/` にあります。

## 公開手順

いまの本番は Vercel プロジェクト `hourei-atlas` の手動デプロイです。このリポジトリからの自動公開への切り替えは、別作業です。

```bash
export VERCEL_TOKEN=…          # チーム n1n9jps-projects のトークン
export HOUREI_STORE=/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3
./scripts/publish-atlas.sh --snapshot 20261009
```

共有するのは本番エイリアス `https://hourei-atlas.vercel.app` だけです。デプロイ固有 URL や `*-n1n9jps-projects.vercel.app` はチーム保護でログイン画面に飛びます。

## 出典

- 法令の本文と識別子は [e-Gov 法令検索](https://laws.e-gov.go.jp/) の法令データ（公共データ利用規約）を加工して作成しています。
- 略称・別名辞書は [JLaw-CiteGraph](https://github.com/yabooung/jp-law-citation-graph)（Apache License 2.0）のソースを `pipeline/vendor/jlawcite/` に置いて使っています。JLaw プロジェクト全体の評価データは CC BY 4.0 です。

## ライセンス

このリポジトリ本体のライセンスは未決です。第三者由来のファイル（JLaw-CiteGraph の辞書、e-Gov 由来データ）は、それぞれのライセンスと利用規約に従ってください。
