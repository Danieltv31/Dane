(() => {
  'use strict';
  const ORIGIN=location.origin, PASSIVE=30000, HOT=1000, DISCOVER=300000;
  const state=new Map(), hotFrames=new Map();
  let names=new Map(), probe=null, probeBusy=false, lastDiscover=0;

  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const idOf=u=>{try{return new URL(u,ORIGIN).searchParams.get('id')}catch{return null}};
  const compact=n=>!Number.isFinite(n)?'—':n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(2)+'K':Math.round(n).toLocaleString();
  const fmt=s=>!Number.isFinite(s)?'SYNC':s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  function visible(el){if(!el)return false;const w=el.ownerDocument?.defaultView;if(!w)return false;const c=w.getComputedStyle(el);return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)!==0&&!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)}
  function parseClock(t){t=clean(t);let m=t.match(/\b(\d{1,2}):([0-5]\d):([0-5]\d)\b/);if(m){const s=+m[1]*3600+ +m[2]*60+ +m[3];if(s>0&&s<=7500)return s}m=t.match(/\b(\d{1,2}):([0-5]\d)\b/);if(m){const s=+m[1]*60+ +m[2];if(s>0&&s<=7200)return s}return NaN}
  function timer(d){
    const bad=/restor|energy|daily|sidebar|clock|date|profile|citizen/i, c=[];
    for(const e of d.querySelectorAll('span,div,b,strong,p,td')){
      if(!visible(e))continue;const t=clean(e.textContent);if(!t||t.length>70)continue;const s=parseClock(t);if(!Number.isFinite(s))continue;
      const sig=`${e.id||''} ${e.className||''} ${e.parentElement?.id||''} ${e.parentElement?.className||''}`, around=clean(e.parentElement?.textContent||'').slice(0,220);let score=0;
      if(/battle/i.test(sig))score+=4;if(/round/i.test(sig))score+=4;if(/timer|countdown|timeleft|time-left/i.test(sig))score+=3;if(/round|battle|remaining|time left|ends in/i.test(around))score+=2;if(bad.test(sig)||bad.test(around))score-=10;c.push({s,score});
    }
    c.sort((a,b)=>b.score-a.score);return c[0]?.score>=3?c[0].s:NaN;
  }
  function nums(t,min=1000){const a=[];for(const m of String(t||'').matchAll(/(?:^|[^\d])(\d{1,3}(?:[,.]\d{3})+|\d{4,})(?:[^\d]|$)/g)){const n=Number(m[1].replace(/[,.](?=\d{3}(?:\D|$))/g,''));if(Number.isFinite(n)&&n>=min)a.push(n)}return a}
  function bh(d){
    const found=[];for(const t of d.querySelectorAll('table')){if(!t.querySelector('a[href*="profile.html?id="]')||!/damage/i.test(t.textContent||''))continue;for(const r of t.querySelectorAll('tr')){if(!r.querySelector('a[href*="profile.html?id="]'))continue;const a=nums(r.textContent);if(a.length){found.push({n:Math.max(...a),x:t.getBoundingClientRect().left});break}}}
    found.sort((a,b)=>a.x-b.x);return{l:found[0]?.n??NaN,r:found.length>1?found.at(-1).n:NaN};
  }
  function dmg(d){
    const cand=[];for(const e of d.querySelectorAll('div,table,section')){const t=clean(e.textContent);if(t.length>900||!/%/.test(t))continue;if(e.querySelectorAll('[class*="flag" i],img[src*="flag" i]').length<2)continue;const a=[...new Set(nums(t,10000))];if(a.length<2)continue;let p=a.slice(-2);if(a.length>=3){outer:for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)for(let k=0;k<a.length;k++){if(k===i||k===j)continue;if(Math.abs(a[i]+a[j]-a[k])<=Math.max(100,a[k]*.02)){p=[a[i],a[j]];break outer}}}const r=e.getBoundingClientRect();cand.push({p,area:r.width*r.height})}
    cand.sort((a,b)=>a.area-b.area);return{l:cand[0]?.p[0]??NaN,r:cand[0]?.p[1]??NaN};
  }
  function sample(id,d){const s=timer(d),B=state.get(String(id))||{};B.seconds=s;B.at=Date.now();B.last=B.at;B.bh=bh(d);B.dmg=dmg(d);state.set(String(id),B);paint()}
  function estimate(B){if(!B||!Number.isFinite(B.seconds)||!B.at)return NaN;const s=B.seconds-Math.floor((Date.now()-B.at)/1000);return s>0?s:NaN}

  async function discover(){
    if(Date.now()-lastDiscover<DISCOVER)return;lastDiscover=Date.now();try{const r=await fetch(`${ORIGIN}/battles.html?_fix=${Date.now()}`,{credentials:'include',cache:'no-store'}),d=new DOMParser().parseFromString(await r.text(),'text/html'),m=new Map();for(const a of d.querySelectorAll('a[href*="battle.html?id="]')){const id=idOf(a.href);if(!id)continue;let n=clean(a.textContent).replace(/\s+[\d,.]{4,}.*$/,'').trim();if(!n||n.length>90)n='Battle';m.set(String(id),`${n} #${id}`)}names=m;paint()}catch{}
  }
  function ensureProbe(){if(probe)return probe;probe=document.createElement('iframe');probe.style.cssText='position:fixed;left:-99999px;top:-99999px;width:1200px;height:900px;opacity:0;pointer-events:none;border:0';document.body.appendChild(probe);return probe}
  function passiveProbe(id,url){if(probeBusy)return;probeBusy=true;const f=ensureProbe();let done=false;const finish=()=>{if(done)return;done=true;probeBusy=false;f.removeEventListener('load',onload)};const onload=()=>setTimeout(()=>{try{if(f.contentDocument?.body)sample(id,f.contentDocument)}catch{}finally{finish()}},700);f.addEventListener('load',onload);const u=new URL(url,ORIGIN);u.searchParams.set('_fix',Date.now());f.src=u.href;setTimeout(finish,7000)}
  function ensureHot(id,url){id=String(id);if(hotFrames.has(id))return;const f=document.createElement('iframe');f.style.cssText='position:fixed;left:-99999px;top:-99999px;width:1200px;height:900px;opacity:0;pointer-events:none;border:0';f.addEventListener('load',()=>setTimeout(()=>{try{if(f.contentDocument?.body)sample(id,f.contentDocument)}catch{}},500));document.body.appendChild(f);hotFrames.set(id,f);f.src=url}
  function dropHot(id){const f=hotFrames.get(String(id));if(f)f.remove();hotFrames.delete(String(id))}

  function cardInfo(){return[...document.querySelectorAll('#pbs3 [data-card]')].map(c=>{const id=String(c.getAttribute('data-card'));const o=c.querySelector('button[data-action="open"]');return{id,card:c,url:o?`${ORIGIN}/battle.html?id=${encodeURIComponent(id)}`:null}})}
  function paint(){
    const h=document.querySelector('#pbs3-head .pbs-small');if(h)h.textContent='v3.6';
    for(const {id,card} of cardInfo()){
      const B=state.get(id),s=estimate(B),hot=Number.isFinite(s)&&s<=60,n=names.get(id);const name=card.querySelector('.pbs-name'),tm=card.querySelector('.pbs-time'),mode=card.querySelector('.pbs-mode');if(name&&n){name.textContent=n;name.title=n}if(tm)tm.textContent=fmt(s);if(mode)mode.textContent=hot?'🔥 1s':'30s';card.classList.toggle('HOT',hot);const spans=card.querySelectorAll('.pbs-intel span,.pbs-intel b');if(spans.length>=6){spans[1].textContent=`◀ ${compact(B?.dmg?.l)}`;spans[2].textContent=`${compact(B?.dmg?.r)} ▶`;spans[4].textContent=`◀ ${compact(B?.bh?.l)}`;spans[5].textContent=`${compact(B?.bh?.r)} ▶`}
    }
  }
  function tick(){discover();const cards=cardInfo(),now=Date.now();for(const x of cards){const B=state.get(x.id),s=estimate(B);if(Number.isFinite(s)&&s<=60){ensureHot(x.id,x.url);const f=hotFrames.get(x.id);try{if(f?.contentDocument?.body)sample(x.id,f.contentDocument)}catch{}}else{dropHot(x.id);if(!B||now-(B.last||0)>=PASSIVE)passiveProbe(x.id,x.url)}}paint()}
  setInterval(tick,HOT);setInterval(paint,400);setTimeout(tick,1200);
})();
