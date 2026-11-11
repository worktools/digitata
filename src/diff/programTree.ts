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
  let block: { side: "old" | "new"; col: number } | null = null;
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
      block = { side, col: col + lead };
      lines.push({ id, prefix, text: rest, side, isSideHeader: true });
      return;
    }
    if (block) {
      const lead = rest.length - rest.trimStart().length;
      if (col + lead > block.col) {
        lines.push({ id, prefix, text: rest, side: block.side });
        return;
      }
      block = null;
    }
    lines.push({ id, prefix, text: rest });
  });
  return { lines, defs, nsChanges };
}
