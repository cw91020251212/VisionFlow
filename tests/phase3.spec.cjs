const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const html=`<!doctype html><html><head><style>html{overflow:auto}body{position:relative;margin:32px;width:1700px;height:1700px}button,p,section{box-sizing:border-box;margin:0}#a,#b,#c{position:absolute;width:100px;height:80px;background:#ddd}#a{left:100px;top:100px}#b{left:280px;top:100px}#c{left:460px;top:100px}#nested{position:absolute;left:100px;top:300px;width:220px;height:140px;background:#eee}#child{position:absolute;left:15px;top:15px;width:90px;height:50px}#front,#back{position:absolute;left:500px;top:330px;width:100px;height:80px}#front{z-index:2;background:pink}#back{background:blue}</style></head><body><button id="a">A</button><button id="b">B</button><p id="c">C</p><section id="nested"><button id="child">Child</button></section><button id="back">Back</button><button id="front">Front</button></body></html>`;
const errors=new WeakMap();
test.beforeEach(async({page})=>{const list=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
async function load(page,imported=false,z=1){
 await page.goto('/');
 if(imported){await page.click('#toggle-left');await page.setInputFiles('#file-input',{name:'index.html',mimeType:'text/html',buffer:Buffer.from(html)});await page.waitForFunction(()=>isIframeLoaded);await page.waitForTimeout(160);await page.click('#toggle-left');}
 else await page.evaluate(()=>{addShape('rect');addShape('rect');addShape('rect');items.forEach((it,i)=>{it.id=['a','b','c'][i];it.x=100+180*i;it.y=100;it.w=100;it.h=80;});setDemoSelection([]);renderDemo();});
 await page.evaluate(z=>{zoom=z;zoomRevision++;refreshLayoutAndRulers();},z);await page.waitForTimeout(220);
}
async function point(page,x,y,imported){return page.evaluate(({x,y,imported})=>{const r=(imported?importedFrame:artboard).getBoundingClientRect();return{x:r.left+x*zoom,y:r.top+y*zoom};},{x,y,imported});}
async function clickItem(page,id,imported,mod){
 const p=await page.evaluate(({id,imported})=>{if(!imported){const it=items.find(i=>i.id===id),r=artboard.getBoundingClientRect();return{x:r.left+(it.x+20)*zoom,y:r.top+(it.y+20)*zoom};}const r=importedFrame.contentDocument.getElementById(id).getBoundingClientRect(),fr=importedFrame.getBoundingClientRect();return{x:fr.left+(r.left+20)*zoom,y:fr.top+(r.top+20)*zoom};},{id,imported});
 if(mod)await page.keyboard.down(mod);await page.mouse.click(p.x,p.y);if(mod)await page.keyboard.up(mod);
}
async function selection(page,imported){return page.evaluate(imported=>imported?importedSelectedElements.map(el=>el.id):selectedIds,imported);}
async function drag(page,a,b){await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();}
for(const imported of [false,true])for(const mod of ['Control','Meta'])test(`${imported?'iframe':'canvas'} ${mod} adds/removes exactly once; plain selected drag preserves group`,async({page})=>{
 await load(page,imported);await clickItem(page,'a',imported);await clickItem(page,'b',imported,mod);expect(await selection(page,imported)).toEqual(['a','b']);
 await clickItem(page,'b',imported,mod);expect(await selection(page,imported)).toEqual(['a']);await clickItem(page,'b',imported,mod);
 await page.click('#group-btn');const a=await point(page,170,170,imported);await page.keyboard.down('Alt');await drag(page,a,{x:a.x+45,y:a.y+25});await page.keyboard.up('Alt');
 expect(await selection(page,imported)).toEqual(['a','b']);
 const moved=await page.evaluate(imported=>imported?importedSelectedElements.map(el=>recordFor(el,false)?.layoutIntent?.referenceOffset):selectedDemoItems().map(i=>({x:i.x,y:i.y})),imported);
 if(imported){expect(moved[0].x).toBeCloseTo(45,0);expect(moved[1].x).toBeCloseTo(45,0);}else{expect(moved[0].x).toBeCloseTo(145,0);expect(moved[1].x).toBeCloseTo(325,0);}
});
for(const imported of [false,true])test(`${imported?'iframe':'canvas'} blank and explicit rectangle select, empty box clears, cancel keeps selection`,async({page})=>{
 await load(page,imported,.75);await page.click('#box-select');
 const a=await point(page,imported?110:80,imported?110:80,imported),b=await point(page,imported?430:410,imported?230:210,imported);
 await drag(page,a,b);expect(await selection(page,imported)).toEqual(['a','b']);await expect(page.locator('#selection-marquee')).toBeHidden();
 await page.click('#toggle-right');await expect(page.locator('.deep-inspect-item')).toHaveCount(2);
 await page.locator('#batch-size').fill('28');await page.locator('#batch-radius').click();
 const sizes=await page.evaluate(imported=>imported?importedSelectedElements.map(el=>el.ownerDocument.defaultView.getComputedStyle(el).fontSize):selectedDemoItems().map(i=>i.fontSize),imported);expect(sizes).toEqual(imported?['28px','28px']:[28,28]);
 await page.click('#toggle-right');await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(a.x+15,a.y+15);await page.keyboard.press('Escape');await page.mouse.up();expect(await selection(page,imported)).toEqual(['a','b']);
 const empty=await point(page,900,300,imported);await drag(page,empty,{x:empty.x+30,y:empty.y+30});expect(await selection(page,imported)).toEqual([]);
 await page.click('#box-select');await drag(page,a,b);expect(await selection(page,imported)).toEqual(['a','b']);
});
test('iframe rectangle contains obscured and nested items, partial overlaps are excluded, additive list matches',async({page})=>{
 await load(page,true);await page.click('#box-select');const a=await point(page,100,310,true),b=await point(page,665,500,true);await drag(page,a,b);
 expect(await selection(page,true)).toEqual(expect.arrayContaining(['nested','child','back','front']));await page.click('#toggle-right');await expect(page.locator('.deep-inspect-item')).toHaveCount(4);
 await page.locator('.deep-inspect-item').nth(1).click();expect(await selection(page,true)).toEqual(['child']);
 await page.click('#toggle-right');await page.waitForTimeout(220);await page.keyboard.down('Control');const c=await point(page,130,125,true),d=await point(page,420,240,true);await drag(page,c,d);await page.keyboard.up('Control');expect(await selection(page,true)).toEqual(['child','a','b']);
});
for(const z of [1,.75,.46])test(`iframe reference line real drag at ${z} with body offsets matches +/-1px`,async({page})=>{
 await load(page,true,z);await page.click('#add-vertical-guide');const a=await point(page,640,270,true),b=await point(page,736,270,true);await page.keyboard.down('Alt');await drag(page,a,b);await page.keyboard.up('Alt');
 expect(await page.evaluate(()=>importedManualGuides[0].position)).toBeCloseTo(736,0);
 const computed=await page.evaluate(()=>{const r=importedFrame.contentDocument.querySelector('.manual-guide').getBoundingClientRect();return r.left+importedFrame.contentWindow.scrollX;});expect(Math.abs(computed-736)).toBeLessThanOrEqual(1);
 await page.click('#quick-save');await page.reload();await page.waitForFunction(()=>isIframeLoaded);expect(await page.evaluate(()=>importedManualGuides[0].position)).toBeCloseTo(736,0);
});
for(const imported of [false,true])test(`${imported?'iframe':'canvas'} actual pan and 500px measure don't move/select source at 75%`,async({page})=>{
 await load(page,imported,.75);await clickItem(page,'a',imported);const before=await selection(page,imported);
 await page.setViewportSize({width:1440,height:420});await page.click('#pan-tool');await page.evaluate(()=>{canvasScroll.scrollTop=50;});const p=await point(page,800,380,imported);await drag(page,p,{x:p.x,y:p.y-70});expect(await page.evaluate(()=>canvasScroll.scrollTop)).toBeGreaterThan(100);expect(await selection(page,imported)).toEqual(before);
 await page.setViewportSize({width:1440,height:1000});await page.click('#measure-tool');await page.click('#snap-toggle');const start=await point(page,100,100,imported),end=await point(page,400,500,imported);await page.mouse.click(start.x,start.y);await page.mouse.move(end.x,end.y);await page.mouse.click(end.x,end.y);
 await expect(page.locator('#measure-label')).toContainText('500 px');expect(await selection(page,imported)).toEqual(before);
 expect(await page.evaluate(()=>({x:measureEnd.x-measureStart.x,y:measureEnd.y-measureStart.y}))).toEqual({x:300,y:400});
});
test('iframe internal scroll converts guide and ruler once, marker remains at clicked screen point',async({page})=>{
 await load(page,true,.75);await page.evaluate(()=>importedFrame.contentWindow.scrollTo(60,100));await page.click('#add-vertical-guide');
 const a=await point(page,640,250,true),b=await point(page,730,250,true);await page.keyboard.down('Alt');await drag(page,a,b);await page.keyboard.up('Alt');expect(await page.evaluate(()=>importedManualGuides[0].position)).toBeCloseTo(790,0);
 await page.click('#measure-tool');await page.click('#snap-toggle');const start=await point(page,100,100,true),end=await point(page,400,500,true);await page.mouse.click(start.x,start.y);await page.mouse.click(end.x,end.y);await expect(page.locator('#measure-label')).toContainText('500 px');
 const line=await page.locator('#measure-line').boundingBox();expect(line.x).toBeCloseTo(start.x,0);expect(await page.evaluate(()=>measureStart)).toEqual({x:160,y:200});
});
for(const imported of [false,true])test(`${imported?'iframe':'canvas'} erase sweep crosses two manual lines and undo restores entire sweep`,async({page})=>{
 await load(page,imported,.75);await page.evaluate(imported=>{guideMode='live';guidesVisible=true;const list=[{kind:'vertical',position:600},{kind:'vertical',position:760}];if(imported){importedManualGuides=list;renderImportedGuides();}else{manualGuides=list;renderGuides();}},imported);
 await page.click('#guide-eraser');const a=await point(page,570,250,imported),b=await point(page,800,250,imported);await drag(page,a,b);
 expect(await page.evaluate(imported=>imported?importedManualGuides.length:manualGuides.length,imported)).toBe(0);expect(await page.evaluate(()=>isErasing)).toBe(false);
 await page.click('#undo');expect(await page.evaluate(imported=>imported?importedManualGuides.length:manualGuides.length,imported)).toBe(2);
});
for(const imported of [false,true])test(`${imported?'iframe':'canvas'} multi has move-only handles, single has nine and locked multi cannot move`,async({page})=>{
 await load(page,imported);await clickItem(page,'a',imported);await clickItem(page,'b',imported,'Control');
 if(imported){await expect(page.frameLocator('#imported-frame').locator('#ui-editor-overlay .resize-handle:visible')).toHaveCount(1);}else await expect(page.locator('.demo-selection-overlay .resize-handle:visible')).toHaveCount(2);
 await page.click('#lock-position');if(imported)await expect(page.frameLocator('#imported-frame').locator('#ui-editor-overlay .resize-handle:visible')).toHaveCount(0);else await expect(page.locator('.demo-selection-overlay .resize-handle:visible')).toHaveCount(0);
 await page.click('#lock-position');await clickItem(page,'b',imported,'Control');
 if(imported)await expect(page.frameLocator('#imported-frame').locator('#ui-editor-overlay .resize-handle:visible')).toHaveCount(9);else await expect(page.locator('.demo-selection-overlay .resize-handle:visible')).toHaveCount(9);
});
test('pointercancel rolls source drag back, no old handler survives and helper nodes stay out of export',async({page})=>{
 await load(page,true);await clickItem(page,'a',true);const initial=await page.evaluate(()=>JSON.stringify(appearanceRecords));const a=await point(page,170,170,true);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(a.x+50,a.y+20);
 await page.evaluate(()=>importedFrame.contentDocument.dispatchEvent(new importedFrame.contentWindow.PointerEvent('pointercancel',{pointerId:1})));await page.mouse.up();expect(await page.evaluate(()=>JSON.stringify(appearanceRecords))).toBe(initial);
 expect(await page.evaluate(()=>cancelEditorGesture)).toBeNull();await page.mouse.move(a.x+100,a.y+70);expect(await page.evaluate(()=>JSON.stringify(appearanceRecords))).toBe(initial);
 const pending=page.waitForEvent('download');await page.click('#export');const download=await pending;const out=fs.readFileSync(await download.path(),'utf8');expect(out).not.toContain('data-vf-helper');expect(out).not.toContain('ui-editor-overlay');expect(out).not.toContain('selection-marquee');
});

test('nested rectangle selection moves parent and child once, records only independent top-level motion',async({page})=>{
 await load(page,true,.75);await page.click('#box-select');await drag(page,await point(page,110,310,true),await point(page,370,500,true));expect(await selection(page,true)).toEqual(['nested','child']);await page.click('#box-select');
 const before=await page.evaluate(()=>['nested','child'].map(id=>{const r=importedFrame.contentDocument.getElementById(id).getBoundingClientRect();return{x:r.left,y:r.top};}));
 const overlay=await page.frameLocator('#imported-frame').locator('#ui-editor-overlay .resize-handle.c').boundingBox();await page.keyboard.down('Alt');await drag(page,{x:overlay.x+overlay.width/2,y:overlay.y+overlay.height/2},{x:overlay.x+overlay.width/2+30,y:overlay.y+overlay.height/2+15});await page.keyboard.up('Alt');
 const after=await page.evaluate(()=>['nested','child'].map(id=>{const r=importedFrame.contentDocument.getElementById(id).getBoundingClientRect();return{x:r.left,y:r.top};}));
 for(let i=0;i<2;i++){expect(after[i].x-before[i].x).toBeCloseTo(40,0);expect(after[i].y-before[i].y).toBeCloseTo(20,0);}
});
for(const imported of [false,true])test(`${imported?'iframe':'canvas'} cancelled guide copy removes new copy; blur cancels erased lines and mid-drag`,async({page})=>{
 await load(page,imported,.75);await page.click('#add-vertical-guide');const start=await point(page,640,260,imported);await page.keyboard.down('Control');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+50,start.y);await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('Control');
 expect(await page.evaluate(imported=>imported?importedManualGuides.length:manualGuides.length,imported)).toBe(1);
 await page.click('#guide-eraser');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.evaluate(imported=>(imported?importedFrame.contentWindow:window).dispatchEvent(new Event('blur')),imported);await page.mouse.up();
 expect(await page.evaluate(imported=>imported?importedManualGuides.length:manualGuides.length,imported)).toBe(1);expect(await page.evaluate(()=>isErasing)).toBe(false);
});
for(const imported of [false,true])test(`${imported?'iframe':'canvas'} swept generated guide deletion is one undo transaction`,async({page})=>{
 await load(page,imported,.75);await clickItem(page,'a',imported);await page.click('#toggle-guides');
 const initial=await page.evaluate(imported=>imported?hiddenImportedGuideKeys.length:hiddenDemoGuideKeys.length,imported);
 await page.click('#guide-eraser');await drag(page,await point(page,100,250,imported),await point(page,250,250,imported));
 expect(await page.evaluate(imported=>imported?hiddenImportedGuideKeys.length:hiddenDemoGuideKeys.length,imported)).toBeGreaterThan(initial);
 await page.click('#undo');expect(await page.evaluate(imported=>imported?hiddenImportedGuideKeys.length:hiddenDemoGuideKeys.length,imported)).toBe(initial);
});
test('source batch edits only explicit color/radius, not geometry, original text or unselected sibling',async({page})=>{
 await load(page,true);await clickItem(page,'a',true);await clickItem(page,'b',true,'Control');await page.click('#toggle-right');await page.waitForTimeout(180);
 const before=await page.evaluate(()=>['a','b','c'].map(id=>{const el=importedFrame.contentDocument.getElementById(id),r=el.getBoundingClientRect();return{id,text:el.textContent,x:r.x,y:r.y,width:r.width,height:r.height};}));
 await page.locator('#batch-bg').fill('#123456');await page.locator('#batch-radius').fill('16');await page.locator('#batch-size').click();
 const after=await page.evaluate(()=>['a','b','c'].map(id=>{const el=importedFrame.contentDocument.getElementById(id),r=el.getBoundingClientRect();return{id,text:el.textContent,x:r.x,y:r.y,width:r.width,height:r.height};}));expect(after).toEqual(before);
 const records=await page.evaluate(()=>Object.values(appearanceRecords).map(r=>({id:r.target.id,styles:r.styles})));expect(records).toHaveLength(2);for(const rec of records)expect(rec.styles).toEqual({'background-color':'#123456','border-radius':'16px'});
 await page.click('#undo');expect(await page.evaluate(()=>Object.values(appearanceRecords).map(r=>r.styles['border-radius']))).toEqual([undefined,undefined]);
});

test('batch refuses hidden all-matching scope instead of affecting unselected source siblings',async({page})=>{
 await load(page,true);await clickItem(page,'a',true);await page.evaluate(()=>{const rec=recordFor(importedSelected);rec.scope='all-matching';rec.matchingSelector='button';rec.styles['background-color']='#dddddd';refreshAppearanceStyles();});
 await clickItem(page,'b',true,'Control');await page.click('#toggle-right');await page.waitForTimeout(180);const before=await page.evaluate(()=>JSON.stringify(appearanceRecords));
 await page.locator('#batch-radius').fill('22');await page.locator('#batch-size').click();expect(await page.evaluate(()=>JSON.stringify(appearanceRecords))).toBe(before);await expect(page.locator('#status-text')).toContainText('仅此元素');
});
