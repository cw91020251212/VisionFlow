const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..');
const source='<!doctype html><style>button{width:100px;height:80px}</style><button id="a">原有文字</button><script>window.businessRan=true</script>';
const errors=new WeakMap();
test.beforeEach(async({page})=>{const list=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
async function loadSource(page){await page.goto('/');await page.setInputFiles('#file-input',{name:'index.html',mimeType:'text/html',buffer:Buffer.from(source)});await page.waitForFunction(()=>isIframeLoaded);await page.evaluate(()=>{selectImported(importedFrame.contentDocument.getElementById('a'));const input=document.getElementById('iborderRadius');input.value='18';updateImported({target:input,type:'change'},true);});}
async function nativeMock(page,error){await page.evaluate(error=>{window.shared=[];Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.shared.push({title:payload.title,text:payload.text,files:await Promise.all(payload.files.map(async f=>({name:f.name,type:f.type,text:await f.text()})))});if(error)throw new DOMException('test rejected',error);}});},error);}

test('prepared resources list external base/src/poster/srcset/CSS while never fetching; local data URLs stay self-contained',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  let fetches=0;const originalFetch=window.fetch;window.fetch=()=>{fetches++;throw new Error('no remote fetching');};
  const data=[['site/index.html','<!doctype html><link rel="stylesheet" href="css/main.css"><link rel="stylesheet" href="https://cdn.example/main.css"><img src="img/icon.svg" srcset="https://cdn.example/one.png 1x, //cdn.example/two.png 2x"><video poster="https://cdn.example/poster.jpg"></video><script src="https://cdn.example/a.js"></script>','text/html'],['site/css/main.css','@import "nested.css";@import "https://cdn.example/reset.css";body{background:url(https://cdn.example/bg.png)}/* url(https://ignored.example/comment) */p::after{content:"url(https://ignored.example/string)"}','text/css'],['site/css/nested.css','@font-face{font-family:demo;src:url(https://cdn.example/f.woff2)}','text/css'],['site/img/icon.svg','<svg xmlns="http://www.w3.org/2000/svg"></svg>','image/svg+xml']].map(([name,text,type])=>{const file=new File([text],name.split('/').at(-1),{type});Object.defineProperty(file,'webkitRelativePath',{value:name});return file;});
  try{const prepared=await VFFolder.prepare(data);return{...prepared,fetches};}finally{window.fetch=originalFetch;}
 });
 expect(result.fetches).toBe(0);expect(result.html).toContain('data:image/svg+xml;base64,');expect(result.externalResources.map(r=>r.url)).toEqual(expect.arrayContaining(['https://cdn.example/main.css','https://cdn.example/reset.css','https://cdn.example/bg.png','https://cdn.example/f.woff2','https://cdn.example/poster.jpg','https://cdn.example/a.js','https://cdn.example/one.png','https://cdn.example/two.png']));expect(result.externalResources.some(r=>r.url.includes('ignored.example'))).toBe(false);
 const bases=await page.evaluate(()=>VFFolder.describe('<base href="https://remote.example/sub/"><link rel="stylesheet" href="styles.css"><img src="image.png"><style>p{background:url(../bg.jpg)}</style>','index.html').externalResources);
 expect(bases.map(r=>r.url)).toEqual(expect.arrayContaining(['https://remote.example/sub/','https://remote.example/sub/styles.css','https://remote.example/sub/image.png','https://remote.example/bg.jpg']));
});
test('external resource report remains with the right source through copy, draft reload, JSON and undo',async({page})=>{
 await page.goto('/');await page.route('https://assets.example/**',r=>r.abort());await page.setInputFiles('#file-input',{name:'index.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><img src="https://assets.example/a.png"><button id="a">A</button>')});await page.waitForFunction(()=>isIframeLoaded);
 await page.click('#toggle-left');await expect(page.locator('#vf-resource-summary')).toContainText('1 項網路依賴');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied=text}}));await page.click('#vf-copy-resources');expect(await page.evaluate(()=>window.copied)).toContain('https://assets.example/a.png');
 await page.click('#quick-save');await page.reload();await page.waitForFunction(()=>isIframeLoaded);expect(await page.evaluate(()=>importReport.externalResources[0].url)).toBe('https://assets.example/a.png');expect(await page.evaluate(()=>collectAppearanceData().resources.externalResources.length)).toBe(1);
 await page.setInputFiles('#file-input',{name:'other.html',mimeType:'text/html',buffer:Buffer.from('<button>Other</button>')});await page.waitForFunction(()=>isIframeLoaded && appearanceSource.htmlFile==='other.html');expect(await page.evaluate(()=>importReport.externalResources.length)).toBe(0);
 await page.click('#undo');await page.waitForFunction(()=>isIframeLoaded && appearanceSource.htmlFile==='index.html');expect(await page.evaluate(()=>importReport.externalResources[0].url)).toBe('https://assets.example/a.png');
});
test('clipboard denial selects complete report instead of losing it',async({page})=>{
 await loadSource(page);await page.click('#toggle-left');await page.locator('#vf-resource-report details').evaluate(el=>el.open=true);await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));await page.click('#vf-copy-resources');await expect(page.locator('#vf-resource-text')).toBeFocused();expect(await page.locator('#vf-resource-text').evaluate(el=>el.selectionEnd-el.selectionStart)).toBeGreaterThan(20);await expect(page.locator('#status-text')).toContainText('手動複製');
});
for(const imported of [false,true])for(const kind of ['html','json'])test(`${imported?'appearance':'canvas'} shares exact safe ${kind} export using native file API`,async({page})=>{
 if(imported)await loadSource(page);else{await page.goto('/');await page.evaluate(()=>addShape('rect'));}
 await nativeMock(page);await page.click('#vf-share');await page.selectOption('#vf-share-format',kind);const expected=await page.evaluate(kind=>createExportArtifact(kind).content,kind);await page.click('#vf-share-send');await expect(page.locator('#vf-share-result')).toContainText('已交予系統分享');
 const shared=await page.evaluate(()=>window.shared[0]);expect(shared.files[0].text).toBe(expected);expect(shared.files[0].name).toBe(`visionflow-${imported?'appearance':'canvas'}.${kind}`);
 if(kind==='html'){expect(shared.files[0].text).not.toContain('window.businessRan');expect(shared.files[0].text).not.toContain('data-vf-helper');expect(shared.files[0].text).not.toContain('pointer-tools.js');}else expect(JSON.parse(shared.files[0].text).format).toBe(imported?'visionflow-appearance-v1':'visionflow-canvas-v1');
 if(imported)expect(await page.evaluate(()=>hasUnexportedAppearanceChanges())).toBe(false);
});
for(const error of ['AbortError','NotAllowedError'])test(`${error} never marks shared/exported; download fallback remains available`,async({page})=>{
 await loadSource(page);await nativeMock(page,error);await page.click('#vf-share');await page.click('#vf-share-send');await expect(page.locator('#vf-share-result')).toContainText(error==='AbortError'?'取消':'分享未完成');expect(await page.evaluate(()=>hasUnexportedAppearanceChanges())).toBe(true);
 const pending=page.waitForEvent('download');await page.click('#vf-share-download');const d=await pending;expect(d.suggestedFilename()).toBe('visionflow-appearance.html');expect(fs.readFileSync(await d.path(),'utf8')).toContain('18px');expect(await page.evaluate(()=>hasUnexportedAppearanceChanges())).toBe(false);
});
test('unsupported native JSON sharing explains explicit file download and editor link is not design link',async({page})=>{
 await loadSource(page);await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));await page.click('#vf-share');await page.selectOption('#vf-share-format','json');await page.click('#vf-share-send');await expect(page.locator('#vf-share-result')).toContainText('不支援');expect(await page.evaluate(()=>hasUnexportedAppearanceChanges())).toBe(true);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copiedLink=text}}));await page.click('#vf-share-copy-link');await expect(page.locator('#vf-share-result')).toContainText('不含設計');expect(await page.evaluate(()=>window.copiedLink)).not.toContain('?');
});
test('GET share receiver displays hostile text inertly, never fetches URL and adds notes only on explicit click',async({page})=>{
 await loadSource(page);await page.click('#quick-save');const text='<script>window.inboxRan=true</script>',url='https://never-fetch.example/a';let requests=0;await page.route('https://never-fetch.example/**',r=>{requests++;return r.abort();});
 await page.goto('/?'+new URLSearchParams({title:'收到的說明',text,url}));await page.waitForFunction(()=>isIframeLoaded);await expect(page.locator('#vf-inbox-dialog')).toBeVisible();await expect(page.locator('#vf-inbox-text')).toHaveValue('收到的說明\n'+text+'\n'+url);expect(await page.evaluate(()=>appearanceNotes)).toBe('');expect(await page.evaluate(()=>window.inboxRan)).toBeUndefined();expect(requests).toBe(0);expect(page.url()).not.toContain('never-fetch');
 await page.click('#vf-inbox-add');expect(await page.evaluate(()=>appearanceNotes)).toContain(text);expect(await page.evaluate(()=>collectAppearanceData().userNotes)).toContain(url);await page.click('#undo');expect(await page.evaluate(()=>appearanceNotes)).toBe('');
});
test('relative manifest targets and new/import shortcuts retain existing draft and can be opened on a subpath',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{addShape('rect');performQuickSave();});const saved=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));await page.goto('/?action=new');expect(await page.evaluate(()=>items.length)).toBe(1);await expect(page.locator('#project-sidebar')).toBeVisible();await expect(page.locator('#status-text')).toContainText('未清除');const restored=JSON.parse(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY)));const before=JSON.parse(saved);delete restored.workspacePanels;delete before.workspacePanels;expect(restored).toEqual(before);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));expect(manifest.share_target.action).toBe('./index.html');expect(manifest.shortcuts.every(s=>s.url.startsWith('./'))).toBe(true);
});
for(const event of ['visibilitychange','pagehide','beforeunload'])test(`${event} captures typed notes before blur and still rejects unfinished gesture`,async({page})=>{
 await loadSource(page);await page.click('#toggle-left');await page.locator('#vf-user-notes').fill('未失焦仍保存');
 await page.evaluate(event=>{if(event==='visibilitychange'){Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event(event));}else window.dispatchEvent(new Event(event));},event);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(DRAFT_KEY)).appearanceNotes)).toBe('未失焦仍保存');
 const previous=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));await page.evaluate(event=>{isMarquee=true;appearanceNotes='未完成手勢';if(event==='visibilitychange')document.dispatchEvent(new Event(event));else window.dispatchEvent(new Event(event));},event);expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(previous);await page.evaluate(()=>isMarquee=false);
});
test('350ms autosave persists changed metadata and storage failure keeps exact previous bytes',async({page})=>{
 await loadSource(page);await page.click('#toggle-left');await page.locator('#vf-user-notes').fill('自動保存');await expect.poll(()=>page.evaluate(()=>{const raw=localStorage.getItem(DRAFT_KEY);return raw?JSON.parse(raw).appearanceNotes:'';})).toBe('自動保存');
 const previous=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));const result=await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};appearanceNotes='容量不足';const ok=performQuickSave();Storage.prototype.setItem=original;return ok;});expect(result).toBe(false);expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(previous);await expect(page.locator('#status-text')).toContainText('儲存失敗');
});
test('optional report migration reads old v2, protected malformed report cannot overwrite draft',async({page})=>{
 await loadSource(page);const result=await page.evaluate(()=>{const old=JSON.parse(snapshot());delete old.importReport;restoreSnapshot(JSON.stringify(old));const recovered=importReport.externalResources.length;const bad=JSON.parse(snapshot());bad.importReport={warnings:[],externalResources:[{url:'javascript:alert(1)',kind:'img',reference:'index.html'}]};const raw=JSON.stringify(bad);clearTimeout(appearanceAutosaveTimer);localStorage.setItem(DRAFT_KEY,raw);const ok=performQuickSave();return{recovered,ok,untouched:localStorage.getItem(DRAFT_KEY)===raw,blocked:draftRecoveryBlocked};});expect(result).toEqual({recovered:0,ok:false,untouched:true,blocked:true});
});
test('file:// editor still imports/exports and reports that browser app cache is unavailable',async({page})=>{
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);await expect(page.locator('#vf-offline-state')).toContainText('本地檔案模式');await page.evaluate(()=>addShape('rect'));await page.click('#vf-share');const pending=page.waitForEvent('download');await page.click('#vf-share-download');expect((await pending).suggestedFilename()).toBe('visionflow-canvas.html');
});

