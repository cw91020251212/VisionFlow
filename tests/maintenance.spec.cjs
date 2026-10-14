const {test,expect}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const {fixtureServer,offlineReady}=require('./helpers/sw-fixture.cjs');
const errors=new WeakMap();
test.beforeEach(async({page})=>{const list=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
async function open(page){await page.click('#vf-maintenance');await expect(page.locator('#vf-maintenance-dialog')).toBeVisible();}
function confirmOnce(page,accept){page.once('dialog',dialog=>accept?dialog.accept():dialog.dismiss());}
async function fixture(page,body){const server=await fixtureServer();try{await offlineReady(page,server.url);await body(server);}finally{await page.goto('about:blank');await server.close();}}
async function seed(page){await page.evaluate(()=>{addShape('rect');performQuickSave();localStorage.setItem(DRAFT_KEY+'-backup-before-v2','legacy backup');localStorage.setItem('formlab.projects','other design');});}
async function awaitReload(page){await page.waitForURL(url=>url.searchParams.has('vf-refresh'));await page.waitForFunction(()=>typeof maintenanceBusy==='boolean'&&!maintenanceBusy);}

test('versioned scripts and worker match; maintenance entry and backup are usable without deleting data',async({page})=>{
 await page.goto('/');await seed(page);const original=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));await open(page);
 await expect(page.locator('#vf-maintenance-version')).toHaveText('maintenance-controls-v2');
 const version=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8').match(/const APP_VERSION = '([^']+)'/)[1];
 const scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>new URL(n.src).searchParams.get('v')));expect(scripts.every(value=>value===version)).toBe(true);
 const download=page.waitForEvent('download');await page.click('#vf-maintenance-backup');expect(fs.readFileSync(await(await download).path(),'utf8')).toBe(original);
 expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(original);
});
for(const factory of [false,true])test(`cancel ${factory?'factory restore':'cache cleanup'} leaves draft and cache intact`,async({page})=>{
 await fixture(page,async()=>{await seed(page);const before=await page.evaluate(async()=>({draft:localStorage.getItem(DRAFT_KEY),cache:await caches.keys()}));await open(page);confirmOnce(page,false);await page.click(factory?'#vf-maintenance-factory':'#vf-maintenance-clear');await expect(page.locator('#vf-maintenance-result')).toContainText('已取消');expect(await page.evaluate(async()=>({draft:localStorage.getItem(DRAFT_KEY),cache:await caches.keys()}))).toEqual(before);});
});
test('factory restore clears own draft/backup and obsolete caches, keeps other app data and registration; unload cannot write old design back',async({page})=>{
 await fixture(page,async server=>{await seed(page);await page.evaluate(async()=>{
  await navigator.serviceWorker.register('/other/sw.js',{scope:'/other/'});
  const scope=editorScope().href;const cache=await caches.open('visionflow-app:'+encodeURIComponent(scope)+':obsolete');await cache.put(scope+'obsolete.js',new Response('old'));
  const foreign=await caches.open('formlab-app');await foreign.put(new URL('/other/data',location.href),new Response('keep'));
  const legacy=await caches.open('visionflow-legacy-mixed');await legacy.put(scope+'old.js',new Response('remove'));await legacy.put(new URL('/other/old.js',location.href),new Response('keep'));
 });await open(page);confirmOnce(page,true);await page.click('#vf-maintenance-factory');await awaitReload(page);
 expect(await page.evaluate(()=>({items:items.length,draft:localStorage.getItem(DRAFT_KEY),backup:localStorage.getItem(DRAFT_KEY+'-backup-before-v2'),other:localStorage.getItem('formlab.projects')}))).toEqual({items:0,draft:null,backup:null,other:'other design'});
 const values=await page.evaluate(async()=>({foreign:await(await caches.open('formlab-app')).match(new URL('/other/data',location.href)).then(r=>r.text()),legacy:(await(await caches.open('visionflow-legacy-mixed')).keys()).map(r=>r.url),obsolete:(await caches.keys()).some(n=>n.endsWith(':obsolete')),registered:(await navigator.serviceWorker.getRegistrations()).some(r=>r.scope===new URL('/other/',location.href).href)}));
 expect(values.foreign).toBe('keep');expect(values.legacy).toHaveLength(1);expect(values.legacy[0]).toContain('/other/old.js');expect(values.obsolete).toBe(false);expect(values.registered).toBe(true);
 await page.waitForTimeout(500);expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBeNull();
 });
});
test('factory restore handles protected unknown draft after explicit confirmation',async({page})=>{
 await fixture(page,async()=>{await page.evaluate(()=>{clearTimeout(appearanceAutosaveTimer);localStorage.setItem(DRAFT_KEY,'{"version":999}');localStorage.setItem(DRAFT_KEY+'-backup-before-v2','damaged backup');});await page.reload();await page.waitForFunction(()=>draftRecoveryBlocked);await open(page);confirmOnce(page,true);await page.click('#vf-maintenance-factory');await awaitReload(page);expect(await page.evaluate(()=>({blocked:draftRecoveryBlocked,draft:localStorage.getItem(DRAFT_KEY),backup:localStorage.getItem(DRAFT_KEY+'-backup-before-v2')}))).toEqual({blocked:false,draft:null,backup:null});});
});
test('cache cleanup saves live design, reloads fresh shell and preserves backup and other app keys',async({page})=>{
 await fixture(page,async server=>{await seed(page);await page.evaluate(()=>items[0].color='#aabbcc');server.state.version='v2';await open(page);confirmOnce(page,true);await page.click('#vf-maintenance-clear');await awaitReload(page);expect(await page.evaluate(()=>({version:fixtureShellVersion,items:items.length,color:items[0].color,backup:localStorage.getItem(DRAFT_KEY+'-backup-before-v2'),other:localStorage.getItem('formlab.projects')}))).toEqual({version:'v2',items:1,color:'#aabbcc',backup:'legacy backup',other:'other design'});});
});
test('network preflight failure leaves all data and registrations intact',async({page})=>{
 await fixture(page,async server=>{await seed(page);server.state.networkFailure=true;const saved=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));await open(page);confirmOnce(page,true);await page.click('#vf-maintenance-factory');await expect(page.locator('#vf-maintenance-result')).toContainText('維護未完成');expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(saved);expect(await page.evaluate(()=>navigator.serviceWorker.getRegistration().then(Boolean))).toBe(true);});
});
test('cache cleanup refuses storage failure rather than reloading unsaved design',async({page})=>{
 await fixture(page,async()=>{await seed(page);const saved=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));await page.evaluate(()=>{window.realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new Error('full');};});await open(page);confirmOnce(page,true);await page.click('#vf-maintenance-clear');await expect(page.locator('#vf-maintenance-result')).toContainText('未清理');expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(saved);expect(page.url()).not.toContain('vf-refresh');await page.evaluate(()=>Storage.prototype.setItem=window.realSetItem);});
});
for(const factory of [false,true])test(`other editor tab blocks ${factory?'factory restore':'cache cleanup'} without affecting either tab`,async({page,context})=>{
 await fixture(page,async server=>{await seed(page);const other=await context.newPage();try{await other.goto(server.url);await open(page);const saved=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));confirmOnce(page,true);await page.click(factory?'#vf-maintenance-factory':'#vf-maintenance-clear');await expect(page.locator('#vf-maintenance-result')).toContainText('關閉其他');expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(saved);expect(page.url()).not.toContain('vf-refresh');expect(other.url()).not.toContain('vf-refresh');}finally{await other.close();}});
});
test('unfinished gesture refuses cleanup before confirmation or data changes',async({page})=>{
 await page.goto('/');await seed(page);await page.evaluate(()=>isMarquee=true);await open(page);await page.click('#vf-maintenance-factory');await expect(page.locator('#vf-maintenance-result')).toContainText('完成或取消');await page.evaluate(()=>isMarquee=false);expect(await page.evaluate(()=>items.length)).toBe(1);
});
test('failed second key deletion rolls original draft and backup back byte-for-byte',async({page})=>{
 await page.goto('/');await seed(page);const result=await page.evaluate(()=>{const before=[localStorage.getItem(DRAFT_KEY),localStorage.getItem(DRAFT_KEY+'-backup-before-v2')];const remove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(key.endsWith('backup-before-v2'))throw new Error('denied');return remove.call(this,key);};let message;try{removeEditorDrafts();}catch(error){message=error.message;}finally{Storage.prototype.removeItem=remove;}return{before,after:[localStorage.getItem(DRAFT_KEY),localStorage.getItem(DRAFT_KEY+'-backup-before-v2')],message};});expect(result.after).toEqual(result.before);expect(result.message).toContain('原始資料已回復');
});
test('manual check with no new worker does not navigate, clear or modify design',async({page})=>{
 await fixture(page,async()=>{await seed(page);await open(page);const saved=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));await page.click('#vf-maintenance-check');await expect(page.locator('#vf-maintenance-result')).toContainText('未發現');expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(saved);expect(page.url()).not.toContain('vf-refresh');});
});
test('manual check detects new complete version and dialog apply saves and switches shell',async({page})=>{
 await fixture(page,async server=>{await seed(page);server.state.version='v2';await open(page);await page.click('#vf-maintenance-check');await expect(page.locator('#vf-maintenance-result')).toContainText('完整下載');await expect(page.locator('#vf-maintenance-apply')).toBeVisible();expect(await page.evaluate(()=>fixtureShellVersion)).toBe('v1');await page.click('#vf-maintenance-apply');await page.waitForFunction(()=>fixtureShellVersion==='v2');expect(await page.evaluate(()=>items.length)).toBe(1);});
});
test('manual check rejects incomplete newer shell, retaining usable current cache',async({page,context})=>{
 await fixture(page,async server=>{server.state.version='broken';server.state.missing=true;await open(page);await page.click('#vf-maintenance-check');await expect(page.locator('#vf-maintenance-result')).toContainText('未完成');expect(await page.evaluate(()=>fixtureShellVersion)).toBe('v1');await context.setOffline(true);try{await page.reload();await page.waitForFunction(()=>fixtureShellVersion==='v1');}finally{await context.setOffline(false);}});
});

