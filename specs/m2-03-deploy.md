---
cursor:
  subagentId: "bc-4df76127-d762-50d3-a46d-8b372c20ac50"
---

# M2-03 Vercel への公開と外部からの確認

## 目的

アトラスを既存の Vercel チームの新しいプロジェクトに公開し、認証なしで外部から開ける本番URLを渡す。マイルストーンごとに同じ手順で更新する。

## 並行性と依存

- 担当: m2-02（UI）の担当が続けて行う。
- 前提: 環境変数 `VERCEL_TOKEN`（下の「ユーザーにお願いすること」）。これがないと公開できない。ないときは、公開以外を終えたうえで coordinator に「`VERCEL_TOKEN` 待ち」と報告する。MCP の `create_deployment` で代わりにやろうとしない（データが数十MBあり、引数に書けない）。
- 仮データの段階で1回目を公開してよい（早く URL を渡すため）。

## ユーザーにお願いすること（coordinator 経由）

- Vercel のアクセストークンを作り、Cursor のダッシュボード（Cloud Agents → Secrets）に `VERCEL_TOKEN` として追加してもらう。スコープはチーム `n1n9jps-projects`（ID `team_tR0SdGrqjRVReiZNOCkzBGdU`）。

## 決めたこと

- プロジェクト名: `hourei-atlas`。フレームワーク: Next.js。Node: 22.x。ルートディレクトリ: アップロードする `web` そのもの。
- 公開するもの: `web/` 一式（`node_modules`、`.next` を除く）と、`public/data/{snapshotId}/`、`public/data/latest.json`。ビルドは Vercel 上で行う（`next build`）。
- データのコピー: `npm run data:copy -- --snapshot {snapshotId}` で store の `data/web/{snapshotId}/`（仮データなら `data/mock/mock-20261008/`）を `public/data/` にコピーし、`latest.json` を書く。古いスナップショットは `public/data/` に残さない。
- キャッシュ: `next.config.ts` の `headers()` で、`/data/:snapshot/:path*` に `Cache-Control: public, max-age=31536000, immutable`、`/data/latest.json` に `Cache-Control: no-cache`。
- 共有するURL: 本番のエイリアス（`hourei-atlas.vercel.app`。取れなければ Vercel が付けた `hourei-atlas-xxxx.vercel.app`）。デプロイ固有のURLや `*-n1n9jps-projects.vercel.app` は、チームの保護で Vercel のログイン画面に飛ばされるので渡さない。
- チームやプロジェクトの保護の設定は変えない。

## 手順

1. `cd ~/work/web`（作業用のコピー。README の作業ルール）。
2. `npm ci && npm run lint:motion && npm test && npm run build`（ローカルで通ることを確かめる）。
3. `npm run data:copy -- --snapshot {snapshotId}`。
4. 初回だけ: `npx vercel@latest link --yes --project hourei-atlas --scope n1n9jps-projects --token "$VERCEL_TOKEN"`。プロジェクトがなければ作られる。作られたら `npx vercel@latest project inspect hourei-atlas --scope n1n9jps-projects --token "$VERCEL_TOKEN"` で Node の版とフレームワークを確かめ、違えば直す。
5. `npx vercel@latest deploy --prod --yes --archive=tgz --scope n1n9jps-projects --token "$VERCEL_TOKEN"`。
6. 本番のエイリアスを調べる（MCP の `get_project` に `idOrName: "hourei-atlas"`、`teamId` は付けない。`domains` の中の `*.vercel.app` で、`-n1n9jps-projects` を含まないもの）。
7. 外部からの確認（下の受け入れ条件）を行う。
8. `.vercel/project.json` は store に同期しない（ローカルだけ）。プロジェクトIDは `data/web/deployments.jsonl` に `{ at, snapshotId, url, deploymentId }` として1行ずつ残す。

## 受け入れ条件

- 認証なしの `curl -s -o /dev/null -w "%{http_code}" https://{エイリアス}/` が 200。リダイレクト先が `vercel.com/sso-api` ではない。
- `https://{エイリアス}/data/latest.json` が 200 で、`dataPath` の `manifest.json` が 200、`content-type` が `application/json`。`Accept-Encoding: br` を付けたとき `content-encoding: br`（か gzip）。
- `manifest.json` の `cache-control` に `immutable` が含まれる。
- 公開URLに対して m2-02 の E2E が通る（Playwright の `baseURL` を公開URLにする）。本物のデータのときは、民法の詳細パネルで参照箇所の本文が e-Gov から出ることも確かめる。
- `atlas:first-frame` までの時間を公開URLで3回測り、中央値を報告する（目安 2.5秒以内）。
- coordinator への報告に、本番URL、スナップショットID、仮データか本物か、上の確認の結果を書く。

## テスト方法

- 上の `curl` と Playwright を `npm run verify:prod -- --url https://{エイリアス}` にまとめる。
