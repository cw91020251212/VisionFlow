# VisionFlow 外觀檔案改造與驗收報告

日期：2026-10-13。基線為 `23410a32dfe9ed23236106c5ba5e88320675664b`，與附件引用版本一致；開始及提交前均檢查遠端最新版本。本次不改成後端應用，保留原有 GitHub Pages 靜態架構。

## 結論

附件提出的產品方向合理，而且指出的主要缺陷確實存在：原來一次修改會重寫背景／陰影／字體／邊框；選框會隱藏原陰影；暫存只是記憶體中的執行 DOM；撤銷未真正還原匯入元素的修改。本次已改用可序列化外觀模型，將原始來源、靜態外觀快照與 AI 修改資料分開。

發佈前 `npm run check`、`npm test`、`git diff --check` 通過。**Chromium 27 項回歸測試全部通過，0 失敗、0 跳過、0 flaky。**正常使用不需要 Node、Python 或測試伺服器；亦已測試直接以 `file://` 開啟。

## 修改檔案

| 檔案 | 主要改動 |
| --- | --- |
| `index.html` | 接入新模型；刪除一次重寫所有樣式的舊邏輯；原選框改為獨立輔助層；新增 HTML／JSON 匯出、來源／說明／狀態／入口欄位；預設鎖定文字；保留原工具、群組、參考線、吸附、視口與預覽。 |
| `appearance.js`（新增） | 可序列化修改紀錄；元素識別；明確屬性變更；狀態與視口隔離；布局意圖；静態 HTML／JSON；草稿、撤銷／重做；可信脚本預覽；动态图層及匯入驗證。 |
| `folder-import.js`（新增） | 本地資料夾的入口頁、CSS `@import`、圖片／字體／傳統 JS 資源內嵌；不用 blob URL；缺失資源、CSS 循環、srcset 等限制會提示。 |
| `sw.js` | 更新應用資源快取版本，加入新 JS；應用檔案 network-first；清理僅限 VisionFlow 舊快取；保留既有分享消息通道。本次未新增 PWA 註冊或宣稱所有外部資源可離線。 |
| `README.md` | 改為符合真實功能的外觀參考定位；刪除不實的內建 AI 宣傳；加入操作、格式、交接、草稿／脚本風險及限制。 |
| `tests/fixtures/regression.html`（新增） | 附件指定七類元素的回歸頁面；包含原有漸層、陰影、事件與手機换行。 |
| `tests/appearance.spec.cjs`、`tests/folder.spec.cjs`（新增） | 27 項可重複執行的 Chromium 回歸測試。 |
| `tests/check-syntax.cjs`、`playwright.config.cjs`（新增） | JS／HTML 內嵌 script／JSON 語法驗證及測試環境。 |
| `package.json`、`package-lock.json`、`.gitignore`（新增） | 開發用測試依賴、鎖定版本與排除臨時產物；不增加產品執行依賴。 |
| `manus-routes.json`、`plan.md`、`TODO.md`、本報告（新增） | 開發路由聲明、實作／驗收紀錄及交付說明；不改 Pages 路由或部署設定。 |

`LICENSE`、圖示、`manifest.json` 未修改；未把使用者附件或任何憑證提交至倉庫。

## 外觀及資料保護

只修改明確觸發的屬性。移動使用独立 CSS `translate`，不覆蓋原 `transform`，也不清除背景、漸層、陰影、字體或邊框。尺寸修改保留原 box-sizing；陰影局部修改保留其他偏移、顏色、spread、inset 及多重陰影；單一 linear-gradient 的角度／端點修改保留原其他 stops。

真實元素不加去陰影的選中 class；匯入頁與演示畫布均用獨立選框。參考線、縮放控制點、選框和吸附標記不進外觀 JSON，靜態 HTML 也會移除編輯輔助層。

