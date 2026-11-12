import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { programDiffLabel } from "../api.ts";
import { useBusy } from "../store.ts";
import type { FilePatch } from "./parse.ts";
import { ProgramDiff } from "./ProgramDiff.tsx";
import { TextDiff } from "./TextDiff.tsx";

export interface DiffContext {
  repo: string;
  num: number;
  baseSha: string;
  headSha: string;
}

/** A renderer offers an alternative view for files it recognises; the text diff is always available. */
interface Renderer {
  id: string;
  label: string;
  matches(file: FilePatch): boolean;
  render(file: FilePatch, ctx: DiffContext, fallback: (reason: string) => void): ReactNode;
}

const renderers: Renderer[] = [
  {
    id: "calcit-program",
    label: "Program diff",
    // Calcit snapshots: calcit.cirru and other snapshot-style .cirru files; deps.cirru is a manifest.
    matches: (f) => f.path.endsWith(".cirru") && !f.path.endsWith("deps.cirru") && f.status === "modified" && !f.binary,
    render: (f, ctx, fallback) => (
      <ProgramDiff repo={ctx.repo} num={ctx.num} path={f.path} baseSha={ctx.baseSha} headSha={ctx.headSha} onUnavailable={fallback} />
    ),
  },
];

/**
 * Files whose diff is rarely worth reading (lockfiles, git metadata, minified
 * or generated output): collapsed by default, still one click away.
 */
const NOISE = [
  /(^|\/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|go\.sum|composer\.lock)$/,
  /(^|\/)\.git(attributes|ignore|modules)$/,
  /(^|\/)\.yarn\//,
  /\.min\.(js|css)$/,
  /(^|\/)(js-out|dist|node_modules)\//,
];
export function isNoise(path: string) {
  return NOISE.some((re) => re.test(path));
}

export function rendererFor(file: FilePatch) {
  return renderers.find((r) => r.matches(file));
}

export const FileDiff = memo(function FileDiff({ file, ctx, defaultOpen }: { file: FilePatch; ctx: DiffContext; defaultOpen: boolean }) {
  const special = rendererFor(file);
  const busy = useBusy(programDiffLabel(file.path));
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<string>(special ? special.id : "text");
  const [fallbackNote, setFallbackNote] = useState("");
  const fallback = useCallback((reason: string) => {
    setFallbackNote(reason);
    setView("text");
  }, []);
  // The body is memoised so header-only updates (e.g. the "computing" badge)
  // do not re-render a large diff.
  const body = useMemo(
    () =>
      open ? (
        <div className="file-body">
          {fallbackNote && view === "text" && <div className="note">已回退到文本 diff：{fallbackNote}</div>}
          {special && view === special.id ? special.render(file, ctx, fallback) : <TextDiff file={file} />}
        </div>
      ) : null,
    [open, view, fallbackNote, file, ctx.repo, ctx.num, ctx.baseSha, ctx.headSha],
  );

  return (
    <section className={`file ${special && busy ? "computing" : ""}`} id={`file-${file.path}`}>
      <header className="file-head" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span className={`status st-${file.status}`}>{file.status}</span>
        <code className="file-path">{file.path}</code>
        {isNoise(file.path) && !open && <span className="pill unknown">已折叠</span>}
        {special && busy && (
          <span className="pill computing">
            <span className="spinner" /> 计算中
          </span>
        )}
        <span className="stat">
          <span className="add">+{file.additions}</span> <span className="del">−{file.deletions}</span>
        </span>
        {special && (
          <span className="views" onClick={(e) => e.stopPropagation()}>
            {[special, { id: "text", label: "文本 diff" }].map((r) => (
              <button
                key={r.id}
                className={view === r.id ? "on" : ""}
                onClick={() => {
                  setView(r.id);
                  setOpen(true);
                }}
              >
                {r.label}
              </button>
            ))}
          </span>
        )}
      </header>
      {body}
    </section>
  );
});
