// Read definition code trees out of a Calcit snapshot (calcit.cirru), so the UI
// can render a structural tree diff of changed definitions.

import { createRequire } from "node:module";
import type { Cirru, DefCode } from "../shared/types.ts";

const require = createRequire(import.meta.url);
const { pare } = require("cirru-parser") as { pare: (text: string) => Cirru[] };

const isList = (x: Cirru | undefined): x is Cirru[] => Array.isArray(x);
const head = (x: Cirru | undefined) => (isList(x) && typeof x[0] === "string" ? x[0] : undefined);
/** `'app.main` / `|app.main` → `app.main` */
const name = (x: Cirru | undefined) => (typeof x === "string" ? x.replace(/^['|]/, "") : "");
const field = (entry: Cirru | undefined, key: string) => (isList(entry) ? entry.find((c) => head(c) === key) : undefined);

/** `:code $ quote $ CODE` → CODE */
function quoted(entry: Cirru | undefined, key: string): Cirru | undefined {
  const f = field(entry, key);
  if (!isList(f)) return undefined;
  const v = f[1];
  return isList(v) && v[0] === "quote" ? v[1] : v;
}

/** Map of `ns/def` (and `ns/:ns` for the ns form) to its code tree. */
export function snapshotCodes(text: string): Map<string, Cirru> {
  const out = new Map<string, Cirru>();
  const [root] = pare(text);
  const files = field(root, ":files");
  if (!isList(files) || !isList(files[1])) return out;
  for (const entry of files[1].slice(1)) {
    if (!isList(entry) || entry.length < 2) continue;
    const ns = name(entry[0]);
    const file = entry[1];
    const nsCode = quoted(field(file, ":ns") ?? [], ":code");
    if (nsCode !== undefined) out.set(`${ns}/:ns`, nsCode);
    const defs = field(file, ":defs");
    if (!isList(defs) || !isList(defs[1])) continue;
    for (const d of defs[1].slice(1)) {
      if (!isList(d) || d.length < 2) continue;
      const code = quoted(d[1], ":code");
      if (code !== undefined) out.set(`${ns}/${name(d[0])}`, code);
    }
  }
  return out;
}

/** Definitions whose code differs between two snapshots, with both trees. */
export function changedCodes(before: string, after: string): DefCode[] {
  let a: Map<string, Cirru>;
  let b: Map<string, Cirru>;
  try {
    a = snapshotCodes(before);
    b = snapshotCodes(after);
  } catch {
    return [];
  }
  const out: DefCode[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key);
    const y = b.get(key);
    if (x !== undefined && y !== undefined && JSON.stringify(x) === JSON.stringify(y)) continue;
    out.push({ key, old: x, new: y });
  }
  return out;
}
