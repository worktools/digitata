import { alignLines, inlineDiff } from "./inline.ts";

// Minimal parser for `git diff` / `gh pr diff` unified patches.

export interface DiffLine {
  kind: "add" | "del" | "ctx" | "meta";
  text: string;
  oldNo?: number;
  newNo?: number;
  /** Token segments when this line pairs with a line on the other side. */
  segs?: { text: string; changed: boolean }[];
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FilePatch {
  oldPath: string;
  newPath: string;
  /** Display path: new path unless the file was deleted. */
  path: string;
  status: "added" | "deleted" | "renamed" | "modified";
  binary: boolean;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

const stripPrefix = (p: string) => (p === "/dev/null" ? p : p.replace(/^[ab]\//, ""));

export function parsePatch(text: string): FilePatch[] {
  const files: FilePatch[] = [];
  let cur: FilePatch | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      cur = {
        oldPath: m?.[1] ?? "",
        newPath: m?.[2] ?? "",
        path: m?.[2] ?? line,
        status: "modified",
        binary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      files.push(cur);
      hunk = null;
      continue;
    }
    if (!cur) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) cur.status = "added";
      else if (line.startsWith("deleted file mode")) cur.status = "deleted";
      else if (line.startsWith("rename from ")) cur.status = "renamed";
      else if (line.startsWith("Binary files")) cur.binary = true;
      else if (line.startsWith("--- ")) cur.oldPath = stripPrefix(line.slice(4));
      else if (line.startsWith("+++ ")) {
        cur.newPath = stripPrefix(line.slice(4));
        if (cur.newPath === "/dev/null") cur.path = cur.oldPath;
      }
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (h) {
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      hunk = { header: line, lines: [] };
      cur.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
      cur.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
      cur.deletions++;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else if (line.startsWith("\\")) {
      hunk.lines.push({ kind: "meta", text: line });
    }
  }
  return files;
}

/**
 * Pair each run of deleted lines with the run of added lines that follows it,
 * and attach token segments so only the changed parts are emphasised.
 */
export function annotateInline(file: FilePatch) {
  for (const h of file.hunks) {
    const ls = h.lines;
    let i = 0;
    while (i < ls.length) {
      if (ls[i].kind !== "del") {
        i++;
        continue;
      }
      let j = i;
      while (j < ls.length && ls[j].kind === "del") j++;
      let k = j;
      while (k < ls.length && ls[k].kind === "add") k++;
      const dels = ls.slice(i, j);
      const adds = ls.slice(j, k);
      if (adds.length && dels.length * adds.length <= 40_000) {
        const { oldToNew } = alignLines(
          dels.map((l) => l.text),
          adds.map((l) => l.text),
        );
        oldToNew.forEach((n, d) => {
          if (n < 0) return;
          const r = inlineDiff(dels[d].text, adds[n].text);
          dels[d].segs = r.old;
          adds[n].segs = r.new;
        });
      }
      i = k;
    }
  }
  return file;
}
