#!/usr/bin/env bash
# Register the close-a-loop skill. Requires the repo to be PUBLIC — TrueForge clones
# skills with GIT_TERMINAL_PROMPT=0 and there is no credential field in the manifest.
set -uo pipefail
cd "$(dirname "$0")/.."
TF=${TRUEFORGE_BASE_URL:-http://localhost:8790}
REF=${1:-main}

curl -s -X PUT "$TF/api/v1/settings/skills" -H 'Content-Type: application/json' -d "{
  \"manifest\": {
    \"type\": \"git\",
    \"name\": \"close-a-loop\",
    \"url\": \"https://github.com/ombhojane/familiar\",
    \"path\": \"skills/close-a-loop\",
    \"ref\": \"$REF\",
    \"description\": \"Prepare a dropped loop so the person can finish it in one tap. Use whenever a loop needs preparing, a sweep is running, or someone asks what it would take to close something.\"
  }}" | head -c 400
echo
python3 - <<'PY'
import json
p='agent/familiar.agent.json'; d=json.load(open(p))
d['manifest']['skills'] = [{"name": "close-a-loop"}]
json.dump(d, open(p,'w'), indent=2)
print("agent manifest now attaches the skill")
PY
bash scripts/register.sh
