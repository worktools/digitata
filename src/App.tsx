import { useEffect, useState } from "react";
import { PRDetail } from "./PRDetail.tsx";
import { InboxList, PRList } from "./PRList.tsx";

const DEFAULT_REPOS = ["calcit-lang/calcit"];

// Routes: #/<owner>/<repo>[/<num>]
function parseHash(): { repo?: string; num?: number } {
  const m = /^#\/([\w.-]+\/[\w.-]+)(?:\/(\d+))?/.exec(location.hash);
  return m ? { repo: m[1], num: m[2] ? Number(m[2]) : undefined } : {};
}

function loadRepos(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem("digitata.repos") ?? "null");
    if (Array.isArray(r) && r.length) return r;
  } catch {}
  return DEFAULT_REPOS;
}

export function App() {
  const [route, setRoute] = useState(parseHash);
  const [repos, setRepos] = useState(loadRepos);
  const [draft, setDraft] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // Sidebar source: the cross-repo inbox (default) or one repo's PR list.
  const [source, setSource] = useState<string>(() => localStorage.getItem("digitata.source") ?? "inbox");
  const repo = route.repo ?? (source === "inbox" ? repos[0] : source);
  const listRepo = source === "inbox" ? null : source;

  useEffect(() => {
    localStorage.setItem("digitata.source", source);
  }, [source]);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  // Pinned repos persist across reloads.
  useEffect(() => {
    localStorage.setItem("digitata.repos", JSON.stringify(repos));
  }, [repos]);

  const go = (r: string, n?: number) => {
    location.hash = `#/${r}${n ? `/${n}` : ""}`;
  };

  const addRepo = (e: React.FormEvent) => {
    e.preventDefault();
    const r = draft.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(r)) return;
    if (!repos.includes(r)) setRepos([...repos, r]);
    setDraft("");
    setSource(r);
  };

  return (
    <div className="app">
      <aside>
        <div className="brand">Digitata</div>
        <div className="repos">
          <div className={`repo ${source === "inbox" ? "on" : ""}`}>
            <button onClick={() => setSource("inbox")}>📥 收件箱（所有仓库）</button>
          </div>
          {repos.map((r) => (
            <div key={r} className={`repo ${r === source ? "on" : ""}`}>
              <button onClick={() => setSource(r)}>{r}</button>
              {repos.length > 0 && (
                <button
                  className="x"
                  title="移除"
                  onClick={() => {
                    setRepos(repos.filter((x) => x !== r));
                    if (source === r) setSource("inbox");
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <form onSubmit={addRepo}>
            <input placeholder="添加 owner/repo" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </form>
        </div>
        {listRepo ? (
          <PRList repo={listRepo} selected={route.repo === listRepo ? route.num : undefined} onSelect={(n) => go(listRepo, n)} reloadKey={reloadKey} />
        ) : (
          <InboxList selected={route.repo && route.num ? `${route.repo}#${route.num}` : undefined} onSelect={(r, n) => go(r, n)} reloadKey={reloadKey} />
        )}
      </aside>
      <main>
        {route.num && route.repo ? (
          <PRDetail key={`${repo}#${route.num}`} repo={repo} num={route.num} onChanged={() => setReloadKey((k) => k + 1)} />
        ) : (
          <div className="empty big">从左侧选择一个 PR</div>
        )}
      </main>
    </div>
  );
}
