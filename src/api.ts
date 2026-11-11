import type { InboxFilter, MergeRequest, PRDetail, PRSummary, ProgramDiffResult } from "../shared/types.ts";

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
};

// Cache keys and fetch options shared by views and hover prefetch.
export const q = {
  inbox: (filter: InboxFilter, query: string) => ({
    key: `inbox:${filter}:${query}`,
    fetch: () => api.inbox(filter, query),
    opts: { label: "收件箱", persist: true, keepPrevious: true },
  }),
  list: (repo: string, state: string, query: string) => ({
    key: `list:${repo}:${state}:${query}`,
    fetch: () => api.listPRs(repo, state, query),
    opts: { label: `${repo} PR 列表`, persist: true, keepPrevious: true },
  }),
  pr: (repo: string, num: number) => ({
    key: `pr:${repo}#${num}`,
    fetch: () => api.getPR(repo, num),
    opts: { label: `#${num} 详情`, persist: true },
  }),
  diff: (repo: string, num: number) => ({
    key: `diff:${repo}#${num}`,
    fetch: () => api.getDiff(repo, num),
    opts: { label: `#${num} diff` },
  }),
  programDiff: (repo: string, num: number, path: string, baseSha: string, head: string) => ({
    key: `pd2:${repo}:${path}:${baseSha}:${head}`,
    fetch: () => api.programDiff(repo, num, path, baseSha, head),
    opts: { label: `program diff ${path.split("/").pop()}`, persist: true, immutable: true },
  }),
};
