const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixture = path.join(__dirname, 'fixtures/regression.html');

async function boot(page, scripts = false) {
  await page.goto('/');
  await page.click('#toggle-left');
  if (scripts) await page.check('#vf-trusted-scripts');
  await page.setInputFiles('#file-input', fixture);
  await expect(page.locator('#imported-frame')).toBeVisible();
  await page.waitForFunction(() => isIframeLoaded && !!importedFrame.contentDocument.getElementById('card'));
}
async function select(page, selector) {
  await page.evaluate(selector => selectImported(importedFrame.contentDocument.querySelector(selector)), selector);
}
async function edit(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const field = document.getElementById(id);
    if (!field) throw new Error(`Missing editor field ${id}`);
    if (field.type === 'checkbox') field.checked = value; else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}
async function styles(page, selector) {
  return page.evaluate(selector => {
    const el = importedFrame.contentDocument.querySelector(selector), c = el.ownerDocument.defaultView.getComputedStyle(el);
    return Object.fromEntries(['backgroundImage','backgroundColor','boxShadow','fontSize','fontFamily','color','borderWidth','borderStyle','borderRadius','transform','translate','width','height','outline'].map(k=>[k,c[k]]));
  }, selector);
}
async function data(page) { return page.evaluate(() => collectAppearanceData()); }

test('opening and selection do not alter source visuals or invent edits', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page); const before = await styles(page, '#card');
  await select(page, '#card'); expect(await styles(page, '#card')).toEqual(before);
  expect((await data(page)).changes).toEqual([]);
  expect(await page.evaluate(() => importedFrame.contentDocument.querySelector('#card').className)).toBe('');
  expect(errors).toEqual([]);
});

test('position retains gradient shadow font border and original transform', async ({ page }) => {
  await boot(page); const before = await styles(page, '#card'); await select(page, '#card');
  await edit(page, 'ix', 35); await edit(page, 'iy', 22);
  const after = await styles(page, '#card');
  for (const k of Object.keys(before).filter(k=>k!=='translate')) expect(after[k], k).toEqual(before[k]);
  const d = await data(page); expect(Object.keys(d.changes[0].styles)).toEqual(['translate']);
  expect(d.changes[0].layoutIntent.preserveResponsiveLayout).toBe(true);
  expect(d.changes[0].layoutIntent.relativeTo.tag).toBe('body');
  expect(await page.evaluate(() => importedFrame.contentDocument.querySelector('#card').style.transform)).toBe('');
});

test('color only preserves size border shadow and business event bindings', async ({ page }) => {
  await boot(page, true); await select(page, '#save-button'); const before = await styles(page, '#save-button');
  await edit(page, 'icolor', '#bb4422'); const after = await styles(page, '#save-button');
  for (const k of Object.keys(before).filter(k=>k!=='backgroundColor')) expect(after[k], k).toEqual(before[k]);
  expect((await data(page)).changes[0].styles).toEqual({ 'background-color': '#bb4422' });
  await page.click('#edit-mode');
  await page.frameLocator('#imported-frame').locator('#save-button').click();
  expect(await page.evaluate(()=>importedFrame.contentWindow.clicks)).toBe(1);
  expect(await page.evaluate(()=>importedSourceHtml.includes("addEventListener('click'"))).toBe(true);
});

test('shadow remains visible while selected and static export includes only changed shadow', async ({ page }) => {
  await boot(page); await select(page, '#card'); await edit(page, 'isBlur', 30);
  const edited = await styles(page, '#card'); expect(edited.boxShadow).toContain('30px');
  const exported = await page.evaluate(()=>buildAppearanceHtml());
  const preview = await page.context().newPage(); await preview.setContent(exported);
  const shadow = await preview.locator('#card').evaluate(el=>getComputedStyle(el).boxShadow);
  expect(shadow).toBe(edited.boxShadow);
  expect(Object.keys((await data(page)).changes[0].styles)).toEqual(['box-shadow']);
});

