// Structural diff of two Cirru trees (definition code), for the tree view.
//
// Children of a list are aligned by LCS on identical subtrees; unmatched
// children in each gap are paired in order when they look like the same node
// (two leaves, or two lists with the same head / similar size) and diffed
// recursively, so an edit deep inside a form stays a small, local change.

import type { Cirru } from "../../shared/types.ts";

export type DNode =
  | { t: "same"; node: Cirru }
  | { t: "leaf"; old: string; new: string }
  | { t: "list"; items: DNode[] }
  | { t: "add"; node: Cirru }
  | { t: "del"; node: Cirru }
  | { t: "replace"; old: Cirru; new: Cirru }
  /** Nesting change: `in` = new wrapper around (nearly) unchanged old code, `out` = old wrapper removed. */
  | { t: "wrap"; dir: "in" | "out"; items: DNode[] };

const keys = new WeakMap<Cirru[], string>();
/** Structural identity key, cached per list. */
export function keyOf(x: Cirru): string {
  if (typeof x === "string") return x;
  let k = keys.get(x);
  if (k === undefined) {
    k = `(${x.map(keyOf).join(" ")})`;
    keys.set(x, k);
  }
  return k;
}

const sizes = new WeakMap<Cirru[], number>();
export function size(x: Cirru): number {
  if (typeof x === "string") return 1;
  let n = sizes.get(x);
  if (n === undefined) {
    n = x.reduce((acc: number, c) => acc + size(c), 1);
    sizes.set(x, n);
  }
  return n;
}

function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** Would diffing x against y recursively give a readable result? */
function alike(x: Cirru, y: Cirru, gapSizesEqual: boolean): boolean {
  if (typeof x === "string" && typeof y === "string") return true;
  if (typeof x === "string" || typeof y === "string") return false;
  if (x.length > 0 && y.length > 0 && keyOf(x[0]) === keyOf(y[0])) return true;
  if (gapSizesEqual) return true;
  const sx = size(x);
  const sy = size(y);
  return Math.min(sx, sy) / Math.max(sx, sy) > 0.6;
}

// ---- nesting changes ----------------------------------------------------

const WRAP_DEPTH = 3;

/** Path (child indexes) to a descendant of `outer` matching `pred`, breadth-first, up to WRAP_DEPTH levels. */
function findPath(outer: Cirru, pred: (x: Cirru) => boolean): number[] | null {
  let level: { node: Cirru; path: number[] }[] = [{ node: outer, path: [] }];
  for (let depth = 0; depth < WRAP_DEPTH; depth++) {
    const next: typeof level = [];
    for (const { node, path } of level) {
      if (typeof node === "string") continue;
      for (let i = 0; i < node.length; i++) {
        const p = [...path, i];
        if (pred(node[i])) return p;
        next.push({ node: node[i], path: p });
      }
    }
    level = next;
  }
  return null;
}

/**
 * Detect that `inner` now sits inside `outer` (or the reverse): exactly, or
 * nearly (a same-headed list that keeps most nodes). Returns the wrapper with
 * every other child marked added (`in`) or removed (`out`).
 */
function nesting(a: Cirru, b: Cirru): DNode | null {
  const tryDir = (inner: Cirru, outer: Cirru, dir: "in" | "out"): DNode | null => {
    if (typeof outer === "string") return null;
    // A lone leaf is common everywhere; only accept it as a direct child of a small form.
    if (typeof inner === "string") {
      if (outer.length > 4) return null;
      const i = outer.findIndex((c) => c === inner);
      return i < 0 ? null : build(outer, [i], { t: "same", node: inner }, dir);
    }
    const k = keyOf(inner);
    if (keyOf(outer).includes(k)) {
      const p = findPath(outer, (x) => keyOf(x) === k);
      if (p) return build(outer, p, { t: "same", node: inner }, dir);
    }
    // Near match: a same-headed list below that keeps most of `inner`.
    const si = size(inner);
    if (si < 6) return null;
    const head = keyOf(inner[0] ?? "");
    let found: DNode | null = null;
    const p = findPath(outer, (x) => {
      if (typeof x === "string" || keyOf(x[0] ?? "") !== head) return false;
      const sx = size(x);
      if (Math.min(sx, si) / Math.max(sx, si) < 0.6) return false;
      const d = dir === "in" ? diffCirru(inner, x) : diffCirru(x, inner);
      if (d.t === "replace" || kept(d) / Math.max(sx, si) < 0.6) return false;
      found = d;
      return true;
    });
    return p && found ? build(outer, p, found, dir) : null;
  };
  return tryDir(a, b, "in") ?? tryDir(b, a, "out");
}

