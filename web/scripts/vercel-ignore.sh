#!/usr/bin/env bash
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
[[ -n "$prev" ]] || exit 1
git cat-file -e "${prev}^{commit}" 2>/dev/null || exit 1
git diff --quiet "$prev" HEAD -- . && exit 0
exit 1
