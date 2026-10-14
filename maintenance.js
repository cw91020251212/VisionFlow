'use strict';

let maintenanceBusy = false;
let maintenanceStoragePaused = false;

function editorScope() { return new URL('./', location.href); }
function maintenanceResult(text) {
  document.getElementById('vf-maintenance-result').textContent = text;
  setStatus(text);
}
function maintenanceControls(busy) {
  maintenanceBusy = busy;
  document.querySelectorAll('#vf-maintenance-dialog button[data-maintenance]').forEach(button => { button.disabled = busy; });
  document.getElementById('vf-maintenance-close').disabled = busy;
  updateAvailability();
}
function maintenanceGestureActive() {
  return !!(cancelEditorGesture || snapDragActive || guideDrag || isPanning || isErasing || isMarquee);
}
function hasPendingEditorInput() {
  return (pendingImportRequest !== null && pendingImportRequest === importRequestSequence) ||
    (pendingBackgroundRequest !== null && pendingBackgroundRequest === backgroundRequestSequence) ||
    (importedMode && !isIframeLoaded);
}
function waitForEditorWorker(worker) {
  if (!worker || ['installed', 'activated', 'redundant'].includes(worker.state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); worker.removeEventListener('statechange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => { if (['installed', 'activated', 'redundant'].includes(worker.state)) finish(); };
    const timer = setTimeout(() => finish(new Error('新版安裝尚未完成，未刷新或清理；請稍後重試。')), 30000);
    worker.addEventListener('statechange', changed); changed();
  });
}
async function checkEditorUpdate() {
  if (maintenanceBusy || updateRequested) return;
  maintenanceControls(true); maintenanceResult('正在檢查更新，沒有清除設計或重新載入。');
  try {
    await offlineInitialization;
    if (!editorRegistration) throw new Error('此環境未提供應用更新；請使用 HTTPS 網站並連上網路。');
    if (!navigator.onLine) throw new Error('目前離線，未檢查到伺服器版本；請先連網。');
    await editorRegistration.update();
    const worker = editorRegistration.installing;
    await waitForEditorWorker(worker);
    if (worker?.state === 'redundant') throw new Error('新版套件未能完整安裝，已保留目前版本，請稍後重試。');
    maintenanceResult(editorRegistration.waiting ? '新版已完整下載。按「保存並更新」才套用；目前設計未被清除。' : '檢查完成，未發現待套用的新版本；沒有重新載入或清除設計。');
  } catch (error) { maintenanceResult('更新未完成：' + error.message); }
  finally { maintenanceControls(false); }
}
function countEditorClients(worker) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const close = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
    const timer = setTimeout(() => { close(); reject(new Error('無法確認其他編輯分頁，未清理。請先套用新版、關閉其他 VisionFlow 分頁再重試。')); }, 5000);
    channel.port1.onmessage = event => {
      if (event.data?.type !== 'VF_EDITOR_CLIENT_COUNT' || !Number.isInteger(event.data.count)) return;
      const count = event.data.count; close(); resolve(count);
    };
    try { worker.postMessage({type:'VF_MAINTENANCE_CHECK'}, [channel.port2]); }
    catch (error) { close(); reject(error); }
  });
}
async function maintenanceRegistrations() {
  if (location.protocol === 'file:' || !isSecureContext || !navigator.serviceWorker) return [];
  const registrations = (await navigator.serviceWorker.getRegistrations()).filter(registration => registration.scope === editorScope().href);
  for (const registration of registrations) {
    await waitForEditorWorker(registration.installing);
    const worker = registration.waiting || registration.active || registration.installing;
    if (worker && worker.state !== 'redundant' && await countEditorClients(worker) > 1)
      throw new Error('請先關閉其他 VisionFlow 分頁／桌面 App，再清理；沒有刪除資料或刷新其他分頁。');
  }
  return registrations;
}
async function checkMaintenanceNetwork() {
  if (location.protocol === 'file:') return;
  if (!navigator.onLine) throw new Error('請先連上網路再清理，避免刪除離線快取後無法重新開啟。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    // sw.js is deliberately not in the shell cache, so this checks the real network.
    const url = new URL('sw.js', editorScope()); url.searchParams.set('maintenance-check', Date.now());
    const response = await fetch(url, {cache:'no-store', signal:controller.signal});
    if (!response.ok || !/const APP_VERSION\s*=/.test(await response.text())) throw new Error('伺服器尚未可用；未清理，請稍後重試。');
  } finally { clearTimeout(timer); }
}
async function clearScopedEditorCaches() {
  if (location.protocol === 'file:' || !isSecureContext || !globalThis.caches) return 0;
  const scope = editorScope(), prefix = 'visionflow-app:' + encodeURIComponent(scope.href) + ':';
  let removed = 0;
  for (const name of await caches.keys()) {
    if (name.startsWith(prefix)) { if (await caches.delete(name)) removed++; continue; }
    if (!/^visionflow[-:]/.test(name)) continue;
    // Legacy caches had no scope in their name: preserve entries from other apps.
    const cache = await caches.open(name), requests = await cache.keys();
    const own = requests.filter(request => {
      const url = new URL(request.url); return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    });
    if (!own.length) continue;
    if (own.length === requests.length) { if (await caches.delete(name)) removed++; }
    else for (const request of own) { if (await cache.delete(request)) removed++; }
  }
  return removed;
}
function removeEditorDrafts() {
  const keys = [DRAFT_KEY, DRAFT_KEY + '-backup-before-v2'];
  const originals = keys.map(key => [key, localStorage.getItem(key)]);
  try { keys.forEach(key => localStorage.removeItem(key)); }
  catch (error) {
    let restored = true;
    for (const [key, value] of originals) {
      try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); }
      catch { restored = false; }
    }
    throw new Error(restored ? '草稿刪除失敗，原始資料已回復，未重新載入。' : '草稿刪除失敗且可能部分刪除；請立即匯出目前設計，未重新載入。');
  }
}
async function clearEditorStorage(factory = false) {
  if (maintenanceBusy || updateRequested || sharingBusy) return;
  if (maintenanceGestureActive()) { maintenanceResult('請先完成或取消目前手勢，再清理；沒有刪除資料。'); return; }
  if (!factory && hasPendingEditorInput()) { maintenanceResult('匯入／貼圖尚未完成，未清理或取消它；請等待完成，或明確取消輸入後重試。'); return; }
  const message = factory
    ? '恢復出廠狀態會刪除 VisionFlow 已保存草稿、升級前備份、設定及目前未匯出的設計，無法撤銷。請先下載 HTML／JSON 或草稿備份，並關閉其他 VisionFlow 分頁。原始檔案及其他網站資料不受影響。確定還原？'
    : '清除所有 VisionFlow 程式暫存並重新載入？會先保存目前設計，保留草稿及備份；請先關閉其他 VisionFlow 分頁。不會清整個瀏覽器或其他網站資料。';
  if (!window.confirm(message)) { maintenanceResult('已取消，沒有清理或還原。'); return; }
  maintenanceControls(true);
  let navigating = false;
  try {
    await offlineInitialization;
    await checkMaintenanceNetwork();
    const registrations = await maintenanceRegistrations();
    if (!factory && hasPendingEditorInput()) throw new Error('匯入／貼圖尚未完成，未清理或取消它；請等待完成或取消後重試。');
    if (!factory && !performQuickSave()) throw new Error('設計尚未安全保存，未清理。請先下載設計或草稿備份。');
    maintenanceStoragePaused = true; clearTimeout(appearanceAutosaveTimer);
    cancelBackgroundUpload(); importRequestSequence++;
    for (const registration of registrations) {
      if (!await registration.unregister()) throw new Error('離線註冊未能安全取消，未繼續刪除快取；請重試。');
    }
    await clearScopedEditorCaches();
    if (factory) { removeEditorDrafts(); draftRecoveryBlocked = false; }
    editorRegistration = null;
    maintenanceResult(factory ? '出廠還原完成，正在重新載入空白預設；原始檔案及其他網站未改動。' : '程式暫存已清除，設計已保存，正在重新載入。');
    const target = new URL(editorLink()); target.searchParams.set('vf-refresh', Date.now());
    navigating = true; location.replace(target.href);
  } catch (error) {
    maintenanceResult('維護未完成：' + error.message + ' 若已取消離線註冊，重新連網開啟即可重建；目前設計仍可匯出。');
  } finally {
    if (!navigating) { maintenanceStoragePaused = false; maintenanceControls(false); }
  }
}
function initializeMaintenance() {
  document.getElementById('vf-maintenance').addEventListener('click', () => {
    document.getElementById('vf-maintenance-version').textContent = document.querySelector('meta[name="visionflow-app-version"]').content;
    document.getElementById('vf-maintenance-dialog').showModal(); updateAvailability();
  });
  document.getElementById('vf-maintenance-dialog').addEventListener('cancel', event => { if (maintenanceBusy) event.preventDefault(); });
  window.addEventListener('keydown', event => {
    if (document.getElementById('vf-maintenance-dialog').open) event.stopPropagation();
  }, true);
  document.getElementById('vf-maintenance-check').addEventListener('click', checkEditorUpdate);
  document.getElementById('vf-maintenance-apply').addEventListener('click', requestEditorUpdate);
  document.getElementById('vf-maintenance-clear').addEventListener('click', () => clearEditorStorage(false));
  document.getElementById('vf-maintenance-factory').addEventListener('click', () => clearEditorStorage(true));
  document.getElementById('vf-maintenance-backup').addEventListener('click', () => downloadDraftBackup());
}
