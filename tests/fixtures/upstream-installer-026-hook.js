(function(){if(globalThis.__byokReady)return;globalThis.__byokReady=true;var _hasGlass=true;var _q=globalThis.__byokQueue=[];var _collectorUrl="http://127.0.0.1:14800";var _byokUrl="http://127.0.0.1:39831";var _sending=false;var _down=false;var _restPaths=["/auth/full_stripe_profile","/auth/stripe_profile"];var _restSet=new Set(_restPaths);globalThis.__magpieCcursorConnectMode=true;function __byokLog(e){if(_down)return;e._t=Date.now();_q.push(e);if(!_sending)_flush()}function _flush(){if(_down||!_q.length){_sending=false;return}_sending=true;var batch=_q.splice(0,50);fetch(_collectorUrl+"/hook",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(batch)}).then(function(){}).catch(function(){_down=true;_q.length=0;console.warn("[BYOK] Collector not reachable at "+_collectorUrl+", logging disabled for this session")}).finally(function(){if(!_down)setTimeout(_flush,100);else _sending=false})}function __byokMsgToJson(e){if(!e)return null;try{if(typeof e.toJson==="function")return e.toJson()}catch(x){}try{if(typeof e.toJsonString==="function")return JSON.parse(e.toJsonString())}catch(x){}return e}function __byokHeadersToObj(e){if(!e)return{};try{if(e instanceof Headers)return Object.fromEntries(e)}catch(x){}return typeof e==="object"?e:{}}function __byokCloneBody(r){if(!r.body)return Promise.resolve(null);try{return r.clone().text()}catch(e){return Promise.resolve(null)}}function __byokInjectWid(hdrs){var wid=typeof window!=="undefined"&&window.vscodeWindowId;if(typeof wid!=="number")return hdrs;var widStr=String(wid);try{if(hdrs&&typeof hdrs.set==="function"){hdrs.set("x-client-wid",widStr);return hdrs}if(hdrs&&typeof hdrs==="object"&&!Array.isArray(hdrs)){hdrs["x-client-wid"]=widStr;return hdrs}if(Array.isArray(hdrs)){hdrs.push(["x-client-wid",widStr]);return hdrs}}catch(e){}var h=new Headers();h.set("x-client-wid",widStr);return h}globalThis.__byokWrapTransport=function(t,n){return{unary:async function(e,r,i,o,s,a,c){s=__byokInjectWid(s);var u=Math.random().toString(36).slice(2,10),l=Date.now();__byokLog({type:"unary_req",id:u,svc:e.typeName,mtd:r.name,hdr:__byokHeadersToObj(s),msg:__byokMsgToJson(a)});try{var d=await t.unary(e,r,i,o,s,a,c);__byokLog({type:"unary_res",id:u,dur:Date.now()-l,svc:e.typeName,mtd:r.name,msg:__byokMsgToJson(d.message)});return d}catch(d){__byokLog({type:"unary_err",id:u,dur:Date.now()-l,svc:e.typeName,mtd:r.name,err:d?.message||String(d),code:d?.code});throw d}},stream:async function(e,r,i,o,s,a,c){s=__byokInjectWid(s);var u=Math.random().toString(36).slice(2,10),l=Date.now();__byokLog({type:"stream_req",id:u,svc:e.typeName,mtd:r.name,hdr:__byokHeadersToObj(s)});var f=(async function*(){var t=0;for await(var n of a){__byokLog({type:"stream_in",id:u,svc:e.typeName,mtd:r.name,idx:t++,msg:__byokMsgToJson(n)});yield n}})();try{var d=await t.stream(e,r,i,o,s,f,c),h=d.message;d.message=(async function*(){var t=0;for await(var n of h){__byokLog({type:"stream_out",id:u,svc:e.typeName,mtd:r.name,idx:t++,msg:__byokMsgToJson(n)});yield n}__byokLog({type:"stream_end",id:u,dur:Date.now()-l,svc:e.typeName,mtd:r.name,chunks:t})})();return d}catch(d){__byokLog({type:"stream_err",id:u,dur:Date.now()-l,svc:e.typeName,mtd:r.name,err:d?.message||String(d),code:d?.code});throw d}}}};if(_restPaths.length>0){var _origFetch=globalThis.fetch;globalThis.fetch=function(){var args=Array.prototype.slice.call(arguments);var urlArg=args[0];var u=typeof urlArg==="string"?urlArg:(urlArg instanceof Request?urlArg.url:"");var init=args[1]||{};for(var i=0;i<_restPaths.length;i++){if(u.indexOf(_restPaths[i])!==-1){var id=Math.random().toString(36).slice(2,10);var ts=Date.now();var reqMethod=init.method||(urlArg instanceof Request?urlArg.method:"GET")||"GET";var reqHeaders=__byokHeadersToObj(urlArg instanceof Request?urlArg.headers:init.headers);var reqBody=urlArg instanceof Request&&urlArg.body?urlArg.body:(init.body||null);var path=_restPaths[i];var newUrl=_byokUrl+(u.match(/^https?:\/\/[^/]*/)?u.replace(/^https?:\/\/[^/]*/,""):"/");__byokLog({type:"rest_redirect",id:id,path:path,originalUrl:u,redirectUrl:newUrl,method:reqMethod,reqHeaders:reqHeaders,reqBody:reqBody});var newInit=Object.assign({},init);newInit.headers=__byokInjectWid(newInit.headers);var newArgs=[newUrl,newInit];for(var j=2;j<args.length;j++)newArgs.push(args[j]);return _origFetch.apply(globalThis,newArgs).then(function(resp){var r=resp.clone();__byokLog({type:"rest_response",id:id,path:path,status:r.status,resHeaders:__byokHeadersToObj(r.headers)});__byokCloneBody(r).then(function(text){if(text){__byokLog({type:"rest_body",id:id,path:path,body:text})}}).catch(function(){});return resp}).catch(function(err){__byokLog({type:"rest_error",id:id,path:path,error:err?.message||String(err)});throw err})}}if(u.indexOf(_byokUrl)===0){var nInit=Object.assign({},init);nInit.headers=__byokInjectWid(nInit.headers);var nArgs=[urlArg,nInit];for(var k=2;k<args.length;k++)nArgs.push(args[k]);return _origFetch.apply(globalThis,nArgs)}return _origFetch.apply(globalThis,arguments)}}globalThis.__byokRefreshModels=function(){if(globalThis.__byokAiSvc&&typeof globalThis.__byokAiSvc.refreshDefaultModels==="function"){try{var p=globalThis.__byokAiSvc.refreshDefaultModels();console.log("[BYOK] refreshDefaultModels() invoked via captured aiService ref");if(p&&typeof p.then==="function")p.catch(function(e){console.warn("[BYOK] refreshDefaultModels failed:",e&&e.message||e)});return"service"}catch(e){console.warn("[BYOK] refreshDefaultModels threw:",e&&e.message||e)}}var btn=document.querySelector('[title="Refresh model list"]');if(btn&&typeof btn.click==="function"){btn.click();console.log("[BYOK] refresh triggered via DOM click fallback");return"click"}console.warn("[BYOK] no refresh mechanism available (aiService not captured, picker not visible)");return"none"};try{var _byokEs=new EventSource(_byokUrl+"/byok/events");_byokEs.addEventListener("open",function(){globalThis.__magpieCatalogSync&&globalThis.__magpieCatalogSync.open();globalThis.__byokGlassStatus&&globalThis.__byokGlassStatus(true,_restPaths.length>2)});_byokEs.addEventListener("refresh",function(){console.log("[BYOK] refresh event received");globalThis.__byokRefreshModels&&globalThis.__byokRefreshModels()});_byokEs.addEventListener("routes",function(ev){try{var newPaths=JSON.parse(ev.data);_restPaths=newPaths;_restSet=new Set(newPaths);globalThis.__magpieCcursorConnectMode=newPaths.indexOf("/auth/poll")!==-1;globalThis.__magpieCatalogSync&&globalThis.__magpieCatalogSync.mode();console.log("[BYOK] REST redirects hot-reloaded: "+newPaths.length+" paths");globalThis.__byokGlassStatus&&globalThis.__byokGlassStatus(void 0,newPaths.length>2)}catch(e){console.warn("[BYOK] routes event parse failed:",e&&e.message||e)}});_byokEs.addEventListener("error",function(){globalThis.__magpieCatalogSync&&globalThis.__magpieCatalogSync.disconnect();globalThis.__byokGlassStatus&&globalThis.__byokGlassStatus(false,void 0)})}catch(e){console.warn("[BYOK] EventSource init failed:",e&&e.message||e)}(function(){if(!document.body)return;var _prObs=new MutationObserver(function(){var inp=document.querySelector('input[placeholder="Search models"]');if(!inp)return;var wrap=inp.closest(".ui-input-group");if(!wrap||wrap.querySelector("#byok-refresh-btn"))return;var btn=document.createElement("button");btn.type="button";btn.id="byok-refresh-btn";var _rDonor=_hasGlass?document.querySelector("button.ui-icon-button"):null;btn.className=_rDonor?_rDonor.className:"ui-icon-button";btn.dataset.variant="default";btn.dataset.size="sm";btn.setAttribute("aria-label","Refresh Models");btn.style.cssText="margin-right:4px;flex-shrink:0;cursor:pointer;";btn.textContent="\u21BB";btn.addEventListener("click",function(ev){ev.stopPropagation();globalThis.__byokRefreshModels&&globalThis.__byokRefreshModels();console.log("[BYOK] manual refresh from picker")});wrap.appendChild(btn)});_prObs.observe(document.body,{childList:true,subtree:true})})();(function(){var _bEl=null,_bTip=null,_bSrv=false,_bMode=false;function _bCreate(){var e=document.createElement("button");e.type="button";e.className="ui-icon-button";e.dataset.variant="default";e.dataset.size="lg";e.id="byok-glass-status";if(_hasGlass){var donor=document.querySelector("button.ui-icon-button");if(donor){e.className=donor.className}else{e.className="ui-icon-button"}e.style.cssText="width:auto;min-width:auto;font-size:10px;gap:2px;white-space:nowrap;"}else{e.className="ui-icon-button";e.dataset.variant="default";e.dataset.size="lg";e.style.cssText="font-size:11px;gap:3px;width:auto;white-space:nowrap;"}e.addEventListener("click",function(){fetch(_byokUrl+"/byok/toggle",{method:"POST"}).then(function(r){return r.json()}).then(function(d){console.log("[BYOK] toggle \u2192",d.byokMode?"ON":"OFF")}).catch(function(e){console.warn("[BYOK] toggle failed:",e&&e.message||e)})});e.addEventListener("mouseenter",function(){_bShowTip()});e.addEventListener("mouseleave",function(){_bHideTip()});return e}function _bShowTip(){if(_bTip||!_bEl)return;var t=document.createElement("div");t.className="ui-tooltip";t.setAttribute("role","tooltip");t.style.cssText="position:fixed;z-index:99999;pointer-events:none;box-sizing:border-box;width:max-content;max-width:320px;background:var(--cursor-bg-elevated);color:var(--cursor-text-primary);border:var(--ui-tooltip-border-width,1px) solid var(--cursor-stroke-primary);border-radius:var(--ui-tooltip-border-radius,var(--cursor-radius-lg));box-shadow:var(--ui-tooltip-box-shadow,var(--cursor-box-shadow-popup));padding:var(--ui-tooltip-padding-y,var(--cursor-spacing-1-5)) var(--ui-tooltip-padding-x,var(--cursor-spacing-2-5));font-size:var(--ui-tooltip-font-size,var(--cursor-font-size-base));line-height:var(--ui-tooltip-line-height,var(--cursor-line-height-base));letter-spacing:var(--ui-tooltip-letter-spacing,var(--cursor-letter-spacing-base));white-space:pre-line;";t.textContent=(_bSrv?"Server online":"Server offline")+" \u00B7 "+(_bMode?"BYOK ON":"BYOK OFF");document.body.appendChild(t);var r=_bEl.getBoundingClientRect();var tw=t.offsetWidth,th=t.offsetHeight;t.style.left=Math.round(r.left+r.width/2-tw/2)+"px";t.style.top=Math.round(r.top-th-6)+"px";_bTip=t}function _bHideTip(){if(_bTip){_bTip.remove();_bTip=null}}function _bRender(){if(!_bEl)return;var icon=_bSrv?"\u2713":"\u2717";var glyph=_bMode?"\u25C9":"\u25CB";_bEl.textContent=icon+" BYOK "+glyph}function _bInject(){if(_bEl&&document.contains(_bEl))return;var footer=document.querySelector('[data-component="glass-sidebar-footer"]');if(footer){var gear=footer.querySelector("button.ui-icon-button");if(gear&&gear.parentElement){_bEl=_bCreate();_bRender();gear.parentElement.insertBefore(_bEl,gear);return}}var trigger=document.querySelector(".glass-sidebar-footer-account-trigger");var endIcon=trigger&&trigger.querySelector(".ui-sidebar-menu-button-end");if(trigger&&endIcon){_bEl=_bCreate();_bRender();trigger.insertBefore(_bEl,endIcon);return}var actOld=document.querySelector(".glass-sidebar-footer-actions-right");if(actOld){_bEl=_bCreate();_bRender();actOld.insertBefore(_bEl,actOld.firstChild)}}if(document.body){var _bObs=new MutationObserver(function(){_bInject()});_bObs.observe(document.body,{childList:true,subtree:true});_bInject()}globalThis.__byokGlassStatus=function(srv,mode){if(srv!==void 0)_bSrv=srv;if(mode!==void 0)_bMode=mode;_bRender()}})();/* MAGPIE-CATALOG-SYNC-1 */(function __magpieCatalogSyncInstall(g){
if(g.__magpieCatalogSync)return;
var records=new Map(),groups=new Map(),epoch=0,connected=true,active=false,lastService=g.__byokAiSvc;
var fallback=g.__byokRefreshModels;
var keys=["availableDefaultModels2","modelPickerDisplayConfiguration","featureModelConfigs"];
function clone(value){
  if(value===null||typeof value!=="object")return value;
  if(value instanceof Uint8Array)return new Uint8Array(value);
  if(Array.isArray(value))return value.map(clone);
  var result={};
  if(typeof value.getType==="function"){
    for(var field of value.getType().fields.byMember()){
      var item=value[field.localName];
      if(field.kind==="oneof")result[field.localName]=field.findField(item.case)?{case:item.case,value:clone(item.value)}:{case:void 0};
      else result[field.localName]=clone(item);
    }
  }else for(var key of Object.keys(value))result[key]=clone(value[key]);
  return result;
}
// Cursor eTk: null competing variants so reactive merge cannot retain an old toggle.
function display(value){
  if(value===void 0)return;
  var result=clone(value);
  for(var key of ["hideSearchBar","hideAddModels","modelSelectionRestrictionMessage"])result[key]=result[key]??null;
  for(var pair of [["routedModelViewConfig",["routedModelViewToNamedViewToggle","routedModelViewToNamedViewButton"]],["namedModelsViewConfig",["namedViewToRoutedModelViewToggle","namedViewToRoutedModelViewButton","namedViewToRoutedModelViewNoButton"]]]){
    var config=result[pair[0]];
    if(config!==void 0){var selected=pair[1].find(function(name){return config[name]!==void 0});if(selected)for(var name of pair[1])if(name!==selected)config[name]=null;}
  }
  return result;
}
function read(group){var state=group.storage.applicationUserPersistentStorage;return keys.map(function(key){return clone(state[key])});}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
// Solid's store setter shallow-merges objects. Explicit undefined fields remove
// only stale catalog members, including when restoring an older baseline.
function setValue(group,index,value){
  var next=clone(value),current=group.storage.applicationUserPersistentStorage[keys[index]];
  if(next&&typeof next==="object"&&!Array.isArray(next)&&current&&typeof current==="object"){
    for(var key of Object.keys(current))if(!Object.prototype.hasOwnProperty.call(next,key))next[key]=void 0;
  }
  group.storage.setApplicationUserPersistentStorage(keys[index],next);
}
function setModels(group,service,models){
  service.persistAvailableDefaultModels(clone(models));
  // Cursor's own-key cache may skip an unchanged serialized value even after
  // another window replaced reactive state. Update that state explicitly too.
  if(!equal(group.storage.applicationUserPersistentStorage[keys[0]],models))setValue(group,0,models);
}
function notify(group){
  for(var record of group.records){
    var service=record.service;
    if(typeof service._modelConfigService?.triggerParameterizedModelConfigMigration==="function")service._modelConfigService.triggerParameterizedModelConfigMigration();
    if(typeof service._aiSettingsService?.handleAvailableModelsChange==="function")service._aiSettingsService.handleAvailableModelsChange();
  }
}
function apply(group){
  if(!active||!group.snapshot||group.writing)return;
  var current=read(group),snapshot=group.snapshot;
  if(equal(current,snapshot.values))return;
  group.writing=true;
  try{
    if(!equal(current[0],snapshot.values[0]))setModels(group,snapshot.service,snapshot.values[0]);
    if(!equal(current[1],snapshot.values[1]))setValue(group,1,snapshot.values[1]);
    if(!equal(current[2],snapshot.values[2]))setValue(group,2,snapshot.values[2]);
    notify(group);
  }finally{group.writing=false;}
}
function watch(group){
  if(group.observer)return;
  group.baseline=read(group);
  group.observer=group.storage.onChangeEffectManuallyDisposed({
    deps:keys.map(function(key){return function(){return JSON.stringify(group.storage.applicationUserPersistentStorage[key])}}),
    onChange:function(){
      if(!active||group.writing||group.queued)return;
      group.queued=true;
      var ticket=epoch;
      Promise.resolve().then(function(){group.queued=false;if(active&&ticket===epoch){try{apply(group)}catch(e){group.status="apply-failed"}}});
    }
  });
}
function nativeRefresh(record){
  try{return Promise.resolve(record.native.call(record.service)).catch(function(){record.status="native-refresh-failed"})}
  catch(e){record.status="native-refresh-failed";return Promise.resolve();}
}
function sync(record,force){
  if(!active)return nativeRefresh(record);
  if(!force&&record.pending&&record.epoch===epoch)return record.pending;
  var group=record.group,ticket=epoch,request=++group.request;
  record.epoch=ticket;record.status="loading";
  var pending=Promise.resolve().then(async function(){
    try{
      if(!active||ticket!==epoch)return;
      var client=await record.service.aiClient();
      if(!active||ticket!==epoch)return;
      var fromBridge=false;
      var response=await client.availableModels({useModelParameters:true,useReactModelPicker:true},{onHeader:function(headers){fromBridge=headers.get("x-magpie-ccursor-catalog")==="1"}});
      if(!active||ticket!==epoch)return;
      if(request!==group.request){if(record.pending===pending)record.status="superseded";return;}
      if(!fromBridge||!response||!Array.isArray(response.models)||response.displayConfiguration?.routedModelViewConfig?.hideRoutedModelView!==true)throw new Error("BYOK catalog not ready");
      var models=response.models.map(clone),normalizedDisplay=display(response.displayConfiguration);
      // Capture the feature mapping through Cursor's own method (including its defaults).
      // All three values come from this response, never lastBackendCatalog or disk state.
      var before=read(group);
      group.writing=true;
      try{
        setModels(group,record.service,models);
        setValue(group,1,normalizedDisplay);
        record.service.persistFeatureModelConfigs(response);
        group.snapshot={service:record.service,values:[models,normalizedDisplay,clone(group.storage.applicationUserPersistentStorage.featureModelConfigs)]};
      }catch(e){
        try{setModels(group,record.service,before[0]);for(var i=1;i<keys.length;i++)setValue(group,i,before[i]);}
        catch(rollbackError){group.status="rollback-failed";}
        throw e;
      }finally{group.writing=false;}
      notify(group);record.status="ready";group.status="ready";
    }catch(e){if(active&&ticket===epoch&&request===group.request){record.status="fetch-or-apply-failed";if(group.status!=="rollback-failed")group.status="fetch-or-apply-failed";}}
    finally{if(record.pending===pending)record.pending=null;}
  });
  record.pending=pending;return pending;
}
function register(service){
  if(!service||records.has(service))return;
  var storage=service._reactiveStorageService;
  if(!storage||typeof storage.setApplicationUserPersistentStorage!=="function"||typeof storage.onChangeEffectManuallyDisposed!=="function"||typeof service.aiClient!=="function"||typeof service.persistAvailableDefaultModels!=="function"||typeof service.persistFeatureModelConfigs!=="function"||typeof service.refreshDefaultModels!=="function")return;
  var group=groups.get(storage);
  if(!group){group={storage:storage,records:[],request:0,status:"idle",writing:false};groups.set(storage,group);}
  var record={service:service,group:group,native:service.refreshDefaultModels,status:"idle",epoch:-1};
  records.set(service,record);group.records.push(record);
  service.refreshDefaultModels=function(){return active?sync(record):record.native.apply(this,arguments)};
  if(active){watch(group);sync(record);}
}
function refresh(){
  if(!records.size)return active?"none":fallback&&fallback();
  for(var record of records.values())sync(record,true);
  return "service";
}
function mode(){
  var next=connected&&g.__magpieCcursorConnectMode===true;
  if(next===active){if(active)refresh();return;}
  active=next;epoch++;
  if(active){for(var group of groups.values())watch(group);refresh();}
  else{
    for(var group of groups.values()){
      if(group.observer){group.observer.dispose();group.observer=null;}
      group.snapshot=null;group.request++;group.status="inactive";
      if(group.baseline){
        var values=group.baseline;group.baseline=null;
        try{setModels(group,group.records[0].service,values[0]);for(var i=1;i<keys.length;i++)setValue(group,i,values[i]);notify(group);}
        catch(e){group.status="restore-failed";}
      }
    }
    for(var record of records.values()){record.status="inactive";nativeRefresh(record);}
  }
}
g.__magpieCatalogSync={version:1,mode:mode,open:function(){connected=true;mode();},disconnect:function(){connected=false;mode();},refresh:refresh,
  status:function(){return {active:active,epoch:epoch,services:Array.from(records.values(),function(record){return {state:record.status,catalogState:record.group.status,modelCount:record.group.snapshot?.values[0].length}})}}};
Object.defineProperty(g,"__byokAiSvc",{configurable:true,enumerable:true,get:function(){return lastService},set:function(service){lastService=service;register(service)}});
g.__byokRefreshModels=refresh;
active=connected&&g.__magpieCcursorConnectMode===true;
register(lastService);
})(globalThis);/* MAGPIE-CATALOG-SYNC-END */console.log("[BYOK] Hook loaded, collector="+_collectorUrl+", byok="+_byokUrl+", REST redirects="+_restPaths.length)})()