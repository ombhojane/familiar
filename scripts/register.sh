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

AID=$(curl -s "$TF/api/v1/agents" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d[0]['id'] if d else '')")
python3 -c "
import json; d=json.load(open('agent/familiar.agent.json'))
json.dump({'manifest': d['manifest']}, open('/tmp/_agent.json','w'))
"
if [ -n "$AID" ]; then
  curl -s -X PUT "$TF/api/v1/agents/$AID" -H 'Content-Type: application/json' -d @/tmp/_agent.json > /dev/null
else
  curl -s -X POST "$TF/api/v1/agents" -H 'Content-Type: application/json' -d @agent/familiar.agent.json > /dev/null
fi
echo "registered at $(date)"
