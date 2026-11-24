import type { ReviewThread } from "../shared/types.ts";

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; label: string; href: string };

export type CommentBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; text: string }
  | { kind: "details"; summary: string; blocks: CommentBlock[] };

/** Normalize GitHub/bot HTML wrappers before splitting markdown blocks. */
function preprocessCommentHtml(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<picture>[\s\S]*?<\/picture>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<code>([^<]*)<\/code>/gi, "`$1`")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<\/?(?:dl|dd|dt|div|span|sup|sub|p|h[1-6])\b[^>]*>/gi, "");
}

function parsePlainChunk(chunk: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const lines = chunk.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = /^\s*(`{3,})([^\n]*)$/.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2].trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const text = quote.join("\n").trim();
      if (text) blocks.push({ kind: "quote", text });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*`{3,}/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const text = para.join("\n").trim();
    if (text) blocks.push({ kind: "paragraph", text });
  }

  return blocks;
}

function parseNormalized(text: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = detailsRe.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before.trim()) blocks.push(...parsePlainChunk(before));

    const inner = m[1];
    let summary = "详情";
    const sm = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
    const body = sm ? inner.replace(sm[0], "") : inner;
    if (sm) {
      const cleaned = sm[1].replace(/<[^>]+>/g, "").trim();
      if (cleaned) summary = cleaned;
    }
    blocks.push({ kind: "details", summary, blocks: parseNormalized(body) });
    last = m.index + m[0].length;
  }

  const tail = text.slice(last);
  if (tail.trim()) blocks.push(...parsePlainChunk(tail));
  return blocks;
}

/** Parse a GitHub review comment into safe, structured blocks (no raw HTML injection). */
export function parseCommentBlocks(raw: string): CommentBlock[] {
  if (!raw) return [];
  return parseNormalized(preprocessCommentHtml(raw));
}

const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]]+\]\((?:[^()\s]+|\([^()\s]*\))+\))/g;

/** Parse inline code, bold text, and safe http(s) links from a line or paragraph. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;

  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push({ kind: "text", text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`") && tok.endsWith("`")) {
      nodes.push({ kind: "code", text: tok.slice(1, -1) });
    } else if (tok.startsWith("**") && tok.endsWith("**")) {
      nodes.push({ kind: "bold", text: tok.slice(2, -2) });
    } else {
      const lm = /^\[([^\]]+)\]\((.+)\)$/.exec(tok);
      if (lm && /^https?:\/\//i.test(lm[2])) {
        nodes.push({ kind: "link", label: lm[1], href: lm[2] });
      } else {
        nodes.push({ kind: "text", text: tok });
      }
    }
    last = m.index + tok.length;
  }

  if (last < text.length) nodes.push({ kind: "text", text: text.slice(last) });
  return nodes;
}

/** Format the thread line or line range suffix (e.g. `:36` or `:10-14`). */
export function formatThreadLines(t: Pick<ReviewThread, "line" | "startLine" | "originalLine">): string {
  const end = t.line ?? t.originalLine;
  if (end == null) return "";
  if (t.startLine != null && t.line != null && t.startLine !== t.line) return `:${t.startLine}-${t.line}`;
  return `:${end}`;
}
