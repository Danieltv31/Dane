// ==UserScript==
// @name         Primera Battle Sentinel
// @namespace    chatgpt.openai
// @version      3.1.0
// @description  Watches active Primera battles, alerts at T-5:00, and provides REFILL / TRAVEL / HIT controls.
// @updateURL    https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/primera_battle_sentinel.user.js
// @downloadURL  https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/primera_battle_sentinel.user.js
// @match        https://primera.e-sim.org/*
// @match        https://www.primera.e-sim.org/*
// @grant        GM_notification
// @grant        GM_openInTab
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const ORIGIN = location.origin;
  const ALERT_AT = 5 * 60;
  const DISCOVER_EVERY = 4 * 60 * 1000;
  const FRAME_RELOAD_EVERY = 12 * 60 * 1000;
  const MAX_PAGES = 12;
  const STORAGE = 'primeraBattleSentinelV3';

  const state = {
    battles: new Map(),
    frames: new Map(),
    alerts: loadAlerts(),
    discoverBusy: false,
    status: 'Starting…'
  };

  function loadAlerts() {
    try { return JSON.parse(localStorage.getItem(STORAGE) || '{}'); }
    catch { return {}; }
  }

  function saveAlerts() {
    const now = Date.now();
    for (const [k, v] of Object.entries(state.alerts)) {
      if (now - Number(v) > 8 * 60 * 60 * 1000) delete state.alerts[k];
    }
    localStorage.setItem(STORAGE, JSON.stringify(state.alerts));
  }

  function battleId(url) {
    try { return new URL(url, ORIGIN).searchParams.get('id'); }
    catch { return null; }
  }

  function cleanName(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '')
      .trim()
      .slice(0, 120);
  }

  function fmt(sec) {
    if (!Number.isFinite(sec)) return '--:--';
    sec = Math.max(0, Math.floor(sec));
    if (sec >= 3600) {
      return `${Math.floor(sec/3600)}:${String(Math.floor((sec%3600)/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
    }
    return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
  }

  function esc(s='') {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  function isVisible(el) {
    if (!el) return false;
    const win = el.ownerDocument?.defaultView;
    if (!win) return false;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  async function fetchDoc(url) {
    const r = await fetch(url, {credentials:'include', cache:'no-store'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new DOMParser().parseFromString(await r.text(), 'text/html');
  }

  async function discoverAllBattles() {
    if (state.discoverBusy) return;
    state.discoverBusy = true;
    state.status = 'Discovering active battles…';
    render();

    try {
      const queue = [`${ORIGIN}/battles.html`];
      const visited = new Set();
      const found = new Map();

      while (queue.length && visited.size < MAX_PAGES) {
        const url = queue.shift();
        if (visited.has(url)) continue;
        visited.add(url);
        const doc = await fetchDoc(url);

        for (const a of [...doc.querySelectorAll('a[href*="battle.html?id="]')]) {
          const abs = new URL(a.getAttribute('href'), ORIGIN).href;
          const id = battleId(abs);
          if (!id) continue;

          let name = cleanName(a.textContent);
          let node = a;
          for (let depth=0; depth<5 && node; depth++, node=node.parentElement) {
            const txt = cleanName(node.textContent);
            if (txt.length >= name.length && txt.length < 160) name = txt;
          }
          if (!name) name = `Battle #${id}`;
          found.set(id, {id, url:abs, name});
        }

        for (const a of [...doc.querySelectorAll('a[href*="battles.html"]')]) {
          try {
            const abs = new URL(a.getAttribute('href'), ORIGIN).href;
            if (new URL(abs).origin === ORIGIN && !visited.has(abs) && !queue.includes(abs)) queue.push(abs);
          } catch {}
        }
      }

      for (const [id, b] of found) {
        const old = state.battles.get(id) || {};
        state.battles.set(id, {
          ...old,
          ...b,
          seconds:Number.isFinite(old.seconds) ? old.seconds : NaN,
          roundKey:old.roundKey || '',
          loadedAt:old.loadedAt || 0
        });
        ensureFrame(id);
      }

      for (const [id] of [...state.battles]) {
        if (!found.has(id)) removeBattle(id);
      }

      state.status = `Watching ${state.battles.size} active battles`;
    } catch (e) {
      console.error('[Battle Sentinel] discovery failed', e);
      state.status = `Discovery error: ${e.message}`;
    } finally {
      state.discoverBusy = false;
      render();
    }
  }

  function ensureFrame(id) {
    if (state.frames.has(id)) return;
    const b = state.battles.get(id);
    if (!b) return;

    const f = document.createElement('iframe');
    f.dataset.battleId = id;
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-100000px;top:-100000px;width:1024px;height:768px;opacity:0;pointer-events:none;border:0';
    f.addEventListener('load', () => {
      const cur = state.battles.get(id);
      if (!cur) return;
      cur.loadedAt = Date.now();
      readBattleFrame(id, true);
    });

    document.body.appendChild(f);
    state.frames.set(id, f);
    setTimeout(() => { if (state.frames.get(id) === f) f.src = b.url; }, state.frames.size * 250);
  }

  function removeBattle(id) {
    const f = state.frames.get(id);
    if (f) f.remove();
    state.frames.delete(id);
    state.battles.delete(id);
  }

  function reloadFrame(id) {
    const f = state.frames.get(id);
    const b = state.battles.get(id);
    if (!f || !b) return;
    const u = new URL(b.url);
    u.searchParams.set('_sentinel', Date.now());
    f.src = u.href;
  }

  function parseCountdownText(text) {
    const s = String(text || '').replace(/\s+/g, ' ');
    const hms = [...s.matchAll(/\b(\d{1,2}):([0-5]\d):([0-5]\d)\b/g)]
      .map(m => (+m[1]*3600)+(+m[2]*60)+(+m[3]))
      .filter(x => x >= 0 && x <= 2*3600 + 5*60);
    if (hms.length) return Math.min(...hms);

    const ms = [...s.matchAll(/\b(\d{1,2}):([0-5]\d)\b/g)]
      .map(m => (+m[1]*60)+(+m[2]))
      .filter(x => x >= 0 && x <= 60*60);
    if (ms.length) return Math.min(...ms);

    const m = s.match(/\b(\d+)\s*(?:min|mins|minute|minutes)\b(?:\s*(\d+)\s*(?:sec|secs|second|seconds)\b)?/i);
    if (m) return (+m[1]*60) + +(m[2] || 0);
    return NaN;
  }

  function extractTimer(doc) {
    const selectors = [
      '[id*="countdown" i]','[class*="countdown" i]',
      '[id*="battleTimer" i]','[class*="battleTimer" i]',
      '[id*="timer" i]','[class*="timer" i]',
      '[id*="timeLeft" i]','[class*="timeLeft" i]',
      '[data-time]','[data-end]','[data-countdown]'
    ];

    const strong = [];
    for (const sel of selectors) {
      for (const el of [...doc.querySelectorAll(sel)]) {
        const sec = parseCountdownText(el.textContent || el.getAttribute('data-time') || el.getAttribute('data-countdown') || '');
        if (Number.isFinite(sec)) strong.push(sec);
      }
    }
    if (strong.length) return Math.min(...strong);

    for (const el of [...doc.querySelectorAll('div,span,p,td,b,strong')]) {
      const t = String(el.textContent || '').replace(/\s+/g,' ').trim();
      if (t.length > 100 || !/(time|round|left|remaining|ends?)/i.test(t)) continue;
      const sec = parseCountdownText(t);
      if (Number.isFinite(sec)) return sec;
    }

    return parseCountdownText(doc.body?.innerText || '');
  }

  function extractRoundKey(doc, id) {
    const text = String(doc.body?.innerText || '').replace(/\s+/g,' ');
    const r = text.match(/\bRound\s*#?\s*(\d{1,2})\b/i);
    if (r) return `${id}:r${r[1]}`;
    const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
    return `${id}:b${bucket}`;
  }

  function readBattleFrame(id, force=false) {
    const f = state.frames.get(id);
    const b = state.battles.get(id);
    if (!f || !b) return;

    try {
      const doc = f.contentDocument;
      if (!doc || !doc.body) return;
      const sec = extractTimer(doc);
      if (!Number.isFinite(sec)) {
        if (force) b.error = 'Timer not found';
        return;
      }

      b.seconds = sec;
      b.error = '';
      b.roundKey = extractRoundKey(doc, id);

      if (sec > 0 && sec <= ALERT_AT) {
        const key = b.roundKey || id;
        if (!state.alerts[key]) {
          state.alerts[key] = Date.now();
          saveAlerts();
          fireAlert(b);
        }
      }
    } catch {
      b.error = 'Frame read error';
    }
  }

  function fireAlert(b) {
    beep();
    const title = `⚔ ${b.name}`;
    const text = `${fmt(b.seconds)} left — REFILL / TRAVEL / HIT ready`;
    if (typeof GM_notification === 'function') {
      try {
        GM_notification({title, text, timeout:15000, onclick:() => { window.focus(); flashBattleCard(b.id); }});
      } catch {}
    } else if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, {body:text, tag:`battle-${b.id}`});
      n.onclick = () => { window.focus(); flashBattleCard(b.id); n.close(); };
    }
    render();
    flashBattleCard(b.id);
  }

  function beep() {
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      const c = new A(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.frequency.value = 780;
      g.gain.setValueAtTime(0.001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
      o.start(); o.stop(c.currentTime + 0.27);
    } catch {}
  }

  function frameDoc(id) {
    try { return state.frames.get(id)?.contentDocument || null; }
    catch { return null; }
  }

  function clickables(doc) {
    return [...doc.querySelectorAll('button,input[type="button"],input[type="submit"],a.button,a.btn,a[href],[role="button"]')].filter(isVisible);
  }

  function label(el) {
    return String(el.textContent || el.value || el.title || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
  }

  function findClicks(doc, regexes) {
    return clickables(doc).filter(el => regexes.some(r => r.test(label(el))));
  }

  function openBattle(id) {
    const b = state.battles.get(id);
    if (!b) return;
    if (typeof GM_openInTab === 'function') {
      try { GM_openInTab(b.url, {active:true, insert:true}); return; } catch {}
    }
    window.open(b.url, '_blank', 'noopener');
  }

  function actionRefill(id) {
    const doc = frameDoc(id);
    if (!doc) return fallback(id, 'Battle frame not ready');

    const food = findClicks(doc, [
      /\b(use|eat|consume)\b.*\b(meal|food|snack)\b/i,
      /\b(meal|food|snack)\b.*\b(use|eat|consume)\b/i
    ]);
    const drink = findClicks(doc, [
      /\b(use|drink|consume)\b.*\bdrink\b/i,
      /\bdrink\b.*\b(use|consume)\b/i
    ]);
    const generic = findClicks(doc, [/\brefill\b/i,/\brecover energy\b/i]);
    const target = food[0] || drink[0] || generic[0];

    if (!target) {
      openBattle(id);
      toast('No refill control detected. Battle opened.');
      return;
    }

    target.click();
    toast(`Clicked: ${label(target)}`);
  }

  function actionTravel(id) {
    const doc = frameDoc(id);
    if (!doc) return fallback(id, 'Battle frame not ready');
    const targets = findClicks(doc, [/\btravel\s*(?:&|and)\s*fight\b/i,/\bquick\s*travel\b/i,/^travel$/i]);
    if (targets.length === 1) {
      targets[0].click();
      toast(`Clicked: ${label(targets[0])}`);
      setTimeout(() => reloadFrame(id), 1500);
      return;
    }
    openBattle(id);
    toast(targets.length > 1 ? 'Multiple travel controls found. Opened battle.' : 'Travel control not found. Opened battle.');
  }

  function actionHit(id) {
    const doc = frameDoc(id);
    if (!doc) return fallback(id, 'Battle frame not ready');
    let targets = findClicks(doc, [/^fight$/i,/^hit$/i,/\bfight\s*x?1\b/i,/\b1\s*hit\b/i,/\bsingle\s*hit\b/i])
      .filter(el => !/berserk/i.test(label(el)));
    targets = targets.filter((el, i, arr) => !arr.some((other, j) => j !== i && other.contains(el)));

    if (targets.length === 1) {
      targets[0].click();
      toast(`1 HIT sent: ${label(targets[0])}`);
      return;
    }

    openBattle(id);
    toast(targets.length > 1 ? 'Two fight sides detected. Opened battle.' : 'Single-hit control not detected. Opened battle.');
  }

  function fallback(id, msg) {
    openBattle(id);
    toast(`${msg}. Opened battle.`);
  }

  function injectUI() {
    if (document.getElementById('pbs3')) return;

    const css = document.createElement('style');
    css.textContent = `
      #pbs3{
        position:fixed;left:12px;bottom:12px;z-index:2147483647;
        width:410px;max-width:calc(100vw - 20px);max-height:72vh;
        background:#11161c;color:#eef3f7;border:1px solid #65717e;
        border-radius:10px;box-shadow:0 12px 36px #000b;
        font:13px/1.25 Arial,sans-serif;overflow:hidden
      }
      #pbs3-head{display:flex;justify-content:space-between;align-items:center;padding:8px 9px;background:#232a32}
      #pbs3-body{max-height:60vh;overflow:auto;padding:7px}
      #pbs3 button{cursor:pointer;border:1px solid #5d6875;border-radius:6px;background:#2b333d;color:white;padding:5px 7px;font-weight:700}
      #pbs3 button:hover{filter:brightness(1.16)}
      #pbs3 .pbs-refill{background:#2a6541}
      #pbs3 .pbs-travel{background:#355d87}
      #pbs3 .pbs-hit{background:#8a3030}
      #pbs3 .pbs-battle{border:1px solid #333e49;border-radius:7px;padding:7px;margin-bottom:6px;background:#171d24}
      #pbs3 .pbs-battle.URGENT{border-color:#d45555;background:#28191b}
      #pbs3 .pbs-top{display:flex;justify-content:space-between;gap:8px;align-items:center}
      #pbs3 .pbs-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
      #pbs3 .pbs-time{font-size:17px;font-weight:800;color:#ffd36d;white-space:nowrap}
      #pbs3 .pbs-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-top:6px}
      #pbs3 .pbs-small{font-size:11px;color:#95a0ab}
      #pbs3 .pbs-error{color:#ff9b9b}
      #pbs3-toast{display:none;position:absolute;left:50%;bottom:10px;transform:translateX(-50%);padding:7px 10px;border:1px solid #7a8794;border-radius:7px;background:#05080bed;color:#fff;white-space:nowrap;max-width:95%;overflow:hidden;text-overflow:ellipsis}
      #pbs3-flash{animation:pbsflash .35s alternate 8}
      @keyframes pbsflash{from{box-shadow:0 0 0 #0000}to{box-shadow:0 0 24px #ff4242}}
    `;
    document.head.appendChild(css);

    const root = document.createElement('div');
    root.id = 'pbs3';
    root.innerHTML = `
      <div id="pbs3-head">
        <div><b>⚔ Battle Sentinel</b> <span class="pbs-small">v3.1</span></div>
        <div>
          <button id="pbs3-notify" title="Enable desktop notifications">🔔</button>
          <button id="pbs3-refresh" title="Rediscover battles">↻</button>
          <button id="pbs3-min">−</button>
        </div>
      </div>
      <div id="pbs3-body">
        <div id="pbs3-status" class="pbs-small">Starting…</div>
        <div id="pbs3-list"></div>
        <div class="pbs-small">At T−5:00 you get one alert for that round.</div>
      </div>
      <div id="pbs3-toast"></div>
    `;
    document.body.appendChild(root);

    root.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === 'refill') actionRefill(id);
      if (btn.dataset.action === 'travel') actionTravel(id);
      if (btn.dataset.action === 'hit') actionHit(id);
      if (btn.dataset.action === 'open') openBattle(id);
    });

    document.getElementById('pbs3-notify').onclick = async () => {
      if (!('Notification' in window)) return toast('Browser notifications unavailable');
      const p = await Notification.requestPermission();
      toast(`Notifications: ${p}`);
    };
    document.getElementById('pbs3-refresh').onclick = () => discoverAllBattles();
    document.getElementById('pbs3-min').onclick = () => {
      const body = document.getElementById('pbs3-body');
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      document.getElementById('pbs3-min').textContent = hidden ? '−' : '+';
    };
  }

  function render() {
    const status = document.getElementById('pbs3-status');
    const list = document.getElementById('pbs3-list');
    if (!status || !list) return;

    const battles = [...state.battles.values()].sort((a,b) => {
      const aa = Number.isFinite(a.seconds) ? a.seconds : 999999;
      const bb = Number.isFinite(b.seconds) ? b.seconds : 999999;
      return aa-bb;
    });

    const ready = battles.filter(b => Number.isFinite(b.seconds)).length;
    status.textContent = `${state.status} • timers ${ready}/${battles.length}`;

    list.innerHTML = battles.map(b => {
      const urgent = Number.isFinite(b.seconds) && b.seconds <= ALERT_AT && b.seconds > 0;
      return `
        <div class="pbs-battle ${urgent?'URGENT':''}" data-card="${esc(b.id)}">
          <div class="pbs-top">
            <div class="pbs-name" title="${esc(b.name)}">${esc(b.name)}</div>
            <div class="pbs-time">${fmt(b.seconds)}</div>
          </div>
          ${b.error ? `<div class="pbs-small pbs-error">${esc(b.error)}</div>` : ''}
          <div class="pbs-actions">
            <button class="pbs-refill" data-action="refill" data-id="${esc(b.id)}">⚡ REFILL</button>
            <button class="pbs-travel" data-action="travel" data-id="${esc(b.id)}">✈ TRAVEL</button>
            <button class="pbs-hit" data-action="hit" data-id="${esc(b.id)}">💥 HIT</button>
          </div>
          <div style="margin-top:4px;text-align:right"><button data-action="open" data-id="${esc(b.id)}" style="font-size:10px;padding:2px 5px">OPEN</button></div>
        </div>`;
    }).join('') || '<div class="pbs-small">No active battles discovered yet.</div>';
  }

  function flashBattleCard(id) {
    const card = document.querySelector(`[data-card="${CSS.escape(String(id))}"]`);
    if (!card) return;
    card.id = 'pbs3-flash';
    card.scrollIntoView({behavior:'smooth', block:'center'});
    setTimeout(() => { if (card.id === 'pbs3-flash') card.removeAttribute('id'); }, 3500);
  }

  function toast(text) {
    const el = document.getElementById('pbs3-toast');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.style.display = 'none', 2600);
  }

  function heartbeat() {
    for (const [id, b] of state.battles) {
      readBattleFrame(id);
      if (b.loadedAt && Date.now() - b.loadedAt > FRAME_RELOAD_EVERY) {
        reloadFrame(id);
        b.loadedAt = Date.now();
      }
    }
    render();
  }

  function start() {
    injectUI();
    discoverAllBattles();
    setInterval(heartbeat, 1000);
    setInterval(discoverAllBattles, DISCOVER_EVERY);
    setInterval(render, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();