test('radius preserves content, form, link and image semantics', async ({ page }) => {
  await boot(page); await select(page, '#card'); await edit(page, 'iborderRadius', 24);
  expect((await data(page)).changes[0].styles).toEqual({'border-radius':'24px'});
  expect(await page.evaluate(()=>importedFrame.contentDocument.querySelector('#card').textContent)).toContain('文字不應');
  await select(page, '#name'); await edit(page, 'iborderRadius', 12);
  const input = await page.evaluate(()=>{const el=importedFrame.contentDocument.querySelector('#name');return {name:el.name,type:el.type,value:el.value};});
  expect(input).toEqual({name:'customer',type:'text',value:'原有內容'});
  await select(page, '#docs'); await edit(page, 'itextColor', '#665544');
  expect(await page.evaluate(()=>importedFrame.contentDocument.querySelector('#docs').getAttribute('href'))).toBe('https://example.com/docs');
  expect(await page.locator('#itext').isDisabled()).toBe(true);
});

test('width change does not lock original height and avoids horizontal overflow', async ({ page }) => {
  await boot(page); await select(page, '#card'); const before = await styles(page,'#card');
  await edit(page, 'iw', 320); const after = await styles(page,'#card');
  expect(after.height).toBe(before.height); expect(after.width).toBe('320px');
  expect((await data(page)).changes[0].styles).toEqual({width:'320px'});
  expect(await page.evaluate(()=>importedFrame.contentDocument.querySelector('#card').scrollWidth <= 320)).toBe(true);
});

test('valid HTML and versioned JSON omit helpers scripts and unmodified properties', async ({ page }) => {
  await boot(page,true); await select(page,'#card'); await edit(page,'iborderRadius',27);
  await page.click('#add-vertical-guide'); await page.click('#toggle-guides');
  const html=await page.evaluate(()=>buildAppearanceHtml());
  expect(html).toMatch(/^<!doctype html>/); expect(html).toContain('visionflow-appearance-v1');
  expect(html).not.toContain('ui-editor-overlay'); expect(html).not.toContain('ui-editor-style'); expect(html).not.toContain('data-vf-helper');
  expect(html).not.toContain('window.clicks'); expect(html).toContain('runtime-button');
  const decoded=await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    return {data:JSON.parse(doc.getElementById('visionflow-appearance-data').textContent),scripts:[...doc.scripts].map(s=>s.type)};
  },html);
  expect(decoded.scripts.every(t=>t==='application/json')).toBe(true);
  expect(decoded.data.changes[0].target.id).toBe('card');
  expect(decoded.data.changes[0].styles).toEqual({'border-radius':'27px'});
  expect(JSON.stringify(decoded.data)).not.toMatch(/guide-layer|ui-editor|addEventListener/);
  expect(decoded.data.changes[0].preserve).toContain('click-handler');
});

test('undo redo restores data selection group guides viewport theme and live listeners', async ({ page }) => {
  await boot(page,true); await select(page,'#save-button'); const before=await styles(page,'#save-button');
  await edit(page,'iborderRadius',25); await page.click('#undo');
  expect((await data(page)).changes).toEqual([]); expect(await styles(page,'#save-button')).toEqual(before);
  expect(await page.evaluate(()=>importedSelected.id)).toBe('save-button');
  await page.click('#redo'); expect((await styles(page,'#save-button')).borderRadius).toBe('25px');
  await page.evaluate(()=>{selectImported(importedFrame.contentDocument.querySelector('#docs'),true); toggleGroup();});
  expect(await page.evaluate(()=>!!importedGroupIds.get(importedSelected))).toBe(true);
  await page.click('#undo'); expect(await page.evaluate(()=>!!importedGroupIds.get(importedSelected))).toBe(false);
  await page.click('#redo'); expect(await page.evaluate(()=>!!importedGroupIds.get(importedSelected))).toBe(true);
  await page.click('#add-horizontal-guide'); await page.click('#undo'); expect(await page.evaluate(()=>importedManualGuides.length)).toBe(0);
  await page.click('#redo'); expect(await page.evaluate(()=>importedManualGuides.length)).toBe(1);
  await page.click('#toggle-viewport'); await page.click('#undo'); expect(await page.evaluate(()=>viewportMode)).toBe('desktop');
  await page.evaluate(()=>{savePoint();applyTheme(themes[1]);}); await page.click('#undo'); expect(await page.evaluate(()=>activeTheme)).toBe('light');
  await page.evaluate(()=>{editing=false;updateToolButtons();});
  await page.frameLocator('#imported-frame').locator('#save-button').click();
  expect(await page.evaluate(()=>importedFrame.contentWindow.clicks)).toBe(1);
});

