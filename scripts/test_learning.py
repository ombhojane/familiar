#!/usr/bin/env python3
"""The core demo beat: request -> gate -> DENY with a reason -> agent proposes a Standing Order."""
import sys; sys.path.insert(0, "scripts")
from drive import *

sid = new_session()
print(f"session {sid}\n")

print("1. asking for a release")
state, tcid = report(turn(sid, [{"type": "user.message",
    "content": "Publish a v0.1.0 release. Notes: first working slice of the capture pipeline."}]))

while state == "question":
    print("\n2. answering its question")
    state, tcid = report(answer(sid, tcid, "Tag v0.1.0, title 'First slice', notes: capture pipeline + approval gate working."))

if state != "gate":
    print("\n⚠️ expected a gate, got:", state); sys.exit(1)

print("\n3. DENYING with a reason")
state, tcid = report(deny(sid, tcid,
    "Not yet — I want to review release notes myself before anything goes public."))

if state == "gate":
    print("\n4. ✅ it proposed a Standing Order — ratifying")
    report(allow(sid, tcid))
else:
    print("\n⚠️ no Standing Order proposed")