test('dialog update blocked by another tab can retry immediately after that tab closes',async({page,context})=>{
 await fixture(page,async server=>{await seed(page);server.state.version='v2';await open(page);await page.click('#vf-maintenance-check');await expect(page.locator('#vf-maintenance-apply')).toBeVisible();const other=await context.newPage();try{await other.goto(server.url);await page.click('#vf-maintenance-apply');await expect(page.locator('#status-text')).toContainText('關閉其他');await expect(page.locator('#vf-maintenance-apply')).toBeEnabled();await other.close();await page.click('#vf-maintenance-apply');await page.waitForFunction(()=>fixtureShellVersion==='v2');}finally{if(!other.isClosed())await other.close();}});
});
test('offline cleanup is refused before cache or draft deletion',async({page,context})=>{
 await fixture(page,async()=>{await seed(page);const before=await page.evaluate(async()=>({draft:localStorage.getItem(DRAFT_KEY),cache:await caches.keys()}));await context.setOffline(true);try{await open(page);confirmOnce(page,true);await page.click('#vf-maintenance-factory');await expect(page.locator('#vf-maintenance-result')).toContainText('連上網路');expect(await page.evaluate(async()=>({draft:localStorage.getItem(DRAFT_KEY),cache:await caches.keys()}))).toEqual(before);}finally{await context.setOffline(false);}});
});

