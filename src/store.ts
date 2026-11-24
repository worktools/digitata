// Stale-while-revalidate cache plus a global in-flight tracker.
//
// Views render whatever is cached for a key right away and keep it on screen
// while a refresh runs; progress is shown only by the corner indicator.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PRSummary } from "../shared/types.ts";

interface Entry {
  data: unknown;
  at: number;
}

const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const cacheListeners = new Set<(key: string) => void>();
const emitCache = (key: string) => cacheListeners.forEach((l) => l(key));
const PERSIST_PREFIX = "digitata.cache:";
const PERSIST_MAX = 400_000; // characters; big diffs stay in memory only

function readPersisted(key: string): Entry | undefined {
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + key);
    return raw ? (JSON.parse(raw) as Entry) : undefined;
  } catch {
    return undefined;
  }
}

function writePersisted(key: string, e: Entry) {
  try {
    const raw = JSON.stringify(e);
    if (raw.length < PERSIST_MAX) localStorage.setItem(PERSIST_PREFIX + key, raw);
  } catch {
    // quota or privacy mode: the in-memory cache still works
  }
}

export function peek<T>(key: string, persist = false): T | undefined {
  let e = mem.get(key);
  if (!e && persist) {
    e = readPersisted(key);
    if (e) mem.set(key, e);
  }
  return e?.data as T | undefined;
}

// ---- in-flight tracker -------------------------------------------------

export interface Activity {
  id: number;
  label: string;
}
export interface Toast {
  id: number;
  text: string;
  kind: "error" | "ok";
}

let activities: Activity[] = [];
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function track<T>(label: string, p: Promise<T>): Promise<T> {
  const a = { id: ++seq, label };
  activities = [...activities, a];
  emit();
  const done = () => {
    activities = activities.filter((x) => x !== a);
    emit();
  };
  p.then(done, done);
  return p;
}

export function toast(text: string, kind: Toast["kind"] = "error") {
  const t = { id: ++seq, text, kind };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x !== t);
    emit();
  }, 6000);
}

export function useActivity() {
  const a = useSyncExternalStore(subscribe, () => activities);
  const t = useSyncExternalStore(subscribe, () => toasts);
  return { activities: a, toasts: t };
}

// ---- fetching ----------------------------------------------------------

export interface FetchOpts {
  label: string;
  /** Also keep the value in localStorage, so it survives a page reload. */
  persist?: boolean;
  /** Data never changes for this key (e.g. diff between two SHAs): skip refetch when cached. */
  immutable?: boolean;
  /** While a new key loads, keep returning the previous key's data (lists only). */
  keepPrevious?: boolean;
}

/** Fetch (deduplicated per key) and store in the cache. */
export function load<T>(key: string, fetcher: () => Promise<T>, opts: FetchOpts): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = track(opts.label, fetcher()).then((data) => {
    const e = { data, at: Date.now() };
    mem.set(key, e);
    if (opts.persist) writePersisted(key, e);
    return data;
  });
  inflight.set(key, p);
  const clear = () => inflight.delete(key);
  p.then(clear, clear);
  return p;
}

/** Warm the cache (e.g. on hover) unless the key was fetched recently. */
export function prefetch<T>(key: string, fetcher: () => Promise<T>, opts: FetchOpts, maxAgeMs = 60_000) {
  if (opts.persist && peek(key, true) !== undefined && opts.immutable) return;
  const e = mem.get(key);
  if (e && (opts.immutable || Date.now() - e.at < maxAgeMs)) return;
  load(key, fetcher, opts).catch(() => {});
}

export interface Cached<T> {
  data: T | undefined;
  /** data belongs to a previous key (keepPrevious) */
  stale: boolean;
  error: string;
  loading: boolean;
  refresh: () => void;
}

