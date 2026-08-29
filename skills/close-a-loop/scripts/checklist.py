#!/usr/bin/env python3
"""Turn a prepared loop into a numbered, tap-through checklist.

Kept deliberately dumb: the agent decides what the steps are, this only formats
them consistently so every prepared note reads the same way.
"""
import argparse, json, sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--title", required=True)
    p.add_argument("--steps", required=True, help="JSON array of step strings")
    p.add_argument("--missing", default="[]", help="JSON array of what only the person can supply")
    a = p.parse_args()

    steps = json.loads(a.steps)
    missing = json.loads(a.missing)

    out = [a.title, "=" * len(a.title), ""]
    out += [f"{i}. {s}" for i, s in enumerate(steps, 1)]
    if missing:
        out += ["", "Only you can supply:"] + [f"  - {m}" for m in missing]
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
