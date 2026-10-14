const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const fixture=path.join(__dirname,'fixtures/regression.html');
const runtimeErrors=new WeakMap();
test.beforeEach(async({page})=>{const errors=[];runtimeErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(async({page})=>{expect(runtimeErrors.get(page)).toEqual([]);});

async function load(page,imported=false){
  await page.goto('/');
  if(imported){await page.click('#toggle-left');await page.setInputFiles('#file-input',fixture);await page.waitForFunction(()=>isIframeLoaded);await page.waitForTimeout(220);}
}
async function scale(page,percent){
  // Establish an exact initial view; the tested +/- operation is a real button click.
  await page.evaluate(()=>{zoom=1;refreshLayoutAndRulers();});
  await page.click(percent===90?'#zoom-out':'#zoom-in');await expect(page.locator('#zoom-label')).toHaveText(percent+'%');
}
async function panels(page,leftClosed,rightClosed){await page.evaluate(({leftClosed,rightClosed})=>restoreWorkspacePanels({leftClosed,rightClosed}),{leftClosed,rightClosed});}
async function currentPanels(page){return page.evaluate(()=>normalWorkspacePanels());}
async function exportFile(page,selector){const pending=page.waitForEvent('download');await page.click(selector);const file=await pending;return fs.readFileSync(await file.path(),'utf8');}
async function stubFullscreen(page,kind){
  await page.evaluate(kind=>{
    if(kind==='fallback'){document.documentElement.requestFullscreen=()=>Promise.reject(new Error('blocked for test'));return;}
    window.testFull=null;Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>window.testFull});
    document.documentElement.requestFullscreen=async()=>{window.testFull=document.documentElement;document.dispatchEvent(new Event('fullscreenchange'));};
    document.exitFullscreen=async()=>{window.testFull=null;document.dispatchEvent(new Event('fullscreenchange'));};
  },kind);
}

for(const imported of [false,true])for(const percent of [90,110])test(`${imported?'imported':'canvas'} ${percent}% remains stable through both panels and close buttons`,async({page})=>{
  await load(page,imported);await scale(page,percent);
  for(const selector of ['#toggle-left','#toggle-right']){
    await page.click(selector);await page.waitForTimeout(230);await expect(page.locator('#zoom-label')).toHaveText(percent+'%');
    await page.click(selector);await page.waitForTimeout(230);await expect(page.locator('#zoom-label')).toHaveText(percent+'%');
  }
  await panels(page,false,false);
  await page.click('#close-sidebar-btn');await page.click('#close-inspector-btn');await page.waitForTimeout(230);
  await expect(page.locator('#zoom-label')).toHaveText(percent+'%');
  expect(await page.evaluate(()=>zoom)).toBeCloseTo(percent/100,8);
});

for(const kind of ['native','fallback'])for(const [leftClosed,rightClosed] of [[false,false],[false,true],[true,false],[true,true]])test(`${kind} focus restores panels ${leftClosed}/${rightClosed}, visible exit and zoom`,async({page})=>{
  await load(page);await panels(page,leftClosed,rightClosed);await scale(page,110);await stubFullscreen(page,kind);
  await page.click('#focus-mode');await expect(page.locator('.app')).toHaveClass(/focus-mode/);await expect(page.locator('#focus-exit')).toBeVisible();
  expect(await page.evaluate(()=>document.querySelector('.workspace').classList.contains('left-closed')&&document.querySelector('.workspace').classList.contains('right-closed'))).toBe(true);
  await page.waitForTimeout(230);await expect(page.locator('#zoom-label')).toHaveText('110%');
  await page.click('#focus-exit');await expect(page.locator('.app')).not.toHaveClass(/focus-mode/);await expect(page.locator('#focus-exit')).toBeHidden();
  await page.waitForTimeout(230);expect(await currentPanels(page)).toEqual({leftClosed,rightClosed});await expect(page.locator('#zoom-label')).toHaveText('110%');
});