export function useCached<T>(key: string | null, fetcher: () => Promise<T>, opts: FetchOpts): Cached<T> {
  const [, force] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  // Remember the last value shown, so switching keys keeps content until new data arrives.
  const lastShown = useRef<T | undefined>(undefined);

  useEffect(() => {
    if (!key) return;
    let live = true;
    setError("");
    if (opts.immutable && tick === 0 && peek(key, opts.persist) !== undefined) return;
    setLoading(true);
    load(key, () => fetchRef.current(), opts)
      .then(() => live && force((x) => x + 1))
      .catch((e: Error) => {
        if (!live) return;
        setError(e.message);
        if (peek(key, opts.persist) !== undefined) toast(`${opts.label}失败：${e.message}`);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [key, tick]);

  useEffect(() => {
    if (!key) return;
    const on = (k: string) => {
      if (k === key) force((x) => x + 1);
    };
    cacheListeners.add(on);
    return () => {
      cacheListeners.delete(on);
    };
  }, [key]);

  const fresh = key ? peek<T>(key, opts.persist) : undefined;
  if (fresh !== undefined) lastShown.current = fresh;
  const data = fresh ?? (opts.keepPrevious ? lastShown.current : undefined);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, stale: fresh === undefined && data !== undefined, error, loading, refresh };
}

/** Update a cached entry in place and notify any active `useCached` subscriber. */
export function updateCache<T>(key: string, fn: (prev: T) => T, persist = false) {
  const prev = peek<T>(key, persist);
  if (prev === undefined) return;
  const e = { data: fn(prev), at: Date.now() };
  mem.set(key, e);
  if (persist) writePersisted(key, e);
  emitCache(key);
}

// ---- summaries seen in lists, used as instant headers for detail views ----

const summaries = new Map<string, PRSummary>();
export function rememberSummaries(repo: string | null, prs: PRSummary[]) {
  for (const p of prs) summaries.set(`${p.repo ?? repo}#${p.number}`, p);
}
export function summaryOf(repo: string, num: number) {
  return summaries.get(`${repo}#${num}`);
}

export function syncUnresolvedCount(repo: string, num: number, unresolvedCount: number) {
  const summary = summaries.get(`${repo}#${num}`);
  if (summary) summary.unresolvedThreads = unresolvedCount;
  for (const [k, entry] of mem) {
    if ((!k.startsWith("inbox3:") && !k.startsWith(`list:${repo}:`)) || !Array.isArray(entry.data)) continue;
    let changed = false;
    const next = (entry.data as PRSummary[]).map((p) => {
      if ((p.repo ?? repo) !== repo || p.number !== num) return p;
      changed = true;
      return { ...p, unresolvedThreads: unresolvedCount };
    });
    if (!changed) continue;
    const updated = { data: next, at: Date.now() };
    mem.set(k, updated);
    writePersisted(k, updated);
    emitCache(k);
  }
}

// ---- merge jobs: run in the background, independent of which PR is open ----

export interface MergeJob {
  state: "running" | "done" | "failed";
  text: string;
  /** When the merge succeeded (ms), for the list's leave animation. */
  doneAt?: number;
}

let merges: Record<string, MergeJob> = {};
const mergeDoneListeners = new Set<(key: string) => void>();

export const mergeKey = (repo: string, num: number) => `${repo}#${num}`;

/** Start a merge; returns immediately. Duplicate starts for a running PR are ignored. */
export function startMerge(repo: string, num: number, run: () => Promise<string>) {
  const key = mergeKey(repo, num);
  if (merges[key]?.state === "running") return;
  const set = (j: MergeJob) => {
    merges = { ...merges, [key]: j };
    emit();
  };
  set({ state: "running", text: "合并中…" });
  track(`合并 ${repo.split("/")[1]}#${num}`, run())
    .then((msg) => {
      set({ state: "done", text: msg || "已合并", doneAt: Date.now() });
      toast(`✓ 已合并 ${key}`, "ok");
      // Detail and lists are stale now; drop the detail cache and tell listeners to refresh.
      mem.delete(`pr2:${key}`);
      mergeDoneListeners.forEach((l) => l(key));
    })
    .catch((e: Error) => {
      set({ state: "failed", text: e.message });
      toast(`合并 ${key} 失败：${e.message}`);
    });
}

export function useMerges() {
  return useSyncExternalStore(subscribe, () => merges);
}

export function onMergeDone(l: (key: string) => void) {
  mergeDoneListeners.add(l);
  return () => {
    mergeDoneListeners.delete(l);
  };
}

/** True while a request with this exact label is in flight (e.g. a program diff). */
export function useBusy(label: string) {
  const { activities } = useActivity();
  return activities.some((a) => a.label === label);
}

// ---- resume: the tab comes back after being away for a while ----

/** Away longer than this (ms) → refresh lists and the open PR when the page is visible again. */
export const RESUME_AFTER_MS = 2 * 60_000;
const resumeListeners = new Set<() => void>();
let hiddenAt = document.visibilityState === "hidden" ? Date.now() : 0;

function checkResume() {
  if (document.visibilityState === "hidden") {
    hiddenAt ||= Date.now();
    return;
  }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (away >= RESUME_AFTER_MS) resumeListeners.forEach((l) => l());
}
document.addEventListener("visibilitychange", checkResume);
// Window switches without a visibility change (another app in front) count too.
window.addEventListener("blur", () => (hiddenAt ||= Date.now()));
window.addEventListener("focus", checkResume);

export function onResume(l: () => void) {
  resumeListeners.add(l);
  return () => {
    resumeListeners.delete(l);
  };
}
