import { useEffect, useMemo, useRef, useState } from "react";
import { programDiffLabel, q as Q } from "./api.ts";
import { isNoise, rendererFor, type DiffContext } from "./diff/FileDiff.tsx";
import { parseTreeOf, type DefChange, type Marker } from "./diff/programTree.ts";
import { useActivity, useCached } from "./store.ts";
import type { FilePatch } from "./diff/parse.ts";

/**
 * Changed-file list docked on the right of the diff. It stays in view while
 * scrolling and highlights the file currently at the top of the viewport.
 */
/**
 * Changed definitions of a Calcit snapshot, grouped by namespace, nested under
 * the file in the index. Clicking one scrolls to its card in the program diff.
 */
function DefOutline({ path, ctx }: { path: string; ctx: DiffContext }) {
  const qq = Q.programDiff(ctx.repo, ctx.num, path, ctx.baseSha, ctx.headSha);
  const { data: res } = useCached(qq.key, qq.fetch, qq.opts);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => {
    if (!res?.ok) return [];
    const { defs, nsChanges } = parseTreeOf(res);
    const schema = new Map((res.schema ?? []).map((x) => [x.def, x.direction]));
    const byNs = new Map<string, { ns: string; marker?: Marker; lineId?: number; defs: (DefChange & { typed?: string })[] }>();
    const get = (ns: string) => byNs.get(ns) ?? byNs.set(ns, { ns, defs: [] }).get(ns)!;
    for (const n of nsChanges) Object.assign(get(n.ns), { marker: n.marker, lineId: n.lineId });
    for (const d of defs) get(d.ns).defs.push({ ...d, typed: schema.get(`${d.ns}/${d.def}`) });
    return [...byNs.values()];
  }, [res]);
  if (!groups.length) return null;
  const jump = (lineId?: number) => {
    if (lineId === undefined) return;
    document.getElementById(`file-${path}`)?.querySelector(`[data-line="${lineId}"]`)?.scrollIntoView({ block: "start" });
  };
  const toggle = (ns: string) => {
    const next = new Set(closed);
    if (next.has(ns)) next.delete(ns);
    else next.add(ns);
    setClosed(next);
  };
  return (
    <ul className="def-outline">
      {groups.map((g) => (
        <li key={g.ns}>
          <div className={`do-ns ${g.marker ? `mk-${MK[g.marker]}` : ""}`} onClick={() => (g.lineId !== undefined ? jump(g.lineId) : toggle(g.ns))} title={g.ns}>
            <span className="do-caret" onClick={(e) => (e.stopPropagation(), toggle(g.ns))}>
              {g.defs.length ? (closed.has(g.ns) ? "▸" : "▾") : " "}
            </span>
            <span className="do-ns-name">{g.ns}</span>
            {g.marker && g.marker !== "~" && <span className="mk-glyph">{GLYPH[g.marker]}</span>}
            {g.defs.length > 0 && <span className="muted do-count">{g.defs.length}</span>}
          </div>
          {!closed.has(g.ns) && g.defs.length > 0 && (
            <ul>
              {g.defs.map((d) => (
                <li key={d.lineId} className={`do-def mk-${MK[d.marker]}`} onClick={() => jump(d.lineId)} title={`${d.ns}/${d.def}${d.parts.length ? ` · ${d.parts.join(", ")}` : ""}`}>
                  <span className="mk-glyph">{GLYPH[d.marker]}</span>
                  <span className="do-def-name">{d.def}</span>
                  {d.typed && <span className={`type-dot type-${d.typed}`}>T</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

const GLYPH: Record<Marker, string> = { "~": "●", "+": "+", "-": "−", "=": "=" };
const MK: Record<Marker, string> = { "~": "mod", "+": "add", "-": "del", "=": "same" };

export function FileIndex({ files, ctx }: { files: FilePatch[]; ctx: DiffContext }) {
  const [active, setActive] = useState(files[0]?.path ?? "");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("digitata.fi-collapsed") === "1");
  useEffect(() => localStorage.setItem("digitata.fi-collapsed", collapsed ? "1" : "0"), [collapsed]);
  // Tell the layout whether the card is open (a class instead of a costly :has() selector over a big DOM).
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layout = anchor.current?.parentElement;
    layout?.classList.toggle("fi-open", !collapsed);
    layout?.classList.toggle("fi-closed", collapsed);
  }, [collapsed]);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const bar = document.querySelector(".merge-bar")?.getBoundingClientRect().bottom ?? 0;
      let cur = files[0]?.path ?? "";
      for (const f of files) {
        const el = document.getElementById(`file-${f.path}`);
        if (el && el.getBoundingClientRect().top <= bar + 48) cur = f.path;
      }
      setActive(cur);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    main.addEventListener("scroll", on, { passive: true });
    update();
    return () => {
      main.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, [files]);

  const { activities } = useActivity();
  const busy = new Set(activities.map((a) => a.label));
  const total = files.reduce((a, f) => [a[0] + f.additions, a[1] + f.deletions], [0, 0]);

  return (
    // Zero-height sticky anchor: the card floats over the top-right of the code
    // without reserving a column, so the code keeps the full width below it.
    <div className="fi-anchor" ref={anchor}>
    <nav className={`file-index ${collapsed ? "collapsed" : ""}`}>
      <div className="fi-head muted" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "展开文件列表" : "收起文件列表"}>
        {files.length} 个文件 <span className="add">+{total[0]}</span> <span className="del">−{total[1]}</span>
        <span className="fi-toggle">{collapsed ? "▸" : "▾"}</span>
      </div>
      {!collapsed && <ul>
        {files.map((f) => {
          const name = f.path.split("/").pop();
          const dir = f.path.slice(0, f.path.length - (name?.length ?? 0));
          return (
            <li key={f.path} className={`${f.path === active ? "on" : ""} ${isNoise(f.path) ? "noise" : ""}`} title={f.path}>
              <a
                href={`#file-${f.path}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(`file-${f.path}`)?.scrollIntoView({ block: "start" });
                }}
              >
                <span className={`status st-${f.status}`}>{f.status[0].toUpperCase()}</span>
                <span className="fi-name">
                  <span className="muted">{dir}</span>
                  {name}
                </span>
                {rendererFor(f) &&
                  (busy.has(programDiffLabel(f.path)) ? (
                    <span className="spinner fi-spin" title="program diff 计算中" />
                  ) : (
                    <span className="fi-prog" title="program diff">ƒ</span>
                  ))}
                <span className="stat">
                  <span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span>
                </span>
              </a>
              {rendererFor(f) && <DefOutline path={f.path} ctx={ctx} />}
            </li>
          );
        })}
      </ul>}
    </nav>
    </div>
  );
}
