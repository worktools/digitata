// Tree rendering of a definition's code diff, laid out like the Calcit editor /
// calcit-viewer code tree: short lists sit inline with a bottom rule, long or
// nested lists become blocks with a left guide. Unchanged subtrees are folded,
// removed code sits on a cool card, added code on a warm card, and a changed
// leaf is shown in place as `old→new`.

import { memo, useMemo, useState, type ReactNode } from "react";
import type { Cirru } from "../../shared/types.ts";
import { diffCirru, shapeOf, size, type DNode } from "./cirruDiff.ts";

type Mode = "inline" | "inline-block" | "block";

/** Calcit editor layout rule (see calcit-viewer `child-modes`). */
function childModes(items: Cirru[]): Mode[] {
  const many = (x: Cirru, n: number) => Array.isArray(x) && (x.length > n || x.some((y) => Array.isArray(y)));
  const modes: Mode[] = [];
  let prev: Mode = "inline";
  items.forEach((c, i) => {
    let m: Mode;
    if (i === 0 || typeof c === "string") m = "inline";
    else if (many(c, 6)) m = "block";
    else if (prev === "inline") m = "inline-block";
    else if (prev === "inline-block") m = many(c, 2) ? "block" : "inline-block";
    else m = "block";
    modes.push(m);
    prev = m;
  });
  return modes;
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
function Plain({ node, mode, head, foldAt }: { node: Cirru; mode: Mode; head?: boolean; foldAt: number }) {
  const [open, setOpen] = useState(false);
  if (typeof node === "string") return <Leaf s={node} head={head} />;
  if (node.length === 0) return <span className="ex ex-void" />;
  const n = size(node);
  if (n > foldAt && !open) {
    const h = typeof node[0] === "string" ? node[0] : "(…)";
    return (
      <span className={`ex fold ${mode === "block" ? "ex-block" : "ex-inline"}`} onClick={() => setOpen(true)} title={`展开 ${n} 个节点`}>
        <span className="lf lf-head">{h}</span>
        <span className="fold-dots">⋯ {n}</span>
      </span>
    );
  }
  const modes = childModes(node);
  return (
    <span className={`ex ${mode === "block" ? "ex-block" : mode === "inline-block" ? "ex-ib" : "ex-inline"}`}>
      {node.map((c, i) => (
        <Plain key={i} node={c} mode={modes[i]} head={i === 0} foldAt={Infinity} />
      ))}
    </span>
  );
}

function Node({ d, mode, head }: { d: DNode; mode: Mode; head?: boolean }): ReactNode {
  switch (d.t) {
    case "same":
      // Unchanged branches fold unless they are tiny.
      return <Plain node={d.node} mode={mode} head={head} foldAt={6} />;
    case "leaf":
      return (
        <span className="leaf-chg">
          <span className="lf old">{d.old}</span>
          <span className="arrow">→</span>
          <span className="lf new">{d.new}</span>
        </span>
      );
    case "add":
    case "del":
      return (
        <span className={`card ${d.t === "add" ? "card-ins" : "card-rem"} ${mode === "block" ? "card-block" : ""}`}>
          <Plain node={d.node} mode={mode === "block" ? "inline" : mode} head={head} foldAt={Infinity} />
        </span>
      );
    case "replace":
      return (
        <span className={`replace ${mode === "block" ? "card-block" : ""}`}>
          <span className="card card-rem">
            <Plain node={d.old} mode="inline" head={head} foldAt={Infinity} />
          </span>
          <span className="card card-ins">
            <Plain node={d.new} mode="inline" head={head} foldAt={Infinity} />
          </span>
        </span>
      );
    case "list": {
      const modes = childModes(d.items.map(shapeOf));
      return (
        <span className={`ex chg ${mode === "block" ? "ex-block" : mode === "inline-block" ? "ex-ib" : "ex-inline"}`}>
          {d.items.map((c, i) => (
            <Node key={i} d={c} mode={c.t === "list" && modes[i] !== "inline" ? "block" : modes[i]} head={i === 0} />
          ))}
        </span>
      );
    }
  }
}

/** Code diff of one definition as a tree. */
export const CirruTree = memo(function CirruTree({ old, now }: { old?: Cirru; now?: Cirru }) {
  const d = useMemo(() => diffCirru(old, now), [old, now]);
  return (
    <div className="cirru-tree">
      <Node d={d} mode="inline" head />
    </div>
  );
});
