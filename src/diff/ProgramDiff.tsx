import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DefCode } from "../../shared/types.ts";
import { CirruTree } from "./CirruTree.tsx";
import { q as Q } from "../api.ts";
import { useCached } from "../store.ts";
import { parseTreeOf, type Marker, type TreeLine } from "./programTree.ts";


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
  const [showSame, setShowSame] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const qq = Q.programDiff(repo, num, path, baseSha, headSha);
  const { data: res, error: err } = useCached(qq.key, qq.fetch, qq.opts);
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    if (res && !res.ok) onUnavailable?.(res.error ?? "program diff unavailable");
    else if (err) onUnavailable?.(err);
    else return;
    reported.current = true;
  }, [res, err]);

  const parsed = useMemo(() => (res?.ok ? parseTreeOf(res) : null), [res]);
  const codes = useMemo(() => new Map((res?.codes ?? []).map((c) => [c.key, c])), [res]);

  if (err) return <div className="error">program diff 失败：{err}</div>;
  if (!res)
    return (
      <div className="pd-loading">
        <span className="spinner" /> 正在计算 program diff…
      </div>
    );
  if (!res.ok || !parsed) return <div className="error">{res.error ?? "无法生成 program diff"}</div>;

  const schemaMap = new Map((res.schema ?? []).map((x) => [x.def, x.direction]));
  const schemaOf = (def: string) => schemaMap.get(def);

  const jump = (id: number) => {
    requestAnimationFrame(() => root.current?.querySelector(`[data-line="${id}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const counts = parseCounts(res.meta.changes ?? "");
  const cls = res.meta.classification ?? "";

  return (
    <div className="program-diff" ref={root}>
      <div className="pd-meta" title={res.meta.categories}>
        <span className={`pill ${cls === "canonical-format-only" ? "ready" : cls === "semantic-change" ? "pending" : "unknown"}`}>{CLASS_LABEL[cls] ?? cls}</span>
        {counts.mod > 0 && <span className="cnt mod">~{counts.mod}</span>}
        {counts.add > 0 && <span className="cnt add">+{counts.add}</span>}
        {counts.del > 0 && <span className="cnt del">−{counts.del}</span>}
        <span className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> 完整树
        </label>
      </div>
      {res.widening && res.widening.length > 0 && <div className="warn-box">⚠ {res.widening.length} 处类型放宽（widening）</div>}
      {parsed.defs.length === 0 && parsed.nsChanges.length === 0 && <div className="empty">没有定义级改动</div>}
      {showSame ? <FullTree lines={parsed.lines} /> : <Blocks lines={parsed.lines} schemaOf={schemaOf} codes={codes} />}
      {res.notes.length > 0 && (
        <details className="notes">
          <summary>CLI 备注 {res.notes.length}</summary>
          <pre>{res.notes.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

const CLASS_LABEL: Record<string, string> = { "semantic-change": "语义改动", "canonical-format-only": "仅格式", "no-change": "无改动" };
const GLYPH: Record<Marker, string> = { "~": "●", "+": "+", "-": "−", "=": "=" };

function parseCounts(s: string) {
  const n = (re: RegExp) => Number(re.exec(s)?.[1] ?? 0);
  return { mod: n(/~(\d+)/), add: n(/\+(\d+)/), del: n(/-(\d+)/) };
}

function lineClass(l: TreeLine) {
  return [
    "pl",
    l.marker ? `mk-${mkClass(l.marker)}` : "",
    l.side ? `side-${l.side}` : "",
    l.isSideHeader ? "side-header" : "",
    l.same ? "same" : "",
    l.segs ? "paired" : "",
  ].join(" ");
}

/** One rendered line; `prefix` is the (possibly trimmed) tree indentation. */
function Line({ l, prefix }: { l: TreeLine; prefix: string }) {
  if (l.change) {
    const cont = prefix.replace(/[├└]── $/u, (m) => (m.startsWith("├") ? "│   " : "    ")) + "  ";
    return (
      <div data-line={l.id}>
        <div className={lineClass(l)}>
          <span className="tree-prefix">{prefix}</span>
          <span className="part-label">{PART_LABEL[l.change.key] ?? l.change.key}</span>
        </div>
        <div className="pl side-old paired wrap">
          <span className="tree-prefix">{cont}</span>
          <Segs segs={l.change.old} typed={l.change.key === "schema"} />
        </div>
        <div className="pl side-new paired wrap">
          <span className="tree-prefix">{cont}</span>
          <Segs segs={l.change.new} typed={l.change.key === "schema"} />
        </div>
      </div>
    );
  }
  if (l.isSideHeader) {
    return (
      <div data-line={l.id} className={lineClass(l)} title={l.text.trim()}>
        <span className="tree-prefix">{prefix}</span>
        <span className={`side-tag ${l.side}`}>{l.side === "old" ? "旧" : "新"}</span>
      </div>
    );
  }
  return (
    <div data-line={l.id} className={lineClass(l)}>
      <span className="tree-prefix">{prefix}</span>
      {l.marker && <span className="marker">{l.marker} </span>}
      {l.segs ? <Segs segs={l.segs} /> : l.text}
    </div>
  );
}

const PART_LABEL: Record<string, string> = { schema: "类型", code: "代码", doc: "文档", tests: "测试", examples: "示例", tags: "标签", ffi: "FFI" };

function FullTree({ lines }: { lines: TreeLine[] }) {
  return (
    <pre className="pd-tree">
      {lines.map((l) => (
        <Line key={l.id} l={l} prefix={l.prefix} />
      ))}
    </pre>
  );
}

/** A changed definition (or ns declaration / top-level config) shown as its own card. */
function isBlockRoot(l: TreeLine) {
  if (!l.marker || l.marker === "=" || !l.path) return false;
  const p = l.path;
  if (p[0] !== "files") return p.length === 1;
  if (p.length === 2) return l.marker !== "~";
  if (p.length === 3 && p[2] === "ns") return true;
  return p.length === 4 && p[2] === "defs";
}

/**
 * Compact view: drop the program/files/defs scaffolding and unchanged nodes;
 * each changed definition becomes a card with a coloured header, and its body
 * is re-indented relative to the definition.
 */
/** Renders children only once the element is near the viewport (keeps big diffs responsive). */
function Lazy({ children, minHeight }: { children: ReactNode; minHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return <div ref={ref}>{shown ? children : <div style={{ minHeight }} />}</div>;
}

const Blocks = memo(function Blocks({ lines, schemaOf, codes }: { lines: TreeLine[]; schemaOf: (d: string) => string | undefined; codes: Map<string, DefCode> }) {
  const blocks: { root: TreeLine; body: TreeLine[] }[] = [];
  let cur: { root: TreeLine; body: TreeLine[] } | null = null;
  for (const l of lines) {
    if (l.depth !== undefined && cur && l.depth <= cur.root.depth!) cur = null;
    if (isBlockRoot(l)) {
      cur = { root: l, body: [] };
      blocks.push(cur);
      continue;
    }
    if (cur) cur.body.push(l);
  }
  return (
    <div className="pd-blocks">
      {blocks.map(({ root, body }) => {
        const p = root.path!;
        const ns = p[0] === "files" ? p[1] : "";
        const name = p[0] !== "files" ? p[0] : p.length === 2 ? p[1] : p[2] === "ns" ? "ns 声明" : p[3];
        const cut = [...root.prefix].length;
        const dir = p.length === 4 ? schemaOf(`${ns}/${p[3]}`) : undefined;
        const kind = p[0] !== "files" ? "配置" : p.length === 2 ? "命名空间" : "";
        // Current type signature, shown next to the name: unchanged schemas are
        // folded out of the body, but the signature is useful context.
        const sch = body.find((l) => l.path?.[4] === "schema" && l.depth === root.depth! + 1);
        const sig = sch?.change ? null : sch && /^schema "(.*)"$/.exec(sch.text)?.[1];
        const renderBodyLine = (l: TreeLine) => {
          // Drop the definition's own indentation and the part-node column (code/schema/...).
          const pre = [...l.prefix].slice(cut + 4).join("");
          if (l.marker && l.depth === root.depth! + 1 && !l.change) {
            return (
              <div key={l.id} data-line={l.id} className="pl part">
                <span className="part-label">{PART_LABEL[l.text.split(" ")[0]] ?? l.text.split(" ")[0]}</span>
                {l.text.includes(" ") && <span className="muted"> {l.text.slice(l.text.indexOf(" ") + 1)}</span>}
              </div>
            );
          }
          return <Line key={l.id} l={l} prefix={pre} />;
        };
        return (
          <section key={root.id} className={`pd-block mk-${mkClass(root.marker!)}`} data-line={root.id}>
            <header>
              <span className="mk-glyph">{GLYPH[root.marker!]}</span>
              {kind && <span className="muted">{kind}</span>}
              {ns && p.length > 2 && <span className="muted">{ns}/</span>}
              <b>{name}</b>
              {sig && (
                <span className="sig" title={sig}>
                  <TypeText text={sig} />
                </span>
              )}
              {dir && <span className={`pill type-${dir}`}>类型 {dir}</span>}
              {root.marker === "+" && <span className="pill ins">新增</span>}
              {root.marker === "-" && <span className="pill rem">删除</span>}
            </header>
            <Lazy minHeight={Math.min(600, 20 + body.length * 18)}>
            <pre className="pd-tree">
              {(() => {
                // Code parts of this definition render as a structural tree; the
                // CLI's printed lines for that part are skipped.
                const codeKey = p[0] !== "files" ? `:config/${p[0]}` : p.length === 4 ? `${ns}/${p[3]}` : p[2] === "ns" ? `${ns}/:ns` : "";
                const code = codes.get(codeKey);
                // ns declarations and top-level config are one tree each.
                if (code && (p[2] === "ns" || p[0] !== "files")) {
                  return <CirruTree old={code.old} now={code.new} />;
                }
                let skipping = false;
                return body.map((l) => {
                  const partNode = l.marker !== undefined && l.depth === root.depth! + 1;
                  if (partNode) skipping = false;
                  if (skipping || l.marker === "=") return null;
                  if (partNode && code && l.change?.key === "schema" && (code.oldSchema !== undefined || code.newSchema !== undefined)) {
                    return (
                      <div key={l.id} data-line={l.id} className="pl part tree-part">
                        <span className="part-label">类型</span>
                        <CirruTree old={code.oldSchema} now={code.newSchema} foldAt={Infinity} />
                      </div>
                    );
                  }
                  const part = l.text.split(" ")[0];
                  const pair = part === "examples" ? code?.examples : part === "tests" ? code?.tests : undefined;
                  if (partNode && pair) {
                    skipping = true;
                    return (
                      <div key={l.id} data-line={l.id} className="pl part tree-part">
                        <span className="part-label">{PART_LABEL[part]}</span>
                        <CirruTree old={pair.old} now={pair.new} />
                      </div>
                    );
                  }
                  if (partNode && code && l.text.split(" ")[0] === "code") {
                    skipping = true;
                    return (
                      <div key={l.id} data-line={l.id} className="pl part tree-part">
                        <span className="part-label">代码</span>
                        <CirruTree old={code.old} now={code.new} />
                      </div>
                    );
                  }
                  return renderBodyLine(l);
                });
              })()}
            </pre>
            </Lazy>
          </section>
        );
      })}
    </div>
  );
});

function mkClass(m: Marker) {
  return { "+": "add", "-": "del", "~": "mod", "=": "same" }[m];
}

export function Segs({ segs, typed }: { segs: { text: string; changed: boolean }[]; typed?: boolean }) {
  return (
    <>
      {segs.map((s, i) => (
        <span key={i} className={s.changed ? "chg" : "unchg"}>
          {typed ? <TypeText text={s.text} /> : s.text}
        </span>
      ))}
    </>
  );
}

/**
 * Light syntax colouring for Calcit type spellings such as
 * `Fn (List T) (-> Option T) (:generics T)`: type names, arrows, clause tags.
 */
export function TypeText({ text }: { text: string }) {
  const parts = text.split(/(\s+|[()$])/).filter(Boolean);
  return (
    <>
      {parts.map((t, i) => {
        const cls =
          t === "->" ? "ty-arrow" : t.startsWith(":") ? "ty-kw" : /^[()$]$/.test(t) ? "ty-punct" : /^([\w.-]+\/)?[A-Z]/.test(t) ? "ty-name" : /^\s+$/.test(t) ? "" : "ty-var";
        return cls ? (
          <span key={i} className={cls}>
            {t}
          </span>
        ) : (
          t
        );
      })}
    </>
  );
}
