#!/usr/bin/env bash
#
# Nightly verification for kairo-code-desktop.
#
# Runs the full gate end-to-end, including the real-LLM (智谱 GLM-5.1) crew
# tests. Writes a timestamped log to logs/ and exits non-zero if any step fails,
# so it can be wired to cron/launchd/CI.
#
# Usage:
#   bash scripts/nightly.sh            # full run incl. live GLM tests
#   SKIP_LIVE=1 bash scripts/nightly.sh  # skip the real-LLM steps
#
# Live tests read credentials from .env (OPENAI_API_KEY / OPENAI_BASE_URL /
# OPENAI_MODEL) unless already present in the environment.

set -u
cd "$(dirname "$0")/.." || exit 2

mkdir -p logs
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="logs/nightly-${STAMP}.log"
FAILED=0

run() {
  local name="$1"; shift
  echo "" | tee -a "$LOG"
  echo "===== [$(date +%H:%M:%S)] ${name} =====" | tee -a "$LOG"
  if "$@" >>"$LOG" 2>&1; then
    echo "PASS: ${name}" | tee -a "$LOG"
  else
    echo "FAIL: ${name}" | tee -a "$LOG"
    FAILED=1
  fi
}

echo "nightly run ${STAMP} → ${LOG}"

run "typecheck"        npm run --silent typecheck
run "unit tests"       npm run --silent test
run "build"            npm run --silent build
run "e2e (deterministic)" npx playwright test

if [ "${SKIP_LIVE:-0}" != "1" ]; then
  run "live provider (GLM-5.1)" env RUN_LIVE_LLM=1 npx vitest run src/main/provider.live.test.ts
  run "live crew e2e (GLM-5.1)" env RUN_LIVE_LLM=1 npx playwright test e2e/crew-live.e2e.ts
else
  echo "SKIP_LIVE=1 → skipping real-LLM steps" | tee -a "$LOG"
fi

echo "" | tee -a "$LOG"
if [ "$FAILED" -eq 0 ]; then
  echo "===== NIGHTLY: ALL GREEN (${STAMP}) =====" | tee -a "$LOG"
else
  echo "===== NIGHTLY: FAILURES (${STAMP}) — see ${LOG} =====" | tee -a "$LOG"
fi
exit "$FAILED"
