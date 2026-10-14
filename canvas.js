'use strict';

// Standalone shapes are a canvas document, not selector-based source patches.
const CANVAS_FORMAT = 'visionflow-canvas-v1';
const CANVAS_NUMBERS = {
  x: [-10000, 10000], y: [-10000, 10000], w: [1, 10000], h: [1, 10000],
  borderWidth: [0, 1000], borderRadius: [0, 10000], fontSize: [1, 10000],
  gAngle: [0, 360], sX: [-1000, 1000], sY: [-1000, 1000], sBlur: [0, 1000]
};
const CANVAS_CSS = {
  color: 'color', borderColor: 'color', textColor: 'color',
  gStart: 'color', gEnd: 'color', sColor: 'color', shadowColor: 'color',
  fontFamily: 'font-family', customBorderRadius: 'border-radius', clipPath: 'clip-path'
};

function validateCanvasBackground(item) {
  const clean={},fields={backgroundImage:'background-image',backgroundSize:'background-size',backgroundPosition:'background-position',backgroundRepeat:'background-repeat'};
  for(const [key,css] of Object.entries(fields)) {
    if(item?.[key]===undefined)continue;
    if(!safeAppearanceStyle(css,item[key]))throw new Error('畫布背景貼圖格式無效：'+key);
    clean[key]=item[key];
  }
  return clean;
}

function validateCanvasData(data) {
  if (!data || data.format !== CANVAS_FORMAT || !Array.isArray(data.items) || data.items.length > 1000)
    throw new Error('不是支援的 VisionFlow 畫布專案（最多 1000 個圖層）。');
  const size = data.viewport?.mode === 'mobile' ? [375, 812] : [1280, 720];
  if (!['desktop', 'mobile'].includes(data.viewport?.mode) ||
      data.viewport.width !== size[0] || data.viewport.height !== size[1])
    throw new Error('畫布視口資料不完整。');
  const theme = themes.find(t => t.id === data.theme);
  if (!theme || data.background !== theme.bg) throw new Error('畫布主題資料不完整。');
  for (const key of ['projectName', 'userNotes'])
    if (data[key] != null && (typeof data[key] !== 'string' || data[key].length > 10000))
      throw new Error('畫布說明格式不正確。');
  const ids = new Set();
  const cleanItems = data.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.id !== 'string' || !item.id || item.id.length > 200 || ids.has(item.id) ||
        !['shape', 'text'].includes(item.type)) throw new Error('畫布圖層 ID／類型無效或重複。');
    ids.add(item.id);
    const clean = {id: item.id, type: item.type};
    for (const key of ['x', 'y', 'w', 'h'])
      if (!(key in item)) throw new Error('畫布圖層缺少位置或尺寸。');
    for (const [key, [min, max]] of Object.entries(CANVAS_NUMBERS)) {
      if (item[key] == null) continue;
      if (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < min || item[key] > max)
        throw new Error('畫布數值無效：' + key);
      clean[key] = item[key];
    }
    for (const [key, property] of Object.entries(CANVAS_CSS)) {
      if (item[key] == null) { if (item[key] === null) clean[key] = null; continue; }
      if (typeof item[key] !== 'string' || item[key].length > 1000 || /[;{}<>\u0000]|url\s*\(|expression\s*\(/i.test(item[key]) ||
          !CSS.supports(property, item[key]) || (key === 'clipPath' && !/^polygon\(/.test(item[key])))
        throw new Error('畫布樣式無效：' + key);
      clean[key] = item[key];
    }
    Object.assign(clean,validateCanvasBackground(item));
    for (const key of ['name', 'content']) {
      if (item[key] == null) continue;
      if (typeof item[key] !== 'string' || item[key].length > 10000) throw new Error('畫布文字無效。');
      clean[key] = item[key];
    }
    for (const key of ['gradient', 'shadow', 'textShadow']) {
      if (item[key] == null) continue;
      if (typeof item[key] !== 'boolean') throw new Error('畫布開關資料無效。');
      clean[key] = item[key];
    }
    if (item.borderStyle != null) {
      if (!['solid', 'dashed', 'dotted'].includes(item.borderStyle)) throw new Error('畫布邊框樣式無效。');
      clean.borderStyle = item.borderStyle;
    }
    if (item.groupId != null) {
      if (!(typeof item.groupId === 'string' && item.groupId.length <= 200) &&
          !(typeof item.groupId === 'number' && Number.isSafeInteger(item.groupId))) throw new Error('画布群組 ID 無效。');
      clean.groupId = item.groupId;
    }
    return clean;
  });
  return {...data, items: cleanItems};
}