test('reload restores local draft, selected target and appearance without silent loss', async ({ page }) => {
  await boot(page); await select(page,'#card'); await edit(page,'ix',31); await edit(page,'iborderRadius',29);
  await page.click('#quick-save'); await page.reload();
  await page.waitForFunction(()=>isIframeLoaded && importedSelected?.id==='card');
  expect((await styles(page,'#card')).borderRadius).toBe('29px');
  expect((await data(page)).changes[0].layoutIntent.referenceOffset.x).toBe(31);
  await edit(page,'ix',40); expect((await styles(page,'#card')).translate).toBe('40px');
});

test('exported HTML can be reimported and edited, JSON can be independently downloaded', async ({ page }) => {
  await boot(page); await select(page,'#card'); await edit(page,'iborderRadius',23);
  const source=await page.evaluate(()=>importedSourceHtml);
  const download=page.waitForEvent('download'); await page.click('#export'); const htmlDownload=await download;
  expect(htmlDownload.suggestedFilename()).toBe('visionflow-appearance.html');
  const file=await htmlDownload.path(); await page.setInputFiles('#file-input',{name:'visionflow-appearance.html',mimeType:'text/html',buffer:fs.readFileSync(file)});
  await page.waitForFunction(()=>importedSourceHtml.includes('visionflow-appearance-data') && isIframeLoaded && importedFrame?.contentDocument.querySelector('#card')?.getBoundingClientRect().width>0);
  await select(page,'#card'); expect((await styles(page,'#card')).borderRadius).toBe('23px');
  await edit(page,'iborderRadius',34); expect((await data(page)).changes[0].styles['border-radius']).toBe('34px');
  const jsonDownloadPromise=page.waitForEvent('download'); await page.click('#export-json'); const jsonDownload=await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe('visionflow-appearance.json');
  expect(JSON.parse(fs.readFileSync(await jsonDownload.path(),'utf8')).format).toBe('visionflow-appearance-v1');
  expect(source).toBe(fs.readFileSync(fixture,'utf8'));
});

test('mobile desktop edits and all five states are separate, responsive wrapping preserved', async ({ page }) => {
  await boot(page); await select(page,'#save-button'); await edit(page,'iborderRadius',20);
  await page.click('#toggle-viewport'); await edit(page,'iborderRadius',9);
  expect((await styles(page,'#save-button')).borderRadius).toBe('9px');
  const wraps=await page.evaluate(()=>{const d=importedFrame.contentDocument;return d.getElementById('wrap-two').getBoundingClientRect().top>d.getElementById('wrap-one').getBoundingClientRect().top;});
  expect(wraps).toBe(true);
  for(const state of ['hover','focus','disabled','loading']) { await page.selectOption('#vf-edit-state',state); await edit(page,'itextColor','#bb2211'); }
  const d=await data(page); expect(new Set(d.changes.map(r=>r.state))).toEqual(new Set(['default','hover','focus','disabled','loading']));
  const html=await page.evaluate(()=>buildAppearanceHtml()); expect(html).toContain(':hover');expect(html).toContain(':focus');expect(html).toContain('aria-disabled');expect(html).toContain('aria-busy');
  await page.selectOption('#vf-edit-state','default'); await page.click('#toggle-viewport');
  expect((await styles(page,'#save-button')).borderRadius).toBe('20px');
});

