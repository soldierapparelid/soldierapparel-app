/* A revision is a notification only. All records still use authenticated RPCs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoldierProductionRevisionSync=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function createRevisionSync(options){
    const {subscribe,refresh,isCurrent,canRefresh,onStatus}=options;
    if([subscribe,refresh,isCurrent,canRefresh,onStatus].some(f=>typeof f!=='function'))throw Error('invalid_sync');
    const delay=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout,now=options.now||Date.now;
    let stopped=false,ready=false,seen=false,revision=-1,pending=false,busy=false,timer=null,off=null,lastStarted=-Infinity,error=null;
    function current(){try{return !stopped&&isCurrent()===true;}catch{return false;}}
    function allowed(){try{return current()&&canRefresh()===true;}catch{return false;}}
    function notify(){if(stopped)return;try{onStatus(Object.freeze({pending,blocked:pending&&!allowed(),error,busy}));}catch{dispose();}}
    function dispose(){if(stopped)return;stopped=true;if(timer!==null)cancel(timer);timer=null;try{off?.();}catch{}off=null;}
    async function perform(manual){
      if(!current()){dispose();return {ok:false,error:'access_denied'};}if(busy||!ready||!manual&&!allowed())return {ok:false,error:'busy'};
      if(timer!==null)cancel(timer);timer=null;const requestedRevision=revision;busy=true;lastStarted=now();error=null;notify();
      let result;
      try{result=await refresh();if(!current()){dispose();return {ok:false,error:'access_denied'};}if(result?.ok===false){error=result.error==='access_denied'?'access_denied':'unavailable';}else{pending=revision!==requestedRevision;error=null;}}
      catch{result={ok:false,error:'unavailable'};if(current())error='unavailable';}
      finally{busy=false;if(current()){notify();if(pending&&!error)schedule();}else dispose();}
      return result||{ok:true};
    }
    function schedule(){
      if(!current()){dispose();return;}if(!ready||!pending||busy||timer!==null||error||!allowed()){notify();return;}
      timer=delay(async()=>{
        timer=null;if(!current()){dispose();return;}if(!pending||!allowed()){notify();return;}
        await perform(false);
      },Math.max(1000,15000-(now()-lastStarted)));
    }
    function signal(value){
      if(!current()){dispose();return;}
      if(!Number.isSafeInteger(value)||value<0||(seen&&value<revision)){error='unavailable';notify();return;}
      if(seen&&value===revision)return;
      const hadValue=seen;seen=true;revision=value;
      // Subscribe before the first data read. If the initial notification is
      // delayed until after that read, refresh once to close the missed-update race.
      if(hadValue||ready)pending=true;
      if(error!=='access_denied')error=null;schedule();
    }
    function failed(code){if(!current()){dispose();return;}error=code==='access_denied'?'access_denied':'unavailable';notify();}
    off=subscribe(signal,failed);if(typeof off!=='function'){dispose();throw Error('invalid_sync');}if(stopped)off();
    return Object.freeze({ready(){if(stopped)return;ready=true;schedule();},resume(){if(stopped)return;schedule();},refreshNow:()=>perform(true),dispose});
  }
  return Object.freeze({createRevisionSync});
});
