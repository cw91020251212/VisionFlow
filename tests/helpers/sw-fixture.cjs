const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=path.join(__dirname,'../..');
// A mutable loopback-only fixture tests real service-worker installation/update.
// It serves app files only, with no credentials or user data; closes after each test.
async function fixtureServer() {
 const state={version:'v1',missing:false,networkFailure:false};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'), name=url.pathname.split('/').at(-1)||'index.html';
  if(url.pathname==='/other/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));');return;}
  if(state.networkFailure && name==='sw.js' && url.searchParams.has('maintenance-check')){res.writeHead(503);res.end('offline');return;}
  if(!url.pathname.startsWith('/project/') || !['index.html','sw.js','appearance.js','folder-import.js','canvas.js','project-io.js','workspace-state.js','pointer-tools.js','delivery.js','background-image.js','maintenance.js','toolbar-scroll.js','manifest.json','icon.png','icon-192.png','icon-512.png','apple-touch-icon.png'].includes(name)){res.writeHead(404);res.end();return;}
  if(state.missing && name==='delivery.js'){res.writeHead(404);res.end();return;}
  let body=fs.readFileSync(path.join(root,name));
  if(name==='sw.js')body=Buffer.from(body.toString().replace(/const APP_VERSION = '[^']+';/,`const APP_VERSION = ${JSON.stringify(state.version)};`));
  if(name==='index.html')body=Buffer.from(body.toString().replace('</head>',`<meta name="fixture-version" content="${state.version}"></head>`));
  if(name==='delivery.js')body=Buffer.from(`globalThis.fixtureShellVersion=${JSON.stringify(state.version)};\n`+body.toString());
  res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'image/png','Cache-Control':'no-store'});res.end(body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{state,url:`http://127.0.0.1:${server.address().port}/project/`,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function offlineReady(page,url){await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
module.exports={fixtureServer,offlineReady};