test('maintenance dialog keyboard shortcuts cannot delete or undo canvas design',async({page})=>{
 await page.goto('/');await seed(page);await open(page);const before=await page.evaluate(()=>JSON.stringify(collectCanvasData()));await page.keyboard.press('Delete');await page.keyboard.press('Control+z');await page.keyboard.press('s');expect(await page.evaluate(()=>JSON.stringify(collectCanvasData()))).toBe(before);await page.keyboard.press('Escape');await expect(page.locator('#vf-maintenance-dialog')).not.toBeVisible();
});

async function suspendInput(page,kind){
 if(kind==='import')await page.evaluate(()=>{window.realPrepare=VFFolder.prepare;window.releaseInput=null;VFFolder.prepare=(...args)=>new Promise(resolve=>{window.releaseInput=()=>resolve(window.realPrepare(...args));});void loadSelectedFiles([new File(['<button id="new">新匯入內容</button>'],'new.html',{type:'text/html'})]);});
 else {await page.evaluate(()=>{window.realBackgroundReader=readBackgroundFile;window.releaseInput=null;readBackgroundFile=(...args)=>new Promise(resolve=>{window.releaseInput=()=>resolve(window.realBackgroundReader(...args));});});await page.setInputFiles('#bg-image-file',path.join(__dirname,'../icon-192.png'));}
 await page.waitForFunction(()=>hasPendingEditorInput()&&!!window.releaseInput);
}
async function finishInput(page,kind){await page.evaluate(kind=>{window.releaseInput();if(kind==='import')VFFolder.prepare=window.realPrepare;else readBackgroundFile=window.realBackgroundReader;},kind);await page.waitForFunction(()=>!hasPendingEditorInput());}
for(const kind of ['import','image'])for(const operation of ['clear','update'])test(`pending ${kind} survives ${operation} request and operation waits without changing cancellation sequence`,async({page})=>{
 await fixture(page,async server=>{await seed(page);if(operation==='update'){server.state.version='v2';await page.evaluate(()=>editorRegistration.update());await expect(page.locator('#vf-update-app')).toBeVisible();}
 await suspendInput(page,kind);const before=await page.evaluate(()=>({importSequence:importRequestSequence,backgroundSequence:backgroundRequestSequence,stored:localStorage.getItem(DRAFT_KEY)}));
 if(operation==='clear'){await open(page);await page.click('#vf-maintenance-clear');await expect(page.locator('#vf-maintenance-result')).toContainText('尚未完成');}
 else{await page.click('#vf-update-app');await expect(page.locator('#status-text')).toContainText('尚未完成');}
 expect(await page.evaluate(()=>({importSequence:importRequestSequence,backgroundSequence:backgroundRequestSequence,stored:localStorage.getItem(DRAFT_KEY)}))).toEqual(before);expect(page.url()).not.toContain('vf-refresh');expect(await page.evaluate(()=>fixtureShellVersion)).toBe('v1');
 await finishInput(page,kind);if(kind==='import')expect(await page.evaluate(()=>appearanceSource.htmlFile)).toBe('new.html');else expect(await page.evaluate(()=>items[0].backgroundImage)).toContain('data:image/png;base64,');
 if(operation==='update'){await page.click('#vf-update-app');await page.waitForFunction(()=>fixtureShellVersion==='v2');}
 });
});
test('explicitly cancelled pending upload does not keep maintenance blocked forever',async({page})=>{
 await fixture(page,async()=>{await seed(page);await suspendInput(page,'image');await page.evaluate(()=>cancelBackgroundUpload());expect(await page.evaluate(()=>hasPendingEditorInput())).toBe(false);await open(page);confirmOnce(page,true);await page.click('#vf-maintenance-clear');await awaitReload(page);expect(await page.evaluate(()=>items.length)).toBe(1);});
});
test('confirmed factory restore is allowed to discard a still-pending upload',async({page})=>{
 await fixture(page,async()=>{await seed(page);await suspendInput(page,'image');await open(page);confirmOnce(page,true);await page.click('#vf-maintenance-factory');await awaitReload(page);expect(await page.evaluate(()=>({items:items.length,draft:localStorage.getItem(DRAFT_KEY)}))).toEqual({items:0,draft:null});});
});
