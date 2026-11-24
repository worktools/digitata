import assert from "node:assert/strict";
import test from "node:test";
import { formatThreadLines, parseCommentBlocks, parseInline } from "./commentFormat.ts";

test("parses CodeRabbit-style body with comments, picture tags, details, and fenced code", () => {
  const body = `<!-- coderabbit-ai-generated:v1 -->

**<picture><img src="https://example.com/amber.svg" width="16" alt=""></picture> Minor** · **Functional Correctness**

**Replay the \`wasm-compact-portable\` fixture on WASI in CI.**

The \`wasm-compact-portable\` tag selects \`compact-struct-enum-roundtrip\`.

<details>
<summary>Suggested workflow change</summary>
<dl>
<dd>
<br>

\`\`\`diff
-          node scripts/run-core-tests.mjs --backend native,wasi
+          node scripts/run-core-tests.mjs --tag wasm-compact-portable --backend native,wasi
\`\`\`

</dd>
</dl>
</details>

<!-- ai-agent-prompt:start -->
<details>
<summary><picture><img src="https://example.com/bot.svg" alt=""></picture> Prompt to fix issue</summary>
<dl>
<dd>

\`\`\`
Update the WASI test workflow step.
\`\`\`

</dd>
</dl>
</details>
<!-- ai-agent-prompt:end -->
`;

  const blocks = parseCommentBlocks(body);
  assert.equal(blocks.length, 5);
  assert.deepEqual(blocks[0], { kind: "paragraph", text: "** Minor** · **Functional Correctness**" });
  assert.deepEqual(blocks[1], { kind: "paragraph", text: "**Replay the `wasm-compact-portable` fixture on WASI in CI.**" });
  assert.deepEqual(blocks[2], { kind: "paragraph", text: "The `wasm-compact-portable` tag selects `compact-struct-enum-roundtrip`." });

  assert.equal(blocks[3].kind, "details");
  if (blocks[3].kind === "details") {
    assert.equal(blocks[3].summary, "Suggested workflow change");
    assert.deepEqual(blocks[3].blocks, [
      {
        kind: "code",
        lang: "diff",
        text: "-          node scripts/run-core-tests.mjs --backend native,wasi\n+          node scripts/run-core-tests.mjs --tag wasm-compact-portable --backend native,wasi",
      },
    ]);
  }

  assert.equal(blocks[4].kind, "details");
  if (blocks[4].kind === "details") {
    assert.equal(blocks[4].summary, "Prompt to fix issue");
    assert.deepEqual(blocks[4].blocks, [{ kind: "code", lang: "", text: "Update the WASI test workflow step." }]);
  }
});

test("parseInline handles code, bold, safe links, and rejects unsafe link schemes", () => {
  const nodes = parseInline(
    "Check **bold**, `code`, [docs](https://docs.coderabbit.ai/cli) and [xss](javascript:alert(1)).",
  );
  assert.deepEqual(nodes, [
    { kind: "text", text: "Check " },
    { kind: "bold", text: "bold" },
    { kind: "text", text: ", " },
    { kind: "code", text: "code" },
    { kind: "text", text: ", " },
    { kind: "link", label: "docs", href: "https://docs.coderabbit.ai/cli" },
    { kind: "text", text: " and " },
    { kind: "text", text: "[xss](javascript:alert(1))" },
    { kind: "text", text: "." },
  ]);
});

test("formatThreadLines formats single line, range, originalLine fallback, and null", () => {
  assert.equal(formatThreadLines({ line: 36, startLine: 36, originalLine: 36 }), ":36");
  assert.equal(formatThreadLines({ line: 14, startLine: 10, originalLine: 14 }), ":10-14");
  assert.equal(formatThreadLines({ line: null, startLine: null, originalLine: 88 }), ":88");
  assert.equal(formatThreadLines({ line: null, startLine: null, originalLine: null }), "");
});
