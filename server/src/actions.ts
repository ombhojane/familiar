import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

/**
 * Real, irreversible actions on systems the user owns.
 * Uses the already-authenticated `gh` CLI — no new accounts, no new credentials.
 *
 * DEMO_MODE unset -> dry run: returns exactly what WOULD happen, changes nothing.
 *                    This is the path judges get when they clone the repo.
 * DEMO_MODE=live  -> performs the real action.
 * One env var, one code path, zero mocks.
 */
const live = () => process.env.DEMO_MODE === "live";
const REPO = process.env.TARGET_REPO ?? "ombhojane/familiar";

async function gh(args: string[]) {
  const { stdout } = await run("gh", args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

/** REVERSIBLE. A repo description can be changed back freely — this class can earn standing authority. */
export async function setRepoDescription(description: string) {
  const before = await gh(["repo", "view", REPO, "--json", "description", "--jq", ".description"]);
  if (!live()) return { dryRun: true, repo: REPO, before, would_set: description, reversible: true };
  await gh(["repo", "edit", REPO, "--description", description]);
  return { ok: true, repo: REPO, before, now: description, reversible: true };
}

/** IRREVERSIBLE. A published release is public immediately and its tag enters history.
 *  This class is capped at L2 forever — it can never earn standing authority. */
export async function publishRelease(tag: string, title: string, notes: string) {
  if (!live()) {
    return {
      dryRun: true, repo: REPO, would_create: { tag, title },
      warning: "Publishing a release is public the moment it lands and the tag enters repository history.",
      reversible: false,
    };
  }
  const url = await gh(["release", "create", tag, "--repo", REPO, "--title", title, "--notes", notes]);
  return { ok: true, url, tag, reversible: false };
}

/** Read-only proof, straight from GitHub — for verifying an action really landed. */
export async function verifyRelease(tag: string) {
  try {
    const out = await gh(["release", "view", tag, "--repo", REPO, "--json", "tagName,publishedAt,url"]);
    return JSON.parse(out);
  } catch {
    return { found: false, tag };
  }
}

export async function repoState() {
  const out = await gh(["repo", "view", REPO, "--json", "name,description,visibility,pushedAt,url"]);
  return JSON.parse(out);
}
