// Token-level and line-level diff helpers, used to emphasise only what changed
// inside a modified line (and to grey out repeated, unchanged content).

export interface Segment {
  text: string;
  changed: boolean;
}

const TOKEN_RE = /[\p{L}\p{N}_$?!*-]+|\s+|./gu;

export function tokenize(s: string): string[] {
  return s.match(TOKEN_RE) ?? [];
}

/** Longest common subsequence table walk; returns pairs of matching indices. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length;
  const m = b.length;
  // Guard against pathological sizes: fall back to prefix/suffix matching.
  if (n * m > 4_000_000) return prefixSuffix(a, b, eq);
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

function prefixSuffix<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let p = 0;
  while (p < a.length && p < b.length && eq(a[p], b[p])) out.push([p, p++]);
  let s = 0;
  const tail: [number, number][] = [];
  while (s < a.length - p && s < b.length - p && eq(a[a.length - 1 - s], b[b.length - 1 - s])) {
    tail.unshift([a.length - 1 - s, b.length - 1 - s]);
    s++;
  }
  return out.concat(tail);
}

function toSegments(tokens: string[], matched: Set<number>): Segment[] {
  const segs: Segment[] = [];
  tokens.forEach((t, i) => {
    const changed = !matched.has(i);
    const last = segs[segs.length - 1];
    if (last && last.changed === changed) last.text += t;
    else segs.push({ text: t, changed });
  });
  // Whitespace-only changed segments between unchanged text read as noise.
  for (const s of segs) if (s.changed && !s.text.trim()) s.changed = false;
  return segs;
}

export interface InlinePair {
  old: Segment[];
  new: Segment[];
  /** Share of characters common to both sides, 0..1. */
  similarity: number;
}

export function inlineDiff(a: string, b: string): InlinePair {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const pairs = lcs(ta, tb, (x, y) => x === y);
  const ma = new Set(pairs.map((p) => p[0]));
  const mb = new Set(pairs.map((p) => p[1]));
  const common = pairs.reduce((n, [i]) => n + (ta[i].trim() ? ta[i].length : 0), 0);
  const total = Math.max(a.trim().length, b.trim().length, 1);
  return { old: toSegments(ta, ma), new: toSegments(tb, mb), similarity: common / total };
}

/**
 * Align two runs of lines (deleted vs added). Returns, for each old line, the
 * index of the new line it pairs with (or -1), choosing pairs in order by
 * similarity so that a changed line is shown next to its counterpart.
 */
export function alignLines(oldLines: string[], newLines: string[], threshold = 0.4): { oldToNew: number[]; exact: boolean[] } {
  const oldToNew = oldLines.map(() => -1);
  const exact = oldLines.map(() => false);
  // First, exact matches (after trimming) in order.
  const anchors = lcs(oldLines, newLines, (x, y) => x.trim() === y.trim() && x.trim() !== "");
  for (const [i, j] of anchors) {
    oldToNew[i] = j;
    exact[i] = true;
  }
  // Then pair remaining lines inside each gap between anchors by similarity, in order.
  const bounds: [number, number][] = [[-1, -1], ...anchors, [oldLines.length, newLines.length]];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [i0, j0] = bounds[k];
    const [i1, j1] = bounds[k + 1];
    let jStart = j0 + 1;
    for (let i = i0 + 1; i < i1; i++) {
      let best = -1;
      let bestSim = threshold;
      for (let j = jStart; j < j1 && j < jStart + 8; j++) {
        const sim = inlineDiff(oldLines[i], newLines[j]).similarity;
        if (sim > bestSim) {
          bestSim = sim;
          best = j;
        }
      }
      if (best >= 0) {
        oldToNew[i] = best;
        jStart = best + 1;
      }
    }
  }
  return { oldToNew, exact };
}
