import { useEffect, useState } from "react";
import { programDiffLabel } from "./api.ts";
import { isNoise, rendererFor } from "./diff/FileDiff.tsx";
import { useActivity } from "./store.ts";
import type { FilePatch } from "./diff/parse.ts";

/**
 * Changed-file list docked on the right of the diff. It stays in view while
 * scrolling and highlights the file currently at the top of the viewport.
 */
export function FileIndex({ files }: { files: FilePatch[] }) {
  const [active, setActive] = useState(files[0]?.path ?? "");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("digitata.fi-collapsed") === "1");
  useEffect(() => localStorage.setItem("digitata.fi-collapsed", collapsed ? "1" : "0"), [collapsed]);

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
    <div className="fi-anchor">
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
            </li>
          );
        })}
      </ul>}
    </nav>
    </div>
  );
}
