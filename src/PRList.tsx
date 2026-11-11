import { useEffect, useRef, useState } from "react";
import type { ChecksSummary, InboxFilter, PRSummary } from "../shared/types.ts";
import { q as Q } from "./api.ts";
import { prefetch, rememberSummaries, useCached } from "./store.ts";

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

/** Hovering a row warms the detail and diff caches so opening it is instant. */
function hoverPrefetch(repo: string, num: number) {
  const a = Q.pr(repo, num);
  const b = Q.diff(repo, num);
  prefetch(a.key, a.fetch, a.opts);
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

export function PRList({ repo, selected, onSelect, reloadKey }: { repo: string; selected?: number; onSelect: (n: number) => void; reloadKey: number }) {
  const [state, setState] = useState("open");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const src = Q.list(repo, state, query);
  const { data: prs, stale, error: err, refresh } = useCached(src.key, src.fetch, src.opts);
  useReload(reloadKey, refresh);
  useEffect(() => prs && rememberSummaries(repo, prs), [prs]);

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
  return (
    <li
      className={selected ? "sel" : ""}
      onClick={onSelect}
      onMouseEnter={() => onHover && (timer.current = window.setTimeout(onHover, 150))}
      onMouseLeave={() => clearTimeout(timer.current)}
    >
      {showRepo && pr.repo && <div className="row0">{pr.repo}</div>}
      <div className="row1">
        <span className="num">#{pr.number}</span>
        <span className="title">{pr.title}</span>
      </div>
      <div className="row2">
        {pr.isDraft && <span className="tag draft">draft</span>}
        <ChecksBadge checks={pr.checks} />
        {pr.reviewDecision && <span className={`tag rv-${pr.reviewDecision}`}>{pr.reviewDecision.toLowerCase().replace("_", " ")}</span>}
        <span className="muted">
          {pr.author} · {timeAgo(pr.updatedAt)}
        </span>
        <span className="stat">
          <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
        </span>
      </div>
    </li>
  );
}

const INBOX_TABS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "author", label: "我创建的" },
  { id: "review", label: "请求我 review" },
  { id: "assignee", label: "指派给我" },
  { id: "mentioned", label: "提到我" },
];

const isReady = (pr: PRSummary) => !pr.isDraft && pr.checks.state !== "failure" && pr.checks.state !== "pending" && pr.reviewDecision !== "CHANGES_REQUESTED";

/** Cross-repo inbox, like github.com/pulls: open PRs that involve the viewer. */
export function InboxList({ selected, onSelect, reloadKey }: { selected?: string; onSelect: (repo: string, n: number) => void; reloadKey: number }) {
  const [filter, setFilter] = useState<InboxFilter>(() => (localStorage.getItem("digitata.inbox") as InboxFilter) || "all");
  const [readyOnly, setReadyOnly] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const src = Q.inbox(filter, query);
  const { data: prs, stale, error: err, refresh } = useCached(src.key, src.fetch, src.opts);
  useReload(reloadKey, refresh);
  useEffect(() => prs && rememberSummaries(null, prs), [prs]);
  useEffect(() => localStorage.setItem("digitata.inbox", filter), [filter]);

  const shown = prs?.filter((p) => !readyOnly || isReady(p));
  const readyCount = prs?.filter(isReady).length ?? 0;

  return (
    <div className="pr-list">
      <div className="inbox-tabs">
        {INBOX_TABS.map((t) => (
          <button key={t.id} className={filter === t.id ? "on" : ""} onClick={() => setFilter(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <input placeholder="附加搜索条件，如 org:calcit-lang" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <label className="ready">
          <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} /> 可合并 {prs ? readyCount : ""}
        </label>
      </div>
      {err && !prs && <div className="error">{err}</div>}
      {!prs && !err && <div className="loading">加载中…</div>}
      {shown && shown.length === 0 && <div className="empty">没有 PR</div>}
      {prs && (
        <div className="count muted">
          {shown!.length} 个 PR
          <button className="link" onClick={refresh}>
            刷新
          </button>
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
