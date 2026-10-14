const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixture = path.join(__dirname, 'fixtures/regression.html');

async function upload(page, name, content) {
  await page.setInputFiles('#file-input', {name, mimeType: /json$/.test(name) ? 'application/json' : 'text/html', buffer: Buffer.from(content)});
}
async function loadOriginal(page) {
  await page.goto('/'); await page.click('#toggle-left');
  await page.setInputFiles('#file-input', fixture);
  await page.waitForFunction(() => isIframeLoaded && importedFrame?.contentDocument.getElementById('card'));
}
async function selectCard(page) {
  await page.evaluate(() => selectImported(importedFrame.contentDocument.getElementById('card')));
  if (await page.locator('.workspace.right-closed').count()) await page.click('#toggle-right');
}
async function editRadius(page, value) {
  await selectCard(page); await page.fill('#iborderRadius', String(value)); await page.locator('#iborderRadius').press('Tab');
}
async function exported(page, button) {
  const promise = page.waitForEvent('download'); await page.click(button);
  const file = await promise; return {name: file.suggestedFilename(), text: fs.readFileSync(await file.path(), 'utf8')};
}
async function canvasItemStyle(page, selector) {
  return page.locator(selector).evaluate(el => {
    const c = getComputedStyle(el), t = getComputedStyle(el.firstElementChild);
    return {left:c.left,top:c.top,width:c.width,height:c.height,border:c.border,borderRadius:c.borderRadius,clipPath:c.clipPath,
      background:c.backgroundImage,color:c.backgroundColor,shadow:c.boxShadow,textFont:t.fontFamily,textSize:t.fontSize,textColor:t.color,textShadow:t.textShadow,content:el.textContent};
  });
}
async function makeFolder(page) {
  await page.goto('/'); await page.click('#toggle-left');
  await page.evaluate(async () => {
    const files = ['index.html','pages/about.html'].map((path, i) => {
      const f = new File([`<!doctype html><div id="card" style="width:160px;height:80px;border-radius:0">${i ? 'ABOUT' : 'HOME'}</div>`], path.split('/').at(-1), {type:'text/html'});
      Object.defineProperty(f, 'webkitRelativePath', {value: 'site/' + path}); return f;
    });
    await loadSelectedFiles(files);
  });
  await page.waitForFunction(() => isIframeLoaded && importedFrame?.contentDocument.getElementById('card')?.textContent==='HOME');
}
async function switchTo(page, entry, content) {
  await page.selectOption('#vf-entry-page', entry);
  await page.waitForFunction(content => isIframeLoaded && importedFrame?.contentDocument.getElementById('card')?.textContent===content, content);
}

test('canvas actual menu exports styled HTML and JSON; both reopen with exact editable items', async ({page, browser}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await page.click('#add-shape-btn'); await page.click('[data-shape="rect"]');
  await page.click('#toggle-right');
  await page.fill('#fontSize','24'); await page.locator('#fontSize').press('Tab');
  await page.fill('#content','測試按鈕 <script>window.BAD=1</script>'); await page.locator('#content').press('Tab');
  await page.check('#gradient'); await page.check('#shadow');
  await page.fill('#sBlur','15'); await page.locator('#sBlur').press('Tab');
  await page.fill('#borderRadius','18'); await page.locator('#borderRadius').press('Tab');
  const before=await canvasItemStyle(page,'.demo-item');
  const html=await exported(page,'#export'), json=await exported(page,'#export-json');
  expect(html.name).toBe('visionflow-canvas.html');expect(json.name).toBe('visionflow-canvas.json');
  const model=JSON.parse(json.text);expect(model.format).toBe('visionflow-canvas-v1');expect(model.items).toHaveLength(1);
  const preview=await page.context().newPage();await preview.setContent(html.text);
  expect(await canvasItemStyle(preview,'.canvas-item')).toEqual(before);
  expect(await preview.locator('[data-vf-helper],.resize-handle,.guide-layer,.demo-selection-overlay').count()).toBe(0);
  expect(await preview.evaluate(()=>window.BAD)).toBeUndefined();
  expect(await preview.locator('script:not([type="application/json"])').count()).toBe(0);
  for (const file of [json, html]) {
    const context=await browser.newContext();const p=await context.newPage();await p.goto(page.url());await upload(p,file.name,file.text);
    await p.waitForFunction(()=>!importedMode && items.length===1);
    expect(await p.evaluate(()=>collectCanvasData().items)).toEqual(model.items);
    expect(await canvasItemStyle(p,'.demo-item')).toEqual(before);
    await p.click('#undo');expect(await p.locator('.demo-item').count()).toBe(0);
    await p.click('#redo');expect(await p.locator('.demo-item').count()).toBe(1);
    await context.close();
  }
  expect(errors).toEqual([]);
});

