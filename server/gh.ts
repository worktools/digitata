// CodeHost implemented on top of the `gh` CLI (uses the user's existing gh login).

import type { Check, CheckState, ChecksSummary, MergeRequest, PRDetail, PRSummary } from "../shared/types.ts";
import type { CodeHost, ListOptions } from "./host.ts";
import { tmpdir } from "node:os";
import { runOk } from "./run.ts";

// Run gh outside any git checkout so flags like --delete-branch never touch a local repo.
const gh = (args: string[], timeoutMs?: number) => runOk("gh", args, { cwd: tmpdir(), timeoutMs });

const SUMMARY_FIELDS = [
  "number",
  "title",
  "author",
  "headRefName",
  "baseRefName",
  "isDraft",
  "state",
  "updatedAt",
  "reviewDecision",
  "additions",
  "deletions",
  "changedFiles",
  "labels",
  "statusCheckRollup",
  "url",
];

const DETAIL_FIELDS = [
  ...SUMMARY_FIELDS,
  "body",
  "headRefOid",
  "baseRefOid",
  "mergeable",
  "mergeStateStatus",
  "files",
  "commits",
  "latestReviews",
];

type Json = any;

function checkState(raw: Json): Check {
  if (raw.__typename === "StatusContext") {
    const s = String(raw.state ?? "").toUpperCase();
    const state: CheckState = s === "SUCCESS" ? "success" : s === "PENDING" || s === "EXPECTED" ? "pending" : "failure";
    return { name: raw.context ?? "status", state, detail: s, url: raw.targetUrl || undefined };
  }
  const status = String(raw.status ?? "").toUpperCase();
  const conclusion = String(raw.conclusion ?? "").toUpperCase();
  let state: CheckState;
  if (status !== "COMPLETED") state = "pending";
  else if (conclusion === "SUCCESS") state = "success";
  else if (conclusion === "NEUTRAL") state = "neutral";
  else if (conclusion === "SKIPPED") state = "skipped";
  else state = "failure";
  const name = raw.workflowName ? `${raw.workflowName} / ${raw.name}` : raw.name;
  return { name, state, detail: status === "COMPLETED" ? conclusion : status, url: raw.detailsUrl || undefined };
}

export function summarizeChecks(checks: Check[]): ChecksSummary {
  const s: ChecksSummary = { total: checks.length, success: 0, failure: 0, pending: 0, state: "none" };
  for (const c of checks) {
    if (c.state === "failure") s.failure++;
    else if (c.state === "pending") s.pending++;
    else s.success++;
  }
  if (s.total > 0) s.state = s.failure > 0 ? "failure" : s.pending > 0 ? "pending" : "success";
  return s;
}

function toSummary(raw: Json): PRSummary & { _checks: Check[] } {
  const checks: Check[] = (raw.statusCheckRollup ?? []).map(checkState);
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author?.login ?? "",
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    isDraft: !!raw.isDraft,
    state: raw.state,
    updatedAt: raw.updatedAt,
    reviewDecision: raw.reviewDecision ?? "",
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
    labels: (raw.labels ?? []).map((l: Json) => l.name),
    checks: summarizeChecks(checks),
    url: raw.url,
    _checks: checks,
  };
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
export function assertRepo(repo: string): string {
  if (!REPO_RE.test(repo)) throw new Error(`invalid repo: ${repo}`);
  return repo;
}

export class GhCliHost implements CodeHost {
  async listPRs(repo: string, opts: ListOptions = {}): Promise<PRSummary[]> {
    const args = ["pr", "list", "-R", assertRepo(repo), "--json", SUMMARY_FIELDS.join(","), "--limit", String(opts.limit ?? 50)];
    args.push("--state", opts.state ?? "open");
    if (opts.search) args.push("--search", opts.search);
    const raw: Json[] = JSON.parse(await gh(args));
    return raw.map((r) => {
      const { _checks, ...s } = toSummary(r);
      return s;
    });
  }

  async getPR(repo: string, num: number): Promise<PRDetail> {
    const raw = JSON.parse(await gh(["pr", "view", String(num), "-R", assertRepo(repo), "--json", DETAIL_FIELDS.join(",")]));
    const { _checks, ...s } = toSummary(raw);
    return {
      ...s,
      body: raw.body ?? "",
      headRefOid: raw.headRefOid,
      baseRefOid: raw.baseRefOid,
      mergeable: raw.mergeable ?? "",
      mergeStateStatus: raw.mergeStateStatus ?? "",
      files: (raw.files ?? []).map((f: Json) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      commits: (raw.commits ?? []).map((c: Json) => ({
        oid: c.oid,
        headline: c.messageHeadline,
        author: c.authors?.[0]?.login || c.authors?.[0]?.name || "",
      })),
      checkList: _checks,
      reviews: (raw.latestReviews ?? []).map((r: Json) => ({ author: r.author?.login ?? "", state: r.state })),
    };
  }

  async getDiff(repo: string, num: number): Promise<string> {
    return gh(["pr", "diff", String(num), "-R", assertRepo(repo), "--color", "never"], 180_000);
  }

  async merge(repo: string, num: number, req: MergeRequest): Promise<string> {
    if (!/^[0-9a-f]{40}$/.test(req.headRefOid)) throw new Error("headRefOid must be a full commit SHA");
    const method = { squash: "--squash", merge: "--merge", rebase: "--rebase" }[req.method];
    if (!method) throw new Error(`unknown merge method ${req.method}`);
    const args = ["pr", "merge", String(num), "-R", assertRepo(repo), method, "--match-head-commit", req.headRefOid];
    if (req.deleteBranch) args.push("--delete-branch");
    const out = await gh(args, 180_000);
    return out.trim() || "merged";
  }
}