function build(node: Cirru, path: number[], innerDiff: DNode, dir: "in" | "out"): DNode {
  if (path.length === 0 || typeof node === "string") return innerDiff;
  const [i, ...rest] = path;
  const items = node.map((c, j): DNode => (j === i ? build(c, rest, innerDiff, dir) : dir === "in" ? { t: "add", node: c } : { t: "del", node: c }));
  return { t: "wrap", dir, items };
}

export function diffCirru(a: Cirru | undefined, b: Cirru | undefined): DNode {
  if (a === undefined && b !== undefined) return { t: "add", node: b };
  if (b === undefined && a !== undefined) return { t: "del", node: a };
  if (a === undefined || b === undefined) return { t: "same", node: [] };
  if (keyOf(a) === keyOf(b)) return { t: "same", node: b };
  if (typeof a === "string" && typeof b === "string") return { t: "leaf", old: a, new: b };
  if (typeof a === "string" || typeof b === "string") return nesting(a, b) ?? { t: "replace", old: a, new: b };

  // Pure nesting change: one side contains the other unchanged.
  if (keyOf(b).includes(keyOf(a)) || keyOf(a).includes(keyOf(b))) {
    const n = nesting(a, b);
    if (n) return n;
  }
  const ka = a.map(keyOf);
  const kb = b.map(keyOf);
  const anchors = a.length * b.length > 250_000 ? [] : lcs(ka, kb);
  const items: DNode[] = [];
  let pi = 0;
  let pj = 0;
  const gap = (i1: number, j1: number) => {
    const olds = a.slice(pi, i1);
    const news = b.slice(pj, j1);
    const equal = olds.length === news.length;
    let k = 0;
    while (k < olds.length && k < news.length) {
      if (alike(olds[k], news[k], equal)) items.push(diffCirru(olds[k], news[k]));
      else {
        // e.g. `x` → `(f x)`: a wrap, not a delete plus an add.
        const n = nesting(olds[k], news[k]);
        if (!n) break;
        items.push(n);
      }
      k++;
    }
    for (const x of olds.slice(k)) items.push({ t: "del", node: x });
    for (const y of news.slice(k)) items.push({ t: "add", node: y });
  };
  for (const [i, j] of anchors) {
    gap(i, j);
    items.push({ t: "same", node: b[j] });
    pi = i + 1;
    pj = j + 1;
  }
  gap(a.length, b.length);
  // Nothing in common at all: show it as one replacement rather than noise.
  if (anchors.length === 0 && items.every((x) => x.t === "add" || x.t === "del")) return nesting(a, b) ?? { t: "replace", old: a, new: b };
  // Almost everything changed (little survives on either side): one whole
  // replacement reads better than many scattered edits.
  const list: DNode = { t: "list", items };
  const total = Math.max(size(a), size(b));
  // Tiny forms like `(f a)` keep their in-place leaf edits.
  if (total >= 5 && kept(list) / total < REPLACE_BELOW) return nesting(a, b) ?? { t: "replace", old: a, new: b };
  return list;
}

/** Below this share of unchanged nodes, a changed list is shown as a whole replacement. */
const REPLACE_BELOW = 0.4;

/** Number of nodes that stay unchanged inside a diff node (the list container itself counts when its head survives). */
function kept(d: DNode): number {
  switch (d.t) {
    case "same":
      return size(d.node);
    case "list":
      return d.items.reduce((n, c) => n + kept(c), d.items[0]?.t === "same" ? 1 : 0);
    case "wrap":
      return d.items.reduce((n, c) => n + kept(c), 0);
    default:
      return 0;
  }
}

/** The new-side shape of a diff node (old side for deletions), used for layout. */
const shapes = new WeakMap<DNode, Cirru>();
export function shapeOf(d: DNode): Cirru {
  let x = shapes.get(d);
  if (x === undefined) {
    x = shapeOfRaw(d);
    shapes.set(d, x);
  }
  return x;
}
function shapeOfRaw(d: DNode): Cirru {
  switch (d.t) {
    case "same":
    case "add":
    case "del":
      return d.node;
    case "leaf":
      return d.new;
    case "replace":
      return d.new;
    case "list":
    case "wrap":
      return d.items.map(shapeOf);
  }
}
