#!/usr/bin/env bash
# Idempotently register the MCP server, model provider, skill and agent with TrueForge.
set -uo pipefail
cd "$(dirname "$0")/.."
TF=${TRUEFORGE_BASE_URL:-http://localhost:8790}
KEY=$(grep '^OPENAI_API_KEY=' .env | cut -d= -f2-)

curl -s -X PUT "$TF/api/v1/settings/mcp-servers" -H 'Content-Type: application/json' -d '{
  "manifest": { "type":"remote", "name":"familiar", "url":"http://localhost:3333/mcp",
    "description":"The user'"'"'s Familiar: their dossier of durable facts, the mission board of loops they dropped, ratified standing orders, earned clearance per action class, saved screen captures with multimodal extraction, and real actions on systems they own." }}' > /dev/null

curl -s -X PUT "$TF/api/v1/settings/model-providers" -H 'Content-Type: application/json' -d "{\"manifest\":{
  \"type\":\"openai\", \"auth\":{\"api_key\":\"$KEY\"},
  \"models\":[
    {\"model_id\":\"gpt-5.6-terra\",\"name\":\"terra\",\"properties\":{\"context_length\":1050000,\"max_output_tokens\":128000}},
    {\"model_id\":\"gpt-5.6-luna\",\"name\":\"luna\",\"properties\":{\"context_length\":1050000,\"max_output_tokens\":128000}}
  ]}}" > /dev/null

# Find the agent BY NAME. Taking data[0] would overwrite an unrelated agent if TrueForge
# happened to list another one first, and still leave Familiar unregistered.
AID=$(curl -s "$TF/api/v1/agents" | python3 -c "
import sys, json
d = json.load(sys.stdin).get('data', [])
m = [a for a in d if a.get('name') == 'familiar']
print(m[0]['id'] if m else '')
")
python3 -c "
import json; d=json.load(open('agent/familiar.agent.json'))
json.dump({'manifest': d['manifest']}, open('/tmp/_agent.json','w'))
"
if [ -n "$AID" ]; then
  curl -s -X PUT "$TF/api/v1/agents/$AID" -H 'Content-Type: application/json' -d @/tmp/_agent.json > /dev/null
else
  curl -s -X POST "$TF/api/v1/agents" -H 'Content-Type: application/json' -d @agent/familiar.agent.json > /dev/null
fi
# The agent manifest may attach the close-a-loop skill, so the skill has to exist before
# the agent is saved. Registering it here keeps dev.sh a single, complete setup path.
if python3 -c "
import json,sys
d=json.load(open('agent/familiar.agent.json'))
sys.exit(0 if d['manifest'].get('skills') else 1)
"; then
  SKILL_REF=${SKILL_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}
  curl -s -X PUT "$TF/api/v1/settings/skills" -H 'Content-Type: application/json' -d "{
    \"manifest\": {
      \"type\": \"git\", \"name\": \"close-a-loop\",
      \"url\": \"https://github.com/ombhojane/familiar\",
      \"path\": \"skills/close-a-loop\", \"ref\": \"$SKILL_REF\",
      \"description\": \"Prepare a dropped loop so the person can finish it in one tap. Use whenever a loop needs preparing, a sweep is running, or someone asks what it would take to close something.\"
    }}" > /dev/null
  echo "skill close-a-loop registered at ref $SKILL_REF"
fi

echo "registered at $(date)"
