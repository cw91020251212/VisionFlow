'use strict';

const DEFAULT_TOOL_PREFERENCES = {snapEnabled:true, snapGrid:true, activeSnapHover:false};
const DEFAULT_PANELS = {leftClosed:true, rightClosed:true};
let panelsBeforeFocus = null;
let fullscreenTransitionPending = false;
let layoutRefreshTimer;
let zoomRevision = 0;
let fitImportedOnLoad = false;
let cancelEditorGesture = null;

function normalWorkspacePanels() {
  if (panelsBeforeFocus) return {...panelsBeforeFocus};
  const workspace = document.querySelector('.workspace');
  return {leftClosed:workspace.classList.contains('left-closed'), rightClosed:workspace.classList.contains('right-closed')};
}
function restoreWorkspacePanels(panels) {
  const workspace = document.querySelector('.workspace');
  if (app.classList.contains('focus-mode')) { panelsBeforeFocus = {...panels}; return; }
  workspace.classList.toggle('left-closed',panels.leftClosed);
  workspace.classList.toggle('right-closed',panels.rightClosed);
}
function refreshLayoutAndRulers() {
  clearTimeout(layoutRefreshTimer);
  invalidateSnapGeometry(); clearSnapFeedback();
  if (importedMode) updateImportedViewport(); else renderDemo();
  zoomLabel.textContent = `${Math.round(zoom*100)}%`;
  updateMeasureLine(); drawRulers();
}
function scheduleLayoutRefresh() {
  clearTimeout(layoutRefreshTimer);
  layoutRefreshTimer = setTimeout(refreshLayoutAndRulers,180);
}
function fitImportedView() {
  if (!importedMode || !importedFrame) return;
  updateImportedViewport();
  const ratio = Math.min((canvasScroll.clientWidth-32)/importedViewport.width, (canvasScroll.clientHeight-32)/importedViewport.height,1);
  zoom = clamp(Math.round(ratio*100)/100,.1,1);
  refreshLayoutAndRulers();
}
function fitView() {
  zoomRevision++;
  if (importedMode) { fitImportedView(); return; }
  const width = viewportMode === 'mobile' ? 375 : 1280, height = viewportMode === 'mobile' ? 812 : 720;
  zoom = clamp(Math.round(Math.min((canvasScroll.clientWidth-32)/width,(canvasScroll.clientHeight-32)/height,1)*100)/100,.1,1);
  refreshLayoutAndRulers();
}
function enterFocusMode() {
  if (app.classList.contains('focus-mode')) return;
  panelsBeforeFocus = normalWorkspacePanels();
  app.classList.add('focus-mode');
  const workspace = document.querySelector('.workspace');
  workspace.classList.add('left-closed','right-closed');
  document.querySelector('#focus-mode').setAttribute('aria-pressed','true');
  scheduleLayoutRefresh();
}
function leaveFocusMode() {
  const saved = panelsBeforeFocus;
  app.classList.remove('focus-mode'); panelsBeforeFocus = null;
  if (saved) restoreWorkspacePanels(saved);
  document.querySelector('#focus-mode').setAttribute('aria-pressed','false');
  scheduleLayoutRefresh();
}
async function toggleFullscreen() {
  if (fullscreenTransitionPending) return;
  if (app.classList.contains('focus-mode') || document.fullscreenElement) {
    if (!document.fullscreenElement) { leaveFocusMode(); return; }
    fullscreenTransitionPending = true;
    try { await document.exitFullscreen(); leaveFocusMode(); }
    catch { setStatus('瀏覽器未能退出全屏，請按 Esc 或重試退出按鈕。'); }
    finally { fullscreenTransitionPending = false; }
    return;
  }
  fullscreenTransitionPending = true;
  enterFocusMode();
  try {
    if (!document.documentElement.requestFullscreen) throw new Error('unsupported');
    await document.documentElement.requestFullscreen();
  } catch { setStatus('瀏覽器未允許原生全屏，已使用專注檢視；點「退出」即可恢復原面板。'); }
  finally { fullscreenTransitionPending = false; }
}
function registerEditorGesture(cleanup, before = null, beforeHistory = null) {
  clearTimeout(appearanceAutosaveTimer);
  gestureBefore=before ?? snapshot();
  gestureHistory=beforeHistory ?? {history:[...history],future:[...future]};
  cancelEditorGesture=cleanup;
}
function cancelTransientTools() {
  const cleanup=cancelEditorGesture; cancelEditorGesture=null; cleanup?.();
  snapDragActive=false; guideDrag=null; isPanning=false; isErasing=false;isMarquee=false;marquee.style.display='none';
  suppressImportedClick=false; selectedManualGuide=null;
  app.classList.remove('panning'); clearSnapFeedback(); invalidateSnapGeometry();
}
function persistedMeasure() {
  const done = measureState === 'done';
  return {enabled:measureMode,state:done?'done':'idle',start:done?{...measureStart}:{x:0,y:0},end:done?{...measureEnd}:{x:0,y:0}};
}
function readDraftSnapshot(value) {
  const s = JSON.parse(value);
  if (!s || ![1,2].includes(s.version) || !Array.isArray(s.items))
    throw new Error('不支援或損壞的草稿版本；原始草稿仍保留，可下載備份。');
  s.items.forEach(validateCanvasBackground); // Also validate optional texture fields in legacy v1 drafts.
  if(s.importReport !== undefined)validateImportReport(s.importReport);
  if (s.version === 1) {
    s.toolPreferences = {...DEFAULT_TOOL_PREFERENCES};
    s.measure = {enabled:!!s.measureMode,state:'idle',start:{x:0,y:0},end:{x:0,y:0}};
    s.workspacePanels = {...DEFAULT_PANELS};
    // Old snapshots could have mutually inconsistent booleans. Preserve one mode.
    s.panMode = !s.measure.enabled && !!s.panMode;
    s.eraserMode = !s.measure.enabled && !s.panMode && !!s.eraserMode;
  } else {
    const pref=s.toolPreferences, m=s.measure, panels=s.workspacePanels;
    const arrays=['items','selectedIds','manualGuides','hiddenDemoGuideKeys','demoGuideTargets','importedManualGuides','hiddenImportedGuideKeys','importedGuideTargets','selectedTargets','groups','folderPagePaths'];
    if (typeof s.importedMode!=='boolean' || arrays.some(k=>!Array.isArray(s[k])) ||
        ['importedHtml','importedSourceHtml','importedPreparedHtml','staticPreviewHtml','appearanceNotes','folderSetKey'].some(k=>typeof s[k]!=='string') ||
        !s.appearanceSource || typeof s.appearanceSource!=='object' || Array.isArray(s.appearanceSource) ||
        !s.appearanceRecords || typeof s.appearanceRecords!=='object' || Array.isArray(s.appearanceRecords) ||
        (s.pageSessions !== undefined && (!s.pageSessions || typeof s.pageSessions!=='object' || Array.isArray(s.pageSessions))) ||
        (s.importedMode && (!s.importedHtml || !s.importedSourceHtml)))
      throw new Error('草稿來源／圖層／工作集合資料不完整。');
    if (s.importedMode) {
      validateAppearanceOrigin(appearanceOrigin(s.appearanceSource));
      if (typeof s.appearanceSource.page!=='string' || typeof s.appearanceSource.htmlFile!=='string')
        throw new Error('草稿來源路徑無效。');
      validateAppearanceData({format:'visionflow-appearance-v1',source:s.appearanceSource,changes:Object.values(s.appearanceRecords),userNotes:s.appearanceNotes});
    }
    if (s.folderPagePaths.some(path=>typeof path!=='string' || path.length>4096) || Object.values(s.pageSessions||{}).some(raw=>typeof raw!=='string'))
      throw new Error('草稿入口／頁面快照資料無效。');
    if (!pref || ['snapEnabled','snapGrid','activeSnapHover'].some(k=>typeof pref[k]!=='boolean') ||
        !panels || ['leftClosed','rightClosed'].some(k=>typeof panels[k]!=='boolean') ||
        !m || typeof m.enabled!=='boolean' || !['idle','measuring','done'].includes(m.state) ||
        typeof s.panMode!=='boolean' || typeof s.eraserMode!=='boolean' || typeof s.measureMode!=='boolean' ||
        s.measureMode!==m.enabled || Number(m.enabled)+Number(s.panMode)+Number(s.eraserMode)>1)
      throw new Error('草稿工具／面板／量尺狀態不完整或操作模式不一致。');
    for (const point of [m.start,m.end]) if (!point || ['x','y'].some(k=>!Number.isFinite(point[k]) || Math.abs(point[k])>100000))
      throw new Error('草稿量尺座標無效。');
    if (!Number.isFinite(s.zoom) || s.zoom<.1 || s.zoom>1.5 || !['desktop','mobile'].includes(s.viewportMode))
      throw new Error('草稿縮放／視口無效。');
    if (m.state !== 'done') s.measure={enabled:m.enabled,state:'idle',start:{x:0,y:0},end:{x:0,y:0}};
  }
  return s;
}
function restoredDraftMessage() {
  const entry = importedMode && !folderFiles.length && folderPagePaths.length>1 ? '已恢復目前靜態頁；切換原入口需重選原資料夾，各頁修改仍保留。' : '已從此瀏覽器恢復靜態外觀草稿。';
  return entry+'脚本停用；如需功能預覽，請重新啟用可信原始程式。';
}
