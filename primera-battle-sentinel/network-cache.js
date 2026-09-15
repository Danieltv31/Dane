(() => {
  'use strict';

  // Shared persistent page cache for Battle Sentinel.
  // Passive battles: live refresh at most every 30s.
  // Final minute: live refresh at most every 1s.
  // The cache survives page navigation/reloads and is shared by all Primera tabs.

  const NATIVE_FETCH = globalThis.fetch.bind(globalThis);
  const DB_NAME = 'PrimeraBattleSentinelNetDB';
  const DB_VERSION = 1;
  const STORE = 'pages';
  const PASSIVE_MS = 30000;
  const HOT_MS = 1000;
  const HARD_MAX_AGE = 10 * 60 * 1000;
  const MAX_CONCURRENT = 3;
  const inflight = new Map();
  const queue = [];
  let active = 0;
  let dbPromise = null;
  const bc = 'BroadcastChannel' in globalThis ? new BroadcastChannel('pbs-net-cache-v1') : null;
  const memory = new Map();

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'url' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbPromise;
  }

  async function dbGet(url) {
    if (memory.has(url)) return memory.get(url);
    try {
      const db = await openDB();
      const row = await new Promise((resolve, reject) => {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(url);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
      if (row) memory.set(url, row);
      return row;
    } catch { return null; }
  }

  async function dbPut(row) {
    memory.set(row.url, row);
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const r = db.transaction(STORE, 'readwrite').objectStore(STORE).put(row);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    } catch {}
    bc?.postMessage({ type: 'page', row });
  }

  bc?.addEventListener('message', e => {
    const m = e.data || {};
    if (m.type === 'page' && m.row?.url) memory.set(m.row.url, m.row);
  });

  function isCacheable(url, init) {
    let u;
    try { u = new URL(url, location.href); } catch { return false; }
    const method = String(init?.method || 'GET').toUpperCase();
    if (method !== 'GET') return false;
    if (u.origin !== location.origin) return false;
    return /\/(battle|battles)\.html$/i.test(u.pathname);
  }

  // Conservative timer detection only for deciding cache intensity.
  // Avoids generic sidebar clocks such as energy/restoring-limit timers.
  function extractBattleSeconds(html) {
    try {
      const d = new DOMParser().parseFromString(html, 'text/html');
      const candidates = [];
      const selectors = [
        '[id*="battle" i][id*="time" i]', '[class*="battle" i][class*="time" i]',
        '[id*="round" i][id*="time" i]', '[class*="round" i][class*="time" i]',
        '[id*="countdown" i]', '[class*="countdown" i]'
      ];
      for (const el of d.querySelectorAll(selectors.join(','))) {
        const t = String(el.textContent || '').replace(/\s+/g, ' ');
        const m = t.match(/\b(\d{1,2}):([0-5]\d):([0-5]\d)\b/);
        if (m) candidates.push(+m[1] * 3600 + +m[2] * 60 + +m[3]);
        const m2 = t.match(/\b(\d{1,2}):([0-5]\d)\b/);
        if (m2) candidates.push(+m2[1] * 60 + +m2[2]);
      }
      const good = candidates.filter(x => Number.isFinite(x) && x >= 0 && x <= 2 * 3600 + 300);
      return good.length ? Math.min(...good) : NaN;
    } catch { return NaN; }
  }

  function ttl(row) {
    return Number.isFinite(row?.battleSeconds) && row.battleSeconds <= 60 ? HOT_MS : PASSIVE_MS;
  }

  function responseFrom(row) {
    return new Response(row.body, {
      status: row.status || 200,
      statusText: row.statusText || 'OK',
      headers: row.headers || { 'content-type': 'text/html; charset=UTF-8' }
    });
  }

  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      const job = queue.shift();
      active++;
      job().finally(() => { active--; pump(); });
    }
  }

  function queuedLiveFetch(url, init) {
    if (inflight.has(url)) return inflight.get(url).then(responseFrom);

    const promise = new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          const res = await NATIVE_FETCH(url, { ...init, cache: 'no-store' });
          const body = await res.clone().text();
          const row = {
            url,
            body,
            status: res.status,
            statusText: res.statusText,
            headers: { 'content-type': res.headers.get('content-type') || 'text/html; charset=UTF-8' },
            fetchedAt: Date.now(),
            battleSeconds: /\/battle\.html/i.test(url) ? extractBattleSeconds(body) : NaN
          };
          await dbPut(row);
          resolve(row);
        } catch (e) { reject(e); }
      });
      pump();
    });

    inflight.set(url, promise);
    promise.finally(() => inflight.delete(url));
    return promise.then(responseFrom);
  }

  async function cachedFetch(input, init = {}) {
    const url = typeof input === 'string' ? new URL(input, location.href).href : input?.url;
    if (!url || !isCacheable(url, init)) return NATIVE_FETCH(input, init);

    const row = await dbGet(url);
    const age = row ? Date.now() - (row.fetchedAt || 0) : Infinity;
    if (row && age <= Math.min(ttl(row), HARD_MAX_AGE)) return responseFrom(row);

    return queuedLiveFetch(url, init);
  }

  // Expose tiny diagnostics for the Battle Sentinel UI / console.
  globalThis.__PBS_NET_CACHE__ = {
    passiveMs: PASSIVE_MS,
    hotMs: HOT_MS,
    maxConcurrent: MAX_CONCURRENT,
    clearMemory: () => memory.clear()
  };

  globalThis.fetch = cachedFetch;
  try { window.fetch = cachedFetch; } catch {}
})();
