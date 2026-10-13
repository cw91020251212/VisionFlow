const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

test('folder embeds nested CSS imports images fonts scripts, lists entry pages and reports missing resources',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const files=[
      ['site/index.html','<!doctype html><link rel="stylesheet" href="css/main.css"><img id="image" src="img/icon.svg"><a id="link" href="pages/about.html">About</a><script src="js/main.js"></script>','text/html'],
      ['site/pages/about.html','<!doctype html><h1>About page</h1>','text/html'],
      ['site/css/main.css','@import "base.css"; #image{width:48px;height:48px;background:url(../img/icon.svg)} @font-face{font-family:Demo;src:url(../font/demo.woff2)}','text/css'],
      ['site/css/base.css','body{background:rgb(210,220,230)}','text/css'],
      ['site/img/icon.svg','<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="red"/></svg>','image/svg+xml'],
      ['site/font/demo.woff2','test-font','font/woff2'],
      ['site/js/main.js','window.folderScriptRan=true;','text/javascript']
    ].map(([name,content,type])=>{const f=new File([content],name.split('/').at(-1),{type});Object.defineProperty(f,'webkitRelativePath',{value:name});return f;});
    const result=await VFFolder.prepare(files);
    await loadSelectedFiles(files);
    return {html:result.html,pages:result.pages,entry:result.entryPath,warnings:result.warnings};
  });
  expect(result.entry).toBe('index.html');expect(result.pages.map(p=>p.path)).toEqual(['index.html','pages/about.html']);
  expect(result.html).toContain('data:image/svg+xml;base64,');expect(result.html).toContain('data:font/woff2;base64,');expect(result.html).toContain('data:text/javascript;base64,');expect(result.html).not.toContain('blob:');
  await page.waitForFunction(()=>isIframeLoaded && importedFrame.contentDocument.getElementById('image'));
  expect(await page.evaluate(()=>getComputedStyle(importedFrame.contentDocument.body).backgroundColor)).toBe('rgb(210, 220, 230)');
  expect(await page.evaluate(()=>importedFrame.contentWindow.folderScriptRan)).toBeUndefined();
  expect(await page.evaluate(()=>importedFrame.contentDocument.getElementById('link').getAttribute('href'))).toBe('pages/about.html');
  await page.click('#toggle-left');await page.selectOption('#vf-entry-page','pages/about.html');
  await page.waitForFunction(()=>isIframeLoaded && importedFrame.contentDocument.querySelector('h1')?.textContent==='About page');
  expect(await page.evaluate(()=>appearanceSource.page)).toBe('/pages/about.html');
  const warnings=await page.evaluate(async()=>{const result=await VFFolder.prepare([new File(['<!doctype html><img src="missing.png" srcset="a.png 1x,b.png 2x">'],'index.html')]);return result.warnings;});
  expect(warnings.some(w=>w.includes('Missing local resource'))).toBe(true);expect(warnings.some(w=>w.includes('srcset'))).toBe(true);
});

test('file protocol can open editor, import and export without a web server',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'../index.html')).href);
  await page.setInputFiles('#file-input',path.join(__dirname,'fixtures/regression.html'));
  await page.waitForFunction(()=>isIframeLoaded && importedFrame.contentDocument.getElementById('card'));
  await page.evaluate(()=>{selectImported(importedFrame.contentDocument.getElementById('card'));const f=document.getElementById('iborderRadius');f.value=18;f.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(await page.evaluate(()=>collectAppearanceData().changes[0].styles['border-radius'])).toBe('18px');
  expect(await page.evaluate(()=>buildAppearanceHtml())).toContain('visionflow-appearance-v1');expect(errors).toEqual([]);
});
