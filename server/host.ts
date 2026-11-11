// The code-host interface the server talks to. Today it is implemented with the
// gh CLI (server/gh.ts); a direct REST/GraphQL implementation can replace it
// without touching the routes or the UI.

import type { MergeRequest, PRDetail, PRSummary } from "../shared/types.ts";

export interface ListOptions {
  state?: "open" | "closed" | "merged" | "all";
  search?: string;
  limit?: number;
}

export interface CodeHost {
  listPRs(repo: string, opts?: ListOptions): Promise<PRSummary[]>;
  getPR(repo: string, num: number): Promise<PRDetail>;
  /** Unified diff (git patch format) of the whole PR. */
  getDiff(repo: string, num: number): Promise<string>;
  merge(repo: string, num: number, req: MergeRequest): Promise<string>;
}
