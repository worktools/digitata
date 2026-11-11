import { useEffect, useMemo, useRef, useState } from "react";
import type { ProgramDiffResult } from "../../shared/types.ts";
import { api } from "../api.ts";
import { parseTree, type Marker } from "./programTree.ts";

const MARK_LABEL: Record<Marker, string> = { "+": "新增", "-": "删除", "~": "修改", "=": "未变" };

export interface ProgramDiffProps {
  repo: string;
  num: number;
  path: string;
  baseSha: string;
  headSha: string;
  /** Called when the program diff cannot be produced, so the caller can fall back to text. */
  onUnavailable?: (reason: string) => void;
}

export function ProgramDiff({ repo, num, path, baseSha, headSha, onUnavailable }: ProgramDiffProps) {
  const [res, setRes] = useState<ProgramDiffResult | null>(null);
  const [err, setErr] = useState("");
  const [showSame, setShowSame] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setRes(null);
    setErr("");
    api
      .programDiff(repo, num, path, baseSha, headSha)
      .then((r) => {
        if (!live) return;
        setRes(r);
        if (!r.ok) onUnavailable?.(r.error ?? "program diff unavailable");
      })
      .catch((e: Error) => {
        if (!live) return;
        setErr(e.message);
        onUnavailable?.(e.message);
      });
    return () => {
      live = false;
    };
  }, [repo, num, path, baseSha, headSha]);

  const parsed = useMemo(() => (res?.ok ? parseTree(res.tree) : null), [res]);

  if (err) return <div className="error">program diff 失败：{err}</div>;
  if (!res) return <div className="loading">正在计算 program diff（首次需要 clone 仓库）…</div>;
  if (!res.ok || !parsed) return <div className="error">{res.error ?? "无法生成 program diff"}</div>;

  const jump = (id: number) => {
    setShowSame(true);
    requestAnimationFrame(() => root.current?.querySelector(`[data-line="${id}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  return (
    <div className="program-diff" ref={root}>
      <div className="pd-meta">
        <span className={`badge cls-${res.meta.classification ?? ""}`}>{res.meta.classification ?? "?"}</span>
        <span>{res.meta.changes}</span>
        {res.meta.categories && <span className="muted">{res.meta.categories}</span>}
      </div>
      {(parsed.defs.length > 0 || parsed.nsChanges.length > 0) && (
        <ul className="def-list">
          {parsed.nsChanges.map((d) => (
            <li key={`ns-${d.lineId}`} className={`mk mk-${mkClass(d.marker)}`} onClick={() => jump(d.lineId)}>
              <span className="mk-label">{MARK_LABEL[d.marker]} ns</span> <code>{d.ns}</code>
            </li>
          ))}
          {parsed.defs.map((d) => (
            <li key={d.lineId} className={`mk mk-${mkClass(d.marker)}`} onClick={() => jump(d.lineId)}>
              <span className="mk-label">{MARK_LABEL[d.marker]}</span>{" "}
              <code>
                <span className="muted">{d.ns}/</span>
                {d.def}
              </code>
              {d.parts.length > 0 && <span className="muted parts"> {d.parts.join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
      {parsed.defs.length === 0 && parsed.nsChanges.length === 0 && <div className="empty">没有定义级改动（{res.meta.classification}）</div>}
      <label className="toggle">
        <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> 显示未变更节点
      </label>
      <pre className="pd-tree">
        {parsed.lines.map((l) => {
          if (!showSame && l.marker === "=" && (l.depth ?? 0) >= 2) return null;
          const cls = [
            "pl",
            l.marker ? `mk-${mkClass(l.marker)}` : "",
            l.side ? `side-${l.side}` : "",
            l.isSideHeader ? "side-header" : "",
            l.marker && l.depth === 4 && l.path?.[2] === "defs" ? "def-node" : "",
          ].join(" ");
          return (
            <div key={l.id} data-line={l.id} className={cls}>
              <span className="tree-prefix">{l.prefix}</span>
              {l.marker && <span className="marker">{l.marker} </span>}
              {l.isSideHeader ? (l.side === "old" ? "− 旧 " : "+ 新 ") + l.text.trim() : l.text}
            </div>
          );
        })}
      </pre>
      {res.notes.length > 0 && (
        <details className="notes">
          <summary>CLI 输出备注（{res.notes.length}）</summary>
          <pre>{res.notes.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

function mkClass(m: Marker) {
  return { "+": "add", "-": "del", "~": "mod", "=": "same" }[m];
}
