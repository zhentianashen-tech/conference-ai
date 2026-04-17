#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node.js 18+ first."
  exit 1
fi

if [[ ! -f "index-v3.js" ]]; then
  echo "index-v3.js not found in $ROOT_DIR"
  exit 1
fi

echo "Starting Conference Assistant v3 web app..."
echo "UI: http://localhost:${UI_PORT:-3456}"

exec node index-v3.js "$@"