test('repeated components support explicit single and all matching scope', async ({ page }) => {
  await boot(page); await select(page,'[data-key="first"]'); await edit(page,'iborderRadius',15);
  expect((await styles(page,'[data-key="second"]')).borderRadius).toBe('0px');
  await edit(page,'vf-matching-selector','.list-item'); await edit(page,'vf-change-scope','all-matching');
  expect((await styles(page,'[data-key="second"]')).borderRadius).toBe('15px');
  expect((await data(page)).changes[0].scope).toBe('all-matching');
  expect((await data(page)).changes[0].target.confidence).toBe('data-attribute');
});

test('script-generated elements can be edited without rewriting their listeners', async ({ page }) => {
  await boot(page,true); await select(page,'#runtime-button'); await edit(page,'iborderRadius',13);
  expect((await data(page)).changes[0].target.id).toBe('runtime-button');
  await page.click('#undo'); await page.click('#redo'); await page.click('#edit-mode');
  await page.frameLocator('#imported-frame').locator('#runtime-button').click();
  expect(await page.evaluate(()=>importedFrame.contentDocument.getElementById('runtime-button').dataset.state)).toBe('loading');
  expect(await page.evaluate(()=>buildAppearanceHtml())).not.toContain('el.addEventListener');
});

test('real pointer drag and resize keep prior appearance and export explicit changes', async ({ page }) => {
  await boot(page); await select(page,'#card'); await page.waitForTimeout(250);
  const before=await styles(page,'#card');
  const center=await page.frameLocator('#imported-frame').locator('#ui-editor-overlay .c').boundingBox();
  await page.mouse.move(center.x+center.width/2,center.y+center.height/2); await page.mouse.down();
  await page.keyboard.down('Alt'); await page.mouse.move(center.x+center.width/2+35,center.y+center.height/2+20,{steps:8}); await page.mouse.up(); await page.keyboard.up('Alt');
  const moved=await styles(page,'#card'); expect(moved.translate).not.toBe('none'); expect(moved.backgroundImage).toBe(before.backgroundImage);expect(moved.boxShadow).toBe(before.boxShadow);
  const handle=await page.frameLocator('#imported-frame').locator('#ui-editor-overlay .se').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.keyboard.down('Alt');
  await page.mouse.move(handle.x+handle.width/2+20,handle.y+handle.height/2+10,{steps:8});await page.mouse.up();await page.keyboard.up('Alt');
  expect((await data(page)).changes[0].styles.width).toBeDefined();
  expect((await styles(page,'#card')).boxShadow).toBe(before.boxShadow);
});

test('invalid files and unsafe appearance CSS show clear errors and leave existing canvas intact', async ({ page }) => {
  await boot(page); const before=await page.evaluate(()=>importedSourceHtml);
  await page.evaluate(()=>loadSelectedFiles([new File(['test'],'empty.txt')]));
  expect(await page.locator('#sys-modal-text').innerText()).toContain('沒有找到 HTML');
  expect(await page.evaluate(()=>importedSourceHtml)).toBe(before);
  const bad=await data(page);bad.changes=[{target:{selector:'#card'},viewport:'desktop',state:'default',scope:'this-element',page:bad.source.page,styles:{background:'url(javascript:evil)'}}];
  await page.evaluate(data=>loadSelectedFiles([new File([JSON.stringify(data)],'bad.json')]),bad);
  expect(await page.locator('#sys-modal-text').innerText()).toContain('不支援的 CSS');
  expect((await data(page)).changes).toEqual([]);
});

async function customImport(page, html, name = 'custom.html') {
  const generation=await page.evaluate(()=>sourceGeneration);
  await page.setInputFiles('#file-input', {name,mimeType:'text/html',buffer:Buffer.from(html)});
  await page.waitForFunction(generation=>isIframeLoaded && sourceGeneration>generation,generation);
}

