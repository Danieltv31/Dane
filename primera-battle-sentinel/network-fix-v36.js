(() => {
  'use strict';
  // v3.6 safety throttle: legacy battle polling can ask every second when a bad timer hits 0.
  // Keep network GETs to battle pages at >=30s; the final-minute v3.6 watcher reads a live iframe DOM instead.
  const BASE_FETCH = globalThis.fetch.bind(globalThis);
  const TTL = 30000;
  const cache = new Map();
  const inflight = new Map();
  function eligible(input, init={}) {
    try {
      const u = new URL(typeof input === 'string' ? input : input?.url, location.href);
      return u.origin === location.origin && String(init.method||'GET').toUpperCase()==='GET' && /\/(battle|battles)\.html$/i.test(u.pathname);
    } catch { return false; }
  }
  function keyOf(input){try{const u=new URL(typeof input==='string'?input:input?.url,location.href);u.searchParams.delete('_pbs');u.searchParams.delete('_fix');return u.href}catch{return String(input)}}
  function fromRow(r){return new Response(r.body,{status:r.status,statusText:r.statusText,headers:r.headers})}
  async function guarded(input, init={}) {
    if(!eligible(input,init)) return BASE_FETCH(input,init);
    const key=keyOf(input), now=Date.now(), old=cache.get(key);
    if(old && now-old.at<TTL) return fromRow(old);
    if(inflight.has(key)) return inflight.get(key).then(fromRow);
    const p=(async()=>{const res=await BASE_FETCH(input,{...init,cache:'no-store'});const row={body:await res.clone().text(),status:res.status,statusText:res.statusText,headers:{'content-type':res.headers.get('content-type')||'text/html; charset=UTF-8'},at:Date.now()};cache.set(key,row);return row})();
    inflight.set(key,p);p.finally(()=>inflight.delete(key));return p.then(fromRow);
  }
  globalThis.fetch=guarded;try{window.fetch=guarded}catch{}
})();
