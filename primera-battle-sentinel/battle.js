(() => {
  'use strict';
  const ORIGIN = location.origin;
  const ALERT_AT = 300;
  const DISCOVER_EVERY = 240000;
  const RELOAD_EVERY = 720000;
  const MAX_PAGES = 12;
  const STORE = 'primeraBattleSentinelV4';
  const S = { battles:new Map(), frames:new Map(), alerts:load(), busy:false, status:'Starting…' };

  function load(){ try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch{return{}} }
  function save(){
    const now=Date.now();
    for(const[k,v]of Object.entries(S.alerts)) if(now-Number(v)>28800000) delete S.alerts[k];
    localStorage.setItem(STORE,JSON.stringify(S.alerts));
  }
  function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
  function clean(s=''){return String(s).replace(/\s+/g,' ').trim().slice(0,140)}
  function idOf(u){try{return new URL(u,ORIGIN).searchParams.get('id')}catch{return null}}
  function visible(el){
    if(!el)return false; const w=el.ownerDocument?.defaultView;if(!w)return false;
    const c=w.getComputedStyle(el); return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)!==0&&!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);
  }
  function nText(s){
    s=String(s||'').trim().replace(/\s/g,'');
    if(/^\d{1,3}(?:\.\d{3})+$/.test(s)) return Number(s.replace(/\./g,''));
    if(/^\d{1,3}(?:,\d{3})+$/.test(s)) return Number(s.replace(/,/g,''));
    const n=Number(s.replace(/,/g,'')); return Number.isFinite(n)?n:NaN;
  }
  function nums(s,min=100){
    const a=[]; for(const m of String(s||'').matchAll(/(?:^|[^\d])(\d{1,3}(?:[.,]\d{3})+|\d{4,})(?:[^\d]|$)/g)){
      const n=nText(m[1]);if(Number.isFinite(n)&&n>=min)a.push(n);
    } return a;
  }
  function compact(n){
    if(!Number.isFinite(n))return'—';
    if(n>=1e9)return(n/1e9).toFixed(n>=1e10?1:2)+'B';
    if(n>=1e6)return(n/1e6).toFixed(n>=1e7?1:2)+'M';
    if(n>=1e3)return(n/1e3).toFixed(n>=1e4?1:2)+'K';
    return Math.round(n).toLocaleString();
  }
  function time(s){
    if(!Number.isFinite(s))return'--:--';s=Math.max(0,Math.floor(s));
    return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  }
  async function doc(url,opts={}){
    const r=await fetch(url,{credentials:'include',cache:'no-store',...opts});
    if(!r.ok)throw Error(`HTTP ${r.status}`);return new DOMParser().parseFromString(await r.text(),'text/html');
  }

  async function discover(){
    if(S.busy)return;S.busy=true;S.status='Discovering active battles…';render();
    try{
      const q=[`${ORIGIN}/battles.html`],seen=new Set(),found=new Map();
      while(q.length&&seen.size<MAX_PAGES){
        const u=q.shift();if(seen.has(u))continue;seen.add(u);const d=await doc(u);
        for(const a of d.querySelectorAll('a[href*="battle.html?id="]')){
          const url=new URL(a.getAttribute('href'),ORIGIN).href,id=idOf(url);if(!id)continue;
          let name=clean(a.textContent);let x=a;
          for(let i=0;i<5&&x;i++,x=x.parentElement){const t=clean(x.textContent);if(t.length>=name.length&&t.length<180)name=t}
          found.set(id,{id,url,name:name||`Battle #${id}`});
        }
        for(const a of d.querySelectorAll('a[href*="battles.html"]')){
          try{const u2=new URL(a.getAttribute('href'),ORIGIN).href;if(new URL(u2).origin===ORIGIN&&!seen.has(u2)&&!q.includes(u2))q.push(u2)}catch{}
        }
      }
      for(const[id,b]of found){
        const old=S.battles.get(id)||{};
        S.battles.set(id,{...old,...b,seconds:Number.isFinite(old.seconds)?old.seconds:NaN,round:old.round||'',loaded:old.loaded||0,intel:old.intel||{}});
        frame(id);
      }
      for(const[id]of [...S.battles])if(!found.has(id))remove(id);
      S.status=`Watching ${S.battles.size} active battles`;
    }catch(e){S.status=`Discovery error: ${e.message}`}
    finally{S.busy=false;render()}
  }

  function frame(id){
    if(S.frames.has(id))return;const b=S.battles.get(id);if(!b)return;
    const f=document.createElement('iframe');f.dataset.bid=id;f.setAttribute('aria-hidden','true');
    f.style.cssText='position:fixed;left:-99999px;top:-99999px;width:1100px;height:900px;opacity:0;pointer-events:none;border:0';
    f.addEventListener('load',()=>{const x=S.battles.get(id);if(x){x.loaded=Date.now();read(id,true)}});
    document.body.appendChild(f);S.frames.set(id,f);setTimeout(()=>{if(S.frames.get(id)===f)f.src=b.url},S.frames.size*250);
  }
  function remove(id){S.frames.get(id)?.remove();S.frames.delete(id);S.battles.delete(id)}
  function reload(id){
    const f=S.frames.get(id),b=S.battles.get(id);if(!f||!b)return;const u=new URL(b.url);u.searchParams.set('_pbs',Date.now());f.src=u.href;
  }

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
  function roundKey(d,id){
    const t=clean(d.body?.innerText),m=t.match(/\bRound\s*#?\s*(\d{1,2})\b/i);
    return m?`${id}:r${m[1]}`:`${id}:b${Math.floor(Date.now()/1800000)}`;
  }

  function firstRank(block){
    if(!block)return NaN;
    let root=block;
    for(let i=0;i<4&&root;i++,root=root.parentElement){
      for(const row of root.querySelectorAll('tr,li,div')){
        if(!row.querySelector('a[href*="profile.html?id="]'))continue;
        const a=nums(row.textContent);if(a.length)return a[a.length-1];
      }
    }
    return NaN;
  }
  function intel(d){
    const out={leftDamage:NaN,rightDamage:NaN,leftBH:NaN,rightBH:NaN};
    const vals=[];
    for(const e of d.querySelectorAll('[id*="damage" i],[class*="damage" i]')) vals.push(...nums(e.textContent));
    const uniq=[...new Set(vals)];
    if(uniq.length>=2){out.leftDamage=uniq[0];out.rightDamage=uniq[1]}
    if(!Number.isFinite(out.leftDamage)||!Number.isFinite(out.rightDamage)){
      const lines=String(d.body?.innerText||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
      for(let i=0;i<lines.length;i++)if(/damage/i.test(lines[i])){
        const a=nums(lines.slice(Math.max(0,i-2),i+4).join(' '));if(a.length>=2){out.leftDamage=a[0];out.rightDamage=a[1];break}
      }
    }
    const nodes=[...d.querySelectorAll('div,span,p,td,th,h1,h2,h3,h4,b,strong')];
    const A=nodes.find(e=>/top\s*(attacker|attackers)|best\s*attacker/i.test(e.textContent||''));
    const D=nodes.find(e=>/top\s*(defender|defenders)|best\s*defender/i.test(e.textContent||''));
    out.leftBH=firstRank(A);out.rightBH=firstRank(D);
    if(!Number.isFinite(out.leftBH)||!Number.isFinite(out.rightBH)){
      const top=[];
      for(const box of d.querySelectorAll('table,div')){
        const t=String(box.textContent||'');if(t.length>2500||!/damage/i.test(t)||!box.querySelector('a[href*="profile.html?id="]'))continue;
        const x=firstRank(box);if(Number.isFinite(x)&&!top.includes(x))top.push(x);if(top.length===2)break;
      }
      if(!Number.isFinite(out.leftBH))out.leftBH=top[0];
      if(!Number.isFinite(out.rightBH))out.rightBH=top[1];
    }
    return out;
  }

  function read(id,force=false){
    const f=S.frames.get(id),b=S.battles.get(id);if(!f||!b)return;
    try{
      const d=f.contentDocument;if(!d?.body)return;
      const s=timer(d);if(Number.isFinite(s)){b.seconds=s;b.error='';b.round=roundKey(d,id)}
      else if(force)b.error='Timer not found';
      b.intel=intel(d);
      if(s>0&&s<=ALERT_AT&&!S.alerts[b.round]){
        S.alerts[b.round]=Date.now();save();alertBattle(b);
      }
    }catch{b.error='Frame read error'}
  }
  function alertBattle(b){
    beep();const i=b.intel||{},bh=(Number.isFinite(i.leftBH)||Number.isFinite(i.rightBH))?` • BH ${compact(i.leftBH)} / ${compact(i.rightBH)}`:'';
    const title=`⚔ ${b.name}`,text=`${time(b.seconds)} left${bh}`;
    if(typeof GM_notification==='function'){try{GM_notification({title,text,timeout:15000,onclick:()=>{window.focus();flash(b.id)}})}catch{}}
    else if('Notification'in window&&Notification.permission==='granted'){const n=new Notification(title,{body:text,tag:`pbs-${b.id}`});n.onclick=()=>{window.focus();flash(b.id);n.close()}}
    render();flash(b.id);
  }
  function beep(){
    try{const A=window.AudioContext||window.webkitAudioContext,c=new A(),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=780;g.gain.setValueAtTime(.001,c.currentTime);g.gain.exponentialRampToValueAtTime(.12,c.currentTime+.02);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.25);o.start();o.stop(c.currentTime+.27)}catch{}
  }

  function frameDoc(id){try{return S.frames.get(id)?.contentDocument||null}catch{return null}}
  function clicks(d){return[...d.querySelectorAll('button,input[type="button"],input[type="submit"],a.button,a.btn,a[href],[role="button"]')].filter(visible)}
  function label(e){return clean(e.textContent||e.value||e.title||e.getAttribute('aria-label'))}
  function find(d,rx){return clicks(d).filter(e=>rx.some(r=>r.test(label(e))))}
  function open(id){const b=S.battles.get(id);if(!b)return;if(typeof GM_openInTab==='function'){try{GM_openInTab(b.url,{active:true,insert:true});return}catch{}}window.open(b.url,'_blank','noopener')}
  function refill(id){
    const d=frameDoc(id);if(!d)return fail(id,'Battle frame not ready');
    const x=find(d,[/\b(use|eat|consume)\b.*\b(meal|food|snack|drink)\b/i,/\b(meal|food|snack|drink)\b.*\b(use|eat|consume)\b/i,/\brefill\b/i])[0];
    if(!x)return fail(id,'No refill control detected');x.click();toast(`Clicked: ${label(x)}`);
  }
  function travel(id){
    const d=frameDoc(id);if(!d)return fail(id,'Battle frame not ready');
    const x=find(d,[/\btravel\s*(?:&|and)\s*fight\b/i,/\bquick\s*travel\b/i,/^travel$/i]);
    if(x.length!==1)return fail(id,x.length?'Multiple travel controls':'Travel control not found');
    x[0].click();toast(`Clicked: ${label(x[0])}`);setTimeout(()=>reload(id),1500);
  }
  function hit(id){
    const d=frameDoc(id);if(!d)return fail(id,'Battle frame not ready');
    let x=find(d,[/^fight$/i,/^hit$/i,/\bfight\s*x?1\b/i,/\b1\s*hit\b/i]).filter(e=>!/berserk/i.test(label(e)));
    x=x.filter((e,i,a)=>!a.some((o,j)=>j!==i&&o.contains(e)));
    if(x.length!==1)return fail(id,x.length?'Two fight sides detected':'Single-hit control not detected');
    x[0].click();toast(`1 HIT sent: ${label(x[0])}`);
  }
  function fail(id,m){open(id);toast(`${m}. Opened battle.`)}

  function ui(){
    if(document.getElementById('pbs3'))return;
    const css=document.createElement('style');css.textContent=`
#pbs3{position:fixed;left:12px;bottom:12px;z-index:2147483647;width:430px;max-width:calc(100vw - 20px);max-height:76vh;background:#11161c;color:#eef3f7;border:1px solid #65717e;border-radius:10px;box-shadow:0 12px 36px #000b;font:13px/1.25 Arial,sans-serif;overflow:hidden}
#pbs3-head{display:flex;justify-content:space-between;align-items:center;padding:8px 9px;background:#232a32}#pbs3-body{max-height:64vh;overflow:auto;padding:7px}
#pbs3 button{cursor:pointer;border:1px solid #5d6875;border-radius:6px;background:#2b333d;color:white;padding:5px 7px;font-weight:700}#pbs3 button:hover{filter:brightness(1.16)}
.pbs-refill{background:#2a6541!important}.pbs-travel{background:#355d87!important}.pbs-hit{background:#8a3030!important}
.pbs-battle{border:1px solid #333e49;border-radius:7px;padding:7px;margin-bottom:6px;background:#171d24}.pbs-battle.URGENT{border-color:#d45555;background:#28191b}
.pbs-top{display:flex;justify-content:space-between;gap:8px}.pbs-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}.pbs-time{font-size:17px;font-weight:800;color:#ffd36d;white-space:nowrap}
.pbs-intel{display:grid;grid-template-columns:44px 1fr 1fr;gap:4px;margin-top:5px;font-size:11px}.pbs-bh{font-weight:800;color:#ffcf63}.pbs-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-top:6px}
.pbs-small{font-size:11px;color:#95a0ab}.pbs-error{color:#ff9b9b}#pbs3-toast{display:none;position:absolute;left:50%;bottom:10px;transform:translateX(-50%);padding:7px 10px;border:1px solid #7a8794;border-radius:7px;background:#05080bed;color:#fff;white-space:nowrap;max-width:95%;overflow:hidden;text-overflow:ellipsis}
#pbs3-flash{animation:pbsflash .35s alternate 8}@keyframes pbsflash{from{box-shadow:0 0 0 #0000}to{box-shadow:0 0 24px #ff4242}}`;
    document.head.appendChild(css);
    const r=document.createElement('div');r.id='pbs3';r.innerHTML=`<div id="pbs3-head"><div><b>⚔ Battle Sentinel</b> <span class="pbs-small">v3.2</span></div><div><button id="pbs3-notify">🔔</button><button id="pbs3-refresh">↻</button><button id="pbs3-min">−</button></div></div><div id="pbs3-body"><div id="pbs3-status" class="pbs-small">Starting…</div><div id="pbs3-list"></div><div class="pbs-small">DMG = side total. BH = current top damage detected for each side.</div></div><div id="pbs3-toast"></div>`;
    document.body.appendChild(r);
    r.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.id,a=b.dataset.action;if(a==='refill')refill(id);if(a==='travel')travel(id);if(a==='hit')hit(id);if(a==='open')open(id)});
    document.getElementById('pbs3-notify').onclick=async()=>{if(!('Notification'in window))return toast('Browser notifications unavailable');toast(`Notifications: ${await Notification.requestPermission()}`)};
    document.getElementById('pbs3-refresh').onclick=discover;
    document.getElementById('pbs3-min').onclick=()=>{const b=document.getElementById('pbs3-body'),h=b.style.display==='none';b.style.display=h?'':'none';document.getElementById('pbs3-min').textContent=h?'−':'+'};
  }
  function render(){
    const st=document.getElementById('pbs3-status'),list=document.getElementById('pbs3-list');if(!st||!list)return;
    const a=[...S.battles.values()].sort((x,y)=>(Number.isFinite(x.seconds)?x.seconds:9e9)-(Number.isFinite(y.seconds)?y.seconds:9e9));
    st.textContent=`${S.status} • timers ${a.filter(x=>Number.isFinite(x.seconds)).length}/${a.length}`;
    list.innerHTML=a.map(b=>{const i=b.intel||{},u=Number.isFinite(b.seconds)&&b.seconds<=ALERT_AT&&b.seconds>0;return `<div class="pbs-battle ${u?'URGENT':''}" data-card="${esc(b.id)}"><div class="pbs-top"><div class="pbs-name" title="${esc(b.name)}">${esc(b.name)}</div><div class="pbs-time">${time(b.seconds)}</div></div>${b.error?`<div class="pbs-small pbs-error">${esc(b.error)}</div>`:''}<div class="pbs-intel"><span>DMG</span><span>◀ ${compact(i.leftDamage)}</span><span>${compact(i.rightDamage)} ▶</span><b>BH</b><b class="pbs-bh">◀ ${compact(i.leftBH)}</b><b class="pbs-bh">${compact(i.rightBH)} ▶</b></div><div class="pbs-actions"><button class="pbs-refill" data-action="refill" data-id="${esc(b.id)}">⚡ REFILL</button><button class="pbs-travel" data-action="travel" data-id="${esc(b.id)}">✈ TRAVEL</button><button class="pbs-hit" data-action="hit" data-id="${esc(b.id)}">💥 HIT</button></div><div style="margin-top:4px;text-align:right"><button data-action="open" data-id="${esc(b.id)}" style="font-size:10px;padding:2px 5px">OPEN</button></div></div>`}).join('')||'<div class="pbs-small">No active battles discovered yet.</div>';
  }
  function flash(id){const c=document.querySelector(`[data-card="${CSS.escape(String(id))}"]`);if(!c)return;c.id='pbs3-flash';c.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>{if(c.id==='pbs3-flash')c.removeAttribute('id')},3500)}
  function toast(t){const e=document.getElementById('pbs3-toast');if(!e)return;e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',2600)}
  function beat(){for(const[id,b]of S.battles){read(id);if(b.loaded&&Date.now()-b.loaded>RELOAD_EVERY){reload(id);b.loaded=Date.now()}}render()}
  function start(){ui();discover();setInterval(beat,1000);setInterval(discover,DISCOVER_EVERY);setInterval(render,5000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();