'use strict';

const BACKGROUND_DATA_LIMIT = 2 * 1024 * 1024;
const BACKGROUND_KEYS = ['background-image','background-size','background-position','background-repeat'];
let backgroundRequestSequence = 0;
function cancelBackgroundUpload() { backgroundRequestSequence++; }
function rasterMime(bytes) {
  if ([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)) return 'image/png';
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP') return 'image/webp';
  return null;
}
function safeRasterDataUrl(value) {
  if(typeof value!=='string' || value.length>BACKGROUND_DATA_LIMIT)return false;
  const match=value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match || match[2].length%4)return false;
  try { return rasterMime(Uint8Array.from(atob(match[2].slice(0,32)),c=>c.charCodeAt(0)))===match[1]; }
  catch { return false; }
}
function safeBackgroundImage(value) {
  const match=typeof value==='string' && value.match(/^url\("(data:[^"]+)"\)$/);
  return !!match && safeRasterDataUrl(match[1]);
}
function safeAppearanceStyle(key,value) {
  if(!STYLE_ALLOWLIST.has(key) || typeof value!=='string')return false;
  if(key==='background-image' && safeBackgroundImage(value))return true;
  // A narrowly validated raster URL is the only URL exception. Escapes are not
  // accepted here, so an escaped url()/rule boundary can't bypass the checks.
  if(/[;{}<>\\\u0000-\u001f]|url\s*\(|expression\s*\(/i.test(value))return false;
  if(key==='background-image' && value!=='none' && !/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value))return false;
  return CSS.supports(key,value);
}
async function readBackgroundFile(file) {
  if(file.size>10*1024*1024)throw new Error('圖片超過10MiB；請先縮小檔案。');
  const mime=rasterMime(new Uint8Array(await file.slice(0,32).arrayBuffer()));
  if(!mime)throw new Error('只支援真正的PNG、JPEG或WebP圖片，不接受SVG、GIF或偽裝檔案。');
  const blobUrl=URL.createObjectURL(file),image=new Image();
  try {
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('圖片無法解碼，原背景未更改。'));image.src=blobUrl;});
    const width=image.naturalWidth,height=image.naturalHeight;
    if(!width || !height || Math.max(width,height)>12000 || width*height>36000000)throw new Error('圖片尺寸過大（上限12000px／36MP）；請先縮小。');
    let data;
    if(Math.max(width,height)<=2048 && file.size<BACKGROUND_DATA_LIMIT*.7) data=await fileAsDataUrl(new File([file],'background',{type:mime}));
    else {
      const ratio=Math.min(1,2048/Math.max(width,height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
      const context=canvas.getContext('2d');if(!context)throw new Error('瀏覽器無法建立圖片畫布。');
      context.drawImage(image,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/webp',.9);
    }
    if(!safeRasterDataUrl(data))throw new Error('處理後圖片仍超過2MiB，或格式不受支援；請縮小後重試。');
    return data;
  } finally {image.src='';URL.revokeObjectURL(blobUrl);}
}
function backgroundSettings() {
  if(importedMode && importedSelected) {
    const css=importedSelected.ownerDocument.defaultView.getComputedStyle(importedSelected);
    return {image:css.backgroundImage,size:css.backgroundSize,position:css.backgroundPosition,repeat:css.backgroundRepeat};
  }
  const item=selectedDemo();return {image:item?.backgroundImage||'none',size:item?.backgroundSize||'cover',position:item?.backgroundPosition||'50% 50%',repeat:item?.backgroundRepeat||'no-repeat'};
}
function backgroundInspectorFields() {
  const settings=backgroundSettings(),hasImage=settings.image.includes('url(');
  const sized=settings.size.match(/^(\d+(?:\.\d+)?)%\s*(?:auto)?$/),mode=['cover','contain'].includes(settings.size)?settings.size:sized?'custom':'keep';
  const position=settings.position.match(/^(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
  const x=position?clamp(Number(position[1]),0,100):50,y=position?clamp(Number(position[2]),0,100):50;
  return `<section class="section" id="bg-panel"><h2 class="panel-title">背景貼圖</h2>
    <p class="hint">${hasImage?'目前已有背景圖片；可直接調整大小、位置或更換。':'為選取標題／容器加背景，不修改其文字或前景圖片。'}${splitCssList(settings.image).length>1?'多層背景：尺寸／位置作用於所有背景層；更換會替換整組圖片／漸層。':''}</p>
    <label class="field full" for="bg-image-file">上傳／更換圖片<input id="bg-image-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <p class="hint">PNG／JPEG／WebP，最多10MiB；大圖按原比例縮到長邊2048px，必要時轉WebP。內嵌最多2MiB，不修改原檔或上傳雲端。</p>
    <div class="form-grid"><div class="field full"><label for="bg-size">貼圖顯示</label><select id="bg-size"><option value="keep" ${mode==='keep'?'selected':''}>保持目前尺寸</option><option value="cover" ${mode==='cover'?'selected':''}>填滿（Cover，可能裁掉邊緣）</option><option value="contain" ${mode==='contain'?'selected':''}>完整顯示（Contain，可能留白）</option><option value="custom" ${mode==='custom'?'selected':''}>自訂圖片寬度比例</option></select></div>
    <div class="field full"><label for="bg-scale">圖片寬度比例（10–400%）</label><input id="bg-scale" type="number" min="10" max="400" value="${sized?sized[1]:100}" ${mode==='custom'?'':'disabled'}></div>
    <div class="field"><label for="bg-x">水平位置（0左／50中／100右）</label><input id="bg-x" type="range" min="0" max="100" value="${x}" ${hasImage?'':'disabled'}></div>
    <div class="field"><label for="bg-y">垂直位置（0上／50中／100下）</label><input id="bg-y" type="range" min="0" max="100" value="${y}" ${hasImage?'':'disabled'}></div>
    <div class="field full"><label for="bg-repeat">貼圖重複</label><select id="bg-repeat">${[['keep','保持目前方式'],['no-repeat','不重複'],['repeat','橫直重複（紋理）'],['repeat-x','只橫向重複'],['repeat-y','只垂直重複']].map(([value,label])=>`<option value="${value}" ${(settings.repeat===value || value==='keep'&&!['no-repeat','repeat','repeat-x','repeat-y'].includes(settings.repeat))?'selected':''}>${label}</option>`).join('')}</select></div></div>
    <div style="display:flex;gap:6px;margin-top:8px"><button class="button" data-bg-action="remove">移除貼圖</button>${importedMode?'<button class="button" data-bg-action="restore">還原原背景</button>':''}</div>
    <p class="hint" id="bg-result" role="status">背景大小：${escapeHtml(settings.size)}；位置：${escapeHtml(settings.position)}。${importedMode?'原遠端貼圖仍需網路；上傳新圖會內嵌。':''}不是修圖工具，無法修改圖片內的文字或像素。</p></section>`;
}
function writeBackgroundStyles(styles,restore=false) {
  if(importedMode) {
    const record=recordFor(importedSelected);
    if(restore)BACKGROUND_KEYS.forEach(key=>delete record.styles[key]);
    else Object.assign(record.styles,styles);
    const state=ensureImportedState(importedSelected);state.context='';
    refreshAppearanceStyles();syncStateContext(importedSelected);updateImportedOverlay();renderImportedGuides();
  } else {
    const item=selectedDemo(),map={'background-image':'backgroundImage','background-size':'backgroundSize','background-position':'backgroundPosition','background-repeat':'backgroundRepeat'};
    for(const [key,value]of Object.entries(styles))item[map[key]]=value;
    if('background-image'in styles)item.gradient=false;
    renderDemo();
  }
  scheduleAppearanceSave();
}
function activeSingleBackground() {return importedMode?importedSelectedElements.length===1 && importedSelected?.isConnected:selectedIds.length===1 && !!selectedDemo();}
async function uploadSelectedBackground(field) {
  const file=field.files?.[0];if(!file || !activeSingleBackground())return;
  const request=++backgroundRequestSequence,mode=importedMode,target=mode?importedSelected:selectedDemo(),generation=sourceGeneration,viewport=viewportMode,state=appearanceState;
  const scope=mode?recordFor(target,false)?.scope||'this-element':null;
  function stillCurrent(){return request===backgroundRequestSequence && field.isConnected && mode===importedMode && generation===sourceGeneration && viewport===viewportMode && state===appearanceState && activeSingleBackground() && target===(mode?importedSelected:selectedDemo()) && (!mode || scope===(recordFor(target,false)?.scope||'this-element'));}
  document.getElementById('bg-result').textContent='正在讀取本機圖片…';
  try {
    const data=await readBackgroundFile(file);if(!stillCurrent())return;
    savePoint();writeBackgroundStyles({'background-image':`url("${data}")`,'background-size':'cover','background-position':'50% 50%','background-repeat':'no-repeat'});
    isTyping=false;demoFieldDirty=false;mode?renderImportedInspector():renderDemoInspector();
    setStatus('背景貼圖已內嵌，可調大小／位置／重複；HTML與JSON可回讀。原文字、前景圖片與業務未更改。');
  } catch(error){if(stillCurrent()){document.getElementById('bg-result').textContent=error.message;setStatus('貼圖未更改：'+error.message);}}
}
function updateBackgroundField(event,commit) {
  const field=event.target;if(!field.id?.startsWith('bg-'))return false;
  if(!activeSingleBackground())return true;
  if(field.id==='bg-image-file'){if(event.type==='change')void uploadSelectedBackground(field);return true;}
  const settings=backgroundSettings();let styles;
  if(field.id==='bg-size') {
    document.getElementById('bg-scale').disabled=field.value!=='custom';
    if(field.value==='keep')return true;
    styles={'background-size':field.value==='custom'?`${clamp(Number(document.getElementById('bg-scale').value),10,400)}% auto`:field.value};
  } else if(field.id==='bg-scale') {
    if(document.getElementById('bg-size').value!=='custom' || !field.value)return true;
    styles={'background-size':`${clamp(Number(field.value),10,400)}% auto`};
  } else if(field.id==='bg-x' || field.id==='bg-y') {
    if(!settings.image.includes('url('))return true;
    styles={'background-position':`${clamp(Number(document.getElementById('bg-x').value),0,100)}% ${clamp(Number(document.getElementById('bg-y').value),0,100)}%`};
  } else if(field.id==='bg-repeat'){if(field.value==='keep')return true;styles={'background-repeat':field.value};}
  else return true;
  if(!Object.entries(styles).every(([key,value])=>safeAppearanceStyle(key,value)))return true;
  const dirty=importedMode?ensureImportedState(importedSelected).fieldDirty:demoFieldDirty;
  if(!dirty)savePoint();
  if(importedMode)ensureImportedState(importedSelected).fieldDirty=!commit;else demoFieldDirty=!commit;
  isTyping=!commit;writeBackgroundStyles(styles);
  if(commit){isTyping=false;importedMode?renderImportedInspector():renderDemoInspector();}
  return true;
}
function backgroundAction(action) {
  if(!activeSingleBackground())return;
  cancelBackgroundUpload();savePoint();writeBackgroundStyles({'background-image':'none'},action==='restore'&&importedMode);
  isTyping=false;demoFieldDirty=false;importedMode?renderImportedInspector():renderDemoInspector();
  setStatus(action==='restore'?'已還原此視口／狀態的原背景覆寫；原來源及文字保留。':'已移除背景圖片；可復原。原文字／前景圖片未更改。');
}