test('native ESC event uses the same cleanup and imported zoom is preserved',async({page})=>{
  await load(page,true);await scale(page,90);await panels(page,false,true);await stubFullscreen(page,'native');
  await page.click('#focus-mode');await page.evaluate(()=>{window.testFull=null;document.dispatchEvent(new Event('fullscreenchange'));});
  await expect(page.locator('.app')).not.toHaveClass(/focus-mode/);await page.waitForTimeout(230);
  expect(await currentPanels(page)).toEqual({leftClosed:false,rightClosed:true});await expect(page.locator('#zoom-label')).toHaveText('90%');
});

test('real Chromium native fullscreen enters and exits without zoom or panel loss',async({page})=>{
  await load(page);await panels(page,false,true);await scale(page,90);
  await page.click('#focus-mode');await page.waitForFunction(()=>Boolean(document.fullscreenElement));await expect(page.locator('#focus-exit')).toBeVisible();
  await page.click('#focus-exit');await page.waitForFunction(()=>!document.fullscreenElement);await page.waitForTimeout(230);
  expect(await currentPanels(page)).toEqual({leftClosed:false,rightClosed:true});await expect(page.locator('#zoom-label')).toHaveText('90%');
});

test('explicit fit changes scale while a delayed old frame cannot override manual view',async({page})=>{
  await load(page,true);await scale(page,110);await page.click('#fit-view');
  expect(await page.evaluate(()=>zoom)).toBeLessThanOrEqual(1);
  await page.evaluate(()=>{const data=snapshot();restoreSnapshot(data);});await page.waitForFunction(()=>isIframeLoaded);
  await scale(page,110);await page.waitForTimeout(250);await expect(page.locator('#zoom-label')).toHaveText('110%');
});

for(const imported of [false,true])test(`${imported?'imported':'canvas'} v2 reload and history retain snap tools, panels, lock and exact zoom`,async({page})=>{
  await load(page,imported);await scale(page,110);await panels(page,false,false);
  await page.click('#snap-toggle');await page.click('#snap-grid-toggle');await page.click('#snap-hover');await page.click('#lock-position');
  await page.evaluate(()=>savePoint());await page.click('#snap-toggle');await page.click('#snap-grid-toggle');await page.click('#snap-hover');
  await page.click('#undo');
  await expect(page.locator('#snap-toggle')).not.toHaveClass(/active-tool/);await expect(page.locator('#snap-grid-toggle')).not.toHaveClass(/active-tool/);await expect(page.locator('#snap-hover')).toHaveClass(/active-tool/);
  await page.click('#redo');await expect(page.locator('#snap-toggle')).toHaveClass(/active-tool/);await expect(page.locator('#snap-grid-toggle')).toHaveClass(/active-tool/);await expect(page.locator('#snap-hover')).not.toHaveClass(/active-tool/);
  await page.click('#undo');await page.click('#quick-save');const raw=await page.evaluate(()=>JSON.parse(localStorage.getItem(DRAFT_KEY)));
  expect(raw.version).toBe(2);expect(raw.toolPreferences).toEqual({snapEnabled:false,snapGrid:false,activeSnapHover:true});
  await page.reload();if(imported)await page.waitForFunction(()=>isIframeLoaded);await page.waitForTimeout(250);
  expect(await page.evaluate(()=>({enabled:SNAP_CFG.enabled,grid:SNAP_CFG.grid,hover:activeSnapHover,lock:isPositionLocked}))).toEqual({enabled:false,grid:false,hover:true,lock:true});
  await expect(page.locator('#zoom-label')).toHaveText('110%');expect(await currentPanels(page)).toEqual({leftClosed:false,rightClosed:false});
});

test('completed nonzero ruler uses real canvas clicks and restores its line, endpoints and button',async({page})=>{
  await load(page);await page.click('#snap-toggle');await page.click('#measure-tool');
  const rect=await page.locator('#artboard').boundingBox();
  await page.mouse.click(rect.x+100,rect.y+100);await page.mouse.move(rect.x+400,rect.y+500);await page.mouse.click(rect.x+400,rect.y+500);
  await expect(page.locator('#measure-label')).toContainText('500 px');await expect(page.locator('#measure-label')).toContainText('W: 300 H: 400');
  await page.click('#quick-save');const before=await page.evaluate(()=>JSON.parse(localStorage.getItem(DRAFT_KEY)).measure);
  expect(before.state).toBe('done');expect(before.enabled).toBe(true);
  await page.reload();await expect(page.locator('#measure-tool')).toHaveClass(/active-tool/);await expect(page.locator('#measure-line')).toBeVisible();
  await expect(page.locator('#measure-label')).toContainText('500 px');expect(await page.evaluate(()=>persistedMeasure())).toEqual(before);
  await page.click('#measure-tool');await expect(page.locator('#measure-tool')).not.toHaveClass(/active-tool/);await expect(page.locator('#measure-line')).toBeVisible();
  await page.click('#quick-save');await page.reload();await expect(page.locator('#measure-tool')).not.toHaveClass(/active-tool/);await expect(page.locator('#measure-line')).toBeVisible();
});