test('canvas special shapes, mobile size, theme and groups survive export and reload', async ({page}) => {
  await page.goto('/');
  for (const kind of ['circle','blob','triangle','text']) {await page.click('#add-shape-btn');await page.click(`[data-shape="${kind}"]`);}
  await page.evaluate(()=>{setDemoSelection(items.slice(0,2).map(i=>i.id));toggleGroup();applyTheme(themes[1]);});
  await page.click('#toggle-viewport');
  const json=await exported(page,'#export-json'),data=JSON.parse(json.text);
  expect(data.viewport).toEqual({mode:'mobile',width:375,height:812});expect(data.theme).toBe('dark');
  expect(data.items[0].customBorderRadius).toBe('50%');expect(data.items[2].clipPath).toContain('polygon');
  const html=await exported(page,'#export');const preview=await page.context().newPage();await preview.setContent(html.text);
  for(let i=0;i<4;i++) expect(await canvasItemStyle(preview,`.canvas-item:nth-child(${i+1})`)).toEqual(await canvasItemStyle(page,`.demo-item[data-id="${data.items[i].id}"]`));
  await page.click('#reset');await upload(page,json.name,json.text);await page.waitForFunction(()=>items.length===4);
  expect(await page.evaluate(()=>collectCanvasData())).toEqual(data);
  await page.click('#quick-save');await page.reload();expect(await page.evaluate(()=>collectCanvasData())).toEqual(data);
});

test('invalid canvas archives do not change current design or execute active text', async ({page}) => {
  await page.goto('/');await page.click('#add-shape-btn');await page.click('[data-shape="rect"]');
  const original=await page.evaluate(()=>collectCanvasData());
  const variations=[d=>d.items.push({...d.items[0]}),d=>d.items[0].w=-10,d=>d.items[0].color='red;position:fixed',d=>d.items[0].clipPath='url(https://example.com/a)',d=>d.viewport.width=50];
  for(const mutate of variations){
    const bad=structuredClone(original);mutate(bad);await upload(page,'bad.json',JSON.stringify(bad));
    await expect(page.locator('#sys-modal')).toBeVisible();expect(await page.evaluate(()=>collectCanvasData())).toEqual(original);await page.click('#sys-modal-btn');
  }
});

