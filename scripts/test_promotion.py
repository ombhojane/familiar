#!/usr/bin/env python3
"""🏆 THE DIFFERENTIATOR: earn standing authority, and watch the agent's own
approval policy get rewritten server-side."""
import sys, json, urllib.request; sys.path.insert(0, "scripts")
from drive import *

def gated():
    return json.loads(urllib.request.urlopen(FAM + "/api/gated").read())["gated"]

def clearance():
    rows = json.loads(urllib.request.urlopen(FAM + "/api/clearance").read())
    return {r["action_class"]: r for r in rows}

# A ratified rule must scope the class before autonomy can be earned.
urllib.request.urlopen(urllib.request.Request(FAM + "/api/seed_order",
    data=json.dumps({"rule": "Keep the repo description accurate and current.",
                     "rationale": "Om approved three description edits in a row.",
                     "scope": "repo metadata and description"}).encode(),
    headers={"Content-Type": "application/json"}))

print("BEFORE  gated:", gated())
print("        repo.describe:", clearance()["repo.describe"]["level"], "\n")

sid = new_session()
for i in range(1, 4):
    print(f"--- edit {i} ---")
    state, tcid = report(turn(sid, [{"type": "user.message",
        "content": f"Set the repo description to: 'Familiar — an agent that earns its permissions. (rev {i})'"}]))
    while state == "question":
        state, tcid = report(answer(sid, tcid, "Yes, go ahead."))
    if state == "gate":
        decide(sid, tcid, "act_repo_describe", "approved")
    else:
        print("     (no gate — already autonomous)")
    print()

print("AFTER   gated:", gated())
c = clearance()["repo.describe"]
print(f"        repo.describe: L{c['level']}  approvals={c['approvals']} denials={c['denials']}")
r = clearance()["release.publish"]
print(f"        release.publish: L{r['level']}  reversible={r['reversible']}  ⊤ ceiling holds")
