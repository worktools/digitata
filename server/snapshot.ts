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

interface Entry {
  code?: Cirru;
  schema?: Cirru;
  examples?: Cirru;
  tests?: Cirru;
}

const unquote = (v: Cirru | undefined) => (isList(v) && v[0] === "quote" ? v[1] : v);

/** `:examples $ [] (quote …) …` → list of example trees. */
function examplesOf(entry: Cirru | undefined): Cirru | undefined {
  const f = field(entry, ":examples");
  if (!isList(f) || !isList(f[1])) return undefined;
  return f[1].slice(1).map((x) => unquote(x) ?? []);
}

/** `:tests $ [] (%{} 'TestEntry (:name |n) (:code $ quote …)) …` → list of `(name code)` pairs. */
function testsOf(entry: Cirru | undefined): Cirru | undefined {
  const f = field(entry, ":tests");
  if (!isList(f) || !isList(f[1])) return undefined;
  return f[1].slice(1).map((t) => {
    const n = field(t, ":name");
    const nameLeaf = isList(n) && typeof n[1] === "string" ? n[1] : "|?";
    return [nameLeaf, quoted(t, ":code") ?? []];
  });
}

/** Map of `ns/def` (and `ns/:ns` for the ns form) to its code and schema trees. */
export function snapshotCodes(text: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const [root] = pare(text);
  // Top-level snapshot fields other than files (entries, configs, …) as `:config/<name>`.
  if (isList(root)) {
    for (const f of root.slice(1)) {
      const k = head(f);
      if (!k || k === ":files" || k === ":about" || !isList(f)) continue;
      out.set(`:config/${k.slice(1)}`, { code: f.length === 2 ? f[1] : f.slice(1) });
    }
  }
  const files = field(root, ":files");
  if (!isList(files) || !isList(files[1])) return out;
  for (const entry of files[1].slice(1)) {
    if (!isList(entry) || entry.length < 2) continue;
    const ns = name(entry[0]);
    const file = entry[1];
    // `:ns $ %{} 'NsEntry (:doc |) (:code $ quote $ ns …)`, or the older `:ns $ quote $ ns …`.
    const nsVal = (field(file, ":ns") as Cirru[] | undefined)?.[1];
    const nsCode = isList(nsVal) && nsVal[0] === "quote" ? nsVal[1] : quoted(nsVal, ":code");
    if (nsCode !== undefined) out.set(`${ns}/:ns`, { code: nsCode });
    const defs = field(file, ":defs");
    if (!isList(defs) || !isList(defs[1])) continue;
    for (const d of defs[1].slice(1)) {
      if (!isList(d) || d.length < 2) continue;
      out.set(`${ns}/${name(d[0])}`, {
        code: quoted(d[1], ":code"),
        schema: quoted(d[1], ":schema"),
        examples: examplesOf(d[1]),
        tests: testsOf(d[1]),
      });
    }
  }
  return out;
}

const same = (x?: Cirru, y?: Cirru) => JSON.stringify(x) === JSON.stringify(y);

/** Definitions whose code or schema differs between two snapshots, with both trees. */
export function changedCodes(before: string, after: string): DefCode[] {
  let a: Map<string, Entry>;
  let b: Map<string, Entry>;
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
    const codeSame = same(x?.code, y?.code);
    const schemaSame = same(x?.schema, y?.schema);
    const examplesSame = same(x?.examples, y?.examples);
    const testsSame = same(x?.tests, y?.tests);
    if (x && y && codeSame && schemaSame && examplesSame && testsSame) continue;
    out.push({
      key,
      old: x?.code,
      new: y?.code,
      ...(schemaSame ? {} : { oldSchema: x?.schema, newSchema: y?.schema }),
      ...(examplesSame ? {} : { examples: { old: x?.examples, new: y?.examples } }),
      ...(testsSame ? {} : { tests: { old: x?.tests, new: y?.tests } }),
    });
  }
  return out;
}
