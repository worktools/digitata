// Calcit program diff without cloning: fetch the file at the merge base and at
// the PR head through the GitHub API, commit both into a throwaway two-commit
// git repo, and run `calcit analyze program-diff --base <c1> <c2>` there (the
// CLI reads both sides from git history).

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProgramDiffResult } from "../shared/types.ts";
import { assertRepo } from "./gh.ts";
import { changedCodes } from "./snapshot.ts";
import { run, runOk } from "./run.ts";

const CALCIT = process.env.DIGITATA_CALCIT ?? "calcit";
const GH_CWD = tmpdir();

/** Merge base of base..head, as `gh pr diff` uses (commits that landed on base later are not shown). */
async function mergeBaseOf(repo: string, base: string, head: string): Promise<string> {
  const out = await runOk("gh", ["api", `repos/${repo}/compare/${base}...${head}`, "--jq", ".merge_base_commit.sha"], { cwd: GH_CWD });
  return out.trim() || base;
}

/** Raw file content at a commit, or null when the file does not exist there. */
async function fileAt(repo: string, sha: string, path: string): Promise<string | null> {
  const p = path.split("/").map(encodeURIComponent).join("/");
  const r = await run("gh", ["api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/${p}?ref=${sha}`], { cwd: GH_CWD, timeoutMs: 120_000 });
  if (r.code === 0) return r.stdout;
  if (/404|Not Found/i.test(r.stderr + r.stdout)) return null;
  throw new Error(`fetching ${path}@${sha.slice(0, 8)} failed: ${r.stderr.trim()}`);
}

// PR patches seen recently (`gh pr diff` output), keyed by repo#num@head. The
// UI requests the diff when a PR opens, so program diffs can usually reuse it.
const patches = new Map<string, Promise<string>>();
export function rememberPatch(repo: string, num: number, head: string, patch: Promise<string>) {
  patches.set(`${repo}#${num}@${head}`, patch);
  if (patches.size > 50) patches.delete(patches.keys().next().value!);
}

/** The `diff --git` section for one path, as `git apply` expects it. */
function filePatch(all: string, path: string): string | null {
  const start = all.indexOf(`diff --git a/${path} b/${path}\n`);
  if (start < 0) return null;
  const next = all.indexOf("\ndiff --git ", start + 1);
  const section = all.slice(start, next < 0 ? undefined : next + 1);
  return /\n(GIT binary patch|Binary files )/.test(section) ? null : section;
}

/** Recover the pre-PR file by reverse-applying its patch to the head version. */
async function reverseApply(path: string, after: string, patch: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "digitata-rev-"));
  try {
    const file = join(dir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, after);
    await writeFile(join(dir, ".pr.patch"), patch);
    await runOk("git", ["apply", "-R", "--whitespace=nowarn", ".pr.patch"], { cwd: dir });
    return await readFile(file, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const git = (cwd: string, args: string[]) =>
  runOk("git", ["-c", "user.name=digitata", "-c", "user.email=digitata@localhost", "-c", "commit.gpgsign=false", ...args], { cwd });

export function isProgramFile(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  // deps.cirru is a dependency manifest, not a program snapshot.
  return path.endsWith(".cirru") && base !== "deps.cirru";
}

/** Parse the CLI's human output into header fields and the tree section. */
export function parseProgramDiff(path: string, stdout: string, stderr: string): ProgramDiffResult {
  const lines = stdout.split("\n");
  const meta: Record<string, string> = {};
  const notes: string[] = [];
  const tree: string[] = [];
  let section = "";
  for (const line of lines) {
    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      continue;
    }
    if (section === "Tree Diff") {
      tree.push(line);
      continue;
    }
    const m = /^- ([\w ]+): (.*)$/.exec(line);
    if (m) meta[m[1]] = m[2];
    else if (/^(note|warning|Error)/i.test(line)) notes.push(line);
  }
  while (tree.length && tree[tree.length - 1].trim() === "") tree.pop();
  for (const l of stderr.split("\n")) if (l.trim()) notes.push(l);
  return { ok: tree.length > 0, path, meta, tree, notes };
}

export async function programDiff(repo: string, num: number, path: string, baseSha: string, headSha: string): Promise<ProgramDiffResult> {
  assertRepo(repo);
  if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(headSha)) throw new Error("base/head must be full SHAs");
  if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`invalid path ${path}`);
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const lap = (k: string) => (timings[k] = Date.now() - t0);

  // Two ways to get the merge-base version, raced; whichever finishes first wins:
  //  - patch: fetch the PR patch (relative to the merge base, like `gh pr diff`)
  //    alongside the head file and reverse-apply it — one round trip;
  //  - mergeBase: resolve the merge base, then fetch the file there — two
  //    round trips, but faster when the PR's whole patch is large.
  const afterP = fileAt(repo, headSha, path);
  const key = `${repo}#${num}@${headSha}`;
  if (!patches.has(key)) rememberPatch(repo, num, headSha, runOk("gh", ["pr", "diff", String(num), "-R", repo, "--color", "never"], { cwd: GH_CWD, timeoutMs: 180_000 }));
  const viaPatch = (async () => {
    const [after, all] = await Promise.all([afterP, patches.get(key)!]);
    const patch = filePatch(all, path);
    if (after === null || !patch) throw new Error("no usable patch");
    const before = await reverseApply(path, after, patch);
    timings.via = 1;
    return before;
  })();
  const viaMergeBase = (async () => {
    const mergeBase = await mergeBaseOf(repo, baseSha, headSha);
    const before = await fileAt(repo, mergeBase, path);
    timings.via ??= 2;
    return before;
  })();
  const [before, after] = await Promise.all([Promise.any([viaPatch, viaMergeBase]), afterP]);
  viaPatch.catch(() => {});
  viaMergeBase.catch(() => {});
  lap("fetch");

  const dir = await mkdtemp(join(tmpdir(), "digitata-pd-"));
  try {
    const file = join(dir, path);
    await mkdir(dirname(file), { recursive: true });
    await git(dir, ["init", "-q"]);

    if (before === null && after === null) throw new Error(`${path} not found in base or head`);
    // Added or deleted files: the CLI needs both sides, so report it plainly.
    if (before === null || after === null) {
      return { ok: false, path, meta: {}, tree: [], notes: [], error: after !== null ? "该文件为新增，无 base 可比较" : "该文件被删除" };
    }

    await writeFile(file, before);
    await git(dir, ["add", "--", path]);
    await git(dir, ["commit", "-q", "-m", "base"]);
    await writeFile(file, after);
    await git(dir, ["commit", "-q", "-am", "head"]);
    lap("gitRepo");
    const args = [path, "analyze", "program-diff", "--base", "HEAD~1"];
    const [r, j] = await Promise.all([
      run(CALCIT, [...args, "HEAD"], { cwd: dir, timeoutMs: 120_000 }),
      // The JSON format adds per-definition schema direction and widening evidence.
      run(CALCIT, [...args, "--format", "json", "HEAD"], { cwd: dir, timeoutMs: 120_000 }),
    ]);
    lap("calcit");
    const res = parseProgramDiff(path, r.stdout, r.stderr);
    res.codes = changedCodes(before, after);
    lap("codes");
    res.timings = timings;
    console.log(`program-diff ${repo} ${path}: ${JSON.stringify(timings)}`);
    try {
      const ev = JSON.parse(j.stdout.slice(j.stdout.indexOf("{"))).data?.evidence;
      res.schema = (ev?.changes ?? [])
        .filter((c: { category?: string }) => c.category === "schema-signature")
        .map((c: { definition: string; schema_direction?: string }) => ({ def: c.definition, direction: c.schema_direction ?? "changed" }));
      res.widening = ev?.schema_widening ?? [];
    } catch {
      // keep the human output only
    }
    if (r.code !== 0 || !res.ok) res.error = (r.stderr || r.stdout).trim().split("\n").slice(-5).join("\n") || `calcit exited ${r.code}`;
    return res;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