test('unfinished measurement cancels safely on reload and all three modes remain exclusive',async({page})=>{
  await load(page);await page.click('#measure-tool');const box=await page.locator('#artboard').boundingBox();await page.mouse.click(box.x+80,box.y+80);
  await page.click('#quick-save');await page.reload();expect(await page.evaluate(()=>measureState)).toBe('idle');await expect(page.locator('#measure-line')).toBeHidden();
  await page.click('#pan-tool');expect(await page.evaluate(()=>[panMode,eraserMode,measureMode])).toEqual([true,false,false]);
  await page.click('#guide-eraser');expect(await page.evaluate(()=>[panMode,eraserMode,measureMode])).toEqual([false,true,false]);
  await page.click('#measure-tool');expect(await page.evaluate(()=>[panMode,eraserMode,measureMode])).toEqual([false,false,true]);
});

test('focus-mode draft saves original panel preferences, never browser fullscreen state',async({page})=>{
  await load(page);await panels(page,false,true);await stubFullscreen(page,'fallback');await page.click('#focus-mode');
  await page.click('#quick-save');await page.reload();await expect(page.locator('.app')).not.toHaveClass(/focus-mode/);
  expect(await currentPanels(page)).toEqual({leftClosed:false,rightClosed:true});await expect(page.locator('#focus-exit')).toBeHidden();
});

test('legacy v1 defaults, unchanged backup, and migration quota failure do not erase original bytes',async({page,browser})=>{
  await load(page);const raw=await page.evaluate(()=>{const s=JSON.parse(snapshot());s.version=1;s.measureMode=true;delete s.toolPreferences;delete s.measure;delete s.workspacePanels;return JSON.stringify(s);});
  const context=await browser.newContext({baseURL:'http://127.0.0.1:8765'});const p=await context.newPage();
  await p.addInitScript(raw=>{if(localStorage.getItem('visionflow-appearance-draft-v1')===null)localStorage.setItem('visionflow-appearance-draft-v1',raw);},raw);
  await p.goto('/');expect(await p.evaluate(()=>({enabled:SNAP_CFG.enabled,grid:SNAP_CFG.grid,hover:activeSnapHover,state:measureState}))).toEqual({enabled:true,grid:true,hover:false,state:'idle'});
  await p.evaluate(()=>{clearTimeout(appearanceAutosaveTimer);window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};performQuickSave();});
  await expect(p.locator('#status-text')).toContainText('草稿儲存失敗');expect(await p.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(raw);
  await p.evaluate(()=>Storage.prototype.setItem=window.realSet);await p.click('#quick-save');expect(await p.evaluate(()=>JSON.parse(localStorage.getItem(DRAFT_KEY)).version)).toBe(2);
  expect(await p.evaluate(()=>localStorage.getItem(DRAFT_KEY+'-backup-before-v2'))).toBe(raw);await p.click('#quick-save');expect(await p.evaluate(()=>localStorage.getItem(DRAFT_KEY+'-backup-before-v2'))).toBe(raw);
  await context.close();
});

