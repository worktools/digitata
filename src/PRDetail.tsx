import { useEffect, useMemo, useState } from "react";
import type { PRSummary } from "../shared/types.ts";
import { q as Q } from "./api.ts";
import { mergeKey, onMergeDone, summaryOf, useCached } from "./store.ts";
import { FileDiff, rendererFor } from "./diff/FileDiff.tsx";
import { parsePatch, type FilePatch } from "./diff/parse.ts";
import { MergePanel } from "./MergePanel.tsx";
import { ChecksBadge, timeAgo } from "./PRList.tsx";

type Tab = "files" | "overview" | "checks";

export function PRDetail({ repo, num }: { repo: string; num: number }) {
  const [tab, setTab] = useState<Tab>("files");
  const qp = Q.pr(repo, num);
  const qd = Q.diff(repo, num);
  const detail = useCached(qp.key, qp.fetch, qp.opts);
  const diff = useCached(qd.key, qd.fetch, qd.opts);
  const pr = detail.data;
  // Until the full detail arrives, the row seen in the list gives an instant header.
  const head: PRSummary | undefined = pr ?? summaryOf(repo, num);
  const patch = useMemo(() => (diff.data !== undefined ? parsePatch(diff.data) : null), [diff.data]);
  const totalLines = useMemo(() => patch?.reduce((n, f) => n + f.additions + f.deletions, 0) ?? 0, [patch]);
  const refreshAll = () => {
    detail.refresh();
    diff.refresh();
  };

  // If this PR's background merge finishes while it is open, reload its state.
  useEffect(() => onMergeDone((k) => k === mergeKey(repo, num) && refreshAll()), [repo, num]);

  if (!head) {
    if (detail.error) return <div className="error">{detail.error}</div>;
    return <div className="loading">加载 PR #{num}…</div>;
  }

  return (
    <div className="pr-detail">
      <header className="pr-head">
        <h2>
          {head.title} <span className="muted">#{head.number}</span>
        </h2>
        <div className="pr-sub">
          <span className={`tag st-${head.state}`}>{head.isDraft ? "DRAFT" : head.state}</span>
          <span>
            <b>{head.author}</b> 想把 <code>{head.headRefName}</code> 合入 <code>{head.baseRefName}</code>
          </span>
          <span className="muted">更新于 {timeAgo(head.updatedAt)}</span>
          <a href={head.url} target="_blank" rel="noreferrer">
            在 GitHub 打开 ↗
          </a>
          <button className="link" onClick={refreshAll}>
            刷新
          </button>
        </div>
      </header>
      {/* Sticky bar: the merge controls stay reachable while scrolling the diff. */}
      <div className="merge-bar">
        {pr ? (
          <MergePanel repo={repo} pr={pr} />
        ) : (
          <div className="merge-panel muted">
            <span className="mb-title">
              #{head.number} {head.title}
            </span>
            {detail.error ? <span className="error">{detail.error}</span> : "正在获取合并状态…"}
          </div>
        )}
      </div>
      {!pr ? null : (
      <>
      <nav className="tabs">
        <button className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>
          文件 {pr.changedFiles}
        </button>
        <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>
          概览 · {pr.commits.length} commits
        </button>
        <button className={tab === "checks" ? "on" : ""} onClick={() => setTab("checks")}>
          检查 <ChecksBadge checks={pr.checks} />
        </button>
      </nav>
      {tab === "overview" && (
        <div className="overview">
          <pre className="body">{pr.body || "（无描述）"}</pre>
          {pr.reviews.length > 0 && (
            <ul className="reviews">
              {pr.reviews.map((r, i) => (
                <li key={i}>
                  {r.author}: <span className={`tag rv-${r.state}`}>{r.state}</span>
                </li>
              ))}
            </ul>
          )}
          <ul className="commits">
            {pr.commits.map((c) => (
              <li key={c.oid}>
                <code>{c.oid.slice(0, 8)}</code> {c.headline} <span className="muted">{c.author}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === "checks" && (
        <ul className="check-list">
          {pr.checkList.length === 0 && <li className="empty">没有检查</li>}
          {pr.checkList.map((c, i) => (
            <li key={i} className={`ck ck-${c.state}`}>
              <span className="dot" /> {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}{" "}
              <span className="muted">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {tab === "files" && (
        <div className="files">
          {!patch && (diff.error ? <div className="error">{diff.error}</div> : <div className="loading">加载 diff…</div>)}
          {patch && (
            <>
              <ul className="file-index">
                {patch.map((f) => (
                  <li key={f.path}>
                    <a href={`#file-${f.path}`} onClick={(e) => { e.preventDefault(); document.getElementById(`file-${f.path}`)?.scrollIntoView(); }}>
                      <span className={`status st-${f.status}`}>{f.status[0].toUpperCase()}</span> {f.path}
                    </a>{" "}
                    {rendererFor(f) && <span className="tag">program</span>}
                    <span className="stat">
                      <span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {patch.map((f) => (
                <FileDiff
                  key={`${pr.headRefOid}:${f.path}`}
                  file={f}
                  ctx={{ repo, num, baseSha: pr.baseRefOid, headSha: pr.headRefOid }}
                  defaultOpen={!!rendererFor(f) || totalLines < 3000 || f.additions + f.deletions < 400}
                />
              ))}
            </>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
