// Types shared by the API server and the browser UI.

export type CheckState = "success" | "failure" | "pending" | "neutral" | "skipped";

export interface Check {
  name: string;
  state: CheckState;
  /** Raw status/conclusion string from GitHub, for display. */
  detail: string;
  url?: string;
}

export interface ChecksSummary {
  total: number;
  success: number;
  failure: number;
  pending: number;
  /** Overall state: failure beats pending beats success. "none" when there are no checks. */
  state: CheckState | "none";
}

export interface PRSummary {
  /** owner/name; always set by the inbox, which spans repos. */
  repo?: string;
  number: number;
  title: string;
  author: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  state: string;
  updatedAt: string;
  createdAt?: string;
  reviewDecision: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  checks: ChecksSummary;
  url: string;
}

export interface PRFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface PRCommit {
  oid: string;
  headline: string;
  author: string;
}

export interface PRDetail extends PRSummary {
  body: string;
  headRefOid: string;
  baseRefOid: string;
  mergeable: string;
  mergeStateStatus: string;
  files: PRFile[];
  commits: PRCommit[];
  checkList: Check[];
  reviews: { author: string; state: string }[];
}

export type MergeMethod = "squash" | "merge" | "rebase";

export interface MergeRequest {
  method: MergeMethod;
  deleteBranch: boolean;
  /** The head commit the user reviewed; the merge is refused if the PR moved since. */
  headRefOid: string;
}

export interface ProgramDiffResult {
  ok: boolean;
  path: string;
  /** Header fields from the CLI, e.g. classification, changes. */
  meta: Record<string, string>;
  /** Lines of the "Tree Diff" section, as printed by `calcit analyze program-diff`. */
  tree: string[];
  /** Notes / errors printed by the CLI. */
  notes: string[];
  /** Definitions whose type signature (schema) changed, with direction (widened / narrowed / changed). */
  schema?: { def: string; direction: string }[];
  /** Schema slots that got wider, as reported by the CLI (risky for callers). */
  widening?: unknown[];
  /** Code trees of definitions whose code changed, for the structural tree view. */
  codes?: DefCode[];
  /** Cumulative ms at each server step (mergeBase, files, gitRepo, calcit). */
  timings?: Record<string, number>;
  error?: string;
}

/** Inbox filters, mirroring github.com/pulls: authored, review requested, assigned. */
export type InboxFilter = "all" | "author" | "review" | "assignee" | "mentioned";

/** A Cirru tree: a leaf string or a list of nodes. */
export type Cirru = string | Cirru[];

/** Code of one definition before and after (absent when added/removed). `key` is `ns/def`, or `ns/:ns` for the ns form. */
export interface DefCode {
  key: string;
  old?: Cirru;
  new?: Cirru;
}