test('invalid v2 tool/measure data reject before mutation; corrupted draft stays protected',async({page,browser})=>{
  await load(page);const before=await page.evaluate(()=>snapshot());const draft=JSON.parse(before);
  for(const mutate of [s=>s.toolPreferences.snapGrid='yes',s=>s.measure.start.x=null,s=>s.measure.end.y=100001,s=>s.panMode=s.measureMode=s.measure.enabled=true,s=>s.zoom=0]){
    const bad=structuredClone(draft);mutate(bad);
    const error=await page.evaluate(raw=>{try{restoreSnapshot(raw);return null;}catch(e){return e.message;}},JSON.stringify(bad));expect(error).not.toBeNull();
    expect(await page.evaluate(()=>snapshot())).toBe(before);
  }
  const raw=JSON.stringify({...draft,measure:{enabled:false,state:'done',start:{x:null,y:0},end:{x:10,y:20}}});
  const context=await browser.newContext({baseURL:'http://127.0.0.1:8765'});const p=await context.newPage();
  await p.addInitScript(raw=>{if(localStorage.getItem('visionflow-appearance-draft-v1')===null)localStorage.setItem('visionflow-appearance-draft-v1',raw);},raw);
  await p.goto('/');await expect(p.locator('#status-text')).toContainText('停止自動覆寫');expect(await exportFile(p,'#vf-backup-draft')).toBe(raw);
  await p.click('#quick-save');expect(await p.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(raw);await context.close();
});

test('two-page draft describes static restoration and keeps source pages without serializing Files',async({page})=>{
  await load(page);await page.evaluate(async()=>{const files=['index.html','pages/about.html'].map(name=>{const f=new File(['<div id="a">'+name+'</div>'],name.split('/').at(-1),{type:'text/html'});Object.defineProperty(f,'webkitRelativePath',{value:'site/'+name});return f;});await loadSelectedFiles(files);});
  await page.waitForFunction(()=>isIframeLoaded);await page.click('#quick-save');await page.reload();await page.waitForFunction(()=>isIframeLoaded);
  await expect(page.locator('#vf-entry-page')).toBeDisabled();await expect(page.locator('#vf-entry-page')).toContainText('重選原資料夾');
  await expect(page.locator('#status-text')).toContainText('已恢復目前靜態頁');await expect(page.locator('#status-text')).toContainText('重選原資料夾');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem(DRAFT_KEY)));expect(stored.folderPagePaths).toEqual(['index.html','pages/about.html']);expect(stored.folderFiles).toBeUndefined();
});

test('v1 backup button downloads exact original bytes and never replaces an existing backup',async({page,browser})=>{
  await load(page);const raw=await page.evaluate(()=>{const s=JSON.parse(snapshot());s.version=1;delete s.toolPreferences;delete s.measure;delete s.workspacePanels;return JSON.stringify(s);});
  const context=await browser.newContext({baseURL:'http://127.0.0.1:8765'});const p=await context.newPage();
  await p.addInitScript(raw=>{const key='visionflow-appearance-draft-v1';if(localStorage.getItem(key)===null)localStorage.setItem(key,raw);},raw);
  await p.goto('/');await p.click('#quick-save');await p.click('#toggle-left');
  await expect(p.locator('#vf-backup-v1')).toBeEnabled();expect(await exportFile(p,'#vf-backup-v1')).toBe(raw);
  await p.evaluate(()=>{localStorage.setItem(DRAFT_KEY,JSON.stringify({...JSON.parse(localStorage.getItem(DRAFT_KEY)),version:1}));performQuickSave();});
  expect(await p.evaluate(()=>localStorage.getItem(DRAFT_KEY+'-backup-before-v2'))).toBe(raw);await context.close();
});

test('newly inserted unknown draft is protected at save time, not just at initial restoration',async({page})=>{
  await load(page);const raw='{"version":500,"items":[],"future":"preserve"}';
  await page.evaluate(raw=>{localStorage.setItem(DRAFT_KEY,raw);performQuickSave();},raw);
  expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(raw);await expect(page.locator('#status-text')).toContainText('停止自動覆寫');
  expect(await exportFile(page,'#vf-backup-draft')).toBe(raw);
});

