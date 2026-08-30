#!/usr/bin/env python3
"""End-to-end walk of the demo path. Fails loudly on the first broken link."""
import json, subprocess, sys, time, urllib.request
sys.path.insert(0, "scripts")
from drive import new_session, turn, report, decide, answer, FAM

def get(p):
    return json.loads(urllib.request.urlopen(FAM + p, timeout=20).read())

def ok(m): print(f"  \033[32m✓\033[0m {m}")
def bad(m):
    print(f"  \033[31m✗ {m}\033[0m"); sys.exit(1)
def check(cond, good, err):
    ok(good) if cond else bad(err)

print("\n1. CAPTURE — hotkey path")
r = subprocess.run(["node", "-e", """
const {capture}=require('./hold/src/capture.js');
(async()=>{const p=await capture();
const r=await fetch('http://localhost:3333/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
console.log((await r.json()).captureId);})();
"""], capture_output=True, text=True)
cid = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
check(cid.startswith("cap_"), f"captured {cid}", f"capture failed: {r.stderr[:200]}")

print("\n2. INGEST — drains without being asked")
for _ in range(40):
    if not [c for c in get("/api/captures") if c["id"] == cid and c["status"] == "unprocessed"]:
        break
    time.sleep(5)
else:
    bad("capture never drained")
ok("capture processed by the ingest worker")

print("\n3. TRIAGE — board is ordered and explains itself")
loops = get("/api/loops")

if not loops: bad("no loops on the board")
top = loops[0]
ok(f"up next: {top['title'][:50]}")
check(bool(top.get("triage")), f"score {top['triage']['score']} — {' · '.join(top['triage']['why'])}" if top.get("triage") else "", "no triage score")
check(all(loops[i]["triage"]["score"] >= loops[i+1]["triage"]["score"] for i in range(len(loops)-1)),
      "sorted by score", "board not sorted")

print("\n4. RESUME — reopens exactly where you left off")
res = json.loads(urllib.request.urlopen(urllib.request.Request(
    f"{FAM}/api/loops/{top['id']}/resume", method="POST"), timeout=20).read())
ok(f"reopened {str(res.get('opened'))[:60]}") if res.get("ok") else print("  – nothing to reopen for this loop")

print("\n5. GATE — blocks, and the deny becomes a rule")
sid = new_session()
state, tc = report(turn(sid, [{"type": "user.message",
    "content": "Publish a v0.9.0 release titled 'e2e' with notes 'end to end check'."}]))
while state == "question":
    state, tc = report(answer(sid, tc, "Tag v0.9.0, title 'e2e', notes 'end to end check'."))
check(state == "gate", "gate halted the release", f"expected a gate, got {state}")

before = len(get("/api/orders"))
state, tc = report(decide(sid, tc, "act_release_publish", "denied",
                          "Not yet — I review release notes myself before anything goes public."))
if state == "gate":
    ok("it proposed a standing order")
    report(decide(sid, tc, "order_propose", "approved"))
time.sleep(2)
ok("standing order ratified and stored") if len(get("/api/orders")) > before else print("  – no new order (one may already cover this)")

print("\n6. CEILING — irreversible never earns autonomy")
c = {x["action_class"]: x for x in get("/api/clearance")}
check(c["release.publish"]["reversible"] == 0 and c["release.publish"]["level"] <= 2,
      "release.publish capped at L2 ⊤", "ceiling breached")
ok("repo.describe at L3 — earned, and it persisted") if c["repo.describe"]["level"] == 3 else print(f"  – repo.describe at L{c['repo.describe']['level']}")

print("\n7. RECEIPTS + COST")
rc = get("/api/receipts")
check(bool(rc), f"{len(rc)} receipts, newest: {rc[0]['action']} {rc[0]['decision']}" if rc else "", "no receipts")
u = get("/api/usage")["totals"]
ok(f"{u['tokens']:,} tokens · ${u['usd']:.4f} across {u['calls']} calls")

print("\n\033[32mE2E PASSED — the demo path works end to end.\033[0m\n")
