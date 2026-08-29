# Familiar

**Familiar closes the loops you drop.** Press one key when you walk away from something
unfinished — a half-filled grant form, a draft you never sent — and it works out what you
left, prepares it, and asks before it acts.

It starts with **zero permissions** and earns them one approval at a time. Every decision you
make becomes a rule it follows forever.

> Built for the Agent Harness Hackathon on [TrueForge](https://trueforge.dev).

---

## The idea

Every agent product ships trust as a **setting**: ask-every-time (so annoying people switch it
off) or act-autonomously (so frightening people never switch it on). But trust between humans
is a **trajectory**, not a dropdown — you don't hire someone and pick their permission level.

**Agent autonomy is configured, when it should be earned.**

Every `approve` is a positive label. Every `deny` — with a reason — is a negative label *plus an
explanation*. Approval gates continuously generate labelled data about your judgment, and every
product on the market throws it away. Familiar treats its approval history as the training
corpus for its own governance.

### The ceiling

> **Familiar can earn the right to do anything it can undo.
> It can never earn the right to do what it can't.**

| Level | Name | Can do | Reachable by |
|---|---|---|---|
| L0 | Observe | read only | everything starts here |
| L1 | Prepare | draft, fill, stage in the sandbox — never send | any action |
| L2 | Act with approval | executes after your tap | any action |
| **L3** | **Standing authority** | acts alone inside a ratified rule | **reversible actions only** |

Clearance is **per action class**. `repo.describe` can reach L3; `release.publish`,
`email.send` and `npm.publish` are marked `reversible = 0` and are capped at L2 forever, however
much trust accumulates. The UI marks them `⊤`.

---

## How it works

```
CAPTURE → SWEEP → PREPARE → NUDGE → GATE → ACT → RECEIPT → LEARN
```

1. **Capture** — `⌃⌥⌘H` crops the active window, grabs the app, title and browser URL, and posts
   it. The HUD confirms in ~500 ms; extraction happens after, so you never wait.
2. **Perception** — a cheap multimodal model (GPT-5.6 Luna, ~$0.0003/capture) reads *what is
   literally on the screen*: what the thing is, which fields are filled or missing, and any
   **deadline printed on the page**. It never decides importance — you already did that by
   pressing the key.
3. **Cognition** — the TrueForge agent decides what it *means*: is this a duplicate, what would
   closing it take, how urgent given the dossier.
4. **Sweep** — one sub-agent per open loop, dispatched in parallel, each preparing its loop in
   the sandbox. They are told explicitly not to send, submit, publish or spend.
5. **Gate** — the only surface that takes the whole screen. Shows exactly what will happen and
   an **Undo:** line. Deny, and it proposes a standing order citing the denial that taught it.
6. **Receipt** — every decision is appended to a ledger. The cute face is legitimate because
   everything it did is auditable.

### Why a connector wouldn't do

A connector will never exist for that grant portal, that university form, that niche internal
tool. **A hotkey works on anything with pixels**, and the screenshot *is* the extraction — no
browser extension, no per-site scrapers. Capture is explicit and manual only: one keystroke, one
frame, one loop. Nothing is ever recorded passively.

---

## Setup

**Requirements:** macOS, Node ≥ 22.14, an OpenAI API key, `gh` CLI authenticated (used for the
real actions — no other accounts needed).

```bash
git clone https://github.com/ombhojane/familiar && cd familiar
npm install
cp .env.example .env      # then add your OPENAI_API_KEY
./scripts/dev.sh          # starts TrueForge, the MCP server, the dashboard and HOLD
```

Open **http://localhost:5173**, or use the Familiar item in your menu bar.

macOS will ask for **Screen Recording** permission the first time you capture — that is
`screencapture` reading the active window. Grant it to the terminal (or to Familiar) in
System Settings → Privacy & Security → Screen Recording.

### Safe by default

`DEMO_MODE` is **unset**, which means every real action is a **dry run**: it reports exactly what
*would* happen and changes nothing. That is the path you get when you clone this. Set
`DEMO_MODE=live` to perform real actions. One env var, one code path, **no mocks anywhere.**

```bash
./scripts/dev.sh stop     # stop everything
```

---

## How TrueForge is used

The honest test is *"could I build this without TrueForge?"* — and the answer is no. The product
**is** approval gates plus persistence.

| Primitive | Its job here |
|---|---|
| **Custom MCP server** | dossier, mission board, standing orders, clearance, receipts, real actions — 13 tools, **every one annotated** (unannotated tools silently bypass gating) |
| **Approval gates** | both the safety spine *and* the training signal. `require_approval_for_tools` is enforced server-side — the tool call cannot execute |
| **Sandbox** | where sub-agents prepare irreversible work safely |
| **Sub-agents** | the sweep: one per loop, in parallel, each with a self-contained brief |
| **Session persistence** | the worker session id is stored and resumed after a restart, verified against TrueForge first |
| **Live policy mutation** | 🏆 earning L3 **`PATCH`es the session and `PUT`s the agent manifest** — the trust meter literally rewrites the agent's own approval config |
| **Model routing** | perception on the cheap model, cognition on the strong one |

### The mechanic worth looking at

`ApprovalDecision` is `allow` / `deny`, one-shot — there is deliberately no "always allow".
But `PATCH /api/v1/sessions/{id}` accepts a new agent spec. So promotion to L3 is implemented by
**removing that tool from `require_approval_for_tools`** and demotion by putting it back
(`server/src/control.ts`). The control plane sits *in* the approval path (`POST /api/decision`)
so every decision is recorded and clearance recomputed before TrueForge ever sees the answer. On
boot it reconciles the manifest against the database, which is authoritative.

---

## Triage

The board is ordered by a deterministic, explainable score shaped like
[WSJF](https://framework.scaledagile.com/wsjf) (cost of delay ÷ job size):

```
score = 45·urgency    deadline read off the page, 14-day decay
      + 30·stakes     official/money 1.0 · work .7 · social .6 · personal .4
      + 15·readiness  prepared ranks first
      + 10·quickwin   1 / log₂(effort) — the WSJF denominator
```

Every factor carries its evidence onto the card ("due in 5d (read off the page) · official ·
prepared · ~10 min"). **Staleness is deliberately not a factor.** The board shows what is
*ready*, never what is *late* — there are no guilt mechanics anywhere in this product.

---

## Layout

```
hold/      macOS menu-bar app — global hotkey, window capture, HUD, notifications
server/    familiar-mcp — MCP server + SQLite + control plane + triage + ingest worker
web/       the dashboard — mission board, loop drawer, gate card, clearance, receipts
agent/     the TrueForge agent manifest
scripts/   dev.sh (start everything) · register.sh · test drivers
```

## Qodo Code Review Evidence

Every substantive change from the `finish-the-product` branch onward goes through a pull request
reviewed by Qodo before merge.

- Representative PR: **https://github.com/ombhojane/familiar/pull/2** — "The last meter: loops
  become doors, not receipts"

Qodo raised **13 findings on PR #2 — 7 High, 6 Medium/Low. All 13 were fixed**, none dismissed.

The High-severity ones were real defects, not style:

| # | Finding | Fix |
|---|---|---|
| 1 | `register.sh` updated `data[0]`, so it could overwrite an unrelated agent and still leave Familiar unregistered | look the agent up by name |
| 2 | The scheduler wrote today's `last_sweep` *before* the sweep succeeded, so a transient failure looked complete and nothing retried until the next day | mark the day only on completion |
| 3 | The scheduler and `POST /api/sweep` could race and run duplicate sub-agents over the same loops | claim the sweep atomically |
| 4 | A sweep marked *every* open loop `sweeping` while processing only five, stranding the rest with nothing working on them | mark only the selected loops |
| 5 | `POST /loops/:id/status` wrote a `loop.closed` receipt without checking the transition happened — repeats and unknown ids forged audit entries | write a receipt only on a real transition |
| 12 | `register.sh` never registered the `close-a-loop` skill the agent manifest requires | register it in the same path |
| 13 | **The screenshot endpoint served full captures unauthenticated on all interfaces** | bind to loopback only |

Medium/Low: `open` failures reported as successful resumes (6), deadline warnings repeating after every HOLD restart (7), `dev.sh stop` using global `pkill` and killing unrelated dev servers (8), negative effort producing a non-finite triage score (9), unparseable deadlines producing `NaN` and destroying board ordering (10), and the sweep flag never resetting after a throw (11).

Finding 13 was verified fixed by confirming the server refuses connections on the LAN address while still serving on localhost.

## Limitations

- macOS only (`screencapture` and AppleScript).
- Perception is honest about uncertainty: if no deadline is printed on the page, `deadline` is
  `null` rather than a guess.
- The creature has no decay state, by design. Walking away is never punished.

## Licence

MIT.
