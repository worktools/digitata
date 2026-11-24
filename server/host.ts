// The code-host interface the server talks to. Today it is implemented with the
// gh CLI (server/gh.ts); a direct REST/GraphQL implementation can replace it
// without touching the routes or the UI.

import type { InboxFilter, MergeRequest, PRDetail, PRSummary, ResolveThreadResult, ReviewComment } from "../shared/types.ts";

export interface ListOptions {
  state?: "open" | "closed" | "merged" | "all";
  search?: string;
  limit?: number;
}

export interface CodeHost {
  /** Open PRs across all repos that involve the viewer (like github.com/pulls). */
  inbox(filter: InboxFilter, extra?: string): Promise<PRSummary[]>;
  /** Login of the signed-in user. */
  viewer(): Promise<string>;
  listPRs(repo: string, opts?: ListOptions): Promise<PRSummary[]>;
  getPR(repo: string, num: number): Promise<PRDetail>;
  /** Unified diff (git patch format) of the whole PR. */
  getDiff(repo: string, num: number): Promise<string>;
  merge(repo: string, num: number, req: MergeRequest): Promise<string>;
  resolveThread(repo: string, num: number, threadId: string, resolved: boolean): Promise<ResolveThreadResult>;
  replyToThread(repo: string, num: number, threadId: string, body: string): Promise<ReviewComment>;
}
