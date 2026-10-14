'use strict';

// This file shares the existing editor's global lexical scope. DOM caches are
// disposable; appearanceRecords is the serializable source of all user edits.
let appearanceRecords = {};
let appearanceSource = { htmlFile: 'index.html', projectName: '', page: '/', sourceHash: null };
let appearanceNotes = '';
let appearanceState = 'default';
let trustedScripts = false;
let folderFiles = [];
let importedPreparedHtml = '';
let pendingSelection = [];
let pendingGroups = [];
let pendingGuideTargets = [];
let appearanceAutosaveTimer;
let sourceGeneration = 0;
const previewInlineCache = new Map();
let pageSessions = {};
let folderPagePaths = [];
let folderSetKey = '';
const sourceFileSets = new Map(); // Live File references only; never serialized into localStorage.
let exportedAppearanceFingerprint = null;
let initialAppearanceFingerprint = null;
let draftRecoveryBlocked = false;
let importRequestSequence = 0;
const DRAFT_KEY = 'visionflow-appearance-draft-v1';
const PRESERVE = ['text', 'links', 'image-source', 'click-handler', 'form-behavior', 'data-logic', 'program-state'];
const VALID_STATES = ['default', 'hover', 'focus', 'disabled', 'loading'];
const STYLE_ALLOWLIST = new Set(['background-color', 'background-image', 'border-radius', 'border-width', 'border-style', 'border-color', 'box-shadow', 'font-size', 'font-family', 'color', 'text-shadow', 'width', 'height', 'box-sizing', 'translate']);

