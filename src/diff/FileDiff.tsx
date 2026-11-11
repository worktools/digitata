import { useState, type ReactNode } from "react";
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

export function rendererFor(file: FilePatch) {
  return renderers.find((r) => r.matches(file));
}

export function FileDiff({ file, ctx, defaultOpen }: { file: FilePatch; ctx: DiffContext; defaultOpen: boolean }) {
  const special = rendererFor(file);
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<string>(special ? special.id : "text");
  const [fallbackNote, setFallbackNote] = useState("");

  return (
    <section className="file" id={`file-${file.path}`}>
      <header className="file-head" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span className={`status st-${file.status}`}>{file.status}</span>
        <code className="file-path">{file.path}</code>
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
      {open && (
        <div className="file-body">
          {fallbackNote && view === "text" && <div className="note">已回退到文本 diff：{fallbackNote}</div>}
          {special && view === special.id
            ? special.render(file, ctx, (reason) => {
                setFallbackNote(reason);
                setView("text");
              })
            : <TextDiff file={file} />}
        </div>
      )}
    </section>
  );
}