test('new and legacy appearance JSON reuse identical origin regardless of integration route', async ({page, browser}) => {
  await loadOriginal(page);await editRadius(page,18);await page.fill('#vf-page-path','/login');await page.locator('#vf-page-path').press('Tab');
  const file=await exported(page,'#export-json');const model=JSON.parse(file.text);
  expect(model.origin.entryPath).toBe('regression.html');expect(model.integrationPagePath).toBe('/login');
  const legacy=structuredClone(model);delete legacy.origin;delete legacy.integrationPagePath;delete legacy.source.origin;
  for(const archive of [model,legacy]){
    const context=await browser.newContext({baseURL:'http://127.0.0.1:8765',viewport:{width:1440,height:1000}});const p=await context.newPage();await loadOriginal(p);
    const source=await p.evaluate(()=>importedSourceHtml);
    expect(await p.locator('#vf-page-path').inputValue()).toBe('/regression.html');
    await upload(p,'appearance.json',JSON.stringify(archive));await expect(p.locator('#status-text')).toContainText('已載入外觀 JSON');
    expect(await p.locator('#vf-page-path').inputValue()).toBe('/login');
    expect(await p.frameLocator('#imported-frame').locator('#card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('18px');
    expect(await p.evaluate(()=>importedSourceHtml)).toBe(source);
    await p.click('#quick-save');await p.reload();await p.waitForFunction(()=>isIframeLoaded);
    expect(await p.locator('#vf-page-path').inputValue()).toBe('/login');
    await context.close();
  }
});

test('wrong entry or hash and inconsistent routes still reject without replacing changes', async ({page}) => {
  await loadOriginal(page);await editRadius(page,22);const original=await page.evaluate(()=>collectAppearanceData());
  for(const type of ['entry','hash','route']){
    const bad=structuredClone(original);
    if(type==='entry'){bad.source.htmlFile='wrong.html';bad.origin.entryPath='wrong.html';bad.source.origin=bad.origin;}
    if(type==='hash'){bad.source.sourceHash='0'.repeat(64);bad.origin.sourceHash=bad.source.sourceHash;bad.source.origin=bad.origin;}
    if(type==='route')bad.source.page='/wrong';
    await upload(page,'wrong.json',JSON.stringify(bad));await expect(page.locator('#sys-modal-text')).toContainText('來源檔案／頁面／校驗值');
    expect(await page.evaluate(()=>collectAppearanceData())).toEqual(original);await page.click('#sys-modal-btn');
  }
});

test('export allows entry switch, switch-back keeps page edits, later changes block again', async ({page}) => {
  await makeFolder(page);await editRadius(page,18);
  await page.selectOption('#vf-entry-page','pages/about.html');await expect(page.locator('#sys-modal-text')).toContainText('先匯出');
  expect(await page.locator('#vf-entry-page').inputValue()).toBe('index.html');await page.click('#sys-modal-btn');
  await exported(page,'#export');await switchTo(page,'pages/about.html','ABOUT');await editRadius(page,9);
  await exported(page,'#export-json');await switchTo(page,'index.html','HOME');
  expect(await page.frameLocator('#imported-frame').locator('#card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('18px');
  await editRadius(page,20);await page.selectOption('#vf-entry-page','pages/about.html');await expect(page.locator('#sys-modal-text')).toContainText('先匯出');
  await page.click('#sys-modal-btn');await exported(page,'#export-json');await switchTo(page,'pages/about.html','ABOUT');
  expect(await page.frameLocator('#imported-frame').locator('#card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('9px');
  await page.click('#undo');await page.waitForFunction(()=>isIframeLoaded && importedFrame?.contentDocument.getElementById('card')?.textContent==='HOME');
  expect(await page.locator('#vf-entry-page').inputValue()).toBe('index.html');await page.click('#redo');await page.waitForFunction(()=>isIframeLoaded && importedFrame?.contentDocument.getElementById('card')?.textContent==='ABOUT');
  await page.click('#quick-save');await page.reload();await page.waitForFunction(()=>isIframeLoaded);
  await expect(page.locator('#vf-entry-page')).toBeDisabled();await expect(page.locator('#vf-entry-page')).toContainText('重選原資料夾');
  expect(await page.frameLocator('#imported-frame').locator('#card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('9px');
  const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem(DRAFT_KEY)));expect(Object.keys(draft.pageSessions).length).toBeGreaterThan(0);
});

test('failed exports cannot unlock entry switching', async ({page}) => {
  await makeFolder(page);await editRadius(page,16);
  await page.evaluate(()=>{const saved=buildAppearanceHtml;buildAppearanceHtml=()=>{throw new Error('test export failure')};downloadAppearance('html');buildAppearanceHtml=saved;});
  await expect(page.locator('#sys-modal-text')).toContainText('test export failure');await page.click('#sys-modal-btn');
  await page.selectOption('#vf-entry-page','pages/about.html');await expect(page.locator('#sys-modal-text')).toContainText('先匯出');
});

test('unknown draft is not overwritten; raw backup downloads the original bytes', async ({page}) => {
  const raw='{"version":999,"items":[],"sentinel":"do not overwrite"}';
  await page.addInitScript(raw=>{const key='visionflow-appearance-draft-v1';if(!localStorage.getItem(key))localStorage.setItem(key,raw);},raw);
  await page.goto('/');
  await expect(page.locator('#status-text')).toContainText('停止自動覆寫');
  const file=await exported(page,'#vf-backup-draft');expect(file.text).toBe(raw);expect(file.name).toBe('visionflow-draft-backup.json');
  await page.click('#quick-save');expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(raw);
  await page.reload();expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe(raw);
});

test('reselecting original folder after reload restores both page bundles without clearing draft', async ({page}) => {
  await makeFolder(page);await editRadius(page,18);await exported(page,'#export-json');
  await switchTo(page,'pages/about.html','ABOUT');await editRadius(page,9);await exported(page,'#export-json');
  const sourceFiles=await page.evaluate(async()=>Promise.all(folderFiles.map(async file=>({name:file.name,path:file.webkitRelativePath,text:await file.text()}))));
  await page.click('#quick-save');await page.reload();await page.waitForFunction(()=>isIframeLoaded);
  await page.evaluate(async sources=>{const files=sources.map(s=>{const f=new File([s.text],s.name,{type:'text/html'});Object.defineProperty(f,'webkitRelativePath',{value:s.path});return f;});await loadSelectedFiles(files);},sourceFiles);
  await page.waitForFunction(()=>isIframeLoaded && importedFrame?.contentDocument.getElementById('card')?.textContent==='HOME');
  expect(await page.frameLocator('#imported-frame').locator('#card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('18px');
  await switchTo(page,'pages/about.html','ABOUT');
  expect(await page.frameLocator('#imported-frame').locator('#card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('9px');
});

test('undoing a different source restores the original live folder and page cache', async ({page}) => {
  await makeFolder(page);await editRadius(page,18);await exported(page,'#export-json');
  await switchTo(page,'pages/about.html','ABOUT');
  await upload(page,'other.html','<!doctype html><p id="other">OTHER</p>');
  await page.waitForFunction(()=>isIframeLoaded && importedFrame?.contentDocument.getElementById('other'));
  await page.click('#undo');await page.waitForFunction(()=>isIframeLoaded && importedFrame?.contentDocument.getElementById('card')?.textContent==='ABOUT');
  await expect(page.locator('#vf-entry-page')).toBeEnabled();await switchTo(page,'index.html','HOME');
  expect(await page.frameLocator('#imported-frame').locator('#card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('18px');
});

test('a slower import cannot overwrite a more recent import', async ({page}) => {
  await page.goto('/');
  await page.evaluate(async()=>{
    const prepare=VFFolder.prepare;let release;const gate=new Promise(r=>release=r);
    VFFolder.prepare=async(files,entry)=>{if(files[0].name==='slow.html')await gate;return prepare(files,entry);};
    try{
      const slow=loadSelectedFiles([new File(['<p id="slow">SLOW</p>'],'slow.html',{type:'text/html'})]);
      await loadSelectedFiles([new File(['<p id="fast">FAST</p>'],'fast.html',{type:'text/html'})]);
      release();await slow;
    }finally{VFFolder.prepare=prepare;}
  });
  await page.waitForFunction(()=>isIframeLoaded && importedFrame?.contentDocument.getElementById('fast'));
  expect(await page.evaluate(()=>appearanceOrigin().entryPath)).toBe('fast.html');
});

test('legacy hashless JSON retains the current verified source hash', async ({page}) => {
  await loadOriginal(page);await editRadius(page,18);
  const archive=await page.evaluate(()=>collectAppearanceData()),hash=archive.origin.sourceHash;
  expect(hash).toHaveLength(64);
  delete archive.origin;delete archive.integrationPagePath;delete archive.source.origin;archive.source.sourceHash=null;
  await upload(page,'legacy-no-hash.json',JSON.stringify(archive));await expect(page.locator('#status-text')).toContainText('已載入外觀 JSON');
  expect(await page.evaluate(()=>appearanceOrigin().sourceHash)).toBe(hash);
  const exportedData=JSON.parse((await exported(page,'#export-json')).text);
  expect(exportedData.origin.sourceHash).toBe(hash);expect(exportedData.source.sourceHash).toBe(hash);
});

test('metadata-only changes require export before switching entries', async ({page}) => {
  await makeFolder(page);await page.fill('#vf-page-path','/login');await page.locator('#vf-page-path').press('Tab');
  await page.selectOption('#vf-entry-page','pages/about.html');await expect(page.locator('#sys-modal-text')).toContainText('先匯出');await page.click('#sys-modal-btn');
  const data=JSON.parse((await exported(page,'#export-json')).text);expect(data.integrationPagePath).toBe('/login');
  await switchTo(page,'pages/about.html','ABOUT');
  await page.fill('#vf-project-name','示例工程');await page.locator('#vf-project-name').press('Tab');
  await page.selectOption('#vf-entry-page','index.html');await expect(page.locator('#sys-modal-text')).toContainText('先匯出');
});

test('zero-byte damaged draft is protected and backed up without replacing its bytes', async ({page}) => {
  await page.addInitScript(()=>{const key='visionflow-appearance-draft-v1';if(localStorage.getItem(key)===null)localStorage.setItem(key,'');});
  await page.goto('/');await expect(page.locator('#status-text')).toContainText('停止自動覆寫');
  const backup=await exported(page,'#vf-backup-draft');expect(backup.text).toBe('');
  await page.click('#quick-save');expect(await page.evaluate(()=>localStorage.getItem(DRAFT_KEY))).toBe('');
});

test('reset cancels a pending slow import instead of resurrecting the old page', async ({page}) => {
  await page.goto('/');
  await page.evaluate(()=>{
    window.testPrepare=VFFolder.prepare;window.testGate=new Promise(resolve=>window.releaseTestGate=resolve);
    VFFolder.prepare=async(...args)=>{await window.testGate;return window.testPrepare(...args);};
    window.testImport=loadSelectedFiles([new File(['<p id="slow">SLOW</p>'],'slow.html',{type:'text/html'})]);
  });
  await page.click('#reset');await page.evaluate(async()=>{window.releaseTestGate();await window.testImport;VFFolder.prepare=window.testPrepare;});
  expect(await page.evaluate(()=>importedMode)).toBe(false);expect(await page.locator('#imported-frame').count()).toBe(0);
});

test('legacy v1 draft without new origin or page-session fields still restores', async ({page,browser}) => {
  await loadOriginal(page);await editRadius(page,18);
  const raw=await page.evaluate(()=>{
    const value=JSON.parse(snapshot());
    for(const key of ['pageSessions','folderSetKey','folderPagePaths','exportedAppearanceFingerprint','initialAppearanceFingerprint'])delete value[key];
    delete value.appearanceSource.origin;return JSON.stringify(value);
  });
  const context=await browser.newContext({baseURL:'http://127.0.0.1:8765'});const p=await context.newPage();
  await p.addInitScript(raw=>{const key='visionflow-appearance-draft-v1';if(localStorage.getItem(key)===null)localStorage.setItem(key,raw);},raw);
  await p.goto('/');await p.waitForFunction(()=>isIframeLoaded && importedFrame?.contentDocument.getElementById('card'));
  expect(await p.frameLocator('#imported-frame').locator('#card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('18px');
  expect(await p.evaluate(()=>draftRecoveryBlocked)).toBe(false);
  await p.click('#quick-save');expect(await p.evaluate(()=>JSON.parse(localStorage.getItem(DRAFT_KEY)).version)).toBe(1);
  await context.close();
});
