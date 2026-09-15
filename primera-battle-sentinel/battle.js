(() => {
  'use strict';

  const ORIGIN = location.origin;
  const ALERT_AT = 300;
  const PASSIVE_MS = 30000;
  const HOT_MS = 1000;
  const DISCOVER_MS = 300000;
  const MAX_PAGES = 12;
  const ALERT_STORE = 'primeraBattleSentinelV4';
  const PREF_STORE = 'primeraBattleSentinelPrefsV1';
  const LEASE_KEY = 'primeraBattleSentinelLeaderV1';
  const DB_NAME = 'PrimeraBattleSentinelDB';
  const DB_VERSION = 1;
  const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const S = {
    battles: new Map(), alerts: loadAlerts(), busy: false, status: 'Loading cache…',
    leader: false, lastDiscovery: 0, db: null, checking: new Set()
  };
  const P = loadPrefs();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('pbs-db-v1') : null;

  function loadAlerts(){ try{return JSON.parse(localStorage.getItem(ALERT_STORE)||'{}')}catch{return{}} }
  function saveAlerts(){
    const now=Date.now();
    for(const[k,v]of Object.entries(S.alerts)) if(now-Number(v)>28800000) delete S.alerts[k];
    localStorage.setItem(ALERT_STORE,JSON.stringify(S.alerts));
  }
  function loadPrefs(){
    try{return{silent:false,hidden:false,collapsed:false,...JSON.parse(localStorage.getItem(PREF_STORE)||'{}')}}catch{return{silent:false,hidden:false,collapsed:false}}
  }
  function savePrefs(){localStorage.setItem(PREF_STORE,JSON.stringify(P))}
  function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
  function clean(s=''){return String(s).replace(/\s+/g,' ').trim().slice(0,140)}
  function idOf(u){try{return new URL(u,ORIGIN).searchParams.get('id')}catch{return null}}
  function visible(el){
    if(!el)return false;const w=el.ownerDocument?.defaultView;if(!w)return false;
    const c=w.getComputedStyle(el);return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)!==0&&!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);
  }
  function nText(s){
    s=String(s||'').trim().replace(/\s/g,'');
    if(/^\d{1,3}(?:\.\d{3})+$/.test(s))return Number(s.replace(/\./g,''));
    if(/^\d{1,3}(?:,\d{3})+$/.test(s))return Number(s.replace(/,/g,''));
    const n=Number(s.replace(/,/g,''));return Number.isFinite(n)?n:NaN;
  }
  function nums(s,min=100){
    const a=[];for(const m of String(s||'').matchAll(/(?:^|[^\d])(\d{1,3}(?:[.,]\d{3})+|\d{4,})(?:[^\d]|$)/g)){
      const n=nText(m[1]);if(Number.isFinite(n)&&n>=min)a.push(n);
    }return a;
  }
  function compact(n){
    if(!Number.isFinite(n))return'—';if(n>=1e9)return(n/1e9).toFixed(n>=1e10?1:2)+'B';
    if(n>=1e6)return(n/1e6).toFixed(n>=1e7?1:2)+'M';if(n>=1e3)return(n/1e3).toFixed(n>=1e4?1:2)+'K';return Math.round(n).toLocaleString();
  }
  function time(s){
    if(!Number.isFinite(s))return'--:--';s=Math.max(0,Math.floor(s));
    return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  }
  function estimate(b){
    if(!Number.isFinite(b.seconds)||!b.sampledAt)return b.seconds;
    return Math.max(0,b.seconds-Math.floor((Date.now()-b.sampledAt)/1000));
  }
  function modeFor(b){const s=estimate(b);return Number.isFinite(s)&&s<=60?'HOT 1s':'PASSIVE 30s'}

  // ---------- IndexedDB ----------
  function openDB(){
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB_NAME,DB_VERSION);
      r.onupgradeneeded=()=>{
        const d=r.result;
        if(!d.objectStoreNames.contains('battles'))d.createObjectStore('battles',{keyPath:'id'});
        if(!d.objectStoreNames.contains('meta'))d.createObjectStore('meta',{keyPath:'key'});
      };
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
  }
  function dbAll(store){return new Promise((resolve,reject)=>{const r=S.db.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
  function dbPut(store,val){return new Promise((resolve,reject)=>{const r=S.db.transaction(store,'readwrite').objectStore(store).put(val);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}
  function dbDel(store,key){return new Promise((resolve,reject)=>{const r=S.db.transaction(store,'readwrite').objectStore(store).delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}
  function rowOf(b){return{id:b.id,url:b.url,name:b.name,seconds:b.seconds,round:b.round||'',intel:b.intel||{},sampledAt:b.sampledAt||0,lastChecked:b.lastChecked||0,lastSeen:b.lastSeen||0,error:b.error||''}}
  async function saveBattle(b,broadcast=true){
    if(S.db)try{await dbPut('battles',rowOf(b))}catch{}
    if(broadcast)bc?.postMessage({type:'battle',row:rowOf(b)});
  }
  async function deleteBattle(id,broadcast=true){
    S.battles.delete(id);if(S.db)try{await dbDel('battles',id)}catch{};if(broadcast)bc?.postMessage({type:'remove',id});
  }
  async function hydrate(){
    try{
      S.db=await openDB();const rows=await dbAll('battles'),cut=Date.now()-6*3600000;
      for(const r of rows){if((r.lastSeen||0)<cut){dbDel('battles',r.id).catch(()=>{});continue}S.battles.set(String(r.id),r)}
      S.status=`Cache ready • ${S.battles.size} battles`;
    }catch(e){S.status=`Cache unavailable: ${e.message}`}
    render();
  }
  bc?.addEventListener('message',e=>{
    const m=e.data||{};
    if(m.type==='battle'&&m.row){S.battles.set(String(m.row.id),m.row);render()}
    if(m.type==='remove'){S.battles.delete(String(m.id));render()}
  });

  // ---------- leader election: only one Primera tab polls ----------
  function claimLeader(){
    const now=Date.now();let cur={};try{cur=JSON.parse(localStorage.getItem(LEASE_KEY)||'{}')}catch{}
    if(!cur.id||cur.until<now||cur.id===TAB_ID){
      localStorage.setItem(LEASE_KEY,JSON.stringify({id:TAB_ID,until:now+12000}));S.leader=true;
    }else S.leader=false;
    return S.leader;
  }
  window.addEventListener('beforeunload',()=>{
    try{const x=JSON.parse(localStorage.getItem(LEASE_KEY)||'{}');if(x.id===TAB_ID)localStorage.removeItem(LEASE_KEY)}catch{}
  });

  async function doc(url){
    const r=await fetch(url,{credentials:'include',cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);
    return new DOMParser().parseFromString(await r.text(),'text/html');
  }

  // ---------- discovery ----------
  async function discover(){
    if(!S.leader||S.busy)return;S.busy=true;S.status='Testing active battles…';render();
    try{
      const q=[`${ORIGIN}/battles.html`],seen=new Set(),found=new Map();
      while(q.length&&seen.size<MAX_PAGES){
        const u=q.shift();if(seen.has(u))continue;seen.add(u);const d=await doc(u);
        for(const a of d.querySelectorAll('a[href*="battle.html?id="]')){
          const url=new URL(a.getAttribute('href'),ORIGIN).href,id=idOf(url);if(!id)continue;
          let name=clean(a.textContent),x=a;
          for(let i=0;i<5&&x;i++,x=x.parentElement){const t=clean(x.textContent);if(t.length>=name.length&&t.length<180)name=t}
          found.set(String(id),{id:String(id),url,name:name||`Battle #${id}`});
        }
        for(const a of d.querySelectorAll('a[href*="battles.html"]')){
          try{const u2=new URL(a.getAttribute('href'),ORIGIN).href;if(new URL(u2).origin===ORIGIN&&!seen.has(u2)&&!q.includes(u2))q.push(u2)}catch{}
        }
      }
      const now=Date.now();
      for(const[id,f]of found){
        const old=S.battles.get(id)||{};const b={...old,...f,lastSeen:now};S.battles.set(id,b);saveBattle(b);
      }
      for(const[id]of [...S.battles])if(!found.has(id))deleteBattle(id);
      S.lastDiscovery=now;S.status=`${S.battles.size} active • DB cache on`;
    }catch(e){S.status=`Discovery error: ${e.message}`}
    finally{S.busy=false;render()}
  }

  // ---------- timer + damage/BH parsing ----------
  function timerText(t){
    t=String(t||'').replace(/\s+/g,' ');
    let a=[...t.matchAll(/\b(\d{1,2}):([0-5]\d):([0-5]\d)\b/g)].map(m=>+m[1]*3600+ +m[2]*60+ +m[3]).filter(x=>x<=7500);
    if(a.length)return Math.min(...a);
    a=[...t.matchAll(/\b(\d{1,2}):([0-5]\d)\b/g)].map(m=>+m[1]*60+ +m[2]).filter(x=>x<=3600);
    if(a.length)return Math.min(...a);return NaN;
  }
  function timer(d){
    const strong=[];
    for(const e of d.querySelectorAll('[id*="countdown" i],[class*="countdown" i],[id*="timer" i],[class*="timer" i],[id*="timeLeft" i],[class*="timeLeft" i]')){
      const s=timerText(e.textContent);if(Number.isFinite(s))strong.push(s);
    }
    if(strong.length)return Math.min(...strong);
    for(const e of d.querySelectorAll('div,span,p,td,b,strong')){
      const t=clean(e.textContent);if(t.length<=120&&/(time|round|left|remaining|ends?)/i.test(t)){const s=timerText(t);if(Number.isFinite(s))return s}
    }
    return timerText(d.body?.innerText);
  }
  function roundKey(d,id){const t=clean(d.body?.innerText),m=t.match(/\bRound\s*#?\s*(\d{1,2})\b/i);return m?`${id}:r${m[1]}`:`${id}:b${Math.floor(Date.now()/1800000)}`}
  function firstRank(block){
    if(!block)return NaN;let root=block;
    for(let i=0;i<4&&root;i++,root=root.parentElement){
      for(const row of root.querySelectorAll('tr,li,div')){if(!row.querySelector('a[href*="profile.html?id="]'))continue;const a=nums(row.textContent);if(a.length)return a[a.length-1]}
    }return NaN;
  }
  function intel(d){
    const out={leftDamage:NaN,rightDamage:NaN,leftBH:NaN,rightBH:NaN},vals=[];
    for(const e of d.querySelectorAll('[id*="damage" i],[class*="damage" i]'))vals.push(...nums(e.textContent));
    const uniq=[...new Set(vals)];if(uniq.length>=2){out.leftDamage=uniq[0];out.rightDamage=uniq[1]}
    if(!Number.isFinite(out.leftDamage)||!Number.isFinite(out.rightDamage)){
      const lines=String(d.body?.innerText||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
      for(let i=0;i<lines.length;i++)if(/damage/i.test(lines[i])){const a=nums(lines.slice(Math.max(0,i-2),i+4).join(' '));if(a.length>=2){out.leftDamage=a[0];out.rightDamage=a[1];break}}
    }
    const nodes=[...d.querySelectorAll('div,span,p,td,th,h1,h2,h3,h4,b,strong')];
    const A=nodes.find(e=>/top\s*(attacker|attackers)|best\s*attacker/i.test(e.textContent||'')),D=nodes.find(e=>/top\s*(defender|defenders)|best\s*defender/i.test(e.textContent||''));
    out.leftBH=firstRank(A);out.rightBH=firstRank(D);
    if(!Number.isFinite(out.leftBH)||!Number.isFinite(out.rightBH)){
      const top=[];for(const box of d.querySelectorAll('table,div')){const t=String(box.textContent||'');if(t.length>2500||!/damage/i.test(t)||!box.querySelector('a[href*="profile.html?id="]'))continue;const x=firstRank(box);if(Number.isFinite(x)&&!top.includes(x))top.push(x);if(top.length===2)break}
      if(!Number.isFinite(out.leftBH))out.leftBH=top[0];if(!Number.isFinite(out.rightBH))out.rightBH=top[1];
    }return out;
  }

  async function checkBattle(id){
    if(!S.leader||S.checking.has(id))return;const b=S.battles.get(id);if(!b?.url)return;
    S.checking.add(id);
    try{
      const d=await doc(b.url),s=timer(d),now=Date.now();
      b.lastChecked=now;b.sampledAt=now;b.lastSeen=now;b.intel=intel(d);b.round=roundKey(d,id);
      if(Number.isFinite(s)){b.seconds=s;b.error=''}else b.error='Timer not found';
      await saveBattle(b);
      if(Number.isFinite(s)&&s>0&&s<=ALERT_AT&&!S.alerts[b.round]){S.alerts[b.round]=now;saveAlerts();alertBattle(b)}
    }catch(e){b.lastChecked=Date.now();b.error=`Check failed: ${e.message}`;saveBattle(b)}
    finally{S.checking.delete(id);render()}
  }

  function alertBattle(b){
    if(P.silent)return;
    beep();const i=b.intel||{},bh=(Number.isFinite(i.leftBH)||Number.isFinite(i.rightBH))?` • BH ${compact(i.leftBH)} / ${compact(i.rightBH)}`:'';
    const title=`⚔ ${b.name}`,text=`${time(estimate(b))} left${bh}`;
    if(typeof GM_notification==='function'){try{GM_notification({title,text,timeout:15000,onclick:()=>{window.focus();flash(b.id)}})}catch{}}
    else if('Notification'in window&&Notification.permission==='granted'){const n=new Notification(title,{body:text,tag:`pbs-${b.id}`});n.onclick=()=>{window.focus();flash(b.id);n.close()}}
    flash(b.id);
  }
  function beep(){try{const A=window.AudioContext||window.webkitAudioContext,c=new A(),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=780;g.gain.setValueAtTime(.001,c.currentTime);g.gain.exponentialRampToValueAtTime(.12,c.currentTime+.02);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.25);o.start();o.stop(c.currentTime+.27)}catch{}}

  // ---------- user-click actions: iframe created only when needed ----------
  function clicks(d){return[...d.querySelectorAll('button,input[type="button"],input[type="submit"],a.button,a.btn,a[href],[role="button"]')].filter(visible)}
  function label(e){return clean(e.textContent||e.value||e.title||e.getAttribute('aria-label'))}
  function find(d,rx){return clicks(d).filter(e=>rx.some(r=>r.test(label(e))))}
  function open(id){const b=S.battles.get(id);if(!b)return;if(typeof GM_openInTab==='function'){try{GM_openInTab(b.url,{active:true,insert:true});return}catch{}}window.open(b.url,'_blank','noopener')}
  function actionDoc(id,fn){
    const b=S.battles.get(id);if(!b)return;const f=document.createElement('iframe');let done=false;
    f.style.cssText='position:fixed;left:-99999px;top:-99999px;width:1100px;height:900px;opacity:0;pointer-events:none;border:0';
    f.onload=()=>{if(done)return;done=true;try{fn(f.contentDocument)}catch{open(id)}setTimeout(()=>{f.remove();checkBattle(id)},1800)};
    document.body.appendChild(f);f.src=b.url;setTimeout(()=>{if(!done){done=true;f.remove();open(id);toast('Action page timed out. Opened battle.')}},8000);
  }
  function refill(id){actionDoc(id,d=>{const x=find(d,[/\b(use|eat|consume)\b.*\b(meal|food|snack|drink)\b/i,/\b(meal|food|snack|drink)\b.*\b(use|eat|consume)\b/i,/\brefill\b/i])[0];if(!x){open(id);toast('No refill control detected.')}else{x.click();toast(`Clicked: ${label(x)}`)}})}
  function travel(id){actionDoc(id,d=>{const x=find(d,[/\btravel\s*(?:&|and)\s*fight\b/i,/\bquick\s*travel\b/i,/^travel$/i]);if(x.length!==1){open(id);toast(x.length?'Multiple travel controls.':'Travel control not found.')}else{x[0].click();toast(`Clicked: ${label(x[0])}`)}})}
  function hit(id){actionDoc(id,d=>{let x=find(d,[/^fight$/i,/^hit$/i,/\bfight\s*x?1\b/i,/\b1\s*hit\b/i]).filter(e=>!/berserk/i.test(label(e)));x=x.filter((e,i,a)=>!a.some((o,j)=>j!==i&&o.contains(e)));if(x.length!==1){open(id);toast(x.length?'Two fight sides detected.':'Single-hit control not detected.')}else{x[0].click();toast(`1 HIT sent: ${label(x[0])}`)}})}

  // ---------- UI ----------
  function ui(){
    if(document.getElementById('pbs3'))return;
    const css=document.createElement('style');css.textContent=`
#pbs3{position:fixed;left:12px;bottom:12px;z-index:2147483647;width:440px;max-width:calc(100vw - 20px);max-height:78vh;background:#11161c;color:#eef3f7;border:1px solid #65717e;border-radius:10px;box-shadow:0 12px 36px #000b;font:13px/1.25 Arial,sans-serif;overflow:hidden}
#pbs3-head{display:flex;justify-content:space-between;align-items:center;padding:8px 9px;background:#232a32}#pbs3-body{max-height:66vh;overflow:auto;padding:7px}
#pbs3 button,#pbs3-show{cursor:pointer;border:1px solid #5d6875;border-radius:6px;background:#2b333d;color:white;padding:5px 7px;font-weight:700}#pbs3 button:hover,#pbs3-show:hover{filter:brightness(1.16)}
.pbs-refill{background:#2a6541!important}.pbs-travel{background:#355d87!important}.pbs-hit{background:#8a3030!important}.pbs-silent{background:#5f4a22!important}
.pbs-battle{border:1px solid #333e49;border-radius:7px;padding:7px;margin-bottom:6px;background:#171d24}.pbs-battle.URGENT{border-color:#d45555;background:#28191b}.pbs-battle.HOT{box-shadow:inset 3px 0 #ff8b42}
.pbs-top{display:flex;justify-content:space-between;gap:8px}.pbs-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}.pbs-time{font-size:17px;font-weight:800;color:#ffd36d;white-space:nowrap}
.pbs-intel{display:grid;grid-template-columns:44px 1fr 1fr;gap:4px;margin-top:5px;font-size:11px}.pbs-bh{font-weight:800;color:#ffcf63}.pbs-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-top:6px}
.pbs-small{font-size:11px;color:#95a0ab}.pbs-mode{font-size:10px;color:#71d5ff}.pbs-error{color:#ff9b9b}#pbs3-toast{display:none;position:absolute;left:50%;bottom:10px;transform:translateX(-50%);padding:7px 10px;border:1px solid #7a8794;border-radius:7px;background:#05080bed;color:#fff;white-space:nowrap;max-width:95%;overflow:hidden;text-overflow:ellipsis}
#pbs3-show{position:fixed;left:0;bottom:90px;z-index:2147483647;border-radius:0 7px 7px 0;background:#232a32}#pbs3-flash{animation:pbsflash .35s alternate 8}@keyframes pbsflash{from{box-shadow:0 0 0 #0000}to{box-shadow:0 0 24px #ff4242}}`;
    document.head.appendChild(css);
    const r=document.createElement('div');r.id='pbs3';r.innerHTML=`<div id="pbs3-head"><div><b>⚔ Battle Sentinel</b> <span class="pbs-small">v3.4</span></div><div><button id="pbs3-silent" title="Toggle silent mode">${P.silent?'🔇':'🔊'}</button><button id="pbs3-refresh">↻</button><button id="pbs3-hide">✕</button><button id="pbs3-min">${P.collapsed?'+':'−'}</button></div></div><div id="pbs3-body" style="${P.collapsed?'display:none':''}"><div id="pbs3-status" class="pbs-small">Loading cache…</div><div id="pbs3-list"></div><div class="pbs-small">DB cache + single-tab polling. Passive: 30s. Last minute: 1s.</div></div><div id="pbs3-toast"></div>`;
    const show=document.createElement('button');show.id='pbs3-show';show.textContent='⚔ SHOW';
    document.body.appendChild(r);document.body.appendChild(show);
    if(P.hidden){r.style.display='none';show.style.display='block'}else show.style.display='none';
    r.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.id,a=b.dataset.action;if(a==='refill')refill(id);if(a==='travel')travel(id);if(a==='hit')hit(id);if(a==='open')open(id)});
    document.getElementById('pbs3-silent').onclick=()=>{P.silent=!P.silent;savePrefs();document.getElementById('pbs3-silent').textContent=P.silent?'🔇':'🔊';toast(P.silent?'Silent mode ON':'Silent mode OFF')};
    document.getElementById('pbs3-refresh').onclick=()=>{if(S.leader){S.lastDiscovery=0;discover()}else toast('Another Primera tab is the active watcher.')};
    document.getElementById('pbs3-hide').onclick=()=>{P.hidden=true;savePrefs();r.style.display='none';show.style.display='block'};
    show.onclick=()=>{P.hidden=false;savePrefs();r.style.display='block';show.style.display='none'};
    document.getElementById('pbs3-min').onclick=()=>{P.collapsed=!P.collapsed;savePrefs();const b=document.getElementById('pbs3-body');b.style.display=P.collapsed?'none':'';document.getElementById('pbs3-min').textContent=P.collapsed?'+':'−'};
  }
  function render(){
    const st=document.getElementById('pbs3-status'),list=document.getElementById('pbs3-list');if(!st||!list)return;
    const a=[...S.battles.values()].sort((x,y)=>(Number.isFinite(estimate(x))?estimate(x):9e9)-(Number.isFinite(estimate(y))?estimate(y):9e9));
    st.textContent=`${S.status} • ${S.leader?'ACTIVE WATCHER':'CACHE FOLLOWER'} • ${a.length} battles`;
    list.innerHTML=a.map(b=>{const i=b.intel||{},s=estimate(b),hot=Number.isFinite(s)&&s<=60,u=Number.isFinite(s)&&s<=ALERT_AT&&s>0;return `<div class="pbs-battle ${u?'URGENT':''} ${hot?'HOT':''}" data-card="${esc(b.id)}"><div class="pbs-top"><div class="pbs-name" title="${esc(b.name)}">${esc(b.name)}</div><div><span class="pbs-mode">${hot?'🔥 1s':'30s'}</span> <span class="pbs-time">${time(s)}</span></div></div>${b.error?`<div class="pbs-small pbs-error">${esc(b.error)}</div>`:''}<div class="pbs-intel"><span>DMG</span><span>◀ ${compact(i.leftDamage)}</span><span>${compact(i.rightDamage)} ▶</span><b>BH</b><b class="pbs-bh">◀ ${compact(i.leftBH)}</b><b class="pbs-bh">${compact(i.rightBH)} ▶</b></div><div class="pbs-actions"><button class="pbs-refill" data-action="refill" data-id="${esc(b.id)}">⚡ REFILL</button><button class="pbs-travel" data-action="travel" data-id="${esc(b.id)}">✈ TRAVEL</button><button class="pbs-hit" data-action="hit" data-id="${esc(b.id)}">💥 HIT</button></div><div style="margin-top:4px;text-align:right"><button data-action="open" data-id="${esc(b.id)}" style="font-size:10px;padding:2px 5px">OPEN</button></div></div>`}).join('')||'<div class="pbs-small">No active battles cached yet.</div>';
  }
  function flash(id){if(P.silent||P.hidden||P.collapsed)return;const c=document.querySelector(`[data-card="${CSS.escape(String(id))}"]`);if(!c)return;c.id='pbs3-flash';c.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>{if(c.id==='pbs3-flash')c.removeAttribute('id')},3500)}
  function toast(t){const e=document.getElementById('pbs3-toast');if(!e)return;e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',2600)}

  async function followerSync(){
    if(S.leader||!S.db)return;try{for(const r of await dbAll('battles'))S.battles.set(String(r.id),r)}catch{}render();
  }
  function scheduler(){
    claimLeader();const now=Date.now();
    if(S.leader){
      if(!S.lastDiscovery||now-S.lastDiscovery>=DISCOVER_MS)discover();
      for(const[id,b]of S.battles){
        const s=estimate(b),interval=Number.isFinite(s)&&s<=60?HOT_MS:PASSIVE_MS;
        if(now-(b.lastChecked||0)>=interval)checkBattle(id);
      }
    }
    render();
  }
  async function start(){
    ui();await hydrate();claimLeader();
    if(S.leader)discover();else followerSync();
    setInterval(scheduler,1000);setInterval(followerSync,5000);setInterval(()=>{if(S.leader)localStorage.setItem(LEASE_KEY,JSON.stringify({id:TAB_ID,until:Date.now()+12000}))},5000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();