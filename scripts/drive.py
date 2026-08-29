#!/usr/bin/env python3
"""Drive a Familiar session from the CLI: send turns, see tool calls, answer questions,
approve/deny gates. Makes the whole loop testable without a UI."""
import json, sys, urllib.request

TF = "http://localhost:8790"

def post(path, body, retries=8):
    """422 means the session is still finalizing the previous turn. Back off and retry."""
    import time
    for attempt in range(retries):
        req = urllib.request.Request(TF + path, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            return urllib.request.urlopen(req, timeout=300).read().decode()
        except urllib.error.HTTPError as e:
            if e.code == 422 and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            raise

def events(raw):
    out = []
    for line in raw.splitlines():
        if line.startswith("data:") and line[5:].strip():
            try: out.append(json.loads(line[5:].strip()))
            except: pass
    return out

def new_session():
    return json.loads(post("/api/v1/sessions", {"agent": {"name": "familiar"}}))["data"]["id"]

def turn(sid, inputs):
    raw = post(f"/api/v1/sessions/{sid}/turns", {"input": inputs})
    if raw.lstrip().startswith("{") and '"error"' in raw[:60]:
        print("ERROR:", raw[:300]); return []
    return events(raw)

def report(evs):
    """Print what happened; return ('gate'|'question'|'done', tool_call_id|None)."""
    byid = {e.get("id"): e for e in evs}
    txt = ""
    for e in evs:
        t = e.get("type")
        if t == "model.message.delta" and isinstance(e.get("content"), str):
            txt += e["content"]
        if t == "model.message":
            for tc in (e.get("toolCalls") or []):
                name = (tc.get("toolInfo") or {}).get("name")
                args = str(tc.get("function", {}).get("arguments"))[:160]
                print(f"  TOOL → {name} {args}")
    if txt.strip():
        print(f"  SAID → {txt.strip()[:400]}")
    def find_name(tcid):
        # The call appears in streaming deltas and again in the final message;
        # source_event_id is not always resolvable once deltas are merged.
        for e in evs:
            for c in (e.get("toolCalls") or e.get("tool_calls") or []):
                if c.get("id") == tcid:
                    n = (c.get("toolInfo") or c.get("tool_info") or {}).get("name")
                    if n:
                        return n
        return None

    for e in evs:
        if e.get("type") == "tool.approval_required":
            tcid = e["tool_calls"][0]["id"]
            name = find_name(tcid)
            print(f"  🛑 GATE on {name or '?'} — halted, nothing executed")
            return "gate", tcid
        if e.get("type") == "tool.response_required":
            print("  ❓ QUESTION")
            return "question", e["tool_calls"][0]["id"]
    return "done", None

FAM = "http://localhost:3333"

def decide(sid, tcid, tool_name, decision, reason=None):
    """Route the decision through the control plane, not straight to TrueForge.
    It records the receipt, recomputes clearance, PATCHes policy on promotion,
    then forwards to TrueForge to resume the halted turn."""
    req = urllib.request.Request(FAM + "/api/decision",
        data=json.dumps({"sessionId": sid, "toolCallId": tcid, "toolName": tool_name,
                         "decision": decision, "reason": reason}).encode(),
        headers={"Content-Type": "application/json"})
    out = json.loads(urllib.request.urlopen(req, timeout=300).read().decode())
    p = out.get("promotion")
    if p:
        print(f"     clearance: {p['why']}" + ("  🏆 PROMOTED" if p["promoted"] else ""))
    if out.get("patched"):
        print(f"     🏆 PATCHED session policy -> gated now: {out['patched']['gated']}")
    # The control plane already drained the resumed turn; hand its events back so the
    # caller can see whether it stopped at another gate.
    return events(out.get("resumed", ""))

def allow(sid, tcid):
    return turn(sid, [{"type": "user.tool_approval", "thread_id": "main",
                       "tool_call_id": tcid, "approval": {"status": "allow"}}])

def deny(sid, tcid, reason):
    return turn(sid, [{"type": "user.tool_approval", "thread_id": "main",
                       "tool_call_id": tcid, "approval": {"status": "deny", "reason": reason}}])

def answer(sid, tcid, content):
    return turn(sid, [{"type": "user.tool_response", "thread_id": "main",
                       "tool_call_id": tcid, "content": content}])
