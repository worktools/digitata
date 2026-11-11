import { useEffect, useMemo, useState } from "react";
import type { PRDetail as Detail } from "../shared/types.ts";
import { api } from "./api.ts";
import { FileDiff, rendererFor } from "./diff/FileDiff.tsx";
import { parsePatch, type FilePatch } from "./diff/parse.ts";
import { MergePanel } from "./MergePanel.tsx";
import { ChecksBadge, timeAgo } from "./PRList.tsx";

type Tab = "files" | "overview" | "checks";

export function PRDetail({ repo, num, onChanged }: { repo: string; num: number; onChanged: () => void }) {
  const [pr, setPr] = useState<Detail | null>(null);
  const [patch, setPatch] = useState<FilePatch[] | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("files");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setErr("");
    api.getPR(repo, num).then((r) => live && setPr(r)).catch((e: Error) => live && setErr(e.message));
    api
      .getDiff(repo, num)
      .then((t) => live && setPatch(parsePatch(t)))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [repo, num, reload]);

  const totalLines = useMemo(() => patch?.reduce((n, f) => n + f.additions + f.deletions, 0) ?? 0, [patch]);

  if (err && !pr) return <div className="error">{err}</div>;
  if (!pr) return <div className="loading">加载 PR #{num}…</div>;

  return (
    <div className="pr-detail">
      <header className="pr-head">
        <h2>
          {pr.title} <span className="muted">#{pr.number}</span>
        </h2>
        <div className="pr-sub">
          <span className={`tag st-${pr.state}`}>{pr.isDraft ? "DRAFT" : pr.state}</span>
          <span>
            <b>{pr.author}</b> 想把 <code>{pr.headRefName}</code> 合入 <code>{pr.baseRefName}</code>
          </span>
          <span className="muted">更新于 {timeAgo(pr.updatedAt)}</span>
          <a href={pr.url} target="_blank" rel="noreferrer">
            在 GitHub 打开 ↗
          </a>
          <button className="link" onClick={() => setReload((x) => x + 1)}>
            刷新
          </button>
        </div>
        <MergePanel
          repo={repo}
          pr={pr}
          onMerged={() => {
            setReload((x) => x + 1);
            onChanged();
          }}
        />
      </header>
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
          {!patch && <div className="loading">加载 diff…</div>}
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
    </div>
  );
}