原入口文字與 SHA-256 校驗值獨立保存。執行 DOM 只用於標明為「靜態外觀參考」的預覽快照，不冒充原工程。匯出會移除全部原有 script、事件屬性及可執行 URL，也排除原有 hydration／業務 JSON；唯一新 script 是不可執行的 VisionFlow 外觀資料。

文字編輯預設關閉。連結地址、表單欄位、圖片来源及業務代码不作源碼改寫。可信脚本預覽只是觀察原事件／动态元素，並非功能整合；同頁撤銷不重建 DOM，已驗證原 `addEventListener` 仍有效。跨來源切換／重建或刷新不能還原全部執行狀態，會使用静態視覺快照並明示。

## 新增格式

| 格式 | 驗證結果 |
| --- | --- |
| `visionflow-appearance.html` | 有效 HTML；內嵌 `application/json`；包含 `visionflow-appearance-v1`；可重新匯入繼續外觀編輯。 |
| `visionflow-appearance.json` | `JSON.parse()` 成功；每項有目標、頁面、視口、狀態、範圍、保留事項、補充說明；不偽造未修改的 CSS。 |

JSON 具有 `source`、`pages`、`viewport`、`changes`、`userNotes` 和 `preview`。每項記錄區分 desktop／mobile、default／hover／focus／disabled／loading，以及 `this-element`／`all-matching`。位置額外包含父級、布局類型、相鄰元素、間距、參考位置和保留響應式的意圖，不僅輸出固定 left／top。

已有 ID 優先，其次採較穩定的 data 標記，再採語義、文字、selector、DOM 路徑和矩形。結構識別缺乏穩定性時會提示補充區域說明；沒有把内部临时編號假裝成真實 ID。同類元素位移被限制為單一元素，以保護其他实例不同的原始 translate。

## 執行的測試

命令：

```sh
npm ci
npx playwright install chromium
npm run check
npm test
git diff --check
```

測試環境為 Ubuntu／Chromium，以 Playwright 執行；HTTP 測試使用臨時靜態服務，另有 `file://` 獨立測試。最終整套約 11 秒完成。早期測試及審查發現的問題已修正後重測，不以第一次結果或未執行檢查當作通過。

| 測試類別 | 具體驗證 | 結果 |
| --- | --- | --- |
| 選取與來源 | 選取不改漸層、陰影、outline；沒有編輯時 `changes` 為空；原始檔案內容不覆寫。 | 通過 |
| 位置與 transform | 輸入位移及真實滑鼠拖動；保留原旋轉／transform、字體、邊框、背景、陰影；輸出布局意圖。 | 通過 |
| 普通按鈕 | 僅改背景色，不改尺寸、邊框、陰影；原 click listener 在功能預覽可繼續執行。 | 通過 |
| 陰影卡片 | 選中／匯出皆可見陰影；只改 blur，其他參數及多重／inset／spread 陰影仍保留。 | 通過 |
| 漸層 | 改角度保留原色；多色 stops 及百分比保留。 | 通過 |
| 圓角及內容 | 圓角不改文字；文字輸入停用；輸入框 name／type／value 保留；連結 href 保留。 | 通過 |
| 尺寸 | 只改寬度不鎖定高度；測試卡片無額外水平溢出；content-box 不被轉成 border-box；真實控制點縮放。 | 通過 |
| 匯出 | HTML、格式版本、目標識別、`JSON.parse()`、保留事項、精確修改；無 overlay／參考線／執行脚本／業務 JSON。 | 通過 |
| 重新匯入 | HTML 可恢復並再編輯；JSON 獨立下載／載入；錯來源／錯頁面 JSON 拒絕並提示。 | 通過 |
| 撤銷／重做 | 還原外觀資料、選取、群組、參考線、視口及主題；同頁原事件仍有效；跨來源切換後恢復正確 prepared source。 | 通過 |
| 刷新及保存 | 本機草稿恢復修改和選取；位移不重複疊加；容量失敗提示匯出，不誤報成功。 | 通過 |
| 手機及狀態 | 桌面與手機各自圓角；手機元素換行；五種狀態各自輸出；重新切回桌面不串值。 | 通過 |
| 重複列表 | 只改一個实例或所有匹配項；不讓同類項的不同原位移被覆蓋。 | 通過 |
| JS 元素 | 原脚本生成按鈕可編輯、listener 不被重寫；稍後生成元素加入圖層；静態草稿刷新保留其外觀但不自動信任脚本。 | 通過 |
| 特殊優先級 | 原 inline `!important` 可修改、撤銷、匯出；手機未改狀態保留原外觀；重新匯入不混入桌面模擬。 | 通過 |
| 原演示功能 | 新增圖形、群組／解散、屬性撤銷；選框及控制點為獨立 sibling overlay。 | 通過 |
| 資料夾及錯誤 | 多 HTML 入口；递迴 CSS、圖片／字體／JS data URL；默认不執行脚本；缺資源與 srcset 警告；無 HTML、非法 CSS 有明確錯誤。 | 通過 |
| 不需後端 | 直接 `file://` 開啟、匯入、修改及生成外觀檔案；無頁面 JS 錯誤。 | 通過 |

