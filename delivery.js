'use strict';

let editorRegistration = null;
let updateRequested = false;
let sharingBusy = false;

async function copyEditorText(text, fallback) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('unsupported');
    await navigator.clipboard.writeText(text); return true;
  } catch {
    if (fallback) { fallback.focus(); fallback.select(); }
    return false;
  }
}
function editorLink() {
  const url=new URL(location.href); url.search=''; url.hash=''; return url.href;
}
function shareArtifactDescription() {
  const result=document.getElementById('vf-share-result');
  try {
    const artifact=createExportArtifact(document.getElementById('vf-share-format').value);
    document.getElementById('vf-share-preview').textContent=`${artifact.filename} · ${new Blob([artifact.content]).size.toLocaleString()} bytes`;
    result.textContent='分享的是目前設計檔，不是原工程，也不是公開設計連結。含頁面文字／圖片及交接說明，請只交給信任的接收者。';
  } catch(error) { result.textContent=error.message; }
}
async function shareCurrentArtifact() {
  if (sharingBusy) return;
  const result=document.getElementById('vf-share-result'), send=document.getElementById('vf-share-send');
  try {
    // Build synchronously inside the user's click: don't lose transient activation.
    const artifact=createExportArtifact(document.getElementById('vf-share-format').value);
    const file=new File([artifact.content],artifact.filename,{type:artifact.kind==='html'?'text/html':'application/json'});
    if (!navigator.share || !navigator.canShare?.({files:[file]})) {
      result.textContent='瀏覽器不支援分享這類檔案。請用「下載檔案」後，透過你自己的通訊軟體傳送；未對外傳送。'; return;
    }
    sharingBusy=true;send.disabled=true;
    await navigator.share({files:[file],title:'VisionFlow 外觀參考',text:'靜態外觀參考，不是原工程；請連同原始工程整合。'});
    markArtifactExported(artifact);
    result.textContent='已交予系統分享；請確認接收者收到檔案。若之後再修改，需再次匯出／分享。';
  } catch(error) {
    result.textContent=error.name==='AbortError'?'分享已取消，或沒有可用接收程式；未標記已匯出。':`分享未完成：${error.message}。可改用「下載檔案」後手動傳送。`;
  } finally { sharingBusy=false;send.disabled=false; }
}
function downloadSharedArtifact() {
  try {
    const artifact=createExportArtifact(document.getElementById('vf-share-format').value);
    downloadTextFile(artifact.content,artifact.filename,artifact.kind);markArtifactExported(artifact);
    document.getElementById('vf-share-result').textContent='已開始下載安全設計檔；請自行傳送。沒有上傳雲端或產生公開連結。';
  } catch(error) { document.getElementById('vf-share-result').textContent=error.message; }
}
function handleLaunchRequest() {
  const url=new URL(location.href), params=url.searchParams;
  const action=params.get('action');
  if (action==='new' || action==='import') {
    document.querySelector('.workspace').classList.remove('left-closed');scheduleLayoutRefresh();
    document.getElementById('file-input').focus();
    if(action==='new')setStatus('已開啟專案面板，未清除草稿。請先匯出備份；需要空白設計時使用「清空畫布」，可復原。');
    params.delete('action');
  }
  const received=['title','text','url'].map(key=>params.get(key)||'');
  if(received.some(Boolean)) {
    if(received[0].length>2000 || received[1].length>100000 || received[2].length>10000) {
      sysAlert('分享文字太長，未套用或執行。請改以設計檔案匯入。');
    } else {
      const text=received.filter(Boolean).join('\n');
      document.getElementById('vf-inbox-text').value=text;
      const add=document.getElementById('vf-inbox-add');
      add.disabled=draftRecoveryBlocked;
      document.getElementById('vf-inbox-result').textContent='只接收文字／網址，不會自動載入網頁。按下方按鈕才加入目前設計的交接說明；畫布說明最多10000字元。';
      document.getElementById('vf-inbox-dialog').showModal();
    }
    ['title','text','url'].forEach(key=>params.delete(key));
  }
  // Remove received text from this tab's URL without reloading or touching designs.
  window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
}
function addReceivedNotes() {
  const result=document.getElementById('vf-inbox-result');
  if(draftRecoveryBlocked){result.textContent='請先備份草稿並匯入原頁面；沒有修改目前設計。';return;}
  const joined=[appearanceNotes,document.getElementById('vf-inbox-text').value].filter(Boolean).join('\n\n');
  const limit=importedMode?100000:10000;
  if(joined.length>limit){result.textContent=`合併後說明超過${limit}字元，未修改；請先複製並縮短。`;return;}
  savePoint();appearanceNotes=joined;syncAppearanceControls();scheduleAppearanceSave();
  document.getElementById('vf-inbox-dialog').close();setStatus('已將收到的文字／網址加入交接說明，沒有抓取網址或執行內容。');
}
function updateAvailability() {
  const button=document.getElementById('vf-update-app');
  button.hidden=!editorRegistration?.waiting;
  if(editorRegistration?.waiting)document.getElementById('vf-offline-state').textContent='有新版待更新（先保存草稿）';
}
function offlineState(message) { document.getElementById('vf-offline-state').textContent=message; }
async function initializeOfflineEditor() {
  if(location.protocol==='file:') { offlineState('本地檔案模式：無應用快取，仍可匯入／下載');return; }
  if(!isSecureContext || !navigator.serviceWorker) { offlineState('此瀏覽器／環境未提供離線快取');return; }
  try {
    editorRegistration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    function trackWorker(worker) {
      if(!worker)return;
      worker.addEventListener('statechange',()=>{updateAvailability();if(worker.state==='activated'&&!editorRegistration.waiting)offlineState(navigator.onLine?'應用離線快取就緒；外部資源仍需網路':'離線模式；外部資源可能不可用');});
    }
    trackWorker(editorRegistration.installing);
    editorRegistration.addEventListener('updatefound',()=>trackWorker(editorRegistration.installing));
    updateAvailability();
    navigator.serviceWorker.ready.then(()=>{if(!editorRegistration.waiting)offlineState(navigator.onLine?'應用離線快取就緒；外部資源仍需網路':'離線模式；外部資源可能不可用');});
    navigator.serviceWorker.addEventListener('message',event=>{
      if(event.data?.type==='VF_UPDATE_BLOCKED') {updateRequested=false;document.getElementById('vf-update-app').disabled=false;setStatus(event.data.message);}
    });
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(!updateRequested)return;
      updateRequested=false;
      if(performQuickSave(true))location.reload();
      else setStatus('新版已啟用，但草稿保存失敗，未刷新目前設計；請先下載備份。');
    });
    window.addEventListener('offline',()=>offlineState('離線模式；外部資源可能不可用'));
    window.addEventListener('online',()=>{updateAvailability();if(!editorRegistration.waiting)offlineState('網路已恢復；外部資源仍依賴網路');});
  } catch(error) { offlineState('離線快取未建立：'+error.message+'；編輯／下載仍可用'); }
}
function requestEditorUpdate() {
  if(!editorRegistration?.waiting || updateRequested)return;
  if(!performQuickSave()) {setStatus('尚未安全保存草稿，未更新或刷新；請完成手勢或先下载備份。');return;}
  updateRequested=true;document.getElementById('vf-update-app').disabled=true;
  setStatus('草稿已保存，正在請求新版；若有其他分頁請先關閉。');
  editorRegistration.waiting.postMessage({type:'VF_ACTIVATE_UPDATE'});
}
function initializeDelivery() {
  document.getElementById('vf-share').addEventListener('click',()=>{shareArtifactDescription();document.getElementById('vf-share-dialog').showModal();});
  document.getElementById('vf-share-format').addEventListener('change',shareArtifactDescription);
  document.getElementById('vf-share-send').addEventListener('click',shareCurrentArtifact);
  document.getElementById('vf-share-download').addEventListener('click',downloadSharedArtifact);
  document.getElementById('vf-share-copy-link').addEventListener('click',async()=>{
    const field=document.getElementById('vf-editor-link');field.hidden=false;field.value=editorLink();
    const copied=await copyEditorText(field.value,field);
    document.getElementById('vf-share-result').textContent=copied?'已複製編輯器網址（不含設計）。要分享設計請傳送上方檔案。':'剪貼簿不可用，已選取編輯器網址，請手動複製；不含設計。';
  });
  document.getElementById('vf-copy-resources').addEventListener('click',async()=>{
    const field=document.getElementById('vf-resource-text'), copied=await copyEditorText(importReportText(),field);
    setStatus(copied?'已複製完整資源報告。':'剪貼簿不可用，已選取完整報告，請手動複製。');
  });
  document.getElementById('vf-inbox-copy').addEventListener('click',async()=>{
    const field=document.getElementById('vf-inbox-text');document.getElementById('vf-inbox-result').textContent=await copyEditorText(field.value,field)?'已複製收到的文字。':'剪貼簿不可用，已選取文字，請手動複製。';
  });
  document.getElementById('vf-inbox-add').addEventListener('click',addReceivedNotes);
  document.getElementById('vf-update-app').addEventListener('click',requestEditorUpdate);
  handleLaunchRequest();initializeOfflineEditor();
}
