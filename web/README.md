# hourei-atlas-web

法令アトラスの Web（Next.js 16.4.4）。セットアップと公開の手順はリポジトリ直下の [README.md](../README.md) を見てください。

仮データは `public/data/mock-20261008/`。共有コードの正本は `../shared/`。コピーは `npm run sync:shared`。

```bash
npm ci
npm run lint:motion
npm test
npm run build
```

本番スナップショットを載せるときは、Context の `data/` を `HOUREI_STORE` に指してから:

```bash
export HOUREI_STORE=/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3
npm run data:copy -- --snapshot 20261009
```
