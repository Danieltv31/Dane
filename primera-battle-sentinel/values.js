(() => {
  'use strict';
  const ORIGIN=location.origin,STORE='primeraGoldValueBookV2',REFRESH=30*60*1000;
  const book=load();let busy=false,observerTimer=null;

  function load(){try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch{return{}}}
  function save(){localStorage.setItem(STORE,JSON.stringify(book))}
  function clean(s=''){return String(s).replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
  function num(s){s=String(s||'').trim().replace(/\s/g,'');if(/^\d{1,3}(?:\.\d{3})+$/.test(s))return Number(s.replace(/\./g,''));if(/^\d{1,3}(?:,\d{3})+$/.test(s))return Number(s.replace(/,/g,''));const n=Number(s.replace(/,/g,''));return Number.isFinite(n)?n:NaN}
  function key(s){
    const t=clean(s).toLowerCase(),q=(t.match(/\bq\s*([1-7])\b/)||[])[1],Q=q?` q${q}`:'';
    if(/\bpistol\b|q\s*1\s*weapon|weapon\s*q\s*1/.test(t))return'pistol';
    if(/\brifle\b|q\s*5\s*weapon|weapon\s*q\s*5/.test(t))return'rifle';
    if(/\bweapon\b/.test(t)&&q==='1')return'pistol';if(/\bweapon\b/.test(t)&&q==='5')return'rifle';
    if(/\bmeal\b/.test(t))return`meal${Q||' q5'}`;if(/\bsnack\b/.test(t))return`snack${Q||' q2'}`;
    if(/\bfood\b/.test(t))return`food${Q}`.trim();if(/\bdrink\b|\bgift\b/.test(t))return`drink${Q}`.trim();
    if(/\bticket\b/.test(t))return`ticket${Q}`.trim();if(/\bknife\b/.test(t))return`knife${Q}`.trim();
    if(/\bhouse\b/.test(t))return`house${Q}`.trim();if(/\bestate\b/.test(t))return`estate${Q}`.trim();
    if(/\bhospital\b/.test(t))return`hospital${Q}`.trim();if(/defen[cs]e system|\bds\b/.test(t))return`defense system${Q}`.trim();
    for(const x of['iron','grain','oil','stone','wood','minerals','mineral','diamond','diamonds','chemicals','chemical']){
      if(new RegExp(`\\b${x}\\b`).test(t))return /mineral|diamond/.test(x)?'minerals':/chemical/.test(x)?'chemicals':x;
    }return'';
  }
  function text(el){
    const a=[el.getAttribute?.('title'),el.getAttribute?.('alt'),el.getAttribute?.('data-original-title'),el.getAttribute?.('data-product'),el.getAttribute?.('src')];
    let n=el;for(let i=0;i<3&&n;i++,n=n.parentElement){const t=clean(n.textContent);if(t&&t.length<130)a.push(t)}return a.filter(Boolean).join(' ');
  }
  function qty(el){
    let n=el;for(let i=0;i<4&&n;i++,n=n.parentElement){const t=clean(n.textContent);let m=t.match(/[x×]\s*([0-9][0-9.,]*)\b/i)||t.match(/\b(?:quantity|qty|amount)\s*:?\s*([0-9][0-9.,]*)\b/i);if(m){const x=num(m[1]);if(Number.isFinite(x))return x}}return 1;
  }
  function gold(s){
    const a=[];for(const m of String(s||'').matchAll(/(?:^|[^\d])(\d+(?:[.,]\d+)?)\s*(?:gold|g)\b/ig)){const x=Number(m[1].replace(',','.'));if(Number.isFinite(x)&&x>=.00001)a.push(x)}return a;
  }
  function set(k,p,src){
    if(!k||!Number.isFinite(p)||p<=0)return;const old=book[k];
    if(!old||!Number.isFinite(Number(old.price))||Date.now()-Number(old.ts||0)>600000||p<Number(old.price))book[k]={price:p,ts:Date.now(),source:src};
  }
  function learn(root=document){
    let c=0;
    for(const b of root.querySelectorAll('tr,li,.offer,.product,.marketOffer,.productOffer,div')){
      const t=clean(b.textContent);if(!t||t.length>500||!/(?:gold|\bg\b)/i.test(t))continue;
      const k=key(`${t} ${[...b.querySelectorAll('img')].map(text).join(' ')}`);if(!k)continue;
      const a=gold(t);if(!a.length)continue;set(k,Math.min(...a),'live market');c++;
    }
    if(c)save();return c;
  }
  function price(k){const r=book[k];return r&&Number.isFinite(Number(r.price))?Number(r.price):NaN}
  function fg(n){if(!Number.isFinite(n))return'? g';if(n>=1000)return`${(n/1000).toFixed(2)}k g`;if(n>=10)return`${n.toFixed(2)} g`;if(n>=1)return`${n.toFixed(3)} g`;return`${n.toFixed(4)} g`}
  function annotate(){
    for(const old of document.querySelectorAll('.pbs-item-value'))old.remove();
    for(const el of document.querySelectorAll('img[title],img[alt],img[src],[data-product],[title]')){
      if(el.closest?.('#pbs3'))continue;const k=key(text(el));if(!k)continue;const p=price(k);if(!Number.isFinite(p))continue;
      const q=qty(el),v=p*q,b=document.createElement('span');b.className='pbs-item-value';b.textContent=`≈ ${fg(v)}`;b.title=`${q.toLocaleString()} × ${fg(p)} each • ${k}`;
      const target=el.closest('a')||el;target.insertAdjacentElement('afterend',b);
    }
    status();
  }
  function style(){
    if(document.getElementById('pbs-value-style'))return;const s=document.createElement('style');s.id='pbs-value-style';s.textContent=`
.pbs-item-value{display:block!important;width:max-content!important;max-width:120px;margin:1px auto 3px!important;padding:1px 4px!important;border-radius:4px;background:#151b20e8!important;border:1px solid #806d2e!important;color:#ffd86f!important;font:bold 10px/1.25 Arial,sans-serif!important;text-shadow:0 1px 1px #000;white-space:nowrap;z-index:1000}
#pbs-value-status{position:fixed;left:12px;top:12px;z-index:2147483646;background:#141a20;color:#ffd86f;border:1px solid #806d2e;border-radius:6px;padding:4px 7px;font:bold 11px Arial;cursor:pointer;opacity:.9}`;
    document.head.appendChild(s);
  }
  function status(){
    let e=document.getElementById('pbs-value-status');if(!e){e=document.createElement('div');e.id='pbs-value-status';e.title='Click to refresh live Gold values';e.onclick=refresh;document.body.appendChild(e)}
    e.textContent=`💰 ${Object.keys(book).length} prices${busy?' ↻':''}`;
  }
  async function getDoc(u,opts={}){
    const r=await fetch(u,{credentials:'include',cache:'no-store',...opts});if(!r.ok)throw Error();return new DOMParser().parseFromString(await r.text(),'text/html');
  }
  async function refresh(){
    if(busy)return;busy=true;status();
    try{
      const d=await getDoc(`${ORIGIN}/productMarket.html`);learn(d);
      const sels=[...d.querySelectorAll('select')],ps=sels.find(s=>/product|resource|item|type/i.test(`${s.name} ${s.id}`)||[...s.options].some(o=>key(o.textContent)));
      if(ps?.name){
        const f=ps.closest('form'),method=String(f?.method||'get').toLowerCase(),action=new URL(f?.action||`${ORIGIN}/productMarket.html`,ORIGIN);
        const opts=[...ps.options].filter(o=>key(o.textContent)).slice(0,24);
        for(const o of opts){
          try{
            let page;if(method==='get'){const u=new URL(action),fd=f?new FormData(f):new FormData();for(const[k,v]of fd.entries())u.searchParams.set(k,v);u.searchParams.set(ps.name,o.value);page=await getDoc(u)}
            else{const fd=f?new FormData(f):new FormData();fd.set(ps.name,o.value);page=await getDoc(action,{method:'POST',body:fd})}
            const k=key(o.textContent),a=[];for(const row of page.querySelectorAll('tr,.offer,.productOffer,li'))a.push(...gold(row.textContent));if(a.length)set(k,Math.min(...a),'background market');
          }catch{} await new Promise(r=>setTimeout(r,180));
        }save();
      }
    }catch{}finally{busy=false;annotate()}
  }
  function currentMarket(){
    if(!/productMarket\.html/i.test(location.pathname))return;learn(document);
    const sels=[...document.querySelectorAll('select')];let name='';
    for(const s of sels){const t=clean(s.options?.[s.selectedIndex]?.textContent);if(key(t))name+=` ${t}`}
    const k=key(name),a=[];for(const row of document.querySelectorAll('tr,.offer,.productOffer,li'))a.push(...gold(row.textContent));
    if(k&&a.length){set(k,Math.min(...a),'product market');save()}
  }
  function start(){
    style();currentMarket();learn(document);annotate();status();
    const o=new MutationObserver(()=>{clearTimeout(observerTimer);observerTimer=setTimeout(()=>{currentMarket();learn(document);annotate()},400)});o.observe(document.body,{subtree:true,childList:true});
    setTimeout(refresh,5000);setInterval(refresh,REFRESH);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();