test('editing a shadow subparameter retains offsets color spread inset and other shadows', async ({page})=>{
  await boot(page); await select(page,'#card'); const before=await styles(page,'#card');
  await edit(page,'isBlur',33); const after=await styles(page,'#card');
  expect(after.boxShadow).toBe(before.boxShadow.replace('16px','33px'));
  await customImport(page,'<!doctype html><div id="complex" style="width:220px;height:100px;box-shadow:inset 3px 7px 11px 4px rgba(12,34,56,.4), 2px 8px 9px red;text-shadow:1px 3px 6px rgba(11,22,33,.5),4px 2px 7px blue">保持多重陰影</div>');
  await select(page,'#complex');const a=await styles(page,'#complex');await edit(page,'isBlur',20);const b=await styles(page,'#complex');
  expect(b.boxShadow).toBe(a.boxShadow.replace('11px','20px'));
  await edit(page,'ishadowColor','#00ff00');
  expect(await page.evaluate(()=>getComputedStyle(importedFrame.contentDocument.getElementById('complex')).textShadow)).toContain('1px 3px 6px');
});

test('editing gradient angle retains all original color stops and percentages',async({page})=>{
  await boot(page);await select(page,'#card');const before=await styles(page,'#card');await edit(page,'igAngle',120);
  expect((await styles(page,'#card')).backgroundImage).toBe(before.backgroundImage.replace('45deg','120deg'));
  await customImport(page,'<!doctype html><div id="gradient" style="width:200px;height:100px;background:linear-gradient(30deg, red 10%, blue 50%, green 90%)">三色漸層</div>');
  await select(page,'#gradient');const a=await styles(page,'#gradient');await edit(page,'igAngle',80);
  expect((await styles(page,'#gradient')).backgroundImage).toBe(a.backgroundImage.replace('30deg','80deg'));
});

test('static export excludes hydration JSON and content-box sizing remains unchanged',async({page})=>{
  await boot(page);
  await customImport(page,'<!doctype html><div id="content-box" style="box-sizing:content-box;width:200px;height:80px;padding:10px;border:3px solid blue">content</div><script type="application/json" id="__NEXT_DATA__">{"secretBusinessState":"must-not-export"}</script>');
  await select(page,'#content-box');await edit(page,'iw',240);
  expect(await page.evaluate(()=>getComputedStyle(importedSelected).boxSizing)).toBe('content-box');
  expect((await data(page)).changes[0].styles).toEqual({width:'240px'});
  const html=await page.evaluate(()=>buildAppearanceHtml());expect(html).not.toContain('secretBusinessState');expect(html).not.toContain('__NEXT_DATA__');
});

test('all matching does not erase instance-specific translate and layout move stays single-element',async({page})=>{
  await boot(page);
  await customImport(page,'<!doctype html><div id="a" class="row" style="width:100px;height:30px;translate:10px">一</div><div id="b" class="row" style="width:100px;height:30px;translate:40px">二</div>');
  await select(page,'#a');await edit(page,'iborderRadius',8);await edit(page,'vf-matching-selector','.row');await edit(page,'vf-change-scope','all-matching');await edit(page,'ix',30);
  expect((await styles(page,'#a')).translate).toBe('10px');expect((await styles(page,'#b')).translate).toBe('40px');
  await edit(page,'vf-change-scope','this-element');await edit(page,'ix',20);await edit(page,'vf-change-scope','all-matching');
  expect((await data(page)).changes[0].scope).toBe('this-element');expect((await styles(page,'#a')).translate).toBe('30px');expect((await styles(page,'#b')).translate).toBe('40px');
});

test('switching sources then undo restores the right prepared source for trusted scripts',async({page})=>{
  await boot(page,true);
  await customImport(page,'<!doctype html><p id="another">另一頁</p><script>window.sourceName="another";</script>','another.html');
  await page.click('#undo');await page.waitForFunction(()=>isIframeLoaded && importedFrame.contentDocument.getElementById('card'));
  await page.uncheck('#vf-trusted-scripts');await page.waitForFunction(()=>isIframeLoaded && importedFrame.contentDocument.getElementById('card'));
  await page.check('#vf-trusted-scripts');await page.waitForFunction(()=>importedFrame?.contentWindow.clicks===0);
  expect(await page.evaluate(()=>importedFrame.contentDocument.getElementById('another'))).toBeNull();
});

