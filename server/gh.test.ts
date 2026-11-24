import assert from "node:assert/strict";
import test from "node:test";
import { assertThreadId, trimDiffHunk } from "./gh.ts";

test("trimDiffHunk preserves short hunks unchanged", () => {
  const short = "@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line3";
  assert.equal(trimDiffHunk(short), short);
  assert.equal(trimDiffHunk(""), "");
});

test("trimDiffHunk keeps header and trailing maxLines on long hunks", () => {
  const lines = ["@@ -10,12 +10,12 @@", ...Array.from({ length: 12 }, (_, i) => ` line ${i + 1}`)];
  const trimmed = trimDiffHunk(lines.join("\n"), 8, 500);
  assert.equal(
    trimmed,
    ["@@ -10,12 +10,12 @@", "…", " line 5", " line 6", " line 7", " line 8", " line 9", " line 10", " line 11", " line 12"].join("\n"),
  );
});

test("trimDiffHunk truncates overly long lines", () => {
  const longLine = `+${"x".repeat(600)}`;
  const trimmed = trimDiffHunk(longLine, 8, 500);
  assert.equal(trimmed.length, 501);
  assert.ok(trimmed.endsWith("…"));
});

test("assertThreadId accepts valid GraphQL node IDs and rejects invalid values", () => {
  assert.equal(assertThreadId("PRRT_kwDOFVrS1M66YNzy"), "PRRT_kwDOFVrS1M66YNzy");
  assert.equal(assertThreadId("MDEyOlB1bGxSZXF1ZXN0VGhyZWFkMTIz="), "MDEyOlB1bGxSZXF1ZXN0VGhyZWFkMTIz=");
  assert.throws(() => assertThreadId(""), /invalid threadId/);
  assert.throws(() => assertThreadId("bad id with spaces"), /invalid threadId/);
  assert.throws(() => assertThreadId("bad$id!"), /invalid threadId/);
});
