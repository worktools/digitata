// Calcit program diff: keeps a cached clone per repo, fetches the PR's base and
// head commits, and runs `calcit analyze program-diff --base <base> <head>`,
// which compares two snapshots ns -> def and prints a structural tree diff.

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProgramDiffResult } from "../shared/types.ts";
import { assertRepo } from "./gh.ts";
import { run, runOk, serialized } from "./run.ts";

const CACHE_DIR = process.env.DIGITATA_CACHE ?? join(homedir(), ".cache", "digitata", "repos");
const CALCIT = process.env.DIGITATA_CALCIT ?? "calcit";

async function ensureClone(repo: string): Promise<string> {
  const dir = join(CACHE_DIR, ...assertRepo(repo).split("/"));
  if (!existsSync(join(dir, ".git"))) {
    await mkdir(dir, { recursive: true });
    // Blobless clone keeps the first fetch small; blobs are pulled on demand by git show/checkout.
    await runOk("gh", ["repo", "clone", repo, dir, "--", "--filter=blob:none", "--no-checkout", "-q"], { timeoutMs: 600_000 });
  }
  return dir;
}

async function hasCommit(dir: string, sha: string): Promise<boolean> {
  return (await run("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: dir })).code === 0;
}

async function fileAt(dir: string, sha: string, path: string): Promise<boolean> {
  return (await run("git", ["cat-file", "-e", `${sha}:${path}`], { cwd: dir })).code === 0;
}

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

export function programDiff(repo: string, num: number, path: string, baseSha: string, headSha: string): Promise<ProgramDiffResult> {
  if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(headSha)) throw new Error("base/head must be full SHAs");
  if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`invalid path ${path}`);
  return serialized(repo, async () => {
    const dir = await ensureClone(repo);
    if (!(await hasCommit(dir, headSha)) || !(await hasCommit(dir, baseSha))) {
      await runOk("git", ["fetch", "-q", "origin", `+refs/pull/${num}/head:refs/digitata/pr/${num}`, baseSha], { cwd: dir, timeoutMs: 600_000 });
    }
    // Like `gh pr diff`, compare against the merge base rather than the base branch tip,
    // so commits that landed on the base branch after the PR branched are not shown.
    const mergeBase = (await runOk("git", ["merge-base", baseSha, headSha], { cwd: dir })).trim() || baseSha;
    // The CLI resolves the input path in the working tree, so check out a
    // commit that has the file (head, or base when the PR deletes it).
    const inHead = await fileAt(dir, headSha, path);
    const inBase = await fileAt(dir, mergeBase, path);
    if (!inHead && !inBase) throw new Error(`${path} not found in base or head`);
    // Added or deleted files: the CLI needs both sides, so report it plainly.
    if (!inHead || !inBase) {
      return { ok: false, path, meta: {}, tree: [], notes: [], error: inHead ? "该文件为新增，无 base 可比较" : "该文件被删除" };
    }
    await runOk("git", ["checkout", "-q", "--force", "--detach", headSha], { cwd: dir, timeoutMs: 600_000 });
    const r = await run(CALCIT, [path, "analyze", "program-diff", "--base", mergeBase, headSha], { cwd: dir, timeoutMs: 120_000 });
    const res = parseProgramDiff(path, r.stdout, r.stderr);
    if (r.code !== 0 || !res.ok) res.error = (r.stderr || r.stdout).trim().split("\n").slice(-5).join("\n") || `calcit exited ${r.code}`;
    return res;
  });
}
