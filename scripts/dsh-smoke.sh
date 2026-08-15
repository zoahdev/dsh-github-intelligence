#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
WEB_PID=""

cleanup() {
  if [ -n "$WEB_PID" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

export DSH_HOME="$TMP/dsh-home"

echo "== pack =="
cd "$ROOT"
pnpm pack --pack-destination "$TMP" >/dev/null
TGZ="$(ls "$TMP"/*.tgz | head -n 1)"
echo "tarball: $TGZ"

echo "== install packed plugin into a fresh DSH profile =="
pnpm dlx @deepseek-ai/dsh plugin --profile web add "$TGZ"

echo "== verify plugin row in composed config =="
pnpm dlx @deepseek-ai/dsh --profile web --dump-config | grep -q 'github-intelligence'
echo "PASS plugin appears in DSH config"

echo "== boot dsh web (bounded retry, 40s cap) =="
pnpm dlx @deepseek-ai/dsh web --port 4111 >"$TMP/web.log" 2>&1 &
WEB_PID=$!

ready=0
for _ in $(seq 1 40); do
  if curl -sf http://127.0.0.1:4111 >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "FAIL dsh web did not become ready within 40s"
  cat "$TMP/web.log"
  exit 1
fi

echo "PASS dsh web booted with the plugin loaded (HTTP 200)"
