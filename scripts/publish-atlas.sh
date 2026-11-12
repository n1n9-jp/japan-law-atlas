#!/usr/bin/env bash
# 法令アトラスを Vercel 本番（hourei-atlas）へ再公開する。
# 使い方:
#   VERCEL_TOKEN=… ./scripts/publish-atlas.sh
#   VERCEL_TOKEN=… ./scripts/publish-atlas.sh --snapshot 20261009
# 作業コピーは ~/work/web。リポジトリの web/ からコピーする。.vercel/ は VM だけ。
# GitHub からの自動公開への切り替えは、このスクリプトの対象外。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
STORE="${HOUREI_STORE:-${STORE:-/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3}}"
WORK="${WORK:-$HOME/work/web}"
SCOPE="n1n9jps-projects"
PROJECT="hourei-atlas"
SNAPSHOT="mock-20261008"
SKIP_CHECKS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot) SNAPSHOT="$2"; shift 2 ;;
    --store) STORE="$2"; shift 2 ;;
    --work) WORK="$2"; shift 2 ;;
    --skip-checks) SKIP_CHECKS=1; shift ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "VERCEL_TOKEN がありません。Cloud Agents の Secrets にチーム n1n9jps-projects のトークンを入れてください。" >&2
  exit 1
fi

SRC="$REPO/web"
if [[ ! -f "$SRC/package.json" ]]; then
  echo "UI ソースがありません: $SRC" >&2
  exit 1
fi

copy_src() {
  local tmp
  tmp="$(mktemp -d)"
  if [[ -d "$WORK/.vercel" ]]; then
    cp -a "$WORK/.vercel" "$tmp/.vercel"
  fi
  rm -rf "$WORK"
  mkdir -p "$(dirname "$WORK")"
  cp -a "$SRC" "$WORK"
  rm -rf "$WORK/node_modules" "$WORK/.next" "$WORK/.vercel"
  if [[ -d "$tmp/.vercel" ]]; then
    cp -a "$tmp/.vercel" "$WORK/.vercel"
  fi
  rm -rf "$tmp"
}

echo "== copy $SRC -> $WORK"
copy_src

cd "$WORK"
export STORE
export HOUREI_STORE="$STORE"

echo "== install"
if ! npm ci; then
  echo "npm ci が lockfile 不一致で失敗したので npm install にフォールバックします（リポジトリの lockfile は書き換えません）"
  npm install
fi

# /about がビルド時に public/data/{snapshot}/manifest.json を読むので、data:copy を先に行う。
echo "== data:copy --snapshot $SNAPSHOT"
npm run data:copy -- --snapshot "$SNAPSHOT"

if [[ "$SKIP_CHECKS" -eq 0 ]]; then
  echo "== lint:motion / test / build"
  npm run lint:motion
  npm test
  npm run build
fi

if [[ ! -f "$WORK/.vercel/project.json" ]]; then
  echo "== vercel link"
  npx --yes vercel@latest link --yes --project "$PROJECT" --scope "$SCOPE" --token "$VERCEL_TOKEN"
fi

echo "== project inspect (Node は 22.x であること)"
npx --yes vercel@latest project inspect "$PROJECT" --scope "$SCOPE" --token "$VERCEL_TOKEN"
node_ver="$(npx --yes vercel@latest api "/v9/projects/$PROJECT" --scope "$SCOPE" --token "$VERCEL_TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("nodeVersion",""))')"
if [[ "$node_ver" != "22.x" ]]; then
  echo "Node が $node_ver なので 22.x に直します"
  python3 - <<'PY' > /tmp/hourei-project-patch.json
import json
print(json.dumps({"nodeVersion": "22.x"}))
PY
  npx --yes vercel@latest api "/v9/projects/$PROJECT" --method PATCH --scope "$SCOPE" --token "$VERCEL_TOKEN" --input /tmp/hourei-project-patch.json
fi

echo "== deploy --prod --archive=tgz"
deploy_out="$(mktemp)"
npx --yes vercel@latest deploy --prod --yes --archive=tgz --scope "$SCOPE" --token "$VERCEL_TOKEN" | tee "$deploy_out"
eval "$(python3 - "$deploy_out" <<'PY'
import json, re, sys
text = open(sys.argv[1]).read()
url, dep_id = "https://hourei-atlas.vercel.app", ""
for m in re.finditer(r"\{[\s\S]*\}", text):
    try:
        obj = json.loads(m.group())
    except json.JSONDecodeError:
        continue
    dep = obj.get("deployment") if isinstance(obj, dict) else None
    if dep:
        url = dep.get("productionUrl") or url
        dep_id = dep.get("id") or ""
print(f"prod_url={json.dumps(url)}")
print(f"dep_id={json.dumps(dep_id)}")
PY
)"
rm -f "$deploy_out"
if [[ -z "${prod_url:-}" ]]; then
  prod_url="https://hourei-atlas.vercel.app"
fi

mkdir -p "$STORE/data/web"
python3 - <<PY
import json, datetime
from pathlib import Path
p = Path("$STORE/data/web/deployments.jsonl")
rec = {
  "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "snapshotId": "$SNAPSHOT",
  "url": "$prod_url",
  "deploymentId": "${dep_id:-}",
}
with p.open("a") as f:
    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
print("logged", rec)
PY

echo "== curl 確認 $prod_url"
code="$(curl -sS -o /dev/null -w '%{http_code}' "$prod_url/")"
echo "GET / $code"
if [[ "$code" != "200" ]]; then
  echo "本番エイリアスが 200 ではありません" >&2
  exit 1
fi
loc="$(curl -sS -o /dev/null -D - --max-redirs 0 "$prod_url/" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
if [[ "$loc" == *vercel.com/sso-api* ]]; then
  echo "SSO に飛ばされています。本番エイリアスではありません。" >&2
  exit 1
fi
echo "done: $prod_url  snapshot=$SNAPSHOT"
echo "共有するのは本番エイリアスだけ（*-n1n9jps-projects.vercel.app は渡さない）"