for(const kind of ['drag','resize'])test(`in-progress imported ${kind} is not saved; successful pointerup commits and restore clears iframe listeners`,async({page})=>{
  await load(page,true);await page.evaluate(()=>selectImported(importedFrame.contentDocument.getElementById('card')));await page.click('#quick-save');
  const original=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));
  await page.evaluate(kind=>{
    const doc=importedFrame.contentDocument,el=doc.getElementById('card');
    const event=new doc.defaultView.PointerEvent('pointerdown',{button:0,pointerId:1,clientX:100,clientY:100,screenX:100,screenY:100});Object.defineProperty(event,'target',{value:el});
    if(kind==='drag')startImportedDrag(event,el);else startImportedResize(event,el,'se');
    doc.dispatchEvent(new doc.defaultView.PointerEvent('pointermove',{pointerId:1,clientX:150,clientY:140,screenX:150,screenY:140,altKey:true}));
    performQuickSave(true);
  },kind);
  await page.waitForTimeout(450);expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(original);
  await page.evaluate(()=>{const doc=importedFrame.contentDocument;doc.dispatchEvent(new doc.defaultView.PointerEvent('pointerup',{pointerId:1}));});
  await page.waitForFunction(original=>localStorage.getItem(DRAFT_KEY)!==original,original);
  const changed=await page.evaluate(()=>localStorage.getItem(DRAFT_KEY));expect(JSON.parse(changed).appearanceRecords).not.toEqual(JSON.parse(original).appearanceRecords);
  await page.evaluate(({kind,raw})=>{
    const doc=importedFrame.contentDocument,el=doc.getElementById('card');
    const event=new doc.defaultView.PointerEvent('pointerdown',{button:0,pointerId:1,clientX:100,clientY:100,screenX:100,screenY:100});Object.defineProperty(event,'target',{value:el});
    if(kind==='drag')startImportedDrag(event,el);else startImportedResize(event,el,'se');
    window.oldGestureDoc=doc;restoreSnapshot(raw);
    doc.dispatchEvent(new doc.defaultView.PointerEvent('pointermove',{pointerId:1,clientX:260,clientY:220,screenX:260,screenY:220,altKey:true}));
  },{kind,raw:original});
  expect(await page.evaluate(()=>({snap:snapDragActive,guide:guideDrag,cleanup:cancelEditorGesture}))).toEqual({snap:false,guide:null,cleanup:null});
  expect(await page.evaluate(()=>JSON.stringify(appearanceRecords))).toBe(JSON.stringify(JSON.parse(original).appearanceRecords));
});

test('restoring while an imported manual guide is dragging removes its owner-document listener',async({page})=>{
  await load(page,true);await page.evaluate(()=>{addManualGuide('vertical');});const raw=await page.evaluate(()=>snapshot());
  await page.evaluate(raw=>{
    const doc=importedFrame.contentDocument,el=doc.querySelector('.manual-guide');
    const event=new doc.defaultView.PointerEvent('pointerdown',{button:0,pointerId:1,clientX:100,clientY:100});Object.defineProperty(event,'target',{value:el});
    startManualGuideDrag(event,'vertical',0);restoreSnapshot(raw);
    doc.dispatchEvent(new doc.defaultView.PointerEvent('pointermove',{pointerId:1,clientX:400,clientY:300}));
  },raw);
  expect(await page.evaluate(()=>importedManualGuides)).toEqual(JSON.parse(raw).importedManualGuides);expect(await page.evaluate(()=>guideDrag)).toBeNull();
});

test('corrupt v2 source HTML is rejected before mutation and cannot be auto-replaced by an empty iframe',async({page,browser})=>{
  await load(page,true);const original=await page.evaluate(()=>snapshot());
  for(const field of ['importedHtml','importedSourceHtml','importedPreparedHtml','staticPreviewHtml']){
    const bad=JSON.parse(original);bad[field]=null;
    const message=await page.evaluate(raw=>{try{restoreSnapshot(raw);return null;}catch(error){return error.message;}},JSON.stringify(bad));expect(message).toContain('資料不完整');
    expect(await page.evaluate(()=>snapshot())).toBe(original);
  }
  const bad=JSON.parse(original);bad.importedHtml=null;const raw=JSON.stringify(bad);
  const context=await browser.newContext({baseURL:'http://127.0.0.1:8765'});const p=await context.newPage();
  await p.addInitScript(raw=>{if(localStorage.getItem('visionflow-appearance-draft-v1')===null)localStorage.setItem('visionflow-appearance-draft-v1',raw);},raw);
  await p.goto('/');await expect(p.locator('#status-text')).toContainText('停止自動覆寫');await p.waitForTimeout(500);
  expect(await p.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(raw);expect(await exportFile(p,'#vf-backup-draft')).toBe(raw);await context.close();
});
