import type { MergeRequest, PRDetail, PRSummary, ProgramDiffResult } from "../shared/types.ts";

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
