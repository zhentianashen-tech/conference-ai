#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3 first."
  exit 1
fi

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

echo "Starting GLM ASR server..."
echo "Model: ${GLM_ASR_MODEL:-mlx-community/GLM-ASR-Nano-2512-4bit}"
echo "Host: ${GLM_ASR_HOST:-127.0.0.1}"
echo "Port: ${GLM_ASR_PORT:-8765}"

exec python3 scripts/glm-asr-server.py
