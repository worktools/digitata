// Thin local HTTP API: the browser UI calls these routes, they call the CodeHost.
// Listens on 127.0.0.1 only, since it can merge PRs with the user's gh login.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { InboxFilter, MergeRequest } from "../shared/types.ts";
import { programDiff } from "./calcit.ts";
import { GhCliHost } from "./gh.ts";
import type { CodeHost } from "./host.ts";

const host: CodeHost = new GhCliHost();
const PORT = Number(process.env.DIGITATA_PORT ?? 7741);
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : (body as string));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function serveStatic(pathname: string, res: ServerResponse) {
  let file = normalize(join(DIST, pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) return send(res, 404, "Run `yarn build` first, or use `yarn dev`.", "text/plain");
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

// /api/repos/:owner/:repo/pulls[/:num[/diff|/merge|/program-diff]]
const ROUTE = /^\/api\/repos\/([\w.-]+)\/([\w.-]+)\/pulls(?:\/(\d+)(?:\/(diff|merge|program-diff))?)?$/;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Reject cross-site requests: only same-origin pages may drive the API.
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: "forbidden origin" });
  if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname, res);
  try {
    if (url.pathname === "/api/viewer") return send(res, 200, { login: await host.viewer() });
    if (url.pathname === "/api/inbox" && req.method === "GET") {
      const filter = (url.searchParams.get("filter") ?? "all") as InboxFilter;
      if (!["all", "author", "review", "assignee", "mentioned"].includes(filter)) return send(res, 400, { error: "bad filter" });
      return send(res, 200, await host.inbox(filter, url.searchParams.get("q") ?? ""));
    }
    const m = ROUTE.exec(url.pathname);
    if (!m) return send(res, 404, { error: "not found" });
    const repo = `${m[1]}/${m[2]}`;
    const num = m[3] ? Number(m[3]) : undefined;
    const action = m[4];
    if (num === undefined && req.method === "GET") {
      const state = (url.searchParams.get("state") ?? "open") as "open";
      const search = url.searchParams.get("q") ?? undefined;
      return send(res, 200, await host.listPRs(repo, { state, search }));
    }
    if (num !== undefined && !action && req.method === "GET") return send(res, 200, await host.getPR(repo, num));
    if (num !== undefined && action === "diff" && req.method === "GET") return send(res, 200, await host.getDiff(repo, num), "text/plain; charset=utf-8");
    if (num !== undefined && action === "program-diff" && req.method === "GET") {
      const p = url.searchParams.get("path") ?? "";
      const base = url.searchParams.get("base") ?? "";
      const head = url.searchParams.get("head") ?? "";
      return send(res, 200, await programDiff(repo, num, p, base, head));
    }
    if (num !== undefined && action === "merge" && req.method === "POST") {
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "json required" });
      const body = (await readBody(req)) as MergeRequest;
      return send(res, 200, { message: await host.merge(repo, num, body) });
    }
    return send(res, 405, { error: "method not allowed" });
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`digitata api on http://127.0.0.1:${PORT}`);
});
