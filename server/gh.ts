// CodeHost implemented on top of the `gh` CLI (uses the user's existing gh login).

import type { Check, CheckState, ChecksSummary, InboxFilter, MergeRequest, PRDetail, PRSummary } from "../shared/types.ts";
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
  "createdAt",
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
    createdAt: raw.createdAt,
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

const INBOX_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url state isDraft updatedAt createdAt additions deletions changedFiles
        reviewDecision headRefName baseRefName
        repository { nameWithOwner }
        author { login }
        labels(first: 10) { nodes { name } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 0) {
          totalCount
          checkRunCountsByState { state count }
          statusContextCountsByState { state count }
        } } } } }
      }
    }
  }
}`;

const INBOX_QUALIFIER: Record<Exclude<InboxFilter, "all">, string> = {
  author: "author:@me",
  review: "review-requested:@me",
  assignee: "assignee:@me",
  mentioned: "mentions:@me",
};

const RUN_OK = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const RUN_BAD = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED", "STALE", "ERROR"]);

/** Summarize rollup counts from GraphQL without fetching every check. */
function rollupSummary(rollup: Json): ChecksSummary {
  const s: ChecksSummary = { total: 0, success: 0, failure: 0, pending: 0, state: "none" };
  if (!rollup) return s;
  const counts = [...(rollup.contexts?.checkRunCountsByState ?? []), ...(rollup.contexts?.statusContextCountsByState ?? [])];
  for (const { state, count } of counts) {
    if (!count) continue;
    s.total += count;
    if (RUN_OK.has(state)) s.success += count;
    else if (RUN_BAD.has(state)) s.failure += count;
    else s.pending += count;
  }
  if (s.total > 0) s.state = s.failure > 0 ? "failure" : s.pending > 0 ? "pending" : "success";
  return s;
}

function searchNodeToSummary(n: Json): PRSummary {
  return {
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    author: n.author?.login ?? "",
    headRefName: n.headRefName,
    baseRefName: n.baseRefName,
    isDraft: !!n.isDraft,
    state: n.state,
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    reviewDecision: n.reviewDecision ?? "",
    additions: n.additions ?? 0,
    deletions: n.deletions ?? 0,
    changedFiles: n.changedFiles ?? 0,
    labels: (n.labels?.nodes ?? []).map((l: Json) => l.name),
    checks: rollupSummary(n.commits?.nodes?.[0]?.commit?.statusCheckRollup),
    url: n.url,
  };
}

export class GhCliHost implements CodeHost {
  private login?: Promise<string>;
  viewer(): Promise<string> {
    this.login ??= gh(["api", "user", "--jq", ".login"]).then((s) => s.trim());
    return this.login;
  }

  async inbox(filter: InboxFilter, extra = ""): Promise<PRSummary[]> {
    // GitHub search has no OR across qualifiers, so "all" runs one search per qualifier and merges.
    const quals = filter === "all" ? ["author", "review", "assignee"] as const : [filter];
    const results = await Promise.all(
      quals.map(async (k) => {
        const q = `is:open is:pr archived:false ${INBOX_QUALIFIER[k]} sort:updated-desc ${extra}`.trim();
        const args = ["api", "graphql", "-f", `q=${q}`, "-f", `query=${INBOX_QUERY}`];
        // GitHub's search API returns sporadic 502s on heavy queries; retry once.
        const raw = JSON.parse(await gh(args).catch(() => gh(args)));
        return (raw.data?.search?.nodes ?? []).filter((n: Json) => n?.number).map(searchNodeToSummary) as PRSummary[];
      }),
    );
    const seen = new Map<string, PRSummary>();
    for (const pr of results.flat()) seen.set(pr.url, pr);
    return [...seen.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

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
    if (process.env.DIGITATA_DRY_MERGE) {
      // Test mode: never calls GitHub; simulates a slow merge that fails (or succeeds with =ok).
      await new Promise((r) => setTimeout(r, 5000));
      if (process.env.DIGITATA_DRY_MERGE === "ok") return `dry run: pretended to merge ${repo}#${num}`;
      throw new Error(`dry run: would merge ${repo}#${num} (${req.method})`);
    }
    const args = ["pr", "merge", String(num), "-R", assertRepo(repo), method, "--match-head-commit", req.headRefOid];
    if (req.deleteBranch) args.push("--delete-branch");
    const out = await gh(args, 180_000);
    return out.trim() || "merged";
  }
}