## 尚未完成／仍有限制

| 未完整支援的項目 | 現行範圍 |
| --- | --- |
| 任意完整網站／SPA 匯入 | 僅編輯目前 HTML 入口，提供入口切換；不是 build system、服務端路由或任意模組執行器。 |
| 本地 `srcset` 全內嵌 | 保留原 `srcset` 並警告；未實作完整響應式圖片打包。 |
| 複雜背景局部修改 | 單一 linear-gradient 可局部修改；radial／多層背景不安全解析，需明確替換。 |
| 自動整合 Flex／Grid／響應式源码 | 只輸出布局意圖及像素參考；後續 AI／開發者仍須在原工程判斷、修改及測試。 |
| 任意執行狀態還原 | 刷新保留靜態外觀與明確修改，不能還原 JS 閉包、事件綁定、網路狀態或整個程式。 |
| 多頁一次編輯及打包 | JSON 可表示多頁，但 UI 一次編輯一頁；各頁另行匯出，切換前要求保存。 |
| 各瀏覽器／真實手機全面驗證 | 本次 Chromium 通過；Safari／Firefox／真實手機未完成整套測試。 |
| 原工程全部功能保證 | VisionFlow 不提供此保證；原工程測試須由整合者執行。 |

草稿受 localStorage 容量和瀏覽器資料清理影響；外部 HTTP 資源仍需網路；候選圖層上限 1000；伪元素、跨來源 iframe 和 Shadow DOM 內部未完整支援。可信脚本選項不是安全沙箱，只適用自己的可信页面。以上限制均在 UI 或 README 明示，不宣稱「基本完成任意網站整合」。

## GitHub 與 Pages

沿用 `cw91020251212/VisionFlow` 的 `main`／根目錄 GitHub Pages。沒有更改 Pages 設定、網域、存取權或部署架構。程式驗證通過後才提交及推送；推送會由既有 Pages 流程更新網站。最終提交 SHA 和實際部署／線上驗證結果由本次交付報告補充，不能只把本機測試成功當成已發佈。

## 如何交給另一套 AI

將原始工程完整源碼、`visionflow-appearance.html`、`visionflow-appearance.json`、額外說明及啟動／構建／測試命令一起提供。原工程是唯一功能來源，外觀 HTML 是視覺對照，不是替代程序。

> 請以原始工程為唯一功能來源。讀取 VisionFlow 外觀檔案，只將其中明確列出的外觀屬性整合到原工程。不要用外觀 HTML 替換原工程，不要刪除或重寫業務邏輯、事件處理、資料請求和表單行為。對於元素对应不明確或可能影響響應式布局的修改，先列出判斷依據。完成後執行原工程測試，並檢查桌面與手機視口。
