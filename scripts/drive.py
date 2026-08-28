#!/usr/bin/env python3
"""Drive a Familiar session from the CLI: send turns, see tool calls, answer questions,
approve/deny gates. Makes the whole loop testable without a UI."""
import json, sys, urllib.request

TF = "http://localhost:8790"

def post(path, body):
    req = urllib.request.Request(TF + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=300).read().decode()

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
    for e in evs:
        if e.get("type") == "tool.approval_required":
            tcid = e["tool_calls"][0]["id"]
            src = byid.get(e["tool_calls"][0].get("source_event_id"), {})
            name = None
            for c in (src.get("toolCalls") or []):
                if c.get("id") == tcid:
                    name = (c.get("toolInfo") or {}).get("name")
            print(f"  🛑 GATE on {name or '?'} — halted, nothing executed")
            return "gate", tcid
        if e.get("type") == "tool.response_required":
            print("  ❓ QUESTION")
            return "question", e["tool_calls"][0]["id"]
    return "done", None

def allow(sid, tcid):
    return turn(sid, [{"type": "user.tool_approval", "thread_id": "main",
                       "tool_call_id": tcid, "approval": {"status": "allow"}}])

def deny(sid, tcid, reason):
    return turn(sid, [{"type": "user.tool_approval", "thread_id": "main",
                       "tool_call_id": tcid, "approval": {"status": "deny", "reason": reason}}])

def answer(sid, tcid, content):
    return turn(sid, [{"type": "user.tool_response", "thread_id": "main",
                       "tool_call_id": tcid, "content": content}])
