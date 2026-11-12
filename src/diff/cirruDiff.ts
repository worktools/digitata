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
  | { t: "replace"; old: Cirru; new: Cirru };

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

export function size(x: Cirru): number {
  return typeof x === "string" ? 1 : x.reduce((n, c) => n + size(c), 1);
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

export function diffCirru(a: Cirru | undefined, b: Cirru | undefined): DNode {
  if (a === undefined && b !== undefined) return { t: "add", node: b };
  if (b === undefined && a !== undefined) return { t: "del", node: a };
  if (a === undefined || b === undefined) return { t: "same", node: [] };
  if (keyOf(a) === keyOf(b)) return { t: "same", node: b };
  if (typeof a === "string" && typeof b === "string") return { t: "leaf", old: a, new: b };
  if (typeof a === "string" || typeof b === "string") return { t: "replace", old: a, new: b };

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
    while (k < olds.length && k < news.length && alike(olds[k], news[k], equal)) {
      items.push(diffCirru(olds[k], news[k]));
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
  if (anchors.length === 0 && items.every((x) => x.t === "add" || x.t === "del")) return { t: "replace", old: a, new: b };
  return { t: "list", items };
}

/** The new-side shape of a diff node (old side for deletions), used for layout. */
export function shapeOf(d: DNode): Cirru {
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
      return d.items.map(shapeOf);
  }
}
