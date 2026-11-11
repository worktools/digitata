import { useEffect, useState } from "react";
import { PRDetail } from "./PRDetail.tsx";
import { PRList } from "./PRList.tsx";

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
  const repo = route.repo ?? repos[0];

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  // A repo opened by URL joins the sidebar list.
  useEffect(() => {
    if (route.repo && !repos.includes(route.repo)) setRepos((rs) => [...rs, route.repo!]);
  }, [route.repo]);

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
    go(r);
  };

  return (
    <div className="app">
      <aside>
        <div className="brand">Digitata</div>
        <div className="repos">
          {repos.map((r) => (
            <div key={r} className={`repo ${r === repo ? "on" : ""}`}>
              <button onClick={() => go(r)}>{r}</button>
              {repos.length > 1 && (
                <button className="x" title="移除" onClick={() => setRepos(repos.filter((x) => x !== r))}>
                  ×
                </button>
              )}
            </div>
          ))}
          <form onSubmit={addRepo}>
            <input placeholder="添加 owner/repo" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </form>
        </div>
        <PRList repo={repo} selected={route.num} onSelect={(n) => go(repo, n)} reloadKey={reloadKey} />
      </aside>
      <main>
        {route.num ? (
          <PRDetail key={`${repo}#${route.num}`} repo={repo} num={route.num} onChanged={() => setReloadKey((k) => k + 1)} />
        ) : (
          <div className="empty big">从左侧选择一个 PR</div>
        )}
      </main>
    </div>
  );
}
