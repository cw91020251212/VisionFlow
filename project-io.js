'use strict';

function appearanceOrigin(source = appearanceSource) {
  return source.origin || {entryPath: source.htmlFile, sourceHash: source.sourceHash || null, schemaVersion: 1};
}

function validateAppearanceOrigin(origin) {
  if (!origin || typeof origin.entryPath !== 'string' || !origin.entryPath || origin.entryPath.length > 4096 ||
      origin.schemaVersion !== 1 || (origin.sourceHash != null && !/^[a-f0-9]{64}$/i.test(origin.sourceHash)))
    throw new Error('外觀來源識別格式不完整。');
  return origin;
}

function requireMatchingAppearanceSource(data) {
  const incoming = validateAppearanceOrigin(data.origin || appearanceOrigin(data.source));
  const current = appearanceOrigin();
  // integrationPagePath/source.page is user-editable metadata, not file identity.
  if (incoming.entryPath !== current.entryPath || (incoming.sourceHash && incoming.sourceHash !== current.sourceHash))
    throw new Error('JSON 的來源檔案／頁面／校驗值與目前頁面不符；請先匯入正確的原始 HTML。');
}

function appearanceFingerprint() {
  // Excludes timestamps, selection, zoom and other editing-only state.
  return JSON.stringify(collectAppearanceData());
}

function hasUnexportedAppearanceChanges() {
  const current = appearanceFingerprint();
  const baseline = exportedAppearanceFingerprint ?? initialAppearanceFingerprint;
  if (baseline !== null) return current !== baseline;
  return Object.values(appearanceRecords).some(r => Object.keys(r.styles).length) || !!appearanceNotes ||
    !!appearanceSource.projectName || appearanceSource.page !== '/' + appearanceOrigin().entryPath;
}

function pageSessionKey(origin = appearanceOrigin()) {
  return JSON.stringify([folderSetKey, origin.entryPath, origin.sourceHash]);
}

function refreshEntryPagesControl() {
  const select = document.getElementById('vf-entry-page');
  select.replaceChildren();
  if (!importedMode || !folderFiles.length) {
    const option = document.createElement('option');
    option.textContent = importedMode ? '草稿目前頁（切頁須重選原資料夾）' : '尚未匯入';
    option.value = importedMode ? appearanceOrigin().entryPath : '';
    select.appendChild(option); select.disabled = true; return;
  }
  folderPagePaths.forEach(path => {
    const option = document.createElement('option'); option.value = path; option.textContent = path;
    select.appendChild(option);
  });
  select.value = appearanceOrigin().entryPath;
  // Reimported appearance archives retain their original source identity.
  if (select.selectedIndex < 0) {
    const option = document.createElement('option'); option.value = appearanceOrigin().entryPath;
    option.textContent = appearanceOrigin().entryPath + '（外觀參考來源）'; select.appendChild(option); select.value = option.value;
  }
  select.disabled = folderPagePaths.length < 2;
}

function downloadTextFile(content, filename, kind) {
  const blob = new Blob([content], {type: kind === 'json' ? 'application/json;charset=utf-8' : 'text/html;charset=utf-8'});
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function updateLegacyDraftBackupButton() {
  const button=document.getElementById('vf-backup-v1');
  try { button.disabled=localStorage.getItem(DRAFT_KEY+'-backup-before-v2') === null; }
  catch { button.disabled=true; }
}
function downloadDraftBackup(legacy = false) {
  try {
    // Copy the exact stored bytes; even a damaged/unknown draft can be recovered offline.
    const old = legacy === true;
    const raw = localStorage.getItem(old ? DRAFT_KEY+'-backup-before-v2' : DRAFT_KEY);
    if (old && raw === null) throw new Error('尚無升級前草稿備份。');
    downloadTextFile(raw === null ? snapshot() : raw, old ? 'visionflow-draft-before-v2.json' : 'visionflow-draft-backup.json', 'json');
    setStatus('已下載草稿原始備份，未清除或覆寫本機草稿。此備份供復原排錯；日常交接請用畫布／外觀 JSON。');
  } catch (error) { sysAlert('草稿備份失敗：' + error.message); }
}

function validateImportReport(report) {
  if (!report || !Array.isArray(report.warnings) || !Array.isArray(report.externalResources) || report.warnings.length>2000 || report.externalResources.length>2000)
    throw new Error('資源報告格式無效。');
  if (report.warnings.some(w=>typeof w!=='string' || w.length>10000) || report.externalResources.some(r=>!r || typeof r.url!=='string' || !/^https?:\/\//i.test(r.url) || r.url.length>10000 || typeof r.kind!=='string' || r.kind.length>100 || typeof r.reference!=='string' || r.reference.length>5000))
    throw new Error('資源報告內容無效。');
  return report;
}
function importReportText() {
  return ['VisionFlow 本頁資源報告',`來源：${importedMode ? appearanceOrigin().entryPath : '空白畫布'}`,
    '清單僅檢查已匯入的靜態檔案；匯入處理器未主動抓取遠端，但瀏覽器預覽可能請求這些網址。不包含 JS 動態請求或外部 CSS 的子依賴。',
    ...importReport.warnings.map(w=>'警告：'+w),
    ...importReport.externalResources.map(r=>`需要網路：${r.kind} | ${r.reference} | ${r.url}`),
    !importReport.externalResources.length ? '未發現已掃描範圍的 HTTP 資源；不等於保證全離線。' : `共 ${importReport.externalResources.length} 項外部依賴。`].filter(Boolean).join('\n');
}
function renderImportReport() {
  const section=document.getElementById('vf-resource-report'); if (!section) return;
  section.hidden=!importedMode;
  document.getElementById('vf-resource-summary').textContent=`${importReport.externalResources.length} 項網路依賴，${importReport.warnings.length} 項匯入提醒`;
  document.getElementById('vf-resource-text').value=importReportText();
}
function createExportArtifact(kind) {
  if (!['html','json'].includes(kind)) throw new Error('不支援的匯出格式。');
  if (cancelEditorGesture || snapDragActive || guideDrag || isPanning || isErasing || isMarquee) throw new Error('請先完成或取消目前手勢，再匯出／分享。');
  if (importedMode && !isIframeLoaded) throw new Error('請等待匯入畫布完成載入，再匯出／分享。');
  const data=importedMode ? collectAppearanceData() : collectCanvasData();
  return {kind,filename:`visionflow-${importedMode?'appearance':'canvas'}.${kind}`,
    content:kind==='json'?JSON.stringify(data,null,2):importedMode?buildAppearanceHtml():buildCanvasHtml(),
    sourceKey:importedMode?pageSessionKey():null,fingerprint:importedMode?JSON.stringify(data):null};
}
function markArtifactExported(artifact) {
  if (importedMode && artifact.sourceKey===pageSessionKey() && artifact.fingerprint) exportedAppearanceFingerprint=artifact.fingerprint;
  scheduleAppearanceSave();
}
