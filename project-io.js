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
