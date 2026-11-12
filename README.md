# 法令アトラス

日本の施行中の全法令（約 9,015 件）を、参照関係でつながった 1 枚の地図として見る Web 作品です。分野の大陸、参照の種類、その場で読める条文本文を一つの画面にまとめています。

公開 URL: [https://hourei-atlas.vercel.app](https://hourei-atlas.vercel.app)

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `web/` | Next.js 16.4.5 のサイト（deck.gl） |
| `pipeline/` | コーパス・参照抽出・評価・グラフ・配信データの作成 |
| `shared/` | Web とパイプラインが共有する契約・スキーマ・文の取り出し |
| `scripts/` | 非常用の公開スクリプト（`publish-atlas.sh`） |
| `docs/` | 計画と先行事例 |
| `specs/` | 実装仕様 |

生 XML、コーパス、抽出結果などの中間データは Git に入れていません。正本は Cursor Project の Context です。配信データ `web/public/data/` だけはリポジトリに入れます（いまのスナップショットは `20261009`）。これは e-Gov 法令検索の法令データを法令アトラスが加工したものです（出典は下の「出典」）。

```
/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/data/
  corpus/  refs/  eval/  graph/  web/  mock/
```

パイプラインと `web` の `data:copy` は、環境変数 `HOUREI_STORE`（なければ `STORE`）でこの場所を指します。省略時の既定値も同じパスです。

## セットアップ

Node.js 22 が必要です。リポジトリには本番の配信データ（`web/public/data/20261009/`）が入っています。軽く試すなら `npm run data:copy -- --snapshot mock-20261008`（コミットしない）。

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
npm run data:copy -- --snapshot 20261009 --validate
```

`data/web/{id}/refs` が欠けるときは、`data/graph/{id}/web.tar.gz` を展開したものを使います（`data:copy` が自動で試します）。検査は `--validate` を付けたときだけです。

各段の入出力と受け入れ条件は `specs/` にあります。

## 公開手順

本番は Vercel プロジェクト `hourei-atlas`（チーム `n1n9jps-projects`）です。GitHub リポジトリ `n1n9-jp/japan-law-atlas` の `main` に push すると、Vercel が自動で本番 `https://hourei-atlas.vercel.app` を更新します。Root Directory は `web`。ビルドは `npm run build:vercel`（本番ガードのあと `next build`）。新しい環境変数は要りません。

共有するのは本番エイリアス `https://hourei-atlas.vercel.app` だけです。デプロイ固有 URL や `*-n1n9jps-projects.vercel.app` はチーム保護でログイン画面に飛びます。Preview の URL も渡さないでください。

`main` への直接 push がそのまま本番になります。ブランチ保護は付けていません。`web/` の外だけを変えたコミットでは、Vercel はビルドを省きます。

### 配信データの更新

1. 上の「データの作り方」で Context に `data/web/<id>/` と `data/graph/<id>/web.tar.gz` を作る。
2. `git checkout -b cursor/data-<id>-<suffix> origin/main && cd web && npm ci`
3. `HOUREI_STORE=/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3 npm run data:copy -- --snapshot <id> --validate`
4. `VERCEL_ENV=production npm run check:deploy-data && npm test && npm run build`
5. `git add -A public/data && git commit -m "配信データを <id> に更新"`。`git status --porcelain` が空であること（データ以外は入れない）。
6. push して PR を作る。Preview が `READY` になったら、中身は `npx vercel@latest curl /data/latest.json --deployment <url>` で見る。マージすると本番に自動で出る。`npm run verify:prod -- --url https://hourei-atlas.vercel.app` で確かめる。

古いスナップショットは同じコミットで消えます。開いたままのタブが古い `dataPath` の `refs` を読むと 404 になります。

### 本番を戻す

本番ビルドが失敗したときは、前の本番がそのまま残ります。出たあとで壊れていたときは、一つ前の本番デプロイに戻します。

```bash
npx vercel@latest rollback <前の本番のデプロイ ID> --scope n1n9jps-projects --token "$VERCEL_TOKEN"
```

戻すと、Vercel は以後の push を本番に自動で割り当てなくなります。直したコミットを `main` に push し、そのデプロイが `READY` になったら `npx vercel@latest promote <デプロイ ID> --scope n1n9jps-projects --token "$VERCEL_TOKEN"` で本番に上げます。これで自動公開も元に戻ります。

### 非常用の CLI デプロイ

Git 連携が壊れたときだけ使います。次の `main` への push で上書きされます。

```bash
export VERCEL_TOKEN=…          # チーム n1n9jps-projects のトークン
export HOUREI_STORE=/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3
./scripts/publish-atlas.sh --emergency-cli --snapshot 20261009
```

引数なしで実行すると案内を出して止まります。

## 出典

- 出典: [e-Gov 法令検索](https://laws.e-gov.go.jp/)（デジタル庁）の法令データ（2026年10月9日時点のものを取得）、[公共データ利用規約（第1.0版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)（PDL1.0）。
- `web/public/data/` の配信 JSON（法令の一覧、参照関係、位置、条文の言及）とサイトの地図は、上の法令データをもとに法令アトラス（[n1n9-jp/japan-law-atlas](https://github.com/n1n9-jp/japan-law-atlas)）が加工して作成したものです。国やデジタル庁が作成した未加工のデータではありません。参照関係は機械的に抽出したもので、誤りを含むことがあります。正確な条文は e-Gov 法令検索や官報で確かめてください。
- 略称・別名辞書は [JLaw-CiteGraph](https://github.com/yabooung/jp-law-citation-graph)（Apache License 2.0）のソースを `pipeline/vendor/jlawcite/` に置いて使っています。JLaw プロジェクト全体の評価データは CC BY 4.0 です。

## ライセンス

このリポジトリ本体のライセンスは未決です。第三者由来のファイル（JLaw-CiteGraph の辞書、e-Gov 由来データ）は、それぞれのライセンスと利用規約に従ってください。
