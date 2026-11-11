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

export function toast(text: string) {
  const t = { id: ++seq, text };
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

  const fresh = key ? peek<T>(key, opts.persist) : undefined;
  if (fresh !== undefined) lastShown.current = fresh;
  const data = fresh ?? (opts.keepPrevious ? lastShown.current : undefined);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, stale: fresh === undefined && data !== undefined, error, loading, refresh };
}

// ---- summaries seen in lists, used as instant headers for detail views ----

const summaries = new Map<string, PRSummary>();
export function rememberSummaries(repo: string | null, prs: PRSummary[]) {
  for (const p of prs) summaries.set(`${p.repo ?? repo}#${p.number}`, p);
}
export function summaryOf(repo: string, num: number) {
  return summaries.get(`${repo}#${num}`);
}
