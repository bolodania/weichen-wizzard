#!/usr/bin/env bash
# Redeploy existing BTP CF applications; never provision/delete services or apps.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
YES=false
DRY_RUN=false
SKIP_TESTS=false

usage() {
  cat <<'EOF'
Usage: bash scripts/redeploy-cf.sh [--yes] [--dry-run] [--skip-tests]

Redeploys existing CAP, Python agent and Approuter apps in the current CF target.
Preserves existing routes, environment configuration and credentials; rebuilds
CAP, tests both runtimes, reconnects HTTPS URLs and updates the XSUAA callback.

  --yes         Do not ask for confirmation (for CI).
  --dry-run     Show the plan without executing commands or contacting CF.
  --skip-tests  Explicitly skip tests; builds still run.

Requires an existing deployment, CF login, Node >=22.12 and Python 3.12 test env.
Python tests use AGENT_PYTHON, or assets/tp-wizard-agent/venv/bin/python.
Custom npm cache can be set with npm_config_cache.
Restarts lose in-memory sessions. No secrets are read from local .env files.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --yes) YES=true ;;
    --dry-run) DRY_RUN=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $argument" >&2; usage; exit 2 ;;
  esac
done

if $DRY_RUN; then
  cat <<'EOF'
Plan (no commands executed):
1. Display CF target and confirm; check existing apps/services/configuration.
2. npm ci in CAP and Approuter; build CAP/frontend.
3. Run CAP Jest and Python regression tests (unless --skip-tests).
4. Generate temporary manifests preserving existing routes and UPVs.
5. cf push --no-start for CAP, Python agent and Approuter.
6. Discover their external routes; update HTTPS connection settings.
7. Update the existing XSUAA service with the exact Approuter login callback.
8. Remove obsolete agent UPVs; restage all apps and check status.
No app/service deletion, credential printing, or local .env upload.
EOF
  exit 0
fi

for command in cf node npm; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<12)){console.error("Node >=22.12 required");process.exit(1)}'
cf target
echo 'Redeployment restarts all apps and loses in-memory sessions.'
if ! $YES; then
  read -r -p 'Redeploy to this CF org/space? Type yes: ' answer
  [[ "$answer" == yes ]] || { echo 'Cancelled.'; exit 0; }
fi

AGENT_PYTHON="${AGENT_PYTHON:-$ROOT/assets/tp-wizard-agent/venv/bin/python}"
if ! $SKIP_TESTS; then
  [[ -x "$AGENT_PYTHON" ]] || { echo 'Set AGENT_PYTHON to a Python 3.12 environment with requirements and pytest installed.' >&2; exit 1; }
  "$AGENT_PYTHON" -c 'import sys, pytest; assert sys.version_info >= (3,12), "Python >=3.12 required"'
fi

TEMP="$(mktemp -d "${TMPDIR:-/tmp}/tp-redeploy.XXXXXX")"
chmod 700 "$TEMP"
trap 'rm -rf "$TEMP"' EXIT

# Install before using the CAP project's YAML parser; no package versions change.
(cd "$ROOT/assets/tp-wizard-cap" && npm ci)
(cd "$ROOT/assets/tp-wizard-router" && npm ci)
node "$ROOT/scripts/cf-deployment.js" prepare "$TEMP"
(cd "$ROOT/assets/tp-wizard-cap" && npm run build)
if ! $SKIP_TESTS; then
  (cd "$ROOT/assets/tp-wizard-cap" && npm test -- --runInBand)
  (cd "$ROOT/assets/tp-wizard-agent" && "$AGENT_PYTHON" -m pytest -o addopts='' \
    tests prebuilt_tests/test_circuit_breaker.py prebuilt_tests/test_load_skill_resources.py \
    prebuilt_tests/test_util_response_trimming.py prebuilt_tests/test_prompt_injection_detector.py)
fi

for asset in cap agent router; do
  (cd "$ROOT/assets/tp-wizard-$asset" && cf push -f "$TEMP/$asset.yml" --no-start)
done

node "$ROOT/scripts/cf-deployment.js" connect "$TEMP"
cf update-service tp-wizard-xsuaa -c "$TEMP/xs-security.json"
# Wait for asynchronous XSUAA update before starting newly staged apps.
node "$ROOT/scripts/cf-deployment.js" wait-service

for variable in HOST PYTHONUNBUFFERED IBD_TESTING AUTH_MODE; do
  cf unset-env tp-wizard-agent "$variable"
done
for asset in cap agent router; do
  # --no-start uploads a new package but an existing app may still be running
  # its previous droplet. cf start is a no-op for an already-started app.
  # Restage explicitly activates the newly uploaded source and current bindings.
  cf restage "tp-wizard-$asset"
done
for asset in cap agent router; do
  cf app "tp-wizard-$asset"
done
node "$ROOT/scripts/cf-deployment.js" summary