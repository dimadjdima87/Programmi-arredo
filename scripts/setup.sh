#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python -m venv .venv
.venv/bin/pip --cache-dir /tmp/albertelli-pip-cache install -r backend/requirements.lock
npm --prefix frontend ci --cache /tmp/albertelli-npm-cache
npm --prefix frontend run build
npm --prefix frontend run typecheck
