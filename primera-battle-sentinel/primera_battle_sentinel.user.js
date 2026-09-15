// ==UserScript==
// @name         Primera Battle Sentinel
// @namespace    chatgpt.openai
// @version      3.6.0
// @description  Battle timer/BH intel, persistent cache, adaptive polling, and live Gold-value labels for Primera products.
// @updateURL    https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/primera_battle_sentinel.user.js
// @downloadURL  https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/primera_battle_sentinel.user.js
// @require      https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/network-cache.js?v=3.6.0
// @require      https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/network-fix-v36.js?v=3.6.0
// @require      https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/battle.js?v=3.6.0
// @require      https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/fix-v36.js?v=3.6.0
// @require      https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/values.js?v=3.6.0
// @match        https://primera.e-sim.org/*
// @match        https://www.primera.e-sim.org/*
// @grant        GM_notification
// @grant        GM_openInTab
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Manual updater button.
(() => {
  'use strict';
  const UPDATE_URL='https://raw.githubusercontent.com/Danieltv31/Dane/master/primera-battle-sentinel/primera_battle_sentinel.user.js';
  const LOCAL_VERSION='3.6.0';
  const parts=v=>String(v||'0').split('.').map(x=>parseInt(x,10)||0);
  function newer(remote,local){const a=parts(remote),b=parts(local),n=Math.max(a.length,b.length);for(let i=0;i<n;i++){const x=a[i]||0,y=b[i]||0;if(x>y)return true;if(x<y)return false}return false}
  function say(msg){const toast=document.getElementById('pbs3-toast');if(toast){toast.textContent=msg;toast.style.display='block';clearTimeout(say.t);say.t=setTimeout(()=>toast.style.display='none',3500)}else console.log('[Battle Sentinel]',msg)}
  async function checkUpdate(btn){
    const old=btn.textContent;btn.disabled=true;btn.textContent='…';
    try{
      const res=await fetch(`${UPDATE_URL}?check=${Date.now()}`,{cache:'no-store'});if(!res.ok)throw Error(`HTTP ${res.status}`);
      const text=await res.text(),m=text.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m);if(!m)throw Error('remote version not found');const remote=m[1].trim();
      if(newer(remote,LOCAL_VERSION)){say(`Update found: v${LOCAL_VERSION} → v${remote}. Opening Tampermonkey installer…`);btn.textContent=`⬆ v${remote}`;const url=`${UPDATE_URL}?install=${Date.now()}`;if(typeof GM_openInTab==='function')GM_openInTab(url,{active:true,insert:true});else window.open(url,'_blank','noopener')}
      else{say(`Battle Sentinel is up to date: v${LOCAL_VERSION}`);btn.textContent='✓ UPDATED';setTimeout(()=>btn.textContent='⬆ UPDATE',2500)}
    }catch(e){console.error('[Battle Sentinel] update check failed',e);say(`Update check failed: ${e.message}`);btn.textContent='⚠ UPDATE';setTimeout(()=>btn.textContent='⬆ UPDATE',2500)}finally{btn.disabled=false;if(btn.textContent==='…')btn.textContent=old}
  }
  function installButton(){if(document.getElementById('pbs3-update'))return true;const head=document.getElementById('pbs3-head');if(!head)return false;const controls=head.lastElementChild||head,btn=document.createElement('button');btn.id='pbs3-update';btn.type='button';btn.textContent='⬆ UPDATE';btn.title=`Force-check GitHub for a newer Battle Sentinel version. Installed: v${LOCAL_VERSION}`;btn.style.cssText='background:#57407c;color:#fff;margin-right:4px;';btn.addEventListener('click',()=>checkUpdate(btn));controls.insertBefore(btn,controls.firstChild);return true}
  if(!installButton()){const timer=setInterval(()=>{if(installButton())clearInterval(timer)},500);setTimeout(()=>clearInterval(timer),30000)}
})();