function splitCssList(value) {
  const parts=[]; let depth=0, start=0;
  for(let i=0;i<value.length;i++) {
    if(value[i]==='(') depth++; if(value[i]===')') depth--;
    if(value[i]===',' && depth===0) { parts.push(value.slice(start,i).trim()); start=i+1; }
  }
  parts.push(value.slice(start).trim()); return parts;
}
function readShadow(value, text = false) {
  if(value==='none') return {parts:[],color:'#000000',lengths:text?['2px','2px','4px']:['0px','10px','20px','0px'],inset:false};
  const parts=splitCssList(value), first=parts[0];
  const tokens=first.match(/(?:rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]*\)|#[\da-f]+|[^\s]+/gi)||[];
  const lengths=tokens.filter(t=>/^-?(?:\d*\.)?\d+(?:px|em|rem)?$/.test(t));
  return {parts,color:tokens.find(t=>t!=='inset' && !lengths.includes(t))||'#000000',lengths,inset:tokens.includes('inset')};
}
function readGradient(value) {
  // Keep arbitrary backgrounds intact. Parameter editing is available for a
  // single linear gradient only; complex backgrounds require explicit replacement.
  if(!/^linear-gradient\(/.test(value) || !value.endsWith(')')) return null;
  const parts=splitCssList(value.slice(16,-1));
  if(parts.length<2) return null;
  let angle='180deg'; if(/^(?:-?[\d.]+deg|to\s)/.test(parts[0])) angle=parts.shift();
  if(parts.length<2 || parts.some(p=>p.includes('gradient('))) return null;
  return {angle,stops:parts};
}
function stopColor(stop) { return stop.match(/^(?:rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]*\)|^#[\da-f]+|^[a-z]+/i)?.[0]||'#ffffff'; }
function refreshComplexFields(s,c) {
  s.shadowParts=readShadow(c.boxShadow); const sh=s.shadowParts;
  s.sX=parseFloat(sh.lengths[0])||0; s.sY=parseFloat(sh.lengths[1])||0; s.sBlur=parseFloat(sh.lengths[2])||0; s.sColor=rgbToHex(sh.color);
  s.textShadowParts=readShadow(c.textShadow,true); s.shadowColor=rgbToHex(s.textShadowParts.color);
  s.gradientParts=readGradient(c.backgroundImage);
  if(s.gradientParts) {s.gAngle=parseFloat(s.gradientParts.angle)||0;s.gStart=rgbToHex(stopColor(s.gradientParts.stops[0]));s.gEnd=rgbToHex(stopColor(s.gradientParts.stops.at(-1)));}
}
function shadowCss(sh) {
  const first=[sh.inset?'inset':'',sh.color,...sh.lengths].filter(Boolean).join(' ');
  return [first,...sh.parts.slice(1)].join(', ');
}
function elementPath(el) {
  const parts = [];
  while (el && el.nodeType === 1 && el.tagName !== 'HTML') {
    const siblings = el.parentElement ? [...el.parentElement.children].filter(n => n.tagName === el.tagName) : [el];
    parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`);
    el = el.parentElement;
  }
  return 'html > ' + parts.join(' > ');
}
function identifyElement(el) {
  const doc = el.ownerDocument;
  let selector = elementPath(el), confidence = 'structural';
  if (el.id && doc.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
    selector = '#' + CSS.escape(el.id); confidence = 'stable-id';
  } else {
    for (const attr of [...el.attributes].filter(a => /^data-(?:testid|test|cy|key|id|component|component-id)$/.test(a.name) || (a.name.startsWith('data-') && /-(?:id|key)$/.test(a.name) && !a.name.startsWith('data-vf-')))) {
      const candidate = `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`;
      if (doc.querySelectorAll(candidate).length === 1) { selector = candidate; confidence = 'data-attribute'; break; }
    }
  }
  const r = el.getBoundingClientRect();
  return {
    id: el.id || null, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || (el.tagName==='INPUT' ? ({checkbox:'checkbox',radio:'radio',range:'slider',number:'spinbutton',button:'button',submit:'button'}[el.type]||'textbox') : ({BUTTON:'button', A:'link', TEXTAREA:'textbox', SELECT:'combobox'}[el.tagName] || null)),
    text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    selector, path: elementPath(el), confidence, scope: '',
    dataAttributes: Object.fromEntries([...el.attributes].filter(a => a.name.startsWith('data-') && !a.name.startsWith('data-vf-')).map(a => [a.name, a.value])),
    referenceRect: { x:r.x, y:r.y, width:r.width, height:r.height }
  };
}
function findTarget(target, doc = importedFrame?.contentDocument) {
  if (!doc || !target) return null;
  try { return doc.querySelector(target.selector) || doc.querySelector(target.path); } catch { return null; }
}
function ensureImportedState(el) {
  if (importedState.has(el)) return importedState.get(el);
  const r = el.getBoundingClientRect(), c = el.ownerDocument.defaultView.getComputedStyle(el);
  const appearanceSheet = el.ownerDocument.getElementById('vf-appearance-styles');
  if (appearanceSheet) appearanceSheet.disabled = true;
  const translated = previewInlineCache.get(el)?.get('translate');
  const currentTranslate=el.style.getPropertyValue('translate'), currentPriority=el.style.getPropertyPriority('translate');
  if(translated) el.style.setProperty('translate',translated.value,translated.priority);
  const originalTranslate = el.ownerDocument.defaultView.getComputedStyle(el).translate;
  if(translated) el.style.setProperty('translate',currentTranslate,currentPriority);
  if (appearanceSheet) appearanceSheet.disabled = false;
  const state = {
    dx:0, dy:0, width:Math.max(1, Math.round(r.width)), height:Math.max(1, Math.round(r.height)), widthModified:false,
    colorOverride:null, originalColor:rgbToHex(c.backgroundColor), gradient:c.backgroundImage.includes('gradient'),
    gStart:'#ffffff', gEnd:'#000000', gAngle:90, boxShadow:c.boxShadow !== 'none', sX:0, sY:10, sBlur:20, sColor:'#000000',
    borderRadius:parseFloat(c.borderRadius)||0, borderWidth:parseFloat(c.borderWidth)||0, borderColor:rgbToHex(c.borderColor), borderStyle:c.borderStyle.split(' ')[0] || 'solid',
    fontSize:parseFloat(c.fontSize)||16, fontFamily:c.fontFamily.split(',')[0].replace(/['"]/g,''), textColor:rgbToHex(c.color),
    textShadow:c.textShadow !== 'none', shadowColor:'#000000', textOverride:null,
    target:identifyElement(el), originalTranslate, originalStyles:el.getAttribute('style'), context:'',
    positionChanged:false, sizeChanged:false
  };
  refreshComplexFields(state,c);
  importedState.set(el, state);
  importedElementIds.set(el, state.target.selector);
  return state;
}
function recordFor(el, create = true) {
  const s = ensureImportedState(el);
  const key = JSON.stringify([appearanceSource.page, s.target.selector, viewportMode, appearanceState]);
  if (!appearanceRecords[key] && create) appearanceRecords[key] = {
    target:structuredClone(s.target), page:appearanceSource.page, viewport:viewportMode, state:appearanceState,
    scope:'this-element', styles:{}, preserve:[...PRESERVE], notes:''
  };
  return appearanceRecords[key];
}
function syncStateContext(el) {
  const s = ensureImportedState(el), context = viewportMode + ':' + appearanceState;
  if (s.context === context) return s;
  s.context = context; s.positionChanged = false; s.sizeChanged = false;
  const rec = recordFor(el, false), move = rec?.layoutIntent?.referenceOffset;
  s.dx = move?.x || 0; s.dy = move?.y || 0;
  const c = el.ownerDocument.defaultView.getComputedStyle(el);
  s.originalColor = rgbToHex(c.backgroundColor); s.colorOverride = rec?.styles['background-color'] || null;
  s.borderRadius = parseFloat(c.borderRadius) || 0; s.borderWidth = parseFloat(c.borderWidth) || 0;
  s.borderColor = rgbToHex(c.borderColor); s.borderStyle = c.borderStyle.split(' ')[0];
  s.fontSize = parseFloat(c.fontSize) || 16; s.fontFamily = c.fontFamily.split(',')[0].replace(/['"]/g,'');
  s.textColor = rgbToHex(c.color); s.gradient = c.backgroundImage.includes('gradient');
  s.boxShadow = c.boxShadow !== 'none'; s.textShadow = c.textShadow !== 'none';
  refreshComplexFields(s,c);
  const r = el.getBoundingClientRect();
  s.width = parseFloat(c.width) || Math.round(r.width); s.height = parseFloat(c.height) || Math.round(r.height);
  return s;
}
function selectImported(element, additive = false) {
  if (eraserMode || !isCandidate(element)) return;
  importedSelectedElements = additive ? [...new Set([...importedSelectedElements, element])] : [element];
  importedSelectedElements = importedSelectionWithGroups(importedSelectedElements);
  importedSelected = importedSelectedElements[0] || null;
  importedSelectedElements.forEach(syncStateContext);
  if (guideArmed && importedSelectedElements.length === 1) {
    importedGuideTargets = [...new Set([...importedGuideTargets, element])];
    guideArmed = false; guideMode = 'live'; guidesVisible = true; updateToolButtons(); renderImportedGuides();
  }
  updateImportedOverlay(); renderLayers(); updateGroupButtonState();
  if (!isTyping) renderImportedInspector();
}
function layoutReference(el, s) {
  const r = el.getBoundingClientRect(), p = el.parentElement, pr = p?.getBoundingClientRect();
  const sibling = el.previousElementSibling, sr = sibling?.getBoundingClientRect();
  return {
    align:s.alignIntent || 'user-position-reference', relativeTo:p ? identifyElement(p) : null,
    parentLayout:p ? el.ownerDocument.defaultView.getComputedStyle(p).display : null,
    referenceOffset:{x:s.dx, y:s.dy}, referenceRect:{x:r.x,y:r.y,width:r.width,height:r.height},
    relativeRect:pr ? {x:r.x-pr.x,y:r.y-pr.y} : null,
    previousSibling:sibling ? identifyElement(sibling) : null,
    gap:sr ? {horizontal:r.left-sr.right,vertical:r.top-sr.bottom} : null,
    preserveResponsiveLayout:true, integrationRequired:true
  };
}
function positionValue(s) {
  const original = s.originalTranslate && s.originalTranslate !== 'none' ? s.originalTranslate.split(/\s+/) : ['0px','0px'];
  return `calc(${original[0]} + ${s.dx}px) calc(${original[1] || '0px'} + ${s.dy}px)${original[2] ? ' ' + original[2] : ''}`;
}
function applyImportedState() {
  importedSelectedElements.forEach(el => {
    const s = ensureImportedState(el);
    if (s.positionChanged) {
      if (recordFor(el, false)?.scope === 'all-matching') {
        s.positionChanged = false;
        setStatus('同類元素可能具有不同原始位移；移動僅支援「僅此元素」，請先切換範圍。');
        return;
      }
      const rec = recordFor(el); rec.styles.translate = positionValue(s); rec.layoutIntent = layoutReference(el, s);
    }
    if (s.sizeChanged) {
      const rec = recordFor(el);
      rec.styles.width = `${s.width}px`; rec.styles.height = `${s.height}px`;
    }
  });
  importedDirty = true; refreshAppearanceStyles(); updateImportedOverlay(); renderImportedGuides();
  importedSelectedElements.forEach(el=>{const s=ensureImportedState(el);if(s.positionChanged) {const rec=recordFor(el,false);if(rec && rec.scope==='this-element') rec.layoutIntent=layoutReference(el,s);}});
  scheduleAppearanceSave();
}
function stateSelector(selector, state) {
  if (state === 'hover' || state === 'focus') return `${selector}:${state}`;
  if (state === 'disabled') return `${selector}:is(:disabled,[aria-disabled="true"])`;
  if (state === 'loading') return `${selector}:is([aria-busy="true"],[data-state="loading"])`;
  return selector;
}
function safeSelector(selector) {
  // CSS.escape identifiers can contain escaped punctuation; forbid only actual rule boundaries.
  return typeof selector === 'string' && selector.length < 4096 && !/[{}<>\u0000]/.test(selector);
}
function boostSelector(selector) { return `:is(${selector}):is(:where(*),#vf-specificity-a#vf-specificity-b#vf-specificity-c)`; }
function cssRules(records, simulate = false) {
  let css = '';
  const sorted = [...records].sort((a,b) => (a.state === 'default' ? 0 : 1) - (b.state === 'default' ? 0 : 1));
  for (const rec of sorted) {
    if (rec.page !== appearanceSource.page) continue;
    if (simulate && (rec.viewport !== viewportMode || (rec.state !== 'default' && rec.state !== appearanceState))) continue;
    const selector = rec.scope === 'all-matching' ? rec.matchingSelector : rec.target.selector;
    if (!safeSelector(selector)) continue;
    const declarations = Object.entries(rec.styles).filter(([k,v]) => STYLE_ALLOWLIST.has(k) && typeof v === 'string' && !/[;{}<>]/.test(v) && !/url\s*\(|expression\s*\(/i.test(v)).map(([k,v]) => `${k}:${v} !important`).join(';');
    if (!declarations) continue;
    const rule = `${simulate ? selector : stateSelector(boostSelector(selector),rec.state)}{${declarations}}`;
    css += simulate ? rule + '\n' : `@media (${rec.viewport === 'mobile' ? 'max-width:700px' : 'min-width:701px'}){${rule}}\n`;
  }
  return css;
}
function refreshAppearanceStyles() {
  const doc = importedFrame?.contentDocument; if (!doc?.head) return;
  for(const [el,props] of previewInlineCache) {
    for(const [key,original] of props) el.style.setProperty(key,original.value,original.priority);
    if(!el.style.length && el.getAttribute('style')==='') el.removeAttribute('style');
  }
  previewInlineCache.clear();
  let style = doc.getElementById('vf-appearance-styles');
  if (!style) { style = doc.createElement('style'); style.id = 'vf-appearance-styles'; doc.head.appendChild(style); }
  style.textContent = cssRules(Object.values(appearanceRecords), true);
  const records=Object.values(appearanceRecords).filter(r=>r.page===appearanceSource.page && r.viewport===viewportMode && (r.state==='default'||r.state===appearanceState)).sort((a,b)=>(a.state==='default'?0:1)-(b.state==='default'?0:1));
  for(const rec of records) {
    const selector=rec.scope==='all-matching'?rec.matchingSelector:rec.target.selector;
    if(!safeSelector(selector)) continue;
    let targets=[];try{targets=[...doc.querySelectorAll(selector)];}catch{continue;}
    for(const el of targets) {
      if(el.closest('[data-vf-helper]')) continue;
      if(!previewInlineCache.has(el)) previewInlineCache.set(el,new Map());
      const props=previewInlineCache.get(el);
      for(const [key,value] of Object.entries(rec.styles)) {
        if(!STYLE_ALLOWLIST.has(key)) continue;
        if(!props.has(key)) props.set(key,{value:el.style.getPropertyValue(key),priority:el.style.getPropertyPriority(key)});
        el.style.setProperty(key,value,'important');
      }
    }
  }
  invalidateSnapGeometry();
}
function updateImportedText(event, commit = false) { updateImported(event, commit); }
function updateImported(event, commit = false) {
  if (!importedSelected || !event?.target || event.target.id === 'itext') return;
  const field = event.target, id = field.id, s = syncStateContext(importedSelected);
  const metadata = ['vf-target-name','vf-change-scope','vf-matching-selector','vf-change-notes'];
  const supported = ['ix','iy','iw','ih','iborderRadius','iborderWidth','iborderStyle','iborderColor','icolor','igradient','igStart','igEnd','igAngle','ishadow','isX','isY','isBlur','isColor','ifontFamily','ifontSize','itextColor','itextShadow','ishadowColor'];
  if (!metadata.includes(id) && !supported.includes(id)) return;
  if (!s.fieldDirty) savePoint();
  s.fieldDirty = !commit; isTyping = !commit && event.type === 'input';
  const rec = recordFor(importedSelected);
  if (id === 'vf-target-name') rec.target.scope = field.value;
  else if (id === 'vf-change-notes') rec.notes = field.value;
  else if (id === 'vf-matching-selector') {
    try { if (!safeSelector(field.value) || !importedFrame.contentDocument.querySelectorAll(field.value).length) throw new Error(); rec.matchingSelector = field.value; }
    catch { setStatus('同類元素 selector 無效或沒有匹配，尚未套用。'); return; }
  } else if (id === 'vf-change-scope') {
    if (field.value === 'all-matching' && !rec.matchingSelector) { setStatus('請先填寫有效的同類元素 selector。'); field.value = rec.scope; return; }
    if (field.value === 'all-matching' && rec.styles.translate) { setStatus('已有位移的修改只可套用此元素，避免覆盖同類項的原位移。'); field.value = rec.scope; return; }
    rec.scope = field.value;
  } else if (id === 'ix' || id === 'iy') {
    if (rec.scope === 'all-matching') { setStatus('位置修改請先切換至「僅此元素」，保護同類項的原始位移。'); return; }
    s[id === 'ix' ? 'dx' : 'dy'] = clamp(Number(field.value),-5000,5000); s.positionChanged = true;
  } else if (id === 'iw' || id === 'ih') {
    const prop = id === 'iw' ? 'width' : 'height'; s[prop] = clamp(Number(field.value),1,10000);
    rec.styles[prop] = `${s[prop]}px`;
  } else {
    const direct = {
      iborderRadius:['borderRadius','border-radius','px'], iborderWidth:['borderWidth','border-width','px'],
      iborderStyle:['borderStyle','border-style',''], iborderColor:['borderColor','border-color',''],
      icolor:['colorOverride','background-color',''], ifontFamily:['fontFamily','font-family',''],
      ifontSize:['fontSize','font-size','px'], itextColor:['textColor','color','']
    };
    if (direct[id]) {
      const [key, css, unit] = direct[id]; s[key] = unit ? clamp(Number(field.value),0,10000) : field.value;
      rec.styles[css] = `${s[key]}${unit}`;
    } else if (['igradient','igStart','igEnd','igAngle'].includes(id)) {
      if (id === 'igradient') s.gradient = field.checked;
      else s[{igStart:'gStart',igEnd:'gEnd',igAngle:'gAngle'}[id]] = field.value;
      if(id !== 'igradient' && !s.gradientParts) { setStatus('複雜或多層背景不能局部解析。若確定要替換，請先關閉再啟用新漸層。'); return; }
      const gradient=s.gradientParts||{angle:'90deg',stops:['#ffffff','#000000']};
      if(id==='igAngle') gradient.angle=`${s.gAngle}deg`;
      if(id==='igStart') gradient.stops[0]=gradient.stops[0].replace(stopColor(gradient.stops[0]),s.gStart);
      if(id==='igEnd') gradient.stops[gradient.stops.length-1]=gradient.stops.at(-1).replace(stopColor(gradient.stops.at(-1)),s.gEnd);
      s.gradientParts=gradient;
      rec.styles['background-image'] = s.gradient ? `linear-gradient(${gradient.angle}, ${gradient.stops.join(', ')})` : 'none';
    } else if (['ishadow','isX','isY','isBlur','isColor'].includes(id)) {
      if (id === 'ishadow') s.boxShadow = field.checked;
      else s[{isX:'sX',isY:'sY',isBlur:'sBlur',isColor:'sColor'}[id]] = id === 'isColor' ? field.value : clamp(Number(field.value),id === 'isBlur' ? 0 : -1000,1000);
      const sh=s.shadowParts;
      if(id==='isX') sh.lengths[0]=`${s.sX}px`;
      if(id==='isY') sh.lengths[1]=`${s.sY}px`;
      if(id==='isBlur') sh.lengths[2]=`${s.sBlur}px`;
      if(id==='isColor') sh.color=s.sColor;
      rec.styles['box-shadow'] = s.boxShadow ? shadowCss(sh) : 'none';
    } else {
      if (id === 'itextShadow') s.textShadow = field.checked; else s.shadowColor = field.value;
      if(id==='ishadowColor') s.textShadowParts.color=s.shadowColor;
      rec.styles['text-shadow'] = s.textShadow ? shadowCss(s.textShadowParts) : 'none';
    }
  }
  applyImportedState();
  if (commit) { isTyping = false; renderImportedInspector(); }
}
function appearanceInspectorFields() {
  const rec = recordFor(importedSelected,false), target = ensureImportedState(importedSelected).target;
  return `<section class="section"><h2 class="panel-title">交接識別與範圍</h2><p class="hint">${target.confidence === 'structural' ? '沒有穩定 ID，請補充名稱／區域；DOM 路徑只是輔助。' : '識別：' + escapeHtml(target.selector)}</p><div class="form-grid"><div class="field full"><label>名稱／父級區域說明</label><input id="vf-target-name" value="${escapeHtml(rec?.target.scope || '')}"></div><div class="field full"><label>同類元素 CSS selector（先填寫再切換範圍）</label><input id="vf-matching-selector" value="${escapeHtml(rec?.matchingSelector || '')}" placeholder="例如 .list-item"></div><div class="field full"><label>套用範圍</label><select id="vf-change-scope"><option value="this-element">僅此元素</option><option value="all-matching" ${rec?.scope === 'all-matching' ? 'selected' : ''}>所有匹配元素</option></select></div><div class="field full"><label>此修改的整合說明</label><textarea id="vf-change-notes">${escapeHtml(rec?.notes || '')}</textarea></div></div><p class="hint">移動只代表布局意圖，整合時保留原有 Flex／Grid／響應式行為。文字內容預設鎖定，不會自動整合。</p></section>`;
}
function collectAppearanceData() {
  return {
    format:'visionflow-appearance-v1', tool:'VisionFlow', source:structuredClone(appearanceSource),
    origin:structuredClone(appearanceOrigin()), integrationPagePath:appearanceSource.page,
    pages:[...new Set([appearanceSource.page,...Object.values(appearanceRecords).map(r=>r.page)])].map(page=>({page})),
    viewport:{desktop:{width:1280,height:720},mobile:{width:375,height:812}},
    changes:structuredClone(Object.values(appearanceRecords).filter(r=>Object.keys(r.styles).length)),
    userNotes:appearanceNotes,
    preview:{kind:'static-appearance-reference',originalProgramIncluded:false,businessBehaviorGuaranteed:false,contentEditing:'disabled'}
  };
}
function validateAppearanceData(data) {
  if (data?.format !== 'visionflow-appearance-v1' || !Array.isArray(data.changes) || !data.source || typeof data.source.page !== 'string') throw new Error('不是支援的 VisionFlow 外觀檔案。');
  const origin = validateAppearanceOrigin(data.origin || appearanceOrigin(data.source));
  if (data.changes.length > 5000 || data.source.page.length > 4096 ||
      (data.integrationPagePath != null && data.integrationPagePath !== data.source.page) ||
      origin.entryPath !== data.source.htmlFile || (origin.sourceHash || null) !== (data.source.sourceHash || null))
    throw new Error('JSON 的來源檔案／頁面／校驗值與整合路徑資料不一致。');
  if (data.userNotes != null && (typeof data.userNotes !== 'string' || data.userNotes.length > 100000)) throw new Error('外觀說明格式無效。');
  for (const rec of data.changes) {
    if (!rec.target || !safeSelector(rec.target.selector) || !['desktop','mobile'].includes(rec.viewport) || !VALID_STATES.includes(rec.state) || !['this-element','all-matching'].includes(rec.scope) || typeof rec.page !== 'string' || !rec.styles || Array.isArray(rec.styles)) throw new Error('外觀修改的元素／視口／狀態／範圍資料不完整。');
    if (rec.page !== data.source.page) throw new Error('JSON 的來源檔案／頁面／校驗值不一致；外觀紀錄必須屬於目前入口。');
    if (rec.scope === 'all-matching' && !safeSelector(rec.matchingSelector)) throw new Error('同類元素 selector 不完整。');
    if (rec.scope === 'all-matching' && 'translate' in rec.styles) throw new Error('同類元素位置不能共用固定 translate，請拆分成逐元素布局意圖。');
    for (const [k,v] of Object.entries(rec.styles)) if (!STYLE_ALLOWLIST.has(k) || typeof v !== 'string' || /[;{}<>]/.test(v) || /url\s*\(|expression\s*\(/i.test(v)) throw new Error('外觀檔案含有不支援的 CSS 屬性或值。');
  }
  return data;
}
function importAppearanceData(data, verifiedOrigin = null) {
  validateAppearanceData(data);
  appearanceRecords = {};
  for (const rec of data.changes) appearanceRecords[JSON.stringify([rec.page,rec.target.selector,rec.viewport,rec.state])] = structuredClone(rec);
  appearanceSource = structuredClone(data.source); appearanceNotes = data.userNotes || '';
  appearanceSource.origin = structuredClone(data.origin || appearanceOrigin(data.source));
  if (verifiedOrigin?.entryPath === appearanceSource.origin.entryPath && !appearanceSource.origin.sourceHash && verifiedOrigin.sourceHash) {
    appearanceSource.sourceHash = verifiedOrigin.sourceHash;
    appearanceSource.origin.sourceHash = verifiedOrigin.sourceHash;
  }
}
function stripActiveContent(doc) {
  doc.querySelectorAll('script:not([type="application/json"]), iframe, object, embed, meta[http-equiv="refresh"]').forEach(n=>n.remove());
  doc.querySelectorAll('*').forEach(el=>{
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === 'srcdoc' || (['href','src','action','formaction','xlink:href'].includes(attr.name) && /^\s*(javascript|vbscript):/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  });
}
function cleanPreviewDocument(doc) {
  // Only nodes explicitly marked as our helpers are removed, not user's similarly named classes.
  doc.querySelectorAll('[data-vf-helper], #ui-editor-overlay, #ui-editor-style').forEach(n=>n.remove());
  doc.getElementById('vf-appearance-styles')?.remove();
  doc.getElementById('visionflow-appearance-data')?.remove();
}
function buildAppearanceHtml() {
  if (!importedFrame?.contentDocument?.body) throw new Error('請先匯入 HTML，等待畫布載入。');
  const doc = new DOMParser().parseFromString('<!doctype html>\n' + importedFrame.contentDocument.documentElement.outerHTML,'text/html');
  for(const [el,props] of previewInlineCache) {
    let copy;try{copy=doc.querySelector(elementPath(el));}catch{continue;}
    if(!copy) continue;
    for(const [key,original] of props) copy.style.setProperty(key,original.value,original.priority);
    if(!copy.style.length && copy.getAttribute('style')==='') copy.removeAttribute('style');
  }
  cleanPreviewDocument(doc); stripActiveContent(doc);
  doc.querySelectorAll('script').forEach(el=>el.remove());
  let inlineFallback='';
  const preservedInline=new Set();
  for(const rec of Object.values(appearanceRecords).filter(r=>r.page===appearanceSource.page)) {
    const selector=rec.scope==='all-matching'?rec.matchingSelector:rec.target.selector;
    if(!safeSelector(selector)) continue;
    let copies=[];try{copies=[...doc.querySelectorAll(selector)];}catch{continue;}
    for(const copy of copies) for(const key of Object.keys(rec.styles)) {
      const identity=elementPath(copy)+':'+key;
      if(preservedInline.has(identity) || copy.style.getPropertyPriority(key)!=='important') continue;
      preservedInline.add(identity);
      const original=copy.style.getPropertyValue(key);
      inlineFallback+=`${boostSelector(':where('+elementPath(copy)+')')}{${key}:${original} !important}\n`;
      copy.style.setProperty(key,original,'');
    }
  }
  if(inlineFallback) {
    let baseline=doc.getElementById('vf-appearance-inline-baseline');
    if(!baseline) {baseline=doc.createElement('style');baseline.id='vf-appearance-inline-baseline';doc.head.appendChild(baseline);}
    baseline.textContent+=inlineFallback.replace(/</g,'\\3c ');
  }
  const style = doc.createElement('style'); style.id = 'vf-appearance-styles'; style.textContent = cssRules(Object.values(appearanceRecords)).replace(/</g,'\\3c '); doc.head.appendChild(style);
  const metadata = doc.createElement('script'); metadata.type = 'application/json'; metadata.id = 'visionflow-appearance-data';
  metadata.textContent = JSON.stringify(collectAppearanceData(),null,2).replace(/</g,'\\u003c'); doc.body.appendChild(metadata);
  const marker = doc.createElement('meta'); marker.name='visionflow-preview'; marker.content='Static appearance reference; not original source; scripts disabled.'; doc.head.appendChild(marker);
  // Live form property state is intentionally not serialized into the appearance data.
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
function downloadAppearance(kind) {
  try {
    if (!['html', 'json'].includes(kind)) throw new Error('不支援的匯出格式。');
    const data = importedMode ? collectAppearanceData() : collectCanvasData();
    const content = kind === 'json' ? JSON.stringify(data,null,2) : importedMode ? buildAppearanceHtml() : buildCanvasHtml();
    downloadTextFile(content, `visionflow-${importedMode ? 'appearance' : 'canvas'}.${kind}`, kind);
    if (importedMode) exportedAppearanceFingerprint = appearanceFingerprint();
    scheduleAppearanceSave();
    setStatus(importedMode ? '已匯出外觀參考；目前修改已備份，可切換入口。請連同原始工程交給 AI，不要取代原工程。' : '已匯出畫布設計。HTML 是純外觀參考；HTML／JSON 可重新匯入繼續編輯。');
  } catch (e) { sysAlert(e.message); }
}
function snapshot(includePageSessions = true) {
  const targets = importedSelectedElements.filter(el=>el.isConnected).map(el=>ensureImportedState(el).target);
  const groups = importedLayers.filter(l=>importedGroupIds.has(l.element)).map(l=>({target:ensureImportedState(l.element).target,group:importedGroupIds.get(l.element)}));
  let staticPreviewHtml = '';
  if (importedMode && importedFrame?.contentDocument?.body) staticPreviewHtml = buildAppearanceHtml();
  return JSON.stringify({
    version:2, items, selectedId, selectedIds, manualGuides, hiddenDemoGuideKeys, demoGuideTargets,
    toolPreferences:{snapEnabled:SNAP_CFG.enabled,snapGrid:SNAP_CFG.grid,activeSnapHover},
    measure:persistedMeasure(), workspacePanels:normalWorkspacePanels(),
    importedManualGuides, hiddenImportedGuideKeys, importedGuideTargets:importedGuideTargets.filter(el=>el.isConnected).map(el=>ensureImportedState(el).target),
    activeTheme, importedMode, importedSourceHtml, importedHtml, importedPreparedHtml, staticPreviewHtml, importedDirty, editing, zoom, guideMode, guideArmed,
    eraserMode, panMode, measureMode, viewportMode, isPositionLocked, appearanceRecords, appearanceSource, appearanceNotes, appearanceState,
    selectedTargets:targets, groups, importedGroupSeq,
    folderPagePaths, folderSetKey, exportedAppearanceFingerprint, initialAppearanceFingerprint,
    ...(includePageSessions ? {pageSessions} : {})
  });
}
function restoreSnapshot(value, fromDraft = false) {
  const s = readDraftSnapshot(value), sameDocument = importedMode && s.importedMode && s.importedSourceHtml === importedSourceHtml && s.importedHtml === importedHtml;
  cancelTransientTools(); zoomRevision++; fitImportedOnLoad=false;
  importRequestSequence++;
  if (s.pageSessions !== undefined) pageSessions = s.pageSessions || {};
  folderPagePaths = s.folderPagePaths || []; folderSetKey = s.folderSetKey || '';
  folderFiles = sourceFileSets.get(folderSetKey) || [];
  exportedAppearanceFingerprint = s.exportedAppearanceFingerprint ?? null;
  initialAppearanceFingerprint = s.initialAppearanceFingerprint ?? null;
  items=s.items||[]; selectedId=s.selectedId; selectedIds=s.selectedIds||[];
  manualGuides=s.manualGuides||[]; hiddenDemoGuideKeys=s.hiddenDemoGuideKeys||[]; demoGuideTargets=s.demoGuideTargets||[];
  importedManualGuides=s.importedManualGuides||[]; hiddenImportedGuideKeys=s.hiddenImportedGuideKeys||[];
  activeTheme=s.activeTheme||'light'; importedMode=!!s.importedMode; importedSourceHtml=s.importedSourceHtml||''; importedHtml=s.importedHtml||'';
  importedPreparedHtml=s.importedPreparedHtml||s.importedHtml||'';
  if (fromDraft && s.staticPreviewHtml) importedHtml=s.staticPreviewHtml;
  importedDirty=!!s.importedDirty; editing=!!s.editing; zoom=s.zoom||1; guideMode=s.guideMode||'hidden'; guidesVisible=guideMode!=='hidden'; guideArmed=!!s.guideArmed;
  eraserMode=!!s.eraserMode; panMode=!!s.panMode; measureMode=!!s.measureMode; viewportMode=s.viewportMode||'desktop'; isPositionLocked=!!s.isPositionLocked;
  SNAP_CFG.enabled=s.toolPreferences.snapEnabled; SNAP_CFG.grid=s.toolPreferences.snapGrid; activeSnapHover=s.toolPreferences.activeSnapHover;
  measureMode=s.measure.enabled; measureState=s.measure.state; measureStart={...s.measure.start}; measureEnd={...s.measure.end};
  restoreWorkspacePanels(s.workspacePanels);
  appearanceRecords=s.appearanceRecords||{}; appearanceSource=s.appearanceSource||appearanceSource; appearanceNotes=s.appearanceNotes||''; appearanceState=s.appearanceState||'default';
  importedGroupSeq=s.importedGroupSeq||0;
  pendingSelection=s.selectedTargets||[]; pendingGroups=s.groups||[]; pendingGuideTargets=s.importedGuideTargets||[];
  isTyping=false;
  if (!sameDocument) { importedFrame=null; importedSelected=null; importedSelectedElements=[]; importedLayers=[]; sourceGeneration++; }
  else { importedLayers.forEach(l=>importedState.delete(l.element)); refreshAppearanceStyles(); restoreImportedIdentity(); }
  syncAppearanceControls(); applyTheme(themes.find(t=>t.id===activeTheme)||themes[0]); updateToolButtons(); render(); refreshLayoutAndRulers(); scheduleAppearanceSave();
}
function restoreImportedIdentity() {
  importedGroupIds=new WeakMap();
  pendingGroups.forEach(g=>{const el=findTarget(g.target); if(el) importedGroupIds.set(el,g.group);});
  importedGuideTargets=pendingGuideTargets.map(t=>findTarget(t)).filter(Boolean);
  importedSelectedElements=pendingSelection.map(t=>findTarget(t)).filter(Boolean);
  importedSelected=importedSelectedElements[0]||null;
  importedSelectedElements.forEach(syncStateContext);
  const unresolved=Object.values(appearanceRecords).filter(r=>r.page===appearanceSource.page && !findTarget(r.target));
  if (unresolved.length) sysAlert(`有 ${unresolved.length} 個外觀修改暫時找不到原元素，資料仍保留。可能是脚本生成或結構不同；請重新匯入相應頁面或檢查來源。`);
  pendingGroups=[]; pendingSelection=[]; pendingGuideTargets=[];
  updateImportedOverlay(); renderImportedGuides(); updateGroupButtonState();
}
function watchImportedLayers() {
  const frame=importedFrame, doc=frame.contentDocument;
  let timer;
  const observer=new MutationObserver(mutations=>{
    const relevant=mutations.some(m=>!m.target.closest?.('[data-vf-helper]') && [...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1 && !n.matches?.('[data-vf-helper]')));
    if(!relevant) return;
    clearTimeout(timer); timer=setTimeout(()=>{
      if(frame!==importedFrame) {observer.disconnect();return;}
      importedLayers=[...doc.body.querySelectorAll('*')].filter(isCandidate).filter(el=>{const r=el.getBoundingClientRect();return r.width>0 && r.height>0;}).slice(0,1000).map(element=>({element,name:importedName(element)}));
      importedSelectedElements=importedSelectedElements.filter(el=>el.isConnected); importedSelected=importedSelectedElements[0]||null;
      refreshAppearanceStyles(); renderLayers(); updateImportedOverlay(); invalidateSnapGeometry();
    },80);
  });
  observer.observe(doc.body,{childList:true,subtree:true});
}
function scheduleAppearanceSave() {
  clearTimeout(appearanceAutosaveTimer);
  if (snapDragActive || guideDrag || isPanning || isErasing) return;
  appearanceAutosaveTimer=setTimeout(()=>performQuickSave(true),350);
}
function performQuickSave(silent = false) {
  try {
    if (draftRecoveryBlocked) { setStatus('原草稿無法恢復，已停止自動覆寫；請先下載草稿備份。'); return; }
    if (snapDragActive || guideDrag || isPanning || isErasing) { if (!silent) setStatus('手勢進行中，請完成拖動後再暫存；尚未覆寫草稿。'); return; }
    const previous=localStorage.getItem(DRAFT_KEY);
    if (previous !== null) {
      try { readDraftSnapshot(previous); }
      catch { draftRecoveryBlocked=true; clearTimeout(appearanceAutosaveTimer); setStatus('已存草稿版本或內容已改變，停止自動覆寫；請先下載草稿備份。'); return; }
    }
    const value=snapshot();
    if (previous !== null && JSON.parse(previous).version === 1 && localStorage.getItem(DRAFT_KEY+'-backup-before-v2') === null)
      localStorage.setItem(DRAFT_KEY+'-backup-before-v2',previous);
    localStorage.setItem(DRAFT_KEY,value); importedDirty=false; updateLegacyDraftBackupButton();
    if (!silent) setStatus('外觀資料與原始來源已存入此瀏覽器。刷新可恢復；重要修改請另行匯出。');
  } catch (e) { setStatus('草稿儲存失敗（容量或瀏覽器權限）；請立即匯出外觀 HTML／JSON。'); }
}
function syncAppearanceControls() {
  document.getElementById('vf-project-name').value=appearanceSource.projectName||'';
  document.getElementById('vf-page-path').value=appearanceSource.page||'/';
  document.getElementById('vf-user-notes').value=appearanceNotes;
  document.getElementById('vf-edit-state').value=appearanceState;
  document.getElementById('export').textContent = importedMode ? '匯出外觀 HTML' : '匯出畫布 HTML';
  document.getElementById('export-json').textContent = importedMode ? '匯出外觀 JSON' : '匯出畫布 JSON';
  refreshEntryPagesControl();
}
function previewSource(html) {
  const doc=new DOMParser().parseFromString(html,'text/html'); cleanPreviewDocument(doc);
  if (trustedScripts) doc.querySelectorAll('script[type="application/x-vf-disabled-script"]').forEach(el=>{
    el.type=el.getAttribute('data-vf-original-type')||'text/javascript';
    el.removeAttribute('data-vf-original-type');
  });
  if (!trustedScripts) stripActiveContent(doc);
  return '<!doctype html>\n'+doc.documentElement.outerHTML;
}
async function loadSelectedFiles(files, entryPath, switchingPage = false) {
  const request = ++importRequestSequence;
  try {
    if (draftRecoveryBlocked) throw new Error('原草稿仍受保護，請先下載草稿備份並在另一瀏覽器工作區開啟新專案。');
    if (switchingPage && hasUnexportedAppearanceChanges()) {
      refreshEntryPagesControl(); throw new Error('切換入口前請先匯出目前頁面的外觀檔案；匯出後即可切換，修改會保留。');
    }
    const json=files.find(f=>/\.json$/i.test(f.name) && !f.webkitRelativePath);
    if (json && !files.some(f=>/\.html?$/i.test(f.name))) {
      if (json.size > 25000000) throw new Error('專案 JSON 超過 25 MB。');
      const raw = JSON.parse(await json.text());
      if (request !== importRequestSequence) return;
      if (raw?.format === CANVAS_FORMAT) { importCanvasData(raw); return; }
      const data=validateAppearanceData(raw);
      if (!importedMode) throw new Error('請先匯入對應原始 HTML，然後再匯入外觀 JSON。');
      requireMatchingAppearanceSource(data);
      const verifiedOrigin=structuredClone(appearanceOrigin());
      savePoint(); importAppearanceData(data,verifiedOrigin); exportedAppearanceFingerprint=null;
      importedLayers.forEach(l=>importedState.delete(l.element));
      refreshAppearanceStyles(); importedSelectedElements.forEach(syncStateContext); renderImportedInspector();
      syncAppearanceControls(); scheduleAppearanceSave(); setStatus('已載入外觀 JSON；整合路徑已保留，原始 HTML 未被覆寫。'); return;
    }
    if (!files.some(f=>/\.html?$/i.test(f.name))) throw new Error('沒有找到 HTML 入口頁；請選擇 .html 或包含入口頁的資料夾。');
    const prepared=await VFFolder.prepare(files,entryPath);
    const entryFile=files.find(f=>(f.webkitRelativePath||f.name)===prepared.entryPath || (f.webkitRelativePath||f.name).endsWith('/'+prepared.entryPath));
    if (!entryFile) throw new Error('找不到所選入口的原始檔案。');
    const original=await entryFile.text(), doc=new DOMParser().parseFromString(prepared.html,'text/html');
    if (request !== importRequestSequence) return;
    const canvasMetadata = doc.getElementById('visionflow-canvas-data');
    if (canvasMetadata) { importCanvasData(JSON.parse(canvasMetadata.textContent)); return; }
    const embedded=doc.getElementById('visionflow-appearance-data');
    let data=null; if (embedded) data=validateAppearanceData(JSON.parse(embedded.textContent));
    const hash=globalThis.crypto?.subtle ? [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(original)))].map(n=>n.toString(16).padStart(2,'0')).join('') : null;
    if (request !== importRequestSequence) return;
    if (switchingPage && hasUnexportedAppearanceChanges()) throw new Error('載入期間目前頁又有修改，請先重新匯出；原畫布仍保留。');
    const origin={entryPath:prepared.entryPath, sourceHash:hash, schemaVersion:1};
    const paths=prepared.pages.map(p=>p.path);
    const reselectedCurrentSource = importedMode && origin.entryPath===appearanceOrigin().entryPath && hash && hash===appearanceOrigin().sourceHash && JSON.stringify(paths)===JSON.stringify(folderPagePaths);
    const reselectedCachedSource = importedMode && !folderFiles.length && hash && JSON.stringify(paths)===JSON.stringify(folderPagePaths) && !!pageSessions[pageSessionKey(origin)];
    const keepWorkspace = switchingPage || reselectedCurrentSource || reselectedCachedSource;
    savePoint();
    if (keepWorkspace) {
      if (importedMode) pageSessions[pageSessionKey()] = snapshot(false);
    } else { pageSessions={}; folderSetKey=globalThis.crypto?.randomUUID?.() || `files-${Date.now()}-${sourceGeneration}`; }
    sourceFileSets.set(folderSetKey,files); folderFiles=files; folderPagePaths=paths;
    const cached=keepWorkspace && pageSessions[pageSessionKey(origin)];
    if (cached) {
      restoreSnapshot(cached); syncAppearanceControls(); scheduleAppearanceSave();
      setStatus('已切換入口，先前的外觀修改仍保留。'); return;
    }
    sourceGeneration++; importedMode=true; importedSourceHtml=original; importedPreparedHtml=prepared.html; importedHtml=prepared.html;
    appearanceRecords={}; appearanceSource={htmlFile:prepared.entryPath,projectName:'',page:'/'+prepared.entryPath,sourceHash:hash,origin}; appearanceNotes='';
    exportedAppearanceFingerprint=null; appearanceState='default';
    if (data) importAppearanceData(data);
    initialAppearanceFingerprint=appearanceFingerprint();
    folderFiles=files; importedDirty=false; importedFrame=null; importedSelected=null; importedSelectedElements=[]; importedLayers=[];
    importedGroupIds=new WeakMap(); importedGroupSeq=0; importedManualGuides=[]; importedGuideTargets=[]; hiddenImportedGuideKeys=[];
    pendingSelection=[]; pendingGroups=[]; pendingGuideTargets=[]; editing=true; isTyping=false; isIframeLoaded=false;
    const pageSelect=document.getElementById('vf-entry-page');
    pageSelect.innerHTML=prepared.pages.map(p=>`<option value="${escapeHtml(p.path)}" ${p.path === prepared.entryPath ? 'selected' : ''}>${escapeHtml(p.path)}</option>`).join('');
    pageSelect.disabled=prepared.pages.length<2;
    cancelTransientTools(); measureState='idle'; measureStart={x:0,y:0}; measureEnd={x:0,y:0}; fitImportedOnLoad=true;
    syncAppearanceControls(); updateToolButtons(); renderImportedState(); scheduleAppearanceSave();
    const message='只編輯目前入口頁。'+(trustedScripts ? '可信脚本預覽已開啟，執行狀態不保證可保存。' : '脚本預設停用；原始程式保留於來源，不進入外觀 JSON。');
    setStatus(message);
    const warnings=prepared.warnings.filter(w=>!w.startsWith('Disabled '));
    if (warnings.length) sysAlert('匯入限制／缺少資源：\n'+warnings.join('\n'));
  } catch(e) { if (request !== importRequestSequence) return; refreshEntryPagesControl(); sysAlert('匯入失敗：'+e.message); setStatus('匯入失敗，原畫布未被替換。'); }
}
function initializeAppearanceEditor() {
  document.getElementById('export-json').addEventListener('click',()=>downloadAppearance('json'));
  document.getElementById('vf-edit-state').addEventListener('change',e=>{
    savePoint(); appearanceState=e.target.value; importedSelectedElements.forEach(el=>{const s=ensureImportedState(el);s.context='';});
    refreshAppearanceStyles(); importedSelectedElements.forEach(syncStateContext); updateImportedOverlay(); renderImportedInspector(); scheduleAppearanceSave();
  });
  for (const id of ['vf-project-name','vf-page-path','vf-user-notes']) document.getElementById(id).addEventListener('change',e=>{
    savePoint();
    if(id==='vf-project-name') appearanceSource.projectName=e.target.value;
    if(id==='vf-user-notes') appearanceNotes=e.target.value;
    if(id==='vf-page-path') { const previous=appearanceSource.page; appearanceSource.page=e.target.value||'/'; for(const r of Object.values(appearanceRecords)) if(r.page===previous) r.page=appearanceSource.page; appearanceRecords=Object.fromEntries(Object.values(appearanceRecords).map(r=>[JSON.stringify([r.page,r.target.selector,r.viewport,r.state]),r])); }
    refreshAppearanceStyles(); scheduleAppearanceSave();
  });
  document.getElementById('vf-entry-page').addEventListener('change',e=>{
    const path=e.target.value;
    if (hasUnexportedAppearanceChanges()) { refreshEntryPagesControl(); sysAlert('切換入口前請先匯出目前頁面的外觀檔案；匯出後即可切換，修改會保留。'); return; }
    loadSelectedFiles(folderFiles,path,true);
  });
  document.getElementById('vf-trusted-scripts').addEventListener('change',e=>{
    trustedScripts=e.target.checked;
    if (!importedMode) return;
    // Explicit opt-in only; trust is never persisted across sessions.
    importedHtml=importedPreparedHtml||importedSourceHtml; importedFrame=null; importedSelected=null; importedSelectedElements=[]; importedLayers=[]; sourceGeneration++;
    renderImportedState(); setStatus(trustedScripts?'已啟用可信脚本；不要匯入不可信頁面，執行狀態不保證可保存。':'脚本已停用，外觀修改仍保留。');
  });
  window.addEventListener('beforeunload',()=>performQuickSave(true));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden') performQuickSave(true);});
  document.querySelector('.main-toolbar').addEventListener('click',()=>scheduleAppearanceSave());
  document.getElementById('vf-backup-draft').addEventListener('click',downloadDraftBackup);
  document.getElementById('vf-backup-v1').addEventListener('click',()=>downloadDraftBackup(true));
  updateLegacyDraftBackupButton();
  syncAppearanceControls();
  try {
    const draft=localStorage.getItem(DRAFT_KEY);
    if(draft !== null) { restoreSnapshot(draft,true); setStatus(restoredDraftMessage()); }
  } catch(e) { draftRecoveryBlocked=true; clearTimeout(appearanceAutosaveTimer); setStatus('無法恢復草稿：'+e.message+'。已停止自動覆寫，請用「備份草稿」下載原始資料。'); }
}
