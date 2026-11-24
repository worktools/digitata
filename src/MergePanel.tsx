import { useEffect, useRef, useState } from "react";
import type { MergeMethod, PRDetail } from "../shared/types.ts";
import { api } from "./api.ts";
import { mergeKey, startMerge, useMerges } from "./store.ts";
import { ChecksBadge, prStatus } from "./PRList.tsx";

const METHOD_LABEL: Record<MergeMethod, string> = { squash: "Squash and merge", merge: "Merge commit", rebase: "Rebase and merge" };

export function MergePanel({ repo, pr, onOpenComments }: { repo: string; pr: PRDetail; onOpenComments?: () => void }) {
  const [method, setMethod] = useState<MergeMethod>(() => (localStorage.getItem("digitata.method") as MergeMethod) || "squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [ack, setAck] = useState(false);
  const job = useMerges()[mergeKey(repo, pr.number)];
  const busy = job?.state === "running";

  const confirmBtn = useRef<HTMLButtonElement>(null);
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});

  // Keyboard: "m" opens the dialog; inside it Enter merges, Esc cancels,
  // "a" acknowledges warnings, 1/2/3 pick the method, "d" toggles branch deletion.
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  useEffect(() => {
    if (confirming) confirmBtn.current?.focus();
  }, [confirming, ack]);

  keyHandler.current = () => {};
  const label = (
    <span className="mb-title" title={pr.title}>
      <span className="muted">#{pr.number}</span> {pr.title}
    </span>
  );
  if (job?.state === "done")
    return (
      <div className="merge-panel done st-MERGED">
        {label}
        <span className="tag st-MERGED">已合并</span>
      </div>
    );
  if (pr.state !== "OPEN")
    return (
      <div className={`merge-panel done st-${pr.state}`}>
        {label}
        <span className={`tag st-${pr.state}`}>{pr.state}</span>
      </div>
    );

  const unresolved = pr.unresolvedThreads ?? (pr.reviewThreads ?? []).filter((t) => !t.isResolved).length;
  const warnings: string[] = [];
  if (pr.isDraft) warnings.push("PR 仍是草稿");
  if (pr.checks.state === "failure") warnings.push(`${pr.checks.failure} 个检查失败`);
  if (pr.checks.state === "pending") warnings.push(`${pr.checks.pending} 个检查还在运行`);
  if (pr.mergeable === "CONFLICTING") warnings.push("存在合并冲突");
  if (pr.mergeStateStatus && !["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(pr.mergeStateStatus)) warnings.push(`合并状态：${pr.mergeStateStatus}`);
  if (pr.reviewDecision === "CHANGES_REQUESTED") warnings.push("有 reviewer 要求修改");
  if (unresolved > 0) warnings.push(`还有 ${unresolved} 条未解决的 review 评论`);
  const needsAck = warnings.length > 0;
  const status = prStatus(pr);

  // The merge runs in a global job, so the dialog closes at once and the user can
  // move on to other PRs; progress and the result show in the corner and the list.
  const doMerge = () => {
    if (busy) return;
    localStorage.setItem("digitata.method", method);
    const body = { method, deleteBranch, headRefOid: pr.headRefOid };
    startMerge(repo, pr.number, () => api.merge(repo, pr.number, body).then((r) => r.message));
    setConfirming(false);
  };

  const canMerge = !busy && (!needsAck || ack);
  const methods = Object.keys(METHOD_LABEL) as MergeMethod[];
  keyHandler.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    const typing = t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
    if (!confirming) {
      if (e.key === "m" && !typing && !busy) {
        e.preventDefault();
        setConfirming(true);
        setAck(false);
      }
      return;
    }
    if (e.key === "Escape") {
      setConfirming(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (canMerge) doMerge();
    } else if (e.key === "a" && needsAck) {
      setAck((x) => !x);
    } else if (e.key === "d") {
      setDeleteBranch((x) => !x);
    } else if (["1", "2", "3"].includes(e.key)) {
      setMethod(methods[Number(e.key) - 1]);
    } else return;
    e.stopPropagation();
  };

  return (
    <div className="merge-panel">
      {label}
      <span
        className="merge-status"
        title={`CI 成功 ${pr.checks.success} · 失败 ${pr.checks.failure} · 运行中 ${pr.checks.pending}\nmergeable: ${pr.mergeable || "?"} · state: ${pr.mergeStateStatus || "?"}${pr.reviewDecision ? ` · review: ${pr.reviewDecision}` : ""}`}
      >
        {job?.state === "running" ? (
          <span className="pill pending big">合并中…</span>
        ) : job?.state === "failed" ? (
          <span className="pill failed big" title={job.text}>
            合并失败
          </span>
        ) : (
          <span className={`pill big ${status.kind}`}>{status.label}</span>
        )}
        {pr.reviewDecision === "APPROVED" && <span className="pill ready">✓ approved</span>}
        {unresolved > 0 && (
          <button type="button" className="pill pending big clickable-pill" onClick={onOpenComments} title="查看未解决的 review 评论">
            💬 {unresolved} 未解决
          </button>
        )}
      </span>
      <div className="merge-actions">
        <select value={method} onChange={(e) => setMethod(e.target.value as MergeMethod)}>
          {(Object.keys(METHOD_LABEL) as MergeMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} /> 删分支
        </label>
        <button className={`primary ${needsAck ? "warn" : ""}`} disabled={busy} onClick={() => { setConfirming(true); setAck(false); }}>
          {busy ? "合并中…" : <>合并… <kbd>M</kbd></>}
        </button>
      </div>
      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>确认合并 #{pr.number}？</h3>
            <p className="modal-title">{pr.title}</p>
            <ul className="kv">
              <li>仓库：{repo}</li>
              <li>
                {pr.headRefName} → {pr.baseRefName}
              </li>
              <li>
                方式：
                {methods.map((m, i) => (
                  <button key={m} className={`chip ${m === method ? "on" : ""}`} onClick={() => setMethod(m)}>
                    <kbd>{i + 1}</kbd> {METHOD_LABEL[m]}
                  </button>
                ))}
              </li>
              <li>
                <label>
                  <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} /> 合并后删除远程分支 <kbd>D</kbd>
                </label>
              </li>
              <li>
                head：<code>{pr.headRefOid.slice(0, 10)}</code>（若 PR 在此之后有新提交，合并会被拒绝）
              </li>
              <li>
                CI：<ChecksBadge checks={pr.checks} />
              </li>
              {unresolved > 0 && (
                <li>
                  未解决评论：<span className="pill pending">{unresolved} 条</span>
                </li>
              )}
            </ul>
            {pr.checkList.filter((c) => c.state === "failure" || c.state === "pending").length > 0 && (
              <ul className="check-list compact">
                {pr.checkList
                  .filter((c) => c.state === "failure" || c.state === "pending")
                  .map((c, i) => (
                    <li key={i} className={`ck ck-${c.state}`}>
                      {c.name} <span className="muted">{c.detail}</span>
                    </li>
                  ))}
              </ul>
            )}
            {needsAck && (
              <div className="warnings">
                {warnings.map((w) => (
                  <div key={w}>⚠ {w}</div>
                ))}
                <label>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> 我已知晓，仍然合并 <kbd>A</kbd>
                </label>
              </div>
            )}
            <div className="modal-actions">
              <button onClick={() => setConfirming(false)}>
                取消 <kbd>Esc</kbd>
              </button>
              <button ref={confirmBtn} className="primary" disabled={!canMerge} onClick={doMerge}>
                确认合并 <kbd>Enter</kbd>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
