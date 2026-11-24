// CodeHost implemented on top of the `gh` CLI (uses the user's existing gh login).

import type {
  Check,
  CheckState,
  ChecksSummary,
  InboxFilter,
  MergeRequest,
  PRDetail,
  PRSummary,
  ResolveThreadResult,
  ReviewComment,
  ReviewThread,
} from "../shared/types.ts";
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

const THREAD_ID_RE = /^[A-Za-z0-9_+=/:-]{1,200}$/;
export function assertThreadId(id: string): string {
  if (typeof id !== "string" || !THREAD_ID_RE.test(id)) throw new Error("invalid threadId");
  return id;
}

/** Keep the trailing context lines (plus the leading @@ header) so long diffs stay compact. */
export function trimDiffHunk(raw: string, maxLines = 8, maxLineLen = 500): string {
  if (!raw) return "";
  const lines = raw.split("\n");
  let kept: string[];
  if (lines.length > maxLines + 1 && lines[0].startsWith("@@")) {
    kept = [lines[0], "…", ...lines.slice(-maxLines)];
  } else if (lines.length > maxLines) {
    kept = lines.slice(-maxLines);
  } else {
    kept = lines;
  }
  return kept.map((l) => (l.length > maxLineLen ? `${l.slice(0, maxLineLen)}…` : l)).join("\n");
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
        reviewThreads(first: 100) { totalCount nodes { isResolved } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 0) {
          totalCount
          checkRunCountsByState { state count }
          statusContextCountsByState { state count }
        } } } } }
      }
    }
  }
}`;

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $num: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $num) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine startLine diffSide
          viewerCanResolve viewerCanUnresolve viewerCanReply
          resolvedBy { login }
          comments(first: 50) {
            nodes { id author { login } body createdAt url diffHunk }
          }
        }
      }
    }
  }
}`;

const RESOLVE_THREAD_MUTATION = `mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) {
    thread { id isResolved viewerCanResolve viewerCanUnresolve resolvedBy { login } }
  }
}`;

const UNRESOLVE_THREAD_MUTATION = `mutation($id: ID!) {
  unresolveReviewThread(input: { threadId: $id }) {
    thread { id isResolved viewerCanResolve viewerCanUnresolve resolvedBy { login } }
  }
}`;

const REPLY_THREAD_MUTATION = `mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id author { login } body createdAt url }
  }
}`;

async function ghGraphql(args: string[]): Promise<Json> {
  const raw = JSON.parse(await gh(["api", "graphql", ...args]));
  if (raw.errors?.length) {
    throw new Error(raw.errors.map((e: Json) => e?.message ?? String(e)).join("; "));
  }
  return raw;
}

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
    unresolvedThreads: n.reviewThreads
      ? (n.reviewThreads.nodes ?? []).filter((t: Json) => t && !t.isResolved).length
      : undefined,
    url: n.url,
  };
}

export class GhCliHost implements CodeHost {
  private login?: Promise<string>;
  viewer(): Promise<string> {
    this.login ??= gh(["api", "user", "--jq", ".login"])
      .then((s) => s.trim())
      .catch((e) => {
        this.login = undefined;
        throw e;
      });
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

  private async fetchReviewThreads(repo: string, num: number): Promise<ReviewThread[]> {
    const [owner, name] = assertRepo(repo).split("/");
    const threads: ReviewThread[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const args = ["-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `num=${num}`, "-f", `query=${REVIEW_THREADS_QUERY}`];
      if (cursor) args.push("-f", `cursor=${cursor}`);
      const raw = await ghGraphql(args).catch(() => ghGraphql(args));
      const conn = raw.data?.repository?.pullRequest?.reviewThreads;
      if (!conn) break;
      for (const n of conn.nodes ?? []) {
        if (!n) continue;
        const rawComments: Json[] = (n.comments?.nodes ?? []).filter(Boolean);
        threads.push({
          id: n.id,
          isResolved: !!n.isResolved,
          isOutdated: !!n.isOutdated,
          path: n.path ?? "",
          line: n.line ?? null,
          startLine: n.startLine ?? null,
          originalLine: n.originalLine ?? null,
          diffSide: n.diffSide ?? "RIGHT",
          diffHunk: trimDiffHunk(rawComments[0]?.diffHunk ?? ""),
          resolvedBy: n.resolvedBy?.login || undefined,
          viewerCanResolve: !!n.viewerCanResolve,
          viewerCanUnresolve: !!n.viewerCanUnresolve,
          viewerCanReply: !!n.viewerCanReply,
          comments: rawComments.map((c) => ({
            id: c.id,
            author: c.author?.login ?? "ghost",
            body: c.body ?? "",
            createdAt: c.createdAt ?? "",
            url: c.url ?? "",
          })),
        });
      }
      if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
      cursor = conn.pageInfo.endCursor;
    }
    return threads;
  }

  async getPR(repo: string, num: number): Promise<PRDetail> {
    assertRepo(repo);
    const [rawStr, reviewThreads] = await Promise.all([
      gh(["pr", "view", String(num), "-R", repo, "--json", DETAIL_FIELDS.join(",")]),
      this.fetchReviewThreads(repo, num),
    ]);
    const raw = JSON.parse(rawStr);
    const { _checks, ...s } = toSummary(raw);
    return {
      ...s,
      unresolvedThreads: reviewThreads.filter((t) => !t.isResolved).length,
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
      reviewThreads,
    };
  }

  async getDiff(repo: string, num: number): Promise<string> {
    return gh(["pr", "diff", String(num), "-R", assertRepo(repo), "--color", "never"], 180_000);
  }

  async resolveThread(repo: string, _num: number, threadId: string, resolved: boolean): Promise<ResolveThreadResult> {
    assertRepo(repo);
    assertThreadId(threadId);
    const mutation = resolved ? RESOLVE_THREAD_MUTATION : UNRESOLVE_THREAD_MUTATION;
    const raw = await ghGraphql(["-f", `id=${threadId}`, "-f", `query=${mutation}`]);
    const t = resolved ? raw.data?.resolveReviewThread?.thread : raw.data?.unresolveReviewThread?.thread;
    if (!t) throw new Error("unexpected GraphQL response for thread resolve");
    return {
      isResolved: !!t.isResolved,
      viewerCanResolve: !!t.viewerCanResolve,
      viewerCanUnresolve: !!t.viewerCanUnresolve,
      resolvedBy: t.resolvedBy?.login || undefined,
    };
  }

  async replyToThread(repo: string, _num: number, threadId: string, body: string): Promise<ReviewComment> {
    assertRepo(repo);
    assertThreadId(threadId);
    if (!body.trim()) throw new Error("reply body must not be empty");
    const raw = await ghGraphql(["-f", `threadId=${threadId}`, "-f", `body=${body}`, "-f", `query=${REPLY_THREAD_MUTATION}`]);
    const c = raw.data?.addPullRequestReviewThreadReply?.comment;
    if (!c) throw new Error("unexpected GraphQL response for thread reply");
    return {
      id: c.id,
      author: c.author?.login ?? "ghost",
      body: c.body ?? "",
      createdAt: c.createdAt ?? "",
      url: c.url ?? "",
    };
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
