#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -x "$project_root/.venv/bin/uvicorn" ]]; then
  echo "Run 'make setup' first."
  exit 1
fi

"$project_root/.venv/bin/uvicorn" autoeval_api.main:app \
  --app-dir "$project_root/backend/src" --reload --port 8000 &
api_pid=$!

(cd "$project_root/frontend" && npm run dev) &
web_pid=$!

shutdown() {
  trap - EXIT INT TERM
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}

handle_interrupt() {
  shutdown
  exit 0
}

trap shutdown EXIT
trap handle_interrupt INT TERM

wait "$api_pid" "$web_pid"
