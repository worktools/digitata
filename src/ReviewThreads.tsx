import { useState } from "react";
import type { PRDetail, ReviewThread } from "../shared/types.ts";
import { api, q as Q } from "./api.ts";
import { formatThreadLines, parseCommentBlocks, parseInline, type CommentBlock } from "./commentFormat.ts";
import { timeAgo } from "./PRList.tsx";
import { syncUnresolvedCount, toast, track, updateCache } from "./store.ts";

type Filter = "unresolved" | "resolved" | "all";

function isBot(author: string) {
  return author === "coderabbitai" || author.endsWith("[bot]") || author.endsWith("-bot");
}

function InlineText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, li) => (
        <span key={li}>
          {li > 0 && <br />}
          {parseInline(line).map((n, ni) => {
            if (n.kind === "code") return <code key={ni}>{n.text}</code>;
            if (n.kind === "bold") return <strong key={ni}>{n.text}</strong>;
            if (n.kind === "link")
              return (
                <a key={ni} href={n.href} target="_blank" rel="noreferrer">
                  {n.label}
                </a>
              );
            return <span key={ni}>{n.text}</span>;
          })}
        </span>
      ))}
    </>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const diffStyle = lang === "diff" || lang === "suggestion";
  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast("复制失败"));
  };
  return (
    <div className="rt-code-wrap">
      <button type="button" className="rt-copy" onClick={copy}>
        {copied ? "已复制" : "复制"}
      </button>
      <pre className="rt-code">
        {text.split("\n").map((line, i) => {
          const cls = diffStyle
            ? line.startsWith("+") && !line.startsWith("+++")
              ? "add"
              : line.startsWith("-") && !line.startsWith("---")
                ? "del"
                : line.startsWith("@@")
                  ? "hunk"
                  : ""
            : "";
          return (
            <div key={i} className={cls}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function CommentBlocks({ blocks }: { blocks: CommentBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "code") return <CodeBlock key={i} lang={b.lang} text={b.text} />;
        if (b.kind === "quote")
          return (
            <blockquote key={i} className="rt-quote">
              <InlineText text={b.text} />
            </blockquote>
          );
        if (b.kind === "details")
          return (
            <details key={i} className="rt-details">
              <summary>{b.summary}</summary>
              <div className="rt-details-body">
                <CommentBlocks blocks={b.blocks} />
              </div>
            </details>
          );
        return (
          <p key={i}>
            <InlineText text={b.text} />
          </p>
        );
      })}
    </>
  );
}

function DiffHunk({ hunk }: { hunk: string }) {
  return (
    <pre className="rt-hunk">
      {hunk.split("\n").map((line, i) => {
        const cls = line.startsWith("@@")
          ? "hunk"
          : line.startsWith("+")
            ? "add"
            : line.startsWith("-")
              ? "del"
              : "";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function ReviewThreads({
  repo,
  pr,
  fileFilter,
  onClearFileFilter,
  onJumpToFile,
}: {
  repo: string;
  pr: PRDetail;
  fileFilter: string | null;
  onClearFileFilter: () => void;
  onJumpToFile: (path: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("unresolved");
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const threads = pr.reviewThreads ?? [];
  const byFile = fileFilter ? threads.filter((t) => t.path === fileFilter) : threads;
  const unresolvedCount = byFile.filter((t) => !t.isResolved).length;
  const resolvedCount = byFile.length - unresolvedCount;
  const shown = byFile.filter((t) => (filter === "all" ? true : filter === "unresolved" ? !t.isResolved : t.isResolved));

  const setBusy = (id: string, on: boolean) => setBusyIds((prev) => ({ ...prev, [id]: on }));

  const patchThread = (threadId: string, updater: (t: ReviewThread) => ReviewThread) => {
    let nextUnresolved = 0;
    let updated = false;
    updateCache<PRDetail>(
      Q.pr(repo, pr.number).key,
      (prev) => {
        const reviewThreads = (prev.reviewThreads ?? []).map((t) => (t.id === threadId ? updater(t) : t));
        nextUnresolved = reviewThreads.filter((t) => !t.isResolved).length;
        updated = true;
        return { ...prev, reviewThreads, unresolvedThreads: nextUnresolved };
      },
      true,
    );
    if (updated) syncUnresolvedCount(repo, pr.number, nextUnresolved);
  };

  const applyResolve = async (thread: ReviewThread, resolved: boolean) => {
    const res = await track(
      `${resolved ? "Resolve" : "Unresolve"} ${thread.path}`,
      api.resolveThread(repo, pr.number, thread.id, resolved),
    );
    patchThread(thread.id, (t) => ({
      ...t,
      isResolved: res.isResolved,
      viewerCanResolve: res.viewerCanResolve,
      viewerCanUnresolve: res.viewerCanUnresolve,
      resolvedBy: res.resolvedBy,
    }));
    toast(res.isResolved ? "✓ 已标记为已解决" : "已重新打开评论", "ok");
  };

  const toggleResolve = async (thread: ReviewThread, resolved: boolean) => {
    if (busyIds[thread.id]) return;
    setBusy(thread.id, true);
    try {
      await applyResolve(thread, resolved);
    } catch (e) {
      toast(`${resolved ? "Resolve" : "Unresolve"} 失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(thread.id, false);
    }
  };

  const submitReply = async (thread: ReviewThread, andResolve = false) => {
    const body = (drafts[thread.id] ?? "").trim();
    if (!body || busyIds[thread.id]) return;
    setBusy(thread.id, true);
    try {
      const { comment } = await track(`回复 ${thread.path}`, api.replyToThread(repo, pr.number, thread.id, body));
      patchThread(thread.id, (t) => ({ ...t, comments: [...t.comments, comment] }));
      setDrafts((prev) => ({ ...prev, [thread.id]: "" }));
      setReplyOpen((prev) => ({ ...prev, [thread.id]: false }));
      if (andResolve) {
        await applyResolve(thread, true);
      } else {
        toast("✓ 已回复", "ok");
      }
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(thread.id, false);
    }
  };

  return (
    <div className="review-threads">
      <div className="rt-toolbar">
        <div className="rt-filters">
          <button type="button" className={`chip ${filter === "unresolved" ? "on" : ""}`} onClick={() => setFilter("unresolved")}>
            未解决 ({unresolvedCount})
          </button>
          <button type="button" className={`chip ${filter === "resolved" ? "on" : ""}`} onClick={() => setFilter("resolved")}>
            已解决 ({resolvedCount})
          </button>
          <button type="button" className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
            全部 ({byFile.length})
          </button>
        </div>
        {fileFilter && (
          <div className="rt-file-chip">
            <span>
              仅看文件：<code>{fileFilter}</code>
            </span>
            <button type="button" className="link" onClick={onClearFileFilter}>
              显示全部文件
            </button>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="empty rt-empty">
          {filter === "unresolved" ? "没有未解决的 review 评论" : filter === "resolved" ? "没有已解决的 review 评论" : "没有 review 评论"}
          {filter === "unresolved" && resolvedCount > 0 && (
            <button type="button" className="link" onClick={() => setFilter("resolved")}>
              查看 {resolvedCount} 条已解决
            </button>
          )}
          {fileFilter && (
            <button type="button" className="link" onClick={onClearFileFilter}>
              显示全部文件
            </button>
          )}
        </div>
      ) : (
        <div className="rt-list">
          {shown.map((thread) => {
            const busy = !!busyIds[thread.id];
            const replying = !!replyOpen[thread.id];
            const draft = drafts[thread.id] ?? "";
            const url = thread.comments[0]?.url;
            return (
              <article key={thread.id} className={`rt-card ${thread.isResolved ? "resolved" : ""}`}>
                <header className="rt-head">
                  <code className="rt-path">
                    {thread.path}
                    {formatThreadLines(thread)}
                  </code>
                  {thread.isOutdated && <span className="pill unknown">已过时</span>}
                  {thread.isResolved ? (
                    <span className="pill ready">✓ 已解决{thread.resolvedBy ? ` · @${thread.resolvedBy}` : ""}</span>
                  ) : (
                    <span className="pill pending">未解决</span>
                  )}
                  <span className="rt-actions">
                    <button type="button" className="link" onClick={() => onJumpToFile(thread.path)}>
                      看 diff
                    </button>
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer">
                        GitHub ↗
                      </a>
                    )}
                    {!thread.isResolved && thread.viewerCanResolve && (
                      <button type="button" disabled={busy} onClick={() => toggleResolve(thread, true)}>
                        {busy ? "处理中…" : "Resolve"}
                      </button>
                    )}
                    {thread.isResolved && thread.viewerCanUnresolve && (
                      <button type="button" disabled={busy} onClick={() => toggleResolve(thread, false)}>
                        {busy ? "处理中…" : "Unresolve"}
                      </button>
                    )}
                  </span>
                </header>

                {thread.diffHunk && <DiffHunk hunk={thread.diffHunk} />}

                <div className="rt-comments">
                  {thread.comments.map((c) => {
                    const blocks = parseCommentBlocks(c.body);
                    return (
                      <div key={c.id} className="rt-comment">
                        <div className="rt-comment-head">
                          <strong>@{c.author}</strong>
                          {isBot(c.author) && <span className="tag">bot</span>}
                          {c.createdAt && <span className="muted">{timeAgo(c.createdAt)}</span>}
                        </div>
                        <div className="rt-body">
                          {blocks.length > 0 ? <CommentBlocks blocks={blocks} /> : c.body.trim() ? <p>{c.body}</p> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {thread.viewerCanReply && (
                  <div className="rt-reply">
                    {!replying ? (
                      <div className="rt-reply-bar">
                        <button type="button" onClick={() => setReplyOpen((prev) => ({ ...prev, [thread.id]: true }))}>
                          回复
                        </button>
                        {!thread.isResolved && thread.viewerCanResolve && (
                          <button type="button" disabled={busy} onClick={() => toggleResolve(thread, true)}>
                            {busy ? "处理中…" : "Resolve"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="rt-reply-editor">
                        <textarea
                          rows={3}
                          placeholder="写回复…（⌘/Ctrl+Enter 发送，Esc 取消）"
                          value={draft}
                          disabled={busy}
                          autoFocus
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [thread.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setReplyOpen((prev) => ({ ...prev, [thread.id]: false }));
                            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              e.stopPropagation();
                              submitReply(thread, false);
                            }
                          }}
                        />
                        <div className="rt-reply-actions">
                          <button type="button" disabled={busy} onClick={() => setReplyOpen((prev) => ({ ...prev, [thread.id]: false }))}>
                            取消
                          </button>
                          <button type="button" disabled={busy || !draft.trim()} onClick={() => submitReply(thread, false)}>
                            {busy ? "发送中…" : "回复"}
                          </button>
                          {!thread.isResolved && thread.viewerCanResolve && (
                            <button type="button" className="primary" disabled={busy || !draft.trim()} onClick={() => submitReply(thread, true)}>
                              {busy ? "处理中…" : "回复并 Resolve"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
