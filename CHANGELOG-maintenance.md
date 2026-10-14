# VisionFlow 暫存／更新／出廠還原

本次依使用者要求新增維護面板；「還原」已於2026-10-14 19:20確認為恢復出廠狀態，清掉VisionFlow草稿和設定重新開始，不是撤銷一個操作或退回舊程式版本。

## 操作入口

頁腳 **「暫存／更新／還原」** 打開面板並顯示程式版本 `maintenance-controls-v2`。

**清除暫存並重新載入**：先保存目前設計，再取消本應用scope的離線註冊、清程式CacheStorage和記憶體暫態，重新開啟。設計草稿及升級前備份保留；安全保存失敗時拒絕重新載入。這不等於清空整個瀏覽器HTTP快取，也不清其他網站的存儲。

**檢查更新**：手動檢查SW新版本，不刪設計、不強制刷新。新版所有應用檔案完整下載後顯示「保存並更新」，沿用既有保存失敗、進行中手勢及其他編輯分頁的保護。被其他分頁阻擋後，關閉該分頁可在同一面板立即重試。

**還原出廠狀態**：先顯示不可撤銷確認，刪除已保存的VisionFlow草稿、升級前備份及其中的工具設定，放棄目前未匯出的設計並重新開啟空白預設。確認前不刪資料；面板提供下載草稿備份。原始HTML／圖片檔、其他網站的資料和程式原始碼不會被這個功能刪掉。未知／損壞草稿亦可由使用者明確還原；它不是自動修復草稿或還原備份。

## 資料及快取保護

清理只處理精確scope的註冊及應用快取前綴。舊visionflow混合快取僅刪本scope請求，其他來源項保留。只移除VisionFlow既有 `visionflow-appearance-draft-v1` 及 `-backup-before-v2` 兩個鍵，不使用localStorage.clear、全站unregister或刪除瀏覽器全部CacheStorage。

清理前檢查網路、同scope其他編輯分頁及手勢，操作中不應另開編輯分頁。清理階段停止保存定時器及pagehide／beforeunload寫回，並取消過期匯入與貼圖；刪除草稿鍵出錯時嘗試回復原始位元並明示失敗，不假報已全部清除。維護對話框的鍵盤事件不會順帶刪除／撤銷畫布。

HTTP快取不由JS全域刪除。HTML版本meta、全部JS的`?v=`網址和SW版本同步，避免取消SW後重新載入仍命中舊HTTP脚本。新模組加入完整離線套件，第一安裝仍不接管半載入頁面，更新仍等待使用者。

## 修改檔案

`maintenance.js`集中維護UI及清理／更新；`appearance.js`增加資料清理階段的保存守衛；`delivery.js`重用更新入口並同步兩個套用按鈕；`sw.js`提供scope内分頁數檢查及新版資源清單；`index.html`新增面板和版本化腳本。既有SW測試伺服器抽至`tests/helpers/sw-fixture.cjs`供新舊回歸重用，沒有新增產品依賴。README、plan及TODO同步。

## 驗證與發布

完整全套 Chromium 回歸164項通過，0失敗、0跳過、0flaky；含新增非同步匯入／貼圖懸置測試（清快取與更新都拒絕取消輸入、其完成後可繼續）、更新被多分頁阻擋後可重試、離線清理拒絕、確認後丟棄貼圖、鍵盤快捷鍵隔離及原先四批和貼圖功能。`npm run check`、`git diff --check`均通過。只讀審查發現的非同步輸入風險已修正並有回歸覆蓋。提交`a91bf251ae494da61bc1ed509a93a017bcc7a34a`已推送，PR #6（base `main`）已建立：[PR #6](https://github.com/cw91020251212/VisionFlow/pull/6)。分支預覽HTTP 200：[打開維護功能預覽](https://8771-ig0t4iybxb8dlbriv55cb-84142f63.sg2.manus.computer/)。正式網址仍是舊版，尚未合併／部署；正式`main`未變，待使用者明確確認後才合併並更新公開網站。

尚未完成Safari／Firefox／真實手機全面人工驗收。不支援SW的环境不能由worker檢查其他分頁，仍需使用者先關閉；file://沒有程式快取／線上更新，但可明確還原本機草稿。出廠還原刪除的設計無法靠Ctrl+Z取回，重要設計務必另外下载HTML／JSON。

如果仍看不到維護入口，舊版先用頁腳「保存並更新」，或先匯出重要設計、關閉所有VisionFlow分頁後重新開啟原網址；不要先清整個網站資料。正式網址維持 https://cw91020251212.github.io/VisionFlow/ 。

瀏覽器依據：[MDN unregister](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/unregister)、[MDN update](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update)。
