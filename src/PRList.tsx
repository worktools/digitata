import { useEffect, useRef, useState } from "react";
import type { ChecksSummary, PRDetail, PRSummary } from "../shared/types.ts";
import { prefetchProgramDiffs, q as Q } from "./api.ts";
import { load, mergeKey, peek, prefetch, rememberSummaries, useCached, useMerges } from "./store.ts";

/** Refresh when reloadKey bumps (after a merge), but not on mount. */
function useReload(reloadKey: number, refresh: () => void) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    refresh();
  }, [reloadKey]);
}

/** `n` opens the next PR after the selected one, or the first when the selected one is not in the list (ignored while typing or with a dialog open). */
function useFirstShortcut(first: (() => void) | null) {
  const ref = useRef(first);
  ref.current = first;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || document.querySelector(".modal")) return;
      if (!ref.current) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

/** Hovering a row warms the detail and diff caches so opening it is instant. */
function hoverPrefetch(repo: string, num: number) {
  const a = Q.pr(repo, num);
  const b = Q.diff(repo, num);
  // Detail first: its SHAs let the (slowest) program diffs start right away.
  const cached = peek<PRDetail>(a.key, true);
  if (cached) prefetchProgramDiffs(repo, cached);
  load(a.key, a.fetch, a.opts)
    .then((pr) => prefetchProgramDiffs(repo, pr))
    .catch(() => {});
  prefetch(b.key, b.fetch, b.opts);
}

