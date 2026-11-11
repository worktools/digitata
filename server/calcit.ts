// Calcit program diff without cloning: fetch the file at the merge base and at
// the PR head through the GitHub API, commit both into a throwaway two-commit
// git repo, and run `calcit analyze program-diff --base <c1> <c2>` there (the
// CLI reads both sides from git history).

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProgramDiffResult } from "../shared/types.ts";
import { assertRepo } from "./gh.ts";
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

export async function programDiff(repo: string, _num: number, path: string, baseSha: string, headSha: string): Promise<ProgramDiffResult> {
  assertRepo(repo);
  if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(headSha)) throw new Error("base/head must be full SHAs");
  if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`invalid path ${path}`);
  const mergeBase = await mergeBaseOf(repo, baseSha, headSha);
  const [before, after] = await Promise.all([fileAt(repo, mergeBase, path), fileAt(repo, headSha, path)]);
  if (before === null && after === null) throw new Error(`${path} not found in base or head`);
  // Added or deleted files: the CLI needs both sides, so report it plainly.
  if (before === null || after === null) {
    return { ok: false, path, meta: {}, tree: [], notes: [], error: after !== null ? "该文件为新增，无 base 可比较" : "该文件被删除" };
  }

  const dir = await mkdtemp(join(tmpdir(), "digitata-pd-"));
  try {
    const file = join(dir, path);
    await mkdir(dirname(file), { recursive: true });
    await git(dir, ["init", "-q"]);
    await writeFile(file, before);
    await git(dir, ["add", "--", path]);
    await git(dir, ["commit", "-q", "-m", "base"]);
    await writeFile(file, after);
    await git(dir, ["commit", "-q", "-am", "head"]);
    const args = [path, "analyze", "program-diff", "--base", "HEAD~1"];
    const [r, j] = await Promise.all([
      run(CALCIT, [...args, "HEAD"], { cwd: dir, timeoutMs: 120_000 }),
      // The JSON format adds per-definition schema direction and widening evidence.
      run(CALCIT, [...args, "--format", "json", "HEAD"], { cwd: dir, timeoutMs: 120_000 }),
    ]);
    const res = parseProgramDiff(path, r.stdout, r.stderr);
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
