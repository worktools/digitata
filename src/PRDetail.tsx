import { useEffect, useMemo, useState } from "react";
import type { PRSummary } from "../shared/types.ts";
import { prefetchProgramDiffs, q as Q } from "./api.ts";
import { mergeKey, onMergeDone, summaryOf, useCached } from "./store.ts";
import { FileDiff, isNoise, rendererFor } from "./diff/FileDiff.tsx";
import { parsePatch, type FilePatch } from "./diff/parse.ts";
import { FileIndex } from "./FileIndex.tsx";
import { MergePanel } from "./MergePanel.tsx";
import { age, ChecksBadge, timeAgo, useViewer } from "./PRList.tsx";

type Tab = "files" | "overview" | "checks";

export function PRDetail({ repo, num }: { repo: string; num: number }) {
  const [tab, setTab] = useState<Tab>("files");
  const qp = Q.pr(repo, num);
  const qd = Q.diff(repo, num);
  const detail = useCached(qp.key, qp.fetch, qp.opts);
  const diff = useCached(qd.key, qd.fetch, qd.opts);
  const pr = detail.data;
  // Kick off program diffs as soon as the SHAs are known, not when the file renders.
  useEffect(() => {
    if (pr) prefetchProgramDiffs(repo, pr);
  }, [pr?.headRefOid, pr?.baseRefOid]);
  const viewer = useViewer();
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
          {head.state !== "OPEN" && <span className={`tag st-${head.state}`}>{head.state}</span>}
          <span className="repo-chip">{repo}</span>
          <span className="branch">
            <code>{head.headRefName}</code> → <code>{head.baseRefName}</code>
          </span>
          {viewer && head.author !== viewer && <span className="who">@{head.author}</span>}
          <span className="muted" title={`更新于 ${timeAgo(head.updatedAt)}`}>
            {age(head.createdAt ?? head.updatedAt)}
          </span>
          <a href={head.url} target="_blank" rel="noreferrer">
            GitHub ↗
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
            <div className="files-layout">
              <FileIndex files={patch} />
              <div className="files-main">
              {patch.map((f) => (
                <FileDiff
                  key={`${pr.headRefOid}:${f.path}`}
                  file={f}
                  ctx={{ repo, num, baseSha: pr.baseRefOid, headSha: pr.headRefOid }}
                  defaultOpen={!isNoise(f.path) && (!!rendererFor(f) || totalLines < 3000 || f.additions + f.deletions < 400)}
                />
              ))}
              </div>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
