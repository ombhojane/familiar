---
name: close-a-loop
description: Prepare a dropped loop so the person can finish it in one tap. Use whenever a loop needs preparing, a sweep is running, or someone asks what it would take to close something.
---

# Closing a loop

A loop is a thing the person started and walked away from. Your job is to remove every
obstacle between them and finishing it — without finishing it *for* them when finishing
means something irreversible.

## 1. Read what is actually there

Call `capture_extract` on the loop's capture before assuming anything. Work only from what
is visibly on the screen. If a deadline is not printed on the page, there is no deadline —
do not infer one from context.

## 2. Decide what closing it actually takes

Read `references/loop-kinds.md` and match the loop to a kind. Each kind has a different
definition of "prepared". Write the *next physical action*, not a category:

- Good: "Enter 'Catch up this evening' in the Subject field, then Send."
- Bad: "Complete the email."

## 3. Prepare, but never commit

Do everything that is safe and reversible:

- fill in what you can determine from the dossier
- draft the text in the person's own voice
- assemble the checklist of what only they can supply

Never send, submit, publish, spend, or sign. Those are gated actions and they belong to the
person, not to you. If preparing would require one, stop and say so.

## 4. Hand it back

Finish with `loop_upsert`:

- `status: "prepared"`
- `missing`: only what genuinely still requires the person — not things you could determine
- `preparedNote`: **the full draft or checklist, verbatim**. This is what they read. Work
  that is not written here is lost.

## 5. Never guilt

Do not mention how long the loop has been open. Do not apologise for it. Report what is
ready, never what is late.
