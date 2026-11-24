import { prefetch } from "./store.ts";
import type {
  InboxFilter,
  MergeRequest,
  PRDetail,
  PRSummary,
  ProgramDiffResult,
  ResolveThreadResult,
  ReviewComment,
} from "../shared/types.ts";

async function req<T>(url: string, init?: RequestInit, as: "json" | "text" = "json"): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      msg = (await r.json()).error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return (as === "json" ? r.json() : r.text()) as Promise<T>;
}

const base = (repo: string) => `/api/repos/${repo}/pulls`;

export const api = {
  viewer: () => req<{ login: string }>("/api/viewer"),
  inbox: (filter: InboxFilter, q: string) => req<PRSummary[]>(`/api/inbox?${new URLSearchParams({ filter, q })}`),
  listPRs: (repo: string, state: string, q: string) =>
    req<PRSummary[]>(`${base(repo)}?${new URLSearchParams({ state, q })}`),
  getPR: (repo: string, num: number) => req<PRDetail>(`${base(repo)}/${num}`),
  getDiff: (repo: string, num: number) => req<string>(`${base(repo)}/${num}/diff`, undefined, "text"),
  programDiff: (repo: string, num: number, path: string, baseSha: string, head: string) =>
    req<ProgramDiffResult>(`${base(repo)}/${num}/program-diff?${new URLSearchParams({ path, base: baseSha, head })}`),
  merge: (repo: string, num: number, body: MergeRequest) =>
    req<{ message: string }>(`${base(repo)}/${num}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  resolveThread: (repo: string, num: number, threadId: string, resolved: boolean) =>
    req<ResolveThreadResult>(`${base(repo)}/${num}/threads/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, resolved }),
    }),
  replyToThread: (repo: string, num: number, threadId: string, body: string) =>
    req<{ comment: ReviewComment }>(`${base(repo)}/${num}/threads/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, body }),
    }),
};

// Cache keys and fetch options shared by views and hover prefetch.
export const q = {
  viewer: () => ({ key: "viewer", fetch: api.viewer, opts: { label: "账号", persist: true, immutable: true } }),
  inbox: (filter: InboxFilter, query: string) => ({
    key: `inbox3:${filter}:${query}`,
    fetch: () => api.inbox(filter, query),
    opts: { label: "待合并列表", persist: true, keepPrevious: true },
  }),
  list: (repo: string, state: string, query: string) => ({
    key: `list:${repo}:${state}:${query}`,
    fetch: () => api.listPRs(repo, state, query),
    opts: { label: `${repo} PR 列表`, persist: true, keepPrevious: true },
  }),
  pr: (repo: string, num: number) => ({
    key: `pr2:${repo}#${num}`,
    fetch: () => api.getPR(repo, num),
    opts: { label: `#${num} 详情`, persist: true },
  }),
  diff: (repo: string, num: number) => ({
    key: `diff:${repo}#${num}`,
    fetch: () => api.getDiff(repo, num),
    opts: { label: `#${num} diff` },
  }),
  programDiff: (repo: string, num: number, path: string, baseSha: string, head: string) => ({
    key: `pd7:${repo}:${path}:${baseSha}:${head}`,
    fetch: () => api.programDiff(repo, num, path, baseSha, head),
    opts: { label: programDiffLabel(path), persist: true, immutable: true },
  }),
};

/** Calcit snapshot files get a program diff (deps.cirru is a manifest). */
export const isProgramPath = (path: string) => path.endsWith(".cirru") && !path.endsWith("deps.cirru");

/**
 * Start program diffs for a PR's snapshot files as soon as its head/base are
 * known, so they are usually ready by the time the file is scrolled to.
 */
export function prefetchProgramDiffs(repo: string, pr: PRDetail) {
  for (const f of pr.files) {
    if (!isProgramPath(f.path)) continue;
    const x = q.programDiff(repo, pr.number, f.path, pr.baseRefOid, pr.headRefOid);
    prefetch(x.key, x.fetch, x.opts);
  }
}

export const programDiffLabel = (path: string) => `program diff ${path}`;