export function ChecksBadge({ checks }: { checks: ChecksSummary }) {
  if (checks.state === "none") return <span className="ci ci-none">无 CI</span>;
  const icon = { success: "✓", failure: "✗", pending: "●", neutral: "–", skipped: "–" }[checks.state];
  const text =
    checks.state === "success"
      ? `${checks.success}/${checks.total}`
      : checks.state === "failure"
        ? `${checks.failure} 失败`
        : `${checks.pending} 运行中`;
  return (
    <span className={`ci ci-${checks.state}`} title={`成功 ${checks.success} · 失败 ${checks.failure} · 运行中 ${checks.pending}`}>
      {icon} {text}
    </span>
  );
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

/** Compact age for dense rows: 5m, 3h, 2d. */
export function age(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export type StatusKind = "ready" | "pending" | "failed" | "blocked" | "draft" | "unknown";

/** One merge-readiness verdict per PR, so the UI can show a single colour instead of several labels. */
export function prStatus(pr: PRSummary & { mergeable?: string }): { kind: StatusKind; label: string } {
  if (pr.isDraft) return { kind: "draft", label: "草稿" };
  if (pr.mergeable === "CONFLICTING") return { kind: "blocked", label: "冲突" };
  if (pr.checks.state === "failure") return { kind: "failed", label: `CI ${pr.checks.failure} 失败` };
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { kind: "blocked", label: "要求修改" };
  if (pr.checks.state === "pending") return { kind: "pending", label: "CI 运行中" };
  return { kind: "ready", label: pr.checks.state === "none" ? "可合并（无 CI）" : "可合并" };
}

export function useViewer() {
  const v = Q.viewer();
  return useCached(v.key, v.fetch, v.opts).data?.login;
}

export function PRList({ repo, selected, onSelect, reloadKey }: { repo: string; selected?: number; onSelect: (n: number) => void; reloadKey: number }) {
  const [state, setState] = useState("open");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const src = Q.list(repo, state, query);
  const { data: prs, stale, error: err, refresh } = useCached(src.key, src.fetch, src.opts);
  useReload(reloadKey, refresh);
  useEffect(() => prs && rememberSummaries(repo, prs), [prs]);
  const selIdx = prs ? prs.findIndex((p) => p.number === selected) : -1;
  const nextPr = prs ? (selIdx < 0 ? prs[0] : prs[selIdx + 1]) : undefined;
  useFirstShortcut(nextPr ? () => onSelect(nextPr.number) : null);
  // Warm the PR that `n` would open next, so the jump is instant.
  useEffect(() => {
    if (nextPr) hoverPrefetch(repo, nextPr.number);
  }, [repo, nextPr?.number]);

  return (
    <div className="pr-list">
      <div className="filters">
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="open">Open</option>
          <option value="merged">Merged</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <input placeholder="搜索（GitHub 语法，如 author:@me）" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      {err && !prs && <div className="error">{err}</div>}
      {!prs && !err && <div className="loading">加载中…</div>}
      {prs && prs.length === 0 && <div className="empty">没有 PR</div>}
      <ul className={stale ? "stale" : ""}>
        {prs?.map((pr) => (
          <PRRow key={pr.url} pr={pr} selected={pr.number === selected} onSelect={() => onSelect(pr.number)} onHover={() => hoverPrefetch(repo, pr.number)} />
        ))}
      </ul>
    </div>
  );
}

export function PRRow(props: { pr: PRSummary; selected: boolean; onSelect: () => void; onHover?: () => void; showRepo?: boolean }) {
  const { pr, selected, onSelect, onHover, showRepo } = props;
  const timer = useRef(0);
  const viewer = useViewer();
  const job = useMerges()[mergeKey(pr.repo ?? pr.url.split("/").slice(3, 5).join("/"), pr.number)];
  const st = prStatus(pr);
  const repoName = pr.repo?.split("/")[1];
  const unresolved = pr.unresolvedThreads ?? 0;
  return (
    <li
      className={`row st-${st.kind} ${selected ? "sel" : ""} ${job?.state === "done" ? "leaving" : ""}`}
      onClick={onSelect}
      onMouseEnter={() => onHover && (timer.current = window.setTimeout(onHover, 150))}
      onMouseLeave={() => clearTimeout(timer.current)}
      title={`${pr.repo ?? ""}#${pr.number} · ${st.label}${unresolved > 0 ? ` · ${unresolved} 未解决评论` : ""}${pr.author !== viewer ? ` · ${pr.author}` : ""}`}
    >
      <div className="row1">
        <span className="title">{pr.title}</span>
      </div>
      <div className="row2">
        {showRepo && repoName && <span className="repo-name">{repoName}</span>}
        <span className="num">#{pr.number}</span>
        <span className="age">{age(pr.createdAt ?? pr.updatedAt)}</span>
        {viewer && pr.author !== viewer && <span className="who">@{pr.author}</span>}
        {job?.state === "running" && <span className="pill pending">合并中</span>}
        {job?.state === "failed" && <span className="pill failed">合并失败</span>}
        {!job && st.kind !== "ready" && <span className={`pill ${st.kind}`}>{st.label}</span>}
        {pr.reviewDecision === "APPROVED" && <span className="pill ready">✓ approved</span>}
        {unresolved > 0 && (
          <span className="pill pending" title={`${unresolved} 条未解决的 review 评论`}>
            💬 {unresolved}
          </span>
        )}
        <span className="stat">
          <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
        </span>
      </div>
    </li>
  );
}

const LEAVE_MS = 300;

/**
 * PRs waiting for the viewer to merge, across all repos: open, non-draft PRs the
 * viewer authored, was asked to review, or is assigned. Oldest first, so the
 * longest-waiting PR is on top; a PR disappears as soon as its merge succeeds.
 */
export function InboxList({ selected, onSelect, reloadKey }: { selected?: string; onSelect: (repo: string, n: number) => void; reloadKey: number }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const src = Q.inbox("all", query);
  const { data: prs, stale, error: err, refresh } = useCached(src.key, src.fetch, src.opts);
  const merges = useMerges();
  useReload(reloadKey, refresh);
  // Merged rows play a short leave animation before they are dropped.
  const [, tick] = useState(0);
  const leaving = Object.values(merges).some((j) => j.doneAt && Date.now() - j.doneAt < LEAVE_MS);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => tick((x) => x + 1), LEAVE_MS);
    return () => clearTimeout(t);
  }, [merges, leaving]);
  useEffect(() => prs && rememberSummaries(null, prs), [prs]);

  const shown = prs
    ?.filter((p) => {
      const j = merges[mergeKey(p.repo!, p.number)];
      return !p.isDraft && !(j?.state === "done" && Date.now() - (j.doneAt ?? 0) >= LEAVE_MS);
    })
    .sort((a, b) => (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt));

  const live = shown?.filter((p) => merges[mergeKey(p.repo!, p.number)]?.state !== "done") ?? [];
  const liveIdx = live.findIndex((p) => `${p.repo}#${p.number}` === selected);
  const nextLive = liveIdx < 0 ? live[0] : live[liveIdx + 1];
  useFirstShortcut(nextLive ? () => onSelect(nextLive.repo!, nextLive.number) : null);
  // Warm the PR that `n` would open next (detail, diff and program diffs), so the jump is instant.
  useEffect(() => {
    if (nextLive) hoverPrefetch(nextLive.repo!, nextLive.number);
  }, [nextLive?.url]);

  return (
    <div className="pr-list">
      <div className="filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <input placeholder="附加搜索条件，如 org:calcit-lang" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      {err && !prs && <div className="error">{err}</div>}
      {!prs && !err && <div className="loading">加载中…</div>}
      {shown && shown.length === 0 && <div className="empty">没有待合并的 PR</div>}
      {shown && (
        <div className="count muted">
          {shown.length} 个待合并 · 最早在上 ·{" "}
          <span className="ok-count">{shown.filter((p) => prStatus(p).kind === "ready").length} 可合并</span>
          <button className="link" onClick={refresh}>
            刷新
          </button>
          <span className="kbd-hint" title="按 N 打开下一个 PR（当前不在列表中时打开第一个）">
            <kbd>N</kbd>
          </span>
        </div>
      )}
      <ul className={stale ? "stale" : ""}>
        {shown?.map((pr) => (
          <PRRow
            key={pr.url}
            pr={pr}
            showRepo
            selected={`${pr.repo}#${pr.number}` === selected}
            onSelect={() => onSelect(pr.repo!, pr.number)}
            onHover={() => hoverPrefetch(pr.repo!, pr.number)}
          />
        ))}
      </ul>
    </div>
  );
}
