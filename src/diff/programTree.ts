// Interprets the tree printed by `calcit analyze program-diff` (human format):
//
//   └── ~ files
//       └── ~ memof.once
//           └── ~ defs
//               ├── = put-keyed-entry (7 folded)
//               ├── ~ memof1-call
//               │   └── ~ code
//               │         defn ...            <- Cirru code, indented by two spaces
//               │           OLD@0.3.2         <- old subtree follows, deeper indent
//               │             %{} MemoEntry ...
//               │           NEW@0.3.2         <- new subtree
//               │             MemoEntry ...
//
// Markers: "=" unchanged (folded), "~" modified, "+" added, "-" removed.

import { alignLines, inlineDiff } from "./inline.ts";

export type Marker = "=" | "~" | "+" | "-";

export interface TreeLine {
  id: number;
  /** Tree drawing prefix (│ ├── └── and spaces). */
  prefix: string;
  /** Text after the prefix (and after the marker for node lines). */
  text: string;
  marker?: Marker;
  /** Node depth (0 = program); only set on node lines. */
  depth?: number;
  /** Inside an OLD@ or NEW@ block, or the block header itself. */
  side?: "old" | "new";
  isSideHeader?: boolean;
  /** Which OLD@/NEW@ block this line belongs to (sequential id). */
  blockId?: number;
  /** Inline segments when this line pairs with a line on the other side. */
  segs?: { text: string; changed: boolean }[];
  /** Identical to a line on the other side: show it muted, once. */
  same?: boolean;
  /** Path of node names from the root, for node lines. */
  path?: string[];
}

export interface DefChange {
  ns: string;
  def: string;
  marker: Marker;
  /** Line id of the def node, for scrolling. */
  lineId: number;
  /** Which parts of the def changed (code, schema, doc...). */
  parts: string[];
}

const PREFIX_RE = /^[ │├└─]*/u;

export function parseTree(raw: string[]): { lines: TreeLine[]; defs: DefChange[]; nsChanges: DefChange[] } {
  const lines: TreeLine[] = [];
  const stack: string[] = [];
  let block: { side: "old" | "new"; col: number; id: number } | null = null;
  let blockSeq = 0;
  const defs: DefChange[] = [];
  const nsChanges: DefChange[] = [];

  raw.forEach((line, id) => {
    const prefix = PREFIX_RE.exec(line)![0];
    const rest = line.slice(prefix.length);
    const col = [...prefix].length;
    const node = /(├── |└── )$/u.test(prefix) || (prefix === "" && rest !== "" && id <= 1);
    const nm = /^([=~+-]) (.*)$/.exec(rest);

    if (block && (col <= block.col || node)) block = null;

    if (node && nm) {
      const depth = Math.round((col - 4) / 4) + 1;
      const name = nm[2].split(" ")[0];
      stack.length = depth;
      stack[depth] = name;
      const marker = nm[1] as Marker;
      const path = stack.slice(1);
      lines.push({ id, prefix, text: nm[2], marker, depth, path });
      // files/<ns>/defs/<def>
      if (path[0] === "files" && path.length === 4 && path[2] === "defs" && marker !== "=") {
        defs.push({ ns: path[1], def: path[3], marker, lineId: id, parts: [] });
      } else if (path[0] === "files" && path.length === 5 && path[2] === "defs" && marker !== "=") {
        const d = defs[defs.length - 1];
        if (d && d.ns === path[1] && d.def === path[3]) d.parts.push(path[4]);
      } else if (path[0] === "files" && path.length === 2 && (marker === "+" || marker === "-")) {
        nsChanges.push({ ns: path[1], def: "", marker, lineId: id, parts: [] });
      }
      return;
    }
    if (node) {
      // root line ("program")
      stack.length = 0;
      stack[0] = rest;
      lines.push({ id, prefix, text: rest, depth: 0 });
      return;
    }
    const sm = /^\s*(OLD|NEW)@/.exec(rest);
    if (sm) {
      const side = sm[1] === "OLD" ? "old" : "new";
      const lead = rest.length - rest.trimStart().length;
      block = { side, col: col + lead, id: ++blockSeq };
      lines.push({ id, prefix, text: rest, side, isSideHeader: true, blockId: block.id });
      return;
    }
    if (block) {
      const lead = rest.length - rest.trimStart().length;
      if (col + lead > block.col) {
        lines.push({ id, prefix, text: rest, side: block.side, blockId: block.id });
        return;
      }
      block = null;
    }
    lines.push({ id, prefix, text: rest });
  });
  annotateBlocks(lines);
  return { lines, defs, nsChanges };
}

/**
 * For each OLD@ block followed by its NEW@ block, align the lines: identical
 * lines are marked `same` (rendered muted, the new copy without highlight) and
 * similar lines get token segments so only the changed tokens stand out.
 */
function annotateBlocks(lines: TreeLine[]) {
  const blocks = new Map<number, TreeLine[]>();
  for (const l of lines) {
    if (l.blockId === undefined || l.isSideHeader) continue;
    if (!blocks.has(l.blockId)) blocks.set(l.blockId, []);
    blocks.get(l.blockId)!.push(l);
  }
  const headers = new Map(lines.filter((l) => l.isSideHeader).map((l) => [l.blockId!, l]));
  for (const [id, h] of headers) {
    const next = headers.get(id + 1);
    if (h.side !== "old" || !next || next.side !== "new") continue;
    const olds = blocks.get(id) ?? [];
    const news = blocks.get(id + 1) ?? [];
    // Compare with indentation, relative to each block's own header.
    const rel = (b: TreeLine[], hdr: TreeLine) => b.map((l) => " ".repeat(Math.max(0, [...l.prefix].length - [...hdr.prefix].length)) + l.text);
    const ot = rel(olds, h);
    const nt = rel(news, next);
    const { oldToNew, exact } = alignLines(ot, nt);
    oldToNew.forEach((j, i) => {
      if (j < 0) return;
      if (exact[i] && ot[i] === nt[j]) {
        olds[i].same = true;
        news[j].same = true;
      } else {
        const d = inlineDiff(olds[i].text, news[j].text);
        olds[i].segs = d.old;
        news[j].segs = d.new;
      }
    });
  }
}