// A single renderer keeps the editor and exported HTML visually consistent.
// DOM properties/textContent avoid interpreting imported strings as HTML/CSS markup.
function createCanvasElement(item, doc = document) {
  const element = doc.createElement('div');
  element.className = 'canvas-item';
  element.dataset.id = item.id;
  Object.assign(element.style, {
    position: 'absolute', boxSizing: 'border-box',
    left: `${item.x}px`, top: `${item.y}px`, width: `${item.w}px`, height: `${item.h}px`,
    border: `${item.borderWidth || 0}px ${item.borderStyle || 'solid'} ${item.borderColor || '#000000'}`,
    backgroundColor: item.color || 'transparent',
    borderRadius: item.customBorderRadius || `${item.borderRadius || 0}px`
  });
  if (item.clipPath) element.style.clipPath = item.clipPath;
  if (item.gradient) element.style.backgroundImage = `linear-gradient(${item.gAngle ?? 90}deg, ${item.gStart || '#fff'}, ${item.gEnd || '#000'})`;
  if(item.backgroundImage && !item.gradient) {
    element.style.backgroundImage=item.backgroundImage;
    element.style.backgroundSize=item.backgroundSize||'cover';
    element.style.backgroundPosition=item.backgroundPosition||'50% 50%';
    element.style.backgroundRepeat=item.backgroundRepeat||'no-repeat';
  }
  if (item.shadow) element.style.boxShadow = `${item.sX || 0}px ${item.sY || 0}px ${item.sBlur || 0}px ${item.sColor || 'rgba(0,0,0,0.2)'}`;
  const text = doc.createElement('div');
  Object.assign(text.style, {
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: item.fontFamily || 'Inter', fontSize: `${item.fontSize || 16}px`,
    color: item.textColor || '#17202a'
  });
  if (item.type === 'text') text.style.textAlign = 'center';
  if (item.textShadow) text.style.textShadow = `2px 2px 4px ${item.shadowColor || '#000000'}`;
  if (item.type === 'text') (item.content || '').split('\n').forEach((line, index) => {
    if (index) text.appendChild(doc.createElement('br'));
    text.appendChild(doc.createTextNode(line));
  });
  else text.textContent = item.content || '';
  element.appendChild(text);
  return element;
}

function collectCanvasData() {
  const mode = viewportMode, theme = themes.find(t => t.id === activeTheme) || themes[0];
  return validateCanvasData({
    format: CANVAS_FORMAT, tool: 'VisionFlow',
    viewport: {mode, width: mode === 'mobile' ? 375 : 1280, height: mode === 'mobile' ? 812 : 720},
    theme: theme.id, background: theme.bg, items: structuredClone(items),
    projectName: appearanceSource.projectName || '', userNotes: appearanceNotes,
    preview: {kind: 'static-canvas-design', originalProgramIncluded: false, businessBehaviorGuaranteed: false}
  });
}

function buildCanvasHtml() {
  const data = collectCanvasData();
  const doc = new DOMParser().parseFromString('<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>', 'text/html');
  doc.title = data.projectName || 'VisionFlow 畫布設計';
  const style = doc.createElement('style');
  style.textContent = '*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}';
  doc.head.appendChild(style);
  const board = doc.createElement('main'); board.id = 'visionflow-canvas';
  Object.assign(board.style, {position: 'relative', width: `${data.viewport.width}px`, height: `${data.viewport.height}px`, backgroundColor: data.background});
  data.items.forEach(item => board.appendChild(createCanvasElement(item, doc)));
  doc.body.appendChild(board);
  const meta = doc.createElement('script'); meta.type = 'application/json'; meta.id = 'visionflow-canvas-data';
  meta.textContent = JSON.stringify(data, null, 2).replace(/</g, '\\u003c'); doc.body.appendChild(meta);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

function importCanvasData(value) {
  const data = validateCanvasData(value); // Validate completely before changing the current design.
  cancelBackgroundUpload();savePoint();
  cancelTransientTools(); fitImportedOnLoad=false; zoomRevision++;
  measureState='idle'; measureStart={x:0,y:0}; measureEnd={x:0,y:0};
  sourceGeneration++; importedMode = false; importedFrame = null;
  importedSelected = null; importedSelectedElements = []; importedLayers = [];
  importedSourceHtml = ''; importedHtml = ''; importedPreparedHtml = '';
  importReport={warnings:[],externalResources:[]};
  appearanceRecords = {}; appearanceSource = {htmlFile: 'index.html', projectName: data.projectName || '', page: '/', sourceHash: null};
  appearanceNotes = data.userNotes || ''; appearanceState = 'default';
  pageSessions = {}; folderFiles = []; folderPagePaths = []; folderSetKey = ''; exportedAppearanceFingerprint = null;
  items = structuredClone(data.items); viewportMode = data.viewport.mode; activeTheme = data.theme;
  selectedId = null; selectedIds = []; manualGuides = []; hiddenDemoGuideKeys = []; demoGuideTargets = [];
  importedManualGuides = []; importedGuideTargets = []; pendingSelection = []; pendingGroups = []; pendingGuideTargets = [];
  importedDirty = false; editing = true; zoom = 1; isTyping = false; demoFieldDirty = false;
  syncAppearanceControls(); applyTheme(themes.find(t => t.id === activeTheme)); updateToolButtons(); renderDemo(); renderDemoInspector();
  scheduleAppearanceSave(); setStatus('已載入畫布專案；圖層可繼續編輯。');
}