const {fixtureServer,offlineReady}=require('./helpers/sw-fixture.cjs');
test('complete scoped cache works offline, retains draft, and never stores imported HTML or outside origin paths',async({page,context})=>{
 const server=await fixtureServer();try{
  await offlineReady(page,server.url);await page.evaluate(()=>{addShape('rect');performQuickSave();});
  const keys=await page.evaluate(async()=>{const names=await caches.keys();const cache=await caches.open(names.find(n=>n.includes('visionflow-app:')));return(await cache.keys()).map(r=>r.url);});expect(keys).toHaveLength(15);expect(keys.every(k=>k.startsWith(server.url))).toBe(true);expect(keys.some(k=>k.includes('delivery.js'))).toBe(true);expect(keys.some(k=>k.includes('draft'))).toBe(false);
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>items.length===1);expect(await page.evaluate(()=>fixtureShellVersion)).toBe('v1');await expect(page.locator('#vf-offline-state')).toContainText('離線');
 }finally{await context.setOffline(false);await page.goto('about:blank');await server.close();}
});
test('new complete version waits; old HTML/scripts stay paired; explicit saved update reloads new version',async({page})=>{
 const server=await fixtureServer();try{
  await offlineReady(page,server.url);await page.evaluate(()=>{addShape('rect');performQuickSave();});server.state.version='v2';await page.evaluate(()=>editorRegistration.update());await expect(page.locator('#vf-update-app')).toBeVisible();
  await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);expect(await page.locator('meta[name="fixture-version"]').getAttribute('content')).toBe('v1');expect(await page.evaluate(()=>fixtureShellVersion)).toBe('v1');
  await expect(page.locator('#vf-update-app')).toBeVisible();await page.click('#vf-update-app');await page.waitForFunction(()=>fixtureShellVersion==='v2');expect(await page.locator('meta[name="fixture-version"]').getAttribute('content')).toBe('v2');expect(await page.evaluate(()=>items.length)).toBe(1);
 }finally{await page.goto('about:blank');await server.close();}
});
test('missing new asset fails installation without disturbing old offline cache',async({page,context})=>{
 const server=await fixtureServer();try{
  await offlineReady(page,server.url);server.state.version='broken';server.state.missing=true;await page.evaluate(()=>editorRegistration.update().catch(()=>{}));await page.waitForTimeout(500);expect(await page.evaluate(()=>editorRegistration.waiting)).toBeNull();
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>fixtureShellVersion==='v1');expect(await page.locator('meta[name="fixture-version"]').getAttribute('content')).toBe('v1');
 }finally{await context.setOffline(false);await page.goto('about:blank');await server.close();}
});
test('update refuses storage failure, unfinished gesture and multiple open editor tabs',async({page,context})=>{
 const server=await fixtureServer();let other;try{
  await offlineReady(page,server.url);server.state.version='v2';await page.evaluate(()=>editorRegistration.update());await expect(page.locator('#vf-update-app')).toBeVisible();
  await page.evaluate(()=>{window.realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('full');};});await page.click('#vf-update-app');await expect(page.locator('#status-text')).toContainText('未更新');expect(await page.evaluate(()=>fixtureShellVersion)).toBe('v1');await page.evaluate(()=>Storage.prototype.setItem=window.realSetItem);
  await page.evaluate(()=>isMarquee=true);await page.click('#vf-update-app');await expect(page.locator('#status-text')).toContainText('未更新');await page.evaluate(()=>isMarquee=false);
  other=await context.newPage();await other.goto(server.url);await page.click('#vf-update-app');await expect(page.locator('#status-text')).toContainText('關閉其他');expect(await page.evaluate(()=>fixtureShellVersion)).toBe('v1');expect(await other.evaluate(()=>fixtureShellVersion)).toBe('v1');
  await other.close();other=null;await page.click('#vf-update-app');await page.waitForFunction(()=>fixtureShellVersion==='v2');
 }finally{if(other)await other.close();await page.goto('about:blank');await server.close();}
});