test('late JS generated elements join layers and survive a static draft refresh',async({page})=>{
  await boot(page,true);
  await customImport(page,'<!doctype html><div id="host"></div><script>setTimeout(()=>{const el=document.createElement("button");el.id="late";el.textContent="稍後生成";document.getElementById("host").appendChild(el);},150);</script>','late.html');
  await page.waitForFunction(()=>importedLayers.some(l=>l.element.id==='late'));
  await select(page,'#late');await edit(page,'iborderRadius',19);await page.click('#quick-save');await page.reload();
  await page.waitForFunction(()=>isIframeLoaded && importedSelected?.id==='late');expect((await styles(page,'#late')).borderRadius).toBe('19px');
  expect(await page.isChecked('#vf-trusted-scripts')).toBe(false);
});

test('standalone shape grouping theme and undo remain available, selection is a sibling overlay',async({page})=>{
  await page.goto('/');await page.evaluate(()=>addShape('rect'));
  await edit(page,'borderRadius',12);expect(await page.evaluate(()=>selectedDemo().borderRadius)).toBe(12);
  await page.click('#undo');expect(await page.evaluate(()=>selectedDemo().borderRadius)).toBe(0);await page.click('#redo');
  expect(await page.locator('.demo-item .resize-handle').count()).toBe(0);
  expect(await page.locator('.demo-selection-overlay .resize-handle').count()).toBe(9);
  await page.evaluate(()=>{addShape('circle');setDemoSelection(items.map(i=>i.id));toggleGroup();});
  expect(await page.evaluate(()=>new Set(items.map(i=>i.groupId)).size)).toBe(1);
  await page.evaluate(()=>toggleGroup());expect(await page.evaluate(()=>items.every(i=>!i.groupId))).toBe(true);
});

test('independent JSON imports only onto matching source and rejects a wrong page',async({page})=>{
  await boot(page);await select(page,'#card');await edit(page,'iborderRadius',42);const archive=await data(page);
  await page.evaluate(()=>{appearanceRecords={};refreshAppearanceStyles();});
  await page.setInputFiles('#file-input',{name:'visionflow-appearance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
  await page.waitForFunction(()=>collectAppearanceData().changes.length===1);expect((await styles(page,'#card')).borderRadius).toBe('42px');
  archive.source.page='/wrong';
  await page.setInputFiles('#file-input',{name:'wrong.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
  await expect(page.locator('#sys-modal-text')).toContainText('來源檔案／頁面／校驗值');
});

test('inline important styles can be edited, undone and exported without leaking viewport simulation',async({page})=>{
  await boot(page);
  await customImport(page,'<!doctype html><style>div[data-key="unique"]{background-color:green !important}</style><div data-key="unique" style="width:200px;height:90px;background-color:red !important;border-radius:8px !important">Important styles</div>','important.html');
  await select(page,'[data-key="unique"]');await edit(page,'icolor','#123456');await edit(page,'iborderRadius',24);
  expect((await styles(page,'[data-key="unique"]')).backgroundColor).toBe('rgb(18, 52, 86)');
  const html=await page.evaluate(()=>buildAppearanceHtml());const preview=await page.context().newPage();await preview.setContent(html);
  expect(await preview.locator('[data-key="unique"]').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(18, 52, 86)');
  await preview.setViewportSize({width:375,height:812});
  expect(await preview.locator('[data-key="unique"]').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 0, 0)');
  await page.click('#undo');expect((await styles(page,'[data-key="unique"]')).borderRadius).toBe('8px');
  await page.click('#undo');expect((await styles(page,'[data-key="unique"]')).backgroundColor).toBe('rgb(255, 0, 0)');
  await customImport(page,html,'archive-important.html');await select(page,'[data-key="unique"]');
  expect((await styles(page,'[data-key="unique"]')).borderRadius).toBe('24px');
  await page.click('#toggle-viewport');expect((await styles(page,'[data-key="unique"]')).borderRadius).toBe('8px');
});

test('draft storage failure is visible and never reported as saved',async({page})=>{
  await boot(page);await select(page,'#card');await edit(page,'iborderRadius',14);
  await page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
    performQuickSave();Storage.prototype.setItem=original;
  });
  await expect(page.locator('#status-text')).toContainText('草稿儲存失敗');
  expect((await data(page)).changes[0].styles['border-radius']).toBe('14px');
});
