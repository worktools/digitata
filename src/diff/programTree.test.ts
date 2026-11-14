import assert from "node:assert/strict";
import test from "node:test";
import { parseTree } from "./programTree.ts";

test("indexes padded added and removed definitions and their code parts", () => {
  const { defs, lines } = parseTree([
    "program",
    "└── ~ files",
    "    └── ~ stir-template.core",
    "        └── ~ defs",
    "            ├──  +  HtmlElement",
    "            │   └──  +  code defstruct HtmlElement (:name Tag)",
    "            │       NEW@0",
    "            │         defstruct HtmlElement (:name Tag)",
    "            ├── ~ element->string",
    "            │   └── ~ code",
    "            └──  -  old-renderer",
    "                └──  -  code defn old-renderer () nil",
  ]);

  assert.deepEqual(defs.map(({ def, marker, parts }) => ({ def, marker, parts })), [
    { def: "HtmlElement", marker: "+", parts: ["code"] },
    { def: "element->string", marker: "~", parts: ["code"] },
    { def: "old-renderer", marker: "-", parts: ["code"] },
  ]);
  assert.deepEqual(lines[5].path, ["files", "stir-template.core", "defs", "HtmlElement", "code"]);
  assert.equal(lines[7].side, "new");
});
