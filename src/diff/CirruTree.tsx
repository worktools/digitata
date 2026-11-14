// Tree rendering of a definition's code diff, laid out like the Calcit editor /
// calcit-viewer code tree: short lists sit inline with a bottom rule, long or
// nested lists become blocks with a left guide. Unchanged subtrees are folded,
// removed code sits on a cool card, added code on a warm card, and a changed
// leaf is shown in place as `old→new`.

import { memo, useMemo, useState, type ReactNode } from "react";
import type { Cirru } from "../../shared/types.ts";
import { diffCirru, shapeOf, size, type DNode } from "./cirruDiff.ts";

type Mode = "inline" | "inline-block" | "block";

/** Inside added/removed cards, nested subtrees larger than this start folded. */
const CARD_FOLD = 60;

/** Calcit editor layout rule (see calcit-viewer `child-modes`). */
function childModes(items: Cirru[]): Mode[] {
  const many = (x: Cirru, n: number) => Array.isArray(x) && (x.length > n || x.some((y) => Array.isArray(y)));
  const modes: Mode[] = [];
  let prev: Mode = "inline";
  items.forEach((c) => {
    let m: Mode;
    if (typeof c === "string") m = "inline";
    else if (many(c, 6)) m = "block";
    else if (prev === "inline") m = "inline-block";
    else if (prev === "inline-block") m = many(c, 2) ? "block" : "inline-block";
    else m = "block";
    modes.push(m);
    prev = m;
  });
  return modes;
}

/** Tooltip computed on first hover, so large trees do not build every preview up front. */
const tip = (make: () => string) => (e: { currentTarget: HTMLElement }) => {
  if (!e.currentTarget.title) e.currentTarget.title = make();
};

/** One-line text of a subtree for tooltips. */
function preview(x: Cirru, max = 80): string {
  const text = (n: Cirru): string => (typeof n === "string" ? n : `(${n.map(text).join(" ")})`);
  const t = text(x);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function leafClass(s: string, isHead: boolean) {
  if (s.startsWith("|") || s.startsWith('"')) return "lf-str";
  if (s.startsWith(":")) return "lf-tag";
  if (/^-?\d/.test(s)) return "lf-num";
  if (isHead) return "lf-head";
  return "";
}

function Leaf({ s, head }: { s: string; head?: boolean }) {
  const long = s.length > 60;
  return (
    <span className={`lf ${leafClass(s, !!head)}`} title={long ? s : undefined}>
      {long ? `${s.slice(0, 57)}…` : s}
    </span>
  );
}

/** Plain (unchanged) code; lists larger than `foldAt` start folded. */
function Plain({ node, mode, head, foldAt, rootOpen }: { node: Cirru; mode: Mode; head?: boolean; foldAt: number; rootOpen?: boolean }) {
  const [open, setOpen] = useState(!!rootOpen);
  if (typeof node === "string") return <Leaf s={node} head={head} />;
  if (node.length === 0) return <span className="ex ex-void" />;
  const n = size(node);
  if (n > foldAt && !open) {
    const h = typeof node[0] === "string" ? node[0] : "(…)";
    return (
      <span className={`ex fold ${mode === "block" ? "ex-block" : mode === "inline-block" ? "ex-ib" : "ex-inline"}`} onClick={() => setOpen(true)} onMouseEnter={tip(() => `未改动：${preview(node)}（${n} 个节点，点击展开）`)}>
        <span className="lf lf-head">{h}</span>
        <span className="fold-dots">⋯ {n}</span>
      </span>
    );
  }
  const modes = childModes(node);
  return (
    <span className={`ex ${mode === "block" ? "ex-block" : mode === "inline-block" ? "ex-ib" : "ex-inline"}`}>
      {node.map((c, i) => (
        <Plain key={i} node={c} mode={modes[i]} head={i === 0} foldAt={rootOpen ? foldAt : Infinity} />
      ))}
    </span>
  );
}

function Node({ d, mode, head, foldAt }: { d: DNode; mode: Mode; head?: boolean; foldAt: number }): ReactNode {
  switch (d.t) {
    case "same":
      // Unchanged branches are muted and fold unless they are tiny.
      return (
        <span className="dim">
          <Plain node={d.node} mode={mode} head={head} foldAt={foldAt} />
        </span>
      );
    case "leaf":
      return (
        <span className="leaf-chg" onMouseEnter={tip(() => `修改：${d.old} → ${d.new}`)}>
          <span className="lf old">{d.old}</span>
          <span className="arrow">→</span>
          <span className="lf new">{d.new}</span>
        </span>
      );
    case "add":
    case "del":
      return (
        <span
          className={`card ${d.t === "add" ? "card-ins" : "card-rem"} ${mode === "block" ? "card-block" : ""}`}
          onMouseEnter={tip(() => `${d.t === "add" ? "新增" : "删除"}：${preview(d.node)}（${size(d.node)} 个节点）`)}
        >
          <Plain node={d.node} mode={mode === "block" ? "inline" : mode} head={head} foldAt={CARD_FOLD} rootOpen />
        </span>
      );
    case "replace": {
      const sideMode = mode === "block" ? "inline" : "inline-block";
      return (
        <span className={`replace ${mode === "block" ? "card-block" : ""}`} onMouseEnter={tip(() => `替换：${preview(d.old)} → ${preview(d.new)}`)}>
          <span className="card card-rem">
            <Plain node={d.old} mode={sideMode} head={head} foldAt={CARD_FOLD} rootOpen />
          </span>
          <span className="card card-ins">
            <Plain node={d.new} mode={sideMode} head={head} foldAt={CARD_FOLD} rootOpen />
          </span>
        </span>
      );
    }
    case "wrap": {
      // Nesting change: draw the new (or removed) wrapper as a dashed frame;
      // the wrapped code inside stays as-is (or with its few edits).
      const modes = childModes(d.items.map(shapeOf));
      return (
        <span
          className={`ex wrap wrap-${d.dir} ${mode === "block" ? "ex-block" : mode === "inline-block" ? "ex-ib" : "ex-inline"}`}
          onMouseEnter={tip(() => (d.dir === "in" ? "新增一层包裹，里面的代码基本未变" : "去掉了一层包裹，里面的代码基本未变"))}
        >
          {d.items.map((c, i) => (
            <Node key={i} d={c} mode={(c.t === "list" || c.t === "wrap") && modes[i] !== "inline" && size(shapeOf(c)) > 10 ? "block" : modes[i]} head={i === 0} foldAt={foldAt} />
          ))}
        </span>
      );
    }
    case "list": {
      const modes = childModes(d.items.map(shapeOf));
      return (
        <span className={`ex chg ${mode === "block" ? "ex-block" : mode === "inline-block" ? "ex-ib" : "ex-inline"}`} onMouseEnter={tip(() => `内部有改动：${preview(shapeOf(d))}`)}>
          {d.items.map((c, i) => (
            <Node key={i} d={c} mode={(c.t === "list" || c.t === "wrap") && modes[i] !== "inline" && size(shapeOf(c)) > 10 ? "block" : modes[i]} head={i === 0} foldAt={foldAt} />
          ))}
        </span>
      );
    }
  }
}

/** Code diff of one definition as a tree. */
export const CirruTree = memo(function CirruTree({ old, now, foldAt = 6 }: { old?: Cirru; now?: Cirru; foldAt?: number }) {
  const d = useMemo(() => diffCirru(old, now), [old, now]);
  return (
    <div className="cirru-tree">
      <Node d={d} mode="inline" head foldAt={foldAt} />
    </div>
  );
});
