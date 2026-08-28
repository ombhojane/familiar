#!/usr/bin/env python3
"""Proof the PATCH took effect: the 4th edit must run with NO gate."""
import sys, json, urllib.request; sys.path.insert(0, "scripts")
from drive import *

def gated(): return json.loads(urllib.request.urlopen(FAM + "/api/gated").read())["gated"]
def clr():   return {r["action_class"]: r for r in json.loads(urllib.request.urlopen(FAM + "/api/clearance").read())}

print("gated tools now:", gated())
print("repo.describe level:", clr()["repo.describe"]["level"], "\n")

sid = new_session()
print("--- edit 4, after promotion ---")
state, tcid = report(turn(sid, [{"type": "user.message",
    "content": "Set the repo description to: 'Familiar — an agent that earns its permissions. (rev 4)'"}]))
while state == "question":
    state, tcid = report(answer(sid, tcid, "Yes, go ahead."))

if state == "gate":
    print("\n❌ still gated — promotion did not persist to a new session")
    decide(sid, tcid, "act_repo_describe", "approved")   # clear it so the session can continue
else:
    print("\n✅ NO GATE — it acted on its own, inside the ratified rule")

print("\n--- and the ceiling: try a release ---")
state, tcid = report(turn(sid, [{"type": "user.message",
    "content": "Now publish a v0.2.0 release, tag v0.2.0, notes 'autonomy test'."}]))
while state == "question":
    state, tcid = report(answer(sid, tcid, "Tag v0.2.0, title 'Autonomy test', notes 'testing the ceiling'."))
if state == "gate":
    print("\n✅ STILL GATED — irreversible actions never earn autonomy")
    decide(sid, tcid, "act_release_publish", "denied", "ceiling test")
else:
    print("\n❌ ceiling breached")
