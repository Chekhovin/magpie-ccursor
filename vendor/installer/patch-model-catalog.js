import * as acorn from 'acorn';

const START = '/* CURSOR-BYOK-HOOK-START */';
const END = '/* CURSOR-BYOK-HOOK-END */';
const CATALOG_START = '/* MAGPIE-CATALOG-SYNC-1 */';
const CATALOG_END = '/* MAGPIE-CATALOG-SYNC-END */';
const LOADED = 'console.log("[BYOK] Hook loaded, collector="';
const INSERTIONS = [
  ['globalThis.__magpieCcursorConnectMode=newPaths.indexOf("/auth/poll")!==-1;', 'globalThis.__magpieCatalogSync&&globalThis.__magpieCatalogSync.mode();'],
  ['_byokEs.addEventListener("open",function(){', 'globalThis.__magpieCatalogSync&&globalThis.__magpieCatalogSync.open();'],
  ['_byokEs.addEventListener("error",function(){', 'globalThis.__magpieCatalogSync&&globalThis.__magpieCatalogSync.disconnect();'],
];

// Keep the renderer source literal: installer bundling/obfuscation must not rename
// runtime globals or turn a serialized function into a closure over installer code.
const RUNTIME = String.raw`(function __magpieCatalogSyncInstall(g){
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
})(globalThis);`;
const HELPER = CATALOG_START + RUNTIME + CATALOG_END;
const OPTIONS = { ecmaVersion: 'latest', sourceType: 'module' };

function unique(source, text) {
  const index = source.indexOf(text);
  if (index < 0 || source.indexOf(text, index + text.length) !== -1) throw new Error('model-catalog: missing or duplicate hook anchor');
  return index;
}
function bodyOf(payload) {
  const ast = acorn.parse(payload, OPTIONS);
  const expression = ast.body.length === 1 && ast.body[0].expression;
  if (expression?.type !== 'CallExpression' || expression.callee?.type !== 'FunctionExpression'
      || !payload.startsWith('(function(){if(globalThis.__byokReady)return;globalThis.__byokReady=true;')) {
    throw new Error('model-catalog: unsupported renderer hook');
  }
  return expression.callee.body.body;
}
function verify(payload) {
  const body = bodyOf(payload);
  const modeInit = unique(payload, 'var _restSet=new Set(_restPaths);') + 'var _restSet=new Set(_restPaths);'.length;
  if (![true, false].some(value => payload.startsWith(`globalThis.__magpieCcursorConnectMode=${value};`, modeInit))
      || !body.some(node => node.type === 'ExpressionStatement' && node.start === modeInit)) {
    throw new Error('model-catalog: missing connect-mode initialization');
  }
  const start = unique(payload, CATALOG_START), end = unique(payload, CATALOG_END);
  if (payload.slice(start, end + CATALOG_END.length) !== HELPER
      || !body.some(node => node.start === start + CATALOG_START.length && node.end === end)) {
    throw new Error('model-catalog: malformed catalog helper');
  }
  if (unique(payload, LOADED) !== end + CATALOG_END.length) throw new Error('model-catalog: misplaced catalog helper');
  for (const [anchor, addition] of INSERTIONS) {
    if (unique(payload, anchor + addition) < 0) throw new Error('model-catalog: missing lifecycle hook');
    unique(payload, addition);
  }
}

/** Install inside the existing hook and reuse its routes/open/refresh/error lifecycle. */
export function patchModelCatalogHook(payload) {
  bodyOf(payload);
  if (payload.includes('MAGPIE-CATALOG-SYNC') || payload.includes('__magpieCatalogSync')) {
    verify(payload);
    return payload;
  }
  for (const [anchor, addition] of INSERTIONS) {
    const offset = unique(payload, anchor) + anchor.length;
    payload = payload.slice(0, offset) + addition + payload.slice(offset);
  }
  const offset = unique(payload, LOADED);
  payload = payload.slice(0, offset) + HELPER + payload.slice(offset);
  verify(payload);
  return payload;
}
function bounds(source) {
  const start = unique(source, START), end = unique(source, END);
  if (start !== 0 || end <= start) throw new Error('model-catalog: unsupported hook boundaries');
  return { start: START.length, end };
}
export function upgradeModelCatalogHook(source) {
  const { start, end } = bounds(source);
  return source.slice(0, start) + patchModelCatalogHook(source.slice(start, end)) + source.slice(end);
}
/** Even legacy renderers/stubs need the helper installed; no service is a safe runtime no-op. */
export function isModelCatalogCompatible(source) {
  try {
    const { start, end } = bounds(source);
    verify(source.slice(start, end));
    return true;
  } catch { return false; }
}
