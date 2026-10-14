'use strict';

// All editor geometry is in unscaled artboard / source-document pixels.
let boxSelectMode = false;
let isMarquee = false;
let gestureBefore = null;
let gestureHistory = null;
const pointerClickHandled = new WeakMap();
const boundWorkspaces = new WeakSet();
const marquee = document.getElementById('selection-marquee');

function sourceDocument(event) { return event.target?.ownerDocument || document; }
function pointerDocumentPoint(event, doc = sourceDocument(event)) {
  if (doc !== document) return {x:event.clientX + doc.defaultView.scrollX, y:event.clientY + doc.defaultView.scrollY};
  const rect = artboard.getBoundingClientRect();
  return {x:(event.clientX - rect.left)/zoom, y:(event.clientY - rect.top)/zoom};
}
function pointerHostPoint(event, doc = sourceDocument(event)) {
  if (doc === document) return {x:event.clientX,y:event.clientY};
  const rect = importedFrame.getBoundingClientRect();
  return {x:rect.left + event.clientX*zoom,y:rect.top + event.clientY*zoom};
}
function documentRect(element) {
  const r=element.getBoundingClientRect(), win=element.ownerDocument.defaultView;
  return {left:r.left+win.scrollX,top:r.top+win.scrollY,right:r.right+win.scrollX,bottom:r.bottom+win.scrollY,width:r.width,height:r.height};
}
function helperRoot(doc) {
  let root=doc.querySelector('[data-vf-helper="root"]');
  if (!root) {
    root=doc.createElement('div');root.dataset.vfHelper='root';
    for(const [key,value] of Object.entries({position:'absolute',left:'0px',top:'0px',width:'0px',height:'0px',margin:'0px',padding:'0px',border:'0px',overflow:'visible','pointer-events':'none','z-index':'2147483646'}))root.style.setProperty(key,value,'important');
    doc.documentElement.appendChild(root);
  }
  return root;
}
function setImportedSelection(elements) {
  importedSelectedElements=importedSelectionWithGroups([...new Set(elements.filter(isCandidate))]);
  importedSelected=importedSelectedElements[0]||null;
  importedSelectedElements.forEach(syncStateContext);
  if(guideArmed && importedSelectedElements.length===1){importedGuideTargets=[...new Set([...importedGuideTargets,importedSelected])];guideArmed=false;guideMode='live';guidesVisible=true;renderImportedGuides();updateToolButtons();}
  updateImportedOverlay();renderLayers();updateGroupButtonState();if(!isTyping)renderImportedInspector();scheduleAppearanceSave();
}
function commitSelection(value, additive=false, toggle=false) {
  const members=importedMode ? importedSelectionWithGroups([value]) : items.filter(i=>i.id===value || (items.find(x=>x.id===value)?.groupId && i.groupId===items.find(x=>x.id===value).groupId)).map(i=>i.id);
  const current=importedMode?importedSelectedElements:selectedIds;
  const selected=current.includes(value);
  const next=additive ? (toggle && selected ? current.filter(x=>!members.includes(x)) : [...new Set([...current,...members])]) : members;
  if(importedMode)setImportedSelection(next);else{setDemoSelection(next);renderLayers();if(!isTyping)renderDemoInspector();}
}
function preparePointerSelection(event,value) {
  pointerClickHandled.set(sourceDocument(event),true);
  const current=importedMode?importedSelectedElements:selectedIds;
  if(event.ctrlKey || event.metaKey){commitSelection(value,true,true);return (importedMode?importedSelectedElements:selectedIds).includes(value);}
  if(!current.includes(value))commitSelection(value);
  return true;
}
function clickSelection(event,value) {
  if(sourceDocument(event)!==document && (eraserMode || panMode || measureMode || boxSelectMode))return;
  commitSelection(value,event.ctrlKey || event.metaKey,true);
  if(!importedMode)renderDemo();
}
function abortPointerGesture() {
  const raw=cancelEditorGesture?gestureBefore:null, oldHistory=gestureHistory;
  cancelTransientTools();gestureBefore=null;gestureHistory=null;
  if(raw){restoreSnapshot(raw);if(oldHistory){history=oldHistory.history;future=oldHistory.future;updateHistoryButtons();}}
  if(measureState==='measuring'){measureState='idle';measureStart={x:0,y:0};measureEnd={x:0,y:0};updateMeasureLine();}
  isMarquee=false;marquee.style.display='none';
}
function runPointerGesture(event,doc,move,finish) {
  const capture=doc.documentElement;
  try{capture.setPointerCapture(event.pointerId);}catch{}
  function stop(e={cancelled:true}) {
    if(!e.cancelled && e.pointerId!==event.pointerId)return;
    doc.removeEventListener('pointermove',onMove,true);doc.removeEventListener('pointerup',stop,true);
    cancelEditorGesture=null;
    try{capture.releasePointerCapture(event.pointerId);}catch{}
    finish(e);if(!e.cancelled)scheduleAppearanceSave();
  }
  function onMove(e){if(e.pointerId!==event.pointerId)return;e.preventDefault();move(e);}
  doc.addEventListener('pointermove',onMove,true);doc.addEventListener('pointerup',stop,true);
  registerEditorGesture(()=>stop({cancelled:true}));
}
function beginPan(event,doc) {
  const start=pointerHostPoint(event,doc), scroll={x:canvasScroll.scrollLeft,y:canvasScroll.scrollTop};
  isPanning=true;app.classList.add('panning');
  runPointerGesture(event,doc,e=>{const point=pointerHostPoint(e,doc);canvasScroll.scrollLeft=scroll.x-(point.x-start.x);canvasScroll.scrollTop=scroll.y-(point.y-start.y);},()=>{isPanning=false;app.classList.remove('panning');drawRulers();});
}
function measurePoint(event,doc) {
  const p=pointerDocumentPoint(event,doc);
  return event.altKey?{...p,snapped:false}:resolveSnap(p.x,p.y,snapGeometry([],true));
}
function finishMeasure(event,doc) {
  const p=measurePoint(event,doc);
  if(measureState==='measuring'){measureEnd={x:p.x,y:p.y};measureState='done';setStatus('尺寸已鎖定。關閉量尺仍保持結果；再點畫布開始新量度。');}
  else{measureStart={x:p.x,y:p.y};measureEnd={...measureStart};measureState='measuring';}
  updateMeasureLine();scheduleAppearanceSave();
}
function updatePointerFeedback(event,doc) {
  if(snapDragActive || isPanning || isMarquee || isErasing || guideDrag)return;
  if(!measureMode && !activeSnapHover)return;
  const p=measurePoint(event,doc);
  if(p.snapped)drawSnapFeedback(p);else clearSnapFeedback();
  if(measureMode && measureState==='measuring'){measureEnd={x:p.x,y:p.y};updateMeasureLine();}
}
function beginMarquee(event,doc) {
  const start=pointerHostPoint(event,doc), original=importedMode?[...importedSelectedElements]:[...selectedIds];
  let end=start;
  isMarquee=true;marquee.style.display='block';
  const display=()=>Object.assign(marquee.style,{left:Math.min(start.x,end.x)+'px',top:Math.min(start.y,end.y)+'px',width:Math.abs(end.x-start.x)+'px',height:Math.abs(end.y-start.y)+'px'});
  display();
  runPointerGesture(event,doc,e=>{end=pointerHostPoint(e,doc);display();},e=>{
    isMarquee=false;marquee.style.display='none';if(e.cancelled)return;
    const box={left:Math.min(start.x,end.x),top:Math.min(start.y,end.y),right:Math.max(start.x,end.x),bottom:Math.max(start.y,end.y)};
    const candidates=importedMode ? importedLayers.map(l=>l.element) : [...artboard.querySelectorAll('.demo-item')];
    const found=[];
    if(box.right-box.left>=4 || box.bottom-box.top>=4)for(const el of candidates){
      const r=el.getBoundingClientRect(), style=el.ownerDocument.defaultView.getComputedStyle(el);
      if(!r.width || !r.height || style.visibility==='hidden' || style.display==='none')continue;
      const fr=importedMode?importedFrame.getBoundingClientRect():null;
      const view=fr?{left:fr.left+r.left*zoom,top:fr.top+r.top*zoom,right:fr.left+r.right*zoom,bottom:fr.top+r.bottom*zoom}:r;
      if(view.left>=box.left-.5 && view.right<=box.right+.5 && view.top>=box.top-.5 && view.bottom<=box.bottom+.5)found.push(importedMode?el:el.dataset.id);
    }
    const next=event.ctrlKey || event.metaKey?[...new Set([...original,...found])]:found;
    if(importedMode)setImportedSelection(next);else{setDemoSelection(next);renderDemo();renderDemoInspector();}
    setStatus(`已框選 ${next.length} 個圖層；右側列表可逐件選取，外觀欄位可批量套用。`);
  });
}
function guideSegmentHits(a,b,guide,tolerance) {
  const axis=guide.kind==='vertical'?'x':'y';
  return guide.position>=Math.min(a[axis],b[axis])-tolerance && guide.position<=Math.max(a[axis],b[axis])+tolerance;
}
function beginErase(event,doc) {
  let previous=pointerDocumentPoint(event,doc), changed=false;
  isErasing=true;
  const erase=(next)=>{
    const manual=importedMode?importedManualGuides:manualGuides, hidden=importedMode?hiddenImportedGuideKeys:hiddenDemoGuideKeys;
    const hits=manual.filter(g=>guideSegmentHits(previous,next,g,7/zoom));
    const targets=importedMode?importedGuideTargets:items.filter(i=>demoGuideTargets.includes(i.id));
    const keys=[];
    for(const el of targets){const r=importedMode?documentRect(el):{left:el.x,top:el.y,right:el.x+el.w,bottom:el.y+el.h};const id=importedMode?(importedElementIds.get(el)||ensureImportedState(el).target.selector):el.id;
      for(const [edge,kind,position] of [['left','vertical',r.left],['right','vertical',r.right],['center-x','vertical',(r.left+r.right)/2],['top','horizontal',r.top],['bottom','horizontal',r.bottom],['center-y','horizontal',(r.top+r.bottom)/2]]){
        const key=id+':'+edge;if(!hidden.includes(key)&&guideSegmentHits(previous,next,{kind,position},7/zoom))keys.push(key);
      }
    }
    if(hits.length || keys.length){if(!changed){savePoint();changed=true;}const keep=manual.filter(g=>!hits.includes(g));if(importedMode)importedManualGuides=keep;else manualGuides=keep;hidden.push(...keys);selectedManualGuide=null;if(importedMode)renderImportedGuides();else renderGuides();}
    previous=next;
  };
  runPointerGesture(event,doc,e=>erase(pointerDocumentPoint(e,doc)),e=>{isErasing=false;if(!e.cancelled && changed)setStatus('已連續擦除參考線；可一次復原整個擦除手勢。');});
  erase(previous);
}
function bindPointerWorkspace(doc) {
  if(boundWorkspaces.has(doc))return;boundWorkspaces.add(doc);
  doc.addEventListener('pointerdown',event=>{
    if(doc!==document && doc!==importedFrame?.contentDocument)return;
    pointerClickHandled.delete(doc);
    if(doc===document && !event.target.closest?.('#canvas-scroll'))return;
    if(event.button!==0)return;
    if(cancelEditorGesture){event.preventDefault();event.stopImmediatePropagation();return;}
    let action=null;
    if(panMode)action=beginPan;
    else if(measureMode){pointerClickHandled.set(doc,true);event.preventDefault();event.stopImmediatePropagation();finishMeasure(event,doc);return;}
    else if(eraserMode)action=beginErase;
    else if(editing && (boxSelectMode || (doc===document?!event.target.closest('.demo-item,.resize-handle,.guide-line'):event.target===doc.body || event.target===doc.documentElement)))action=beginMarquee;
    if(action){pointerClickHandled.set(doc,true);event.preventDefault();event.stopImmediatePropagation();action(event,doc);}
  },true);
  doc.addEventListener('pointermove',event=>{if(doc!==document || event.target.closest?.('#canvas-scroll'))updatePointerFeedback(event,doc);},true);
  doc.addEventListener('click',event=>{
    if((doc!==document || event.target.closest?.('#canvas-scroll')) && (pointerClickHandled.has(doc) || panMode || measureMode || eraserMode || boxSelectMode)){
      pointerClickHandled.delete(doc);event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  doc.addEventListener('pointercancel',()=>{if(cancelEditorGesture || measureState==='measuring')abortPointerGesture();},true);
  doc.addEventListener('lostpointercapture',()=>{if(cancelEditorGesture)abortPointerGesture();},true);
  doc.defaultView.addEventListener('blur',()=>{if(cancelEditorGesture || measureState==='measuring')abortPointerGesture();});
  doc.addEventListener('keydown',e=>{if(e.key==='Escape' && (cancelEditorGesture || measureState==='measuring')){e.preventDefault();abortPointerGesture();}},true);
}
function choosePointerTool(kind) {
  abortPointerGesture();
  const enabled=kind==='pan'?!panMode:kind==='measure'?!measureMode:kind==='erase'?!eraserMode:!boxSelectMode;
  panMode=kind==='pan'&&enabled;measureMode=kind==='measure'&&enabled;eraserMode=kind==='erase'&&enabled;boxSelectMode=kind==='box'&&enabled;
  if(measureMode || panMode){measureState='idle';measureStart={x:0,y:0};measureEnd={x:0,y:0};}
  updateToolButtons();if(importedMode)renderImportedGuides();else renderGuides();
  setStatus(enabled?({pan:'平移：按住畫布拖動檢視，不改元件位置。',measure:'量尺：點擊起點及終點；尺寸以原頁面像素計算，Alt 暫停吸附。',erase:'擦膠：按住掃過參考線；一次手勢可一次復原。',box:'框選：拖動矩形完整包住圖層，Ctrl/⌘ 可追加；包括遮擋與嵌套圖層。'}[kind]):'工具已關閉。');scheduleAppearanceSave();
}

bindPointerWorkspace(document);

function renderBatchInspector() {
  const selected=importedMode?importedSelectedElements:selectedDemoItems();
  const values=selected.map(el=>importedMode?syncStateContext(el):el);
  const descriptors=[['batch-bg','背景色','color','colorOverride','color'],['batch-color','文字颜色','color','textColor','textColor'],['batch-size','文字大小 (px)','number','fontSize','fontSize'],['batch-radius','圆角 (px)','number','borderRadius','borderRadius'],['batch-border','边框粗细 (px)','number','borderWidth','borderWidth'],['batch-border-color','边框颜色','color','borderColor','borderColor']];
  let fields='';
  for(const [id,label,type,importKey,demoKey] of descriptors){
    const list=values.map(v=>id==='batch-bg'?(importedMode?(v.colorOverride||v.originalColor):v.color):v[importedMode?importKey:demoKey]);
    const same=list.every(v=>v===list[0]);const value=type==='color'?rgbToHex(list[0]):same?list[0]:'';
    fields+=`<div class="field"><label for="${id}">${label}${same?'':'（混合）'}</label><input id="${id}" type="${type}" ${type==='number'?'min="0" max="10000"':''} value="${escapeHtml(value??'')}" placeholder="混合值" title="只修改这一栏；其他样式各自保留"></div>`;
  }
  const families=values.map(v=>v.fontFamily),sameFont=families.every(v=>v===families[0]);
  fields+=`<div class="field full"><label for="batch-font">字體${sameFont?'':'（混合）'}</label><select id="batch-font">${sameFont?'':'<option value="" selected disabled>混合值</option>'}${availableFonts.map(f=>`<option ${sameFont&&f===families[0]?'selected':''}>${escapeHtml(f)}</option>`).join('')}</select></div>`;
  fields+='<div class="field full"><label for="batch-shadow">投影</label><select id="batch-shadow"><option value="" selected disabled>保持各自投影</option><option value="on">开启各自投影</option><option value="off">关闭投影</option></select></div>';
  inspector.innerHTML=renderMultiSelectInfo()+alignmentTools()+`<section class="section"><h2 class="panel-title">批量外观 · ${selected.length} 个图层</h2><p class="hint">仅修改操作的字段；混合值不会自动统一。群组只整体移动，不提供比例缩放。点击上方列表可编辑单件${importedMode?'；文字内容及业务仍受保护':''}。</p><div class="form-grid">${fields}</div></section>`;
}
let batchFieldDirty=false;
function updateBatchAppearance(event,commit) {
  if(!event.target.id.startsWith('batch-'))return false;
  const field=event.target, map={
    'batch-bg':['background-color','color'], 'batch-color':['color','textColor'], 'batch-size':['font-size','fontSize'],
    'batch-radius':['border-radius','borderRadius'], 'batch-border':['border-width','borderWidth'], 'batch-border-color':['border-color','borderColor'], 'batch-font':['font-family','fontFamily']
  };
  if(!map[field.id] && field.id!=='batch-shadow')return true;
  if(importedMode && importedSelectedElements.some(el=>recordFor(el,false)?.scope==='all-matching')){setStatus('批量编辑仅作用于选中图层。请先将已有「所有匹配元素」记录改回「仅此元素」，再批量修改。');return true;}
  if(field.type==='number' && (field.value==='' || !Number.isFinite(Number(field.value))))return true;
  const numeric=field.type==='number';const value=numeric?clamp(Number(field.value),field.id==='batch-size'?1:0,10000):field.value;
  if(!batchFieldDirty)savePoint();batchFieldDirty=!commit;
  if(importedMode){
    for(const el of importedSelectedElements){
      const rec=recordFor(el), state=syncStateContext(el);
      if(field.id==='batch-shadow')rec.styles['box-shadow']=value==='on'?shadowCss(state.shadowParts):'none';
      else{const [css]=map[field.id];rec.styles[css]=`${value}${numeric?'px':''}`;}
      state.context='';
    }
    refreshAppearanceStyles();importedSelectedElements.forEach(syncStateContext);updateImportedOverlay();renderImportedGuides();
  }else{
    for(const item of selectedDemoItems()){
      if(field.id==='batch-shadow')item.shadow=value==='on';
      else{item[map[field.id][1]]=value;if(field.id==='batch-radius')item.customBorderRadius=null;}
    }
    renderDemo();
  }
  scheduleAppearanceSave();if(commit)renderBatchInspector();return true;
}
