# Development Log - 大藏經 AI 白話翻譯與古大德註疏系統 (BuddhaSutra-註疏)

> 本文件依 `.antigravityrules` 規範第 2 條維護，完整記錄每次互動之需求接收、理解分析、設計思考與實作歷程。當本檔案過長（例如超過 500 行或單一里程碑完成）時，將依輪替機制歸檔至 `docs/logs/development-log-YYYYMMDD.md`。

---

## [2026-11-23 10:52] Session 01：專案啟動、規範建置與系統架構規劃

### 1. 接收到的 User Prompt 摘要
- **參考網站**：`https://tripitaka.paramita-budda.com/?id=T09n0278_001`（附 2 張畫面截圖，展示左側大正新脩大藏經目錄樹、主畫面經文段落與「白話直譯／白話口語化新譯／法義解析／名相註解」逐句連動高亮介面）。
- **核心功能需求**：
  1. 完整列出「大藏經」分類目錄，可一層層展開找到佛經與卷次。
  2. 點入佛經後顯示漢文原文。
  3. 隨著游標指到的句子，即時／連動顯示 **AI 翻譯**，同時顯示 **古大德註疏／翻譯**。
  4. 分類目錄先完整做好，起始經文先以 **《華嚴經》** 與 **《楞嚴經》** 兩部為設計起點。
- **AI Agent 行動準則（Rules 1–6）**：
  - 每次任務前讀取並遵守規範、結束時附上標準履約查核標籤。
  - 維護 `development-log.md`（超長歸檔至 `docs/logs/`）。
  - 維護 `Bulletin.json`（記錄跨 Agent/Tools/API/MCP 支援需求與閉環狀態）。
  - 專案內檔案管理免再詢問，嚴禁動到 `.git/`、模型權重與敏感金鑰。
  - 嚴禁終端機檔案/字串搜尋；所有終端機測試與查詢統一寫入 `test_safe_command.py` 並僅執行 `python test_safe_command.py`。
  - 持續透過對話優化規範文件。

### 2. AI 的理解與分析
- **現有環境檢查**：透過原生 `read_file` 檢查專案根目錄，確認 `.antigravityrules` 已存在並包含完整的 1–6 條規範（含第 4 條隱私保護與第 5 條防彈原則）；`development-log.md` 與 `Bulletin.json` 尚未建立，故於本回合初始化。
- **產品差異化亮點**：相較於參考網站僅有純 AI 翻譯，本專案導入「**古大德註疏對照**」並讓 AI 翻譯參考古大德註疏（Context-grounded Translation），可大幅提升佛學法義的準確性，避免 AI 望文生義。
- **關鍵技術挑戰與解法構想**：
  1. **經文與註疏來源**：採用 CBETA 開源大正藏／卍續藏資料（XML/JSON），原生支援「部 → 經 → 卷 → 品 → 段」結構。
  2. **逐句對齊與效能**：將經文切分為句級 ID（Sentence Span），採「本地快取優先 + Cache Miss 時即時呼叫 AI API 並寫回快取」的混合策略，並對 hover 加上 Debounce 或 Click 鎖定，避免滑鼠滑過時過度觸發 API。
  3. **古大德註疏對齊**：註疏多為「科判／段落級」而非完全 1:1 逐句，因此在資料模型設計上採用「起訖句區間（`start_sentence_id` ~ `end_sentence_id`）」對應註疏條目，當游標指到該區間內任一句時即自動高亮對應的祖師註疏。

### 3. 本回合執行動作
- [x] 讀取並確認 `.antigravityrules` 規範內容。
- [x] 建立 `development-log.md` 記錄本次啟動與架構規劃。
- [x] 建立 `Bulletin.json` 並登記初期需確認/支援之外部資源項目（CBETA 資料來源與 LLM API 選型）。
- [x] 建立 `test_safe_command.py` 作為日後合規查詢/測試之統一入口。
- [ ] 待與使用者確認技術棧、華嚴經譯本（60/80/40卷）、AI 模型來源與偏好後，進入 Phase 1 實作。

---

## [2026-11-23 11:06] Session 02：需求定案與翻譯知識庫（`translation_kb/`）資料結構設計

### 1. 接收到的 User Prompt 與附圖摘要
- **《華嚴經》主譯本**：確認以 **80 卷唐譯（實叉難陀，`T10n0279`）** 為主。
- **古大德註疏收錄範圍**：確認**全部收錄**供使用者自由選擇（依使用者提供之《華嚴經》歷代重要註疏大德表：唐智儼《搜玄記》、唐法藏《探玄記》、唐澄觀《華嚴疏鈔》、唐李通玄《新華嚴經論》、唐宗密《行願品疏鈔》、明憨山德清《華嚴經綱要》、清續法《華嚴經疏論纂要》；《楞嚴經》亦比照完整收錄歷代大德）。
- **LLM 雙引擎**：支援 **Gemini API（預設）** 與 **本機 Ollama 模型**。
- **核心快取與知識庫策略**：AI 翻譯過的句子必須自動存入 workspace 下的本地翻譯知識庫資料夾；查詢時採 Cache-First，本地找不到才呼叫 AI 翻譯，避免重複花費與等待。使用者特別要求謹慎設計翻譯知識庫資料結構。

### 2. AI 的分析與架構決策
- 針對「跨譯本古大德註疏」（例如智儼、法藏針對六十華嚴；宗密針對四十華嚴，而主閱讀本為八十華嚴）提出 `target_edition` ＋ `alignment_type: "cross_edition"` ＋ `cross_edition_note` 欄位設計，既能全部收錄又不會讓讀者混淆譯本差異。
- 知識庫採 **Per-Fascicle JSON 分片**（`translation_kb/translations/{sutra_id}/{fascicle}.json`）作為 Single Source of Truth，兼顧 O(1) 查詢、Windows 檔案系統效能、人類可讀性與 Git 友善度。
- 單句翻譯條目支援 **多版本並存（`versions[]`）**（方便日後比較 Gemini vs. Ollama 譯文）、**人工校訂鎖定（`locked_by_human`）**、**原文雜湊校驗（`source_hash`）** 與 **引用大德溯源（`referenced_masters`）**。
- 寫入端規劃 **In-Flight 去重鎖** 與 **Atomic Write（`.tmp` + `os.replace`）**，防止滑鼠頻繁互動造成 JSON 損毀或重複扣費。

### 3. 本回合執行動作
- [x] 建立完整資料結構規格書 `docs/knowledge-base-schema.md`。
- [x] 更新 `development-log.md`（本紀錄）。
- [x] 更新 `Bulletin.json` 中 `BLT-20261123-002` 之 LLM 選型決策狀態。
- [ ] 待使用者確認 `translation_kb/` 資料結構規格後，立即啟動 Phase 1（建立資料夾與初始資料、後端 FastAPI + Gemini/Ollama 雙引擎、前端三欄閱讀器）。

---

## [2026-11-23 11:22] Session 03：Phase 1 & Phase 2 核心系統實作與端到端驗證完成

### 1. 接收到的 User Prompt
- 使用者確認資料結構規格書後下達「開始實作」。

### 2. 環境偵測與架構決策
- 透過 `python test_safe_command.py` 檢查本機環境：Python 3.14.6 已內建安裝 `fastapi`、`uvicorn`、`httpx`、`pydantic`、`python-dotenv`、`google-genai`，免去額外安裝依賴；因此前端採零建置成本之純模組化 HTML/CSS/JS 由 FastAPI 直接託管，讓使用者僅需執行 `python run_app.py` 即可單鍵啟動完整系統。

### 3. 本回合完成項目
- **本地知識庫（`translation_kb/`）**：
  - `schema_meta.json`、`catalog/taisho_tree.json`（完整大正藏 25 大部階層分類樹）。
  - 起始兩部經文：`sutras/T10n0279/fascicles/001.json`（八十華嚴卷第一〈世主妙嚴品第一之一〉）與 `sutras/T19n0945/fascicles/001.json`（楞嚴經卷第一）。
  - 古大德總表與全部註疏：`commentaries/masters_registry.json`＋華嚴 7 位大德（澄觀、李通玄、憨山、續法、智儼、法藏、宗密，含跨譯本對照標記）＋楞嚴 5 位大德（長水子璿、交光真鑑、憨山德清、蕅益智旭、圓瑛大師）。
  - 初始預快取譯文與名相庫：`translations/T10n0279/001.json`、`translations/T19n0945/001.json`、`glossary/terms.json`。
- **後端服務（`backend/` & `run_app.py`）**：
  - `backend/kb_store.py`：實作 Cache-First 查詢、Per-File Lock、Atomic Write（`.tmp` + `os.replace`）、多版本並存、人工鎖定與名相自動合併。
  - `backend/llm_service.py`：實作雙引擎（預設 Gemini API + 本機 Ollama），將前後文與已勾選古大德註疏注入 Prompt，並支援古大德文言註疏一鍵白話導讀。
  - `backend/main.py`：FastAPI 路由、In-Flight 併發去重鎖、靜態前端託管。
  - `.env.example` 與 `.gitignore`（確保 API 金鑰不外洩）。
- **前端介面（`frontend/`）**：
  - `index.html`、`styles.css`、`app.js`：仿大正藏白話翻譯計畫之溫潤宣紙三欄閱讀器，具備階層目錄樹展開、即時搜尋、古大德多選晶片、游標指句高亮連動、點擊鎖定、游標停留自動翻譯開關、Gemini/Ollama 引擎切換、段落 `Go` 跳轉器與古文註疏 AI 導讀按鈕。

### 4. 驗證結果
- 透過 `python test_safe_command.py` 執行 7 項端到端自動化檢查：
  - `GET /api/health`、前端靜態資源、`/api/llm/status`、`/api/catalog`（25 部）、八十華嚴（7 大德）、楞嚴經（5 大德）、`POST /api/translate/sentence` Cache-First 命中、以及獨立暫存目錄之 `KnowledgeBaseStore` 原子寫入＋多版本＋名相合併，**全數 PASS**。

---

## [2026-11-23 11:41] Session 04：使用者實機驗證成功並詢問「卷二要怎麼選」

### 1. 接收到的 User Prompt 與畫面回饋
- 使用者已成功啟動 `http://127.0.0.1:8000` 並完成 Gemini API 金鑰設定（畫面顯示 `Gemini 就緒 (gemini-2.5-flash)`、本卷知識庫已累積 `5 / 23 句` 且成功命中本地快取）。
- 使用者提問：「問一下，卷二要怎麼選」。

### 2. AI 的理解與回覆方向
- 目前初期僅匯入八十華嚴與楞嚴經之「卷第一」（`001.json`），尚未匯入卷二以後之經文，介面亦尚未加入「卷次下拉選單／上一卷・下一卷」快速切換元件。
- 向使用者清楚說明現況，並提議下一步直接實作：
  1. 經名旁新增「卷次下拉選單＋上一卷／下一卷」切換器。
  2. 串接 CBETA 公開經文 API（或批次匯入腳本），讓點選卷二～卷八十（八十華嚴）與卷二～卷十（楞嚴經）時能自動下載、斷句並存入 `translation_kb/sutras/` 供即刻閱讀與翻譯。

---

## [2026-11-23 11:58] Session 05：實作「卷次切換器」＋「CBETA Online API 自動抓取入庫」

### 1. 接收到的 User Prompt
- 使用者確認實作「卷次切換器 ＋ CBETA 自動抓取入庫」。

### 2. 技術實作內容
- **CBETA 自動抓取與斷句模組（`backend/cbeta_fetcher.py`）**：
  - 串接 CBETA 公開 API（`https://cbdata.dila.edu.tw/stable/juans`），自動將 `T10n0279` / `T19n0945` 轉換為 `T0279` / `T0945`。
  - 以標準庫 `HTMLParser` 解析 `<div id="body">`，過濾行號、校勘註腳與異文，保留品名 `<mulu class="pin">`、段落與偈頌 `<div class="lg">`，並依漢文句末標點切分為句級 JSON（含 `source_hash`）。
- **後端整合（`backend/kb_store.py` & `backend/main.py`）**：
  - `GET /api/sutras/{sutra_id}/fascicles/{fascicle}` 升級為「本地知識庫優先；若本地尚無該卷，自動加鎖向 CBETA 下載並原子寫入 `translation_kb/sutras/{sutra_id}/fascicles/{卷號}.json`」。
  - 回傳 `fascicle_count`、`local_fascicles` 與 `fetched_from_cbeta` 供前端呈現。
- **前端卷次切換器（`frontend/index.html`, `styles.css`, `app.js`）**：
  - 經名右側新增 `◀ 上一卷` ｜ `卷第 X / N（✓ 本地 / CBETA）` 下拉選單 ｜ `下一卷 ▶`，支援八十華嚴 1–80 卷與楞嚴經 1–10 卷自由切換；首次下載完成會顯示綠色入庫提示條。

### 3. 驗證結果
- 透過 `python test_safe_command.py` 實測抓取 `T10n0279` 卷第二：
  - 首次請求成功從 CBETA 下載《世主妙嚴品第一之二》（41 段、276 句），自動寫入 `translation_kb/sutras/T10n0279/fascicles/002.json`（75,474 bytes）。
  - 第二次請求確認直接命中本地知識庫（`fetched_from_cbeta=False`），**全數 PASS**。

---

## [2026-11-23 12:08] Session 06：三欄獨立捲軸（Independent Scroll）版面升級

### 1. 接收到的 User Prompt
- 使用者截圖指出畫面上三個區塊（左：大正藏目錄、中：AI 翻譯與古大德註疏、右：漢文原文）只有兩個捲軸，要求三個區塊各自擁有獨立的上下捲動控制。

### 2. 解法與修改
- 修改 `frontend/styles.css`：
  - 鎖定桌面版視窗高度（`html, body { height: 100%; overflow: hidden; }`、`.app-shell { height: calc(100vh - 54px); }`）。
  - `.main-area` 採 `flex-direction: column; height: 100%; overflow: hidden;`，使經名列與古大德選擇列固定在上方。
  - `.sidebar`、`.analysis-pane`、`.sutra-pane` 三個容器均設定 `height: 100%; min-height: 0; overflow-y: scroll/auto;` 並套用一致的溫潤宣紙色系捲軸樣式。
  - 將右下角浮動「段 / Go」跳轉器移至右下角橫向排布，避免遮擋古大德「清除」按鈕與右側原文捲軸。
- 修改 `frontend/app.js`：切換卷次時自動將中欄與右欄各自捲回頂端（`scrollTop = 0`）。

---

## [2026-11-23 12:20] Session 07：實作全卷古大德註疏 CBETA 動態檢索與本地快取入庫

### 1. 接收到的 User Prompt
- 使用者回報：「古大德的註疏對照請確認一下，第二卷之後就一直符合 0 條」。

### 2. 問題根因與解法
- **根因**：`translation_kb/commentaries/` 僅預先建立卷第一之手工註疏，卷二以後尚未有本地對照檔。
- **解法（全卷通用、Cache-First）**：
  - 於 `backend/cbeta_fetcher.py` 新增 `search_cbeta_commentaries_for_sentence`：自動從目標經句抽取 4~6 字辨識度片語，透過 CBETA `/stable/search` 檢索所有古大德典籍（`T1735`, `T1736`, `T1739`, `X0240`, `X0233`, `T1732`, `T1733`, `X0227`, `T1799`, `X0275`, `X0281`, `X0284`），再以 `/stable/search/kwic` 平行擷取真實祖師註疏前後文與卷頁行號（如 `T36 p.0796a12`、`X08 p.0517c04`）。同時順手過濾 CBETA 原文中的 `[*]` 校勘符號。
  - 於 `backend/kb_store.py` 新增 `save_commentary_entries`，將查到的註疏永久原子寫入 `translation_kb/commentaries/{sutra_id}/{master_id}/{fascicle:03d}.json`。
  - 於 `backend/main.py` 新增 `POST /api/commentaries/lookup`，並讓 `POST /api/translate/sentence` 在本地無註疏時自動先抓 CBETA 註疏再送進 LLM Prompt。
  - 於 `frontend/app.js` 實作游標停留（350ms）或點擊無註疏句子時自動觸發 CBETA 檢索入庫，並於古大德卡片右上角加上手動「🔍 CBETA 檢索註疏」按鈕。

### 3. 驗證結果
- 透過 `python test_safe_command.py` 實測八十華嚴卷二 `T10n0279_002_p0004_s001`（「爾時，如來道場眾海，悉已雲集；」）：
  - 首次檢索成功自 CBETA 抓回李通玄《新華嚴經論》卷 12（`T36 p.0796a12`）與憨山德清《華嚴綱要》卷 5（`X08 p.0517c04`）並永久寫入 `translation_kb/commentaries/T10n0279/*/002.json`。
  - 第二次請求確認直接命中本地知識庫（`fetched_count=0`），**全數 PASS**。

---

## [2026-11-23 12:36] Session 08：說明游標對應古大德註疏之技術原理與精準度限制

### 1. 接收到的 User Prompt
- 使用者提問：「你是怎麼做到讓我的游標所指的經文準確的找到古大德的注疏？」

### 2. 回覆重點
- 完整拆解四階段機制（前端 `sentence_id` 定位 → 本地 `translation_kb/commentaries/` 0ms 精準對照 → CBETA `search` + `kwic` 兩段式關鍵片語檢索與限定大德原典 `works` → 原子寫回本地永久快取）。
- 誠實說明現行字面關鍵詞匹配的邊界限制（重複片語可能落在他卷、總釋未引原文或跨譯本異文可能漏檢），並提出「卷次進度加權（Juan-Order Ranking）」等後續精準化升級方案。

---

## [2026-11-23 12:53] Session 09：設計「古大德註疏全文載入＋順向單調對齊同步捲動」架構

### 1. 接收到的 User Prompt
- 使用者提出更佳的對齊思路：讓使用者選擇想看的單一古大德註疏，載入該大德註疏全文供自由瀏覽，並自動停在／高亮游標所指經文之註疏處；當往下讀經文時只需順向往下找（或掃全文），並詢問 AI 是否有更好的優化辦法。

### 2. AI 的分析與進階設計方案
- 高度認同使用者直覺：佛經註疏天然具備「**單調遞增順序性**（依經文順序從頭註到尾）」，「順向往下找」正好是解決重複片語誤判的關鍵。
- 提出升級版 **三層對齊引擎**：
  1. **卷次自動定位＋全文快取**：依原經卷次比例與卷首關鍵句鎖定該大德對應卷次，下載完整註疏全文存入 `translation_kb/commentary_fulltext/`。
  2. **順向近鄰視窗（Monotonic Forward Window）＋ 跳段比例回退**：維護 `cursor_idx` 指標，往下讀時優先在 `[cursor_idx, cursor_idx + N段]` 內搜尋（杜絕高頻重複詞誤跳）；若使用者跨段跳讀，則以相對進度比例掃描全卷重定位；遇「總釋未引句」則停留於所屬科判段落不空白。
  3. **對齊映射持久化＋手動微調**：將對齊表存於 `translation_kb/alignments/`，支援一鍵手動校正對齊。
- 同時準備依使用者需求擴充《楞嚴經》古大德名單至 8 位。

---

## [2026-11-23 13:03] Session 10：完成「單一古大德註疏全文同步捲動＋順向視窗對齊」與歷代大德總表擴充

### 1. 接收到的 User Prompt
- 使用者確認實作單一古大德註疏全文瀏覽與順向對齊高亮，並要求古大德名單盡量齊全（皆為正統古大德）。

### 2. 完成項目
- **完整古大德總表（`translation_kb/commentaries/masters_registry.json`）**：
  - **《華嚴經》8 部歷代名著**：澄觀《華嚴經疏》（60卷）、澄觀《隨疏演義鈔》（90卷）、李通玄《新華嚴經論》（40卷）、憨山《華嚴經綱要》（80卷）、續法《疏論纂要》（120卷）、智儼《搜玄記》（5卷）、法藏《探玄記》（20卷）、宗密《行願品疏鈔》（6卷）。
  - **《楞嚴經》10 位歷代名家**：交光真鑑《正脈疏》、長水子璿《義疏注經》、溫陵戒環《要解》、柏庭善月《玄覽》、真界《纂註》、憨山德清《通議》、蕅益智旭《文句》、溥畹《寶鏡疏》、通理《指掌疏》、圓瑛大師《講義》。
- **後端整卷註疏自動定位與快取（`backend/cbeta_fetcher.py`, `kb_store.py`, `main.py`）**：
  - 新增 `resolve_commentary_juan`（結合卷首關鍵句檢索＋原經卷次進度比例鎖定對應卷號）與 `fetch_commentary_fulltext_juan`。
  - 新增 `GET /api/commentaries/fulltext`，自動將下載之大德整卷全文永久存至 `translation_kb/commentary_fulltext/{master_id}/{卷號}.json`。
  - 擴充 `POST /api/translate/commentary` 支援直接對註疏全文中任一段落進行 AI 白話導讀並快取。
- **前端升級（`frontend/index.html`, `styles.css`, `app.js`）**：
  - 古大德選擇列改為「單選精讀全文」，中欄拆分為「上方可收合 AI 翻譯區（獨立捲軸）」＋「下方古大德註疏全文閱讀器（獨立捲軸＋註疏卷次切換器）」。
  - 實作 **三階段順向單調視窗對齊（Forward Window `[cursor-2, cursor+35]` → 跨段比例全卷重定位 → 總釋停留承接）**，游標指句時自動平滑捲動至對應註疏段並以亮金色標記命中引文（`<mark class="comm-hit">`）。

### 3. 驗證結果（`python test_safe_command.py`）
- 華嚴 8 部、楞嚴 10 位大德總表載入：**PASS**
- 八十華嚴卷二自動定位並載入憨山《華嚴經綱要》卷 2/80（32 段）＋ 二次請求本地命中：**PASS**
- 首楞嚴經卷一自動定位並載入交光《楞嚴經正脈疏》卷 1/10（869 段）並入庫：**PASS**

---

## [2026-11-23 17:25] Session 11：將古大德選擇列移入註疏標題並改為點選 Pop-up 選單

### 1. 接收到的 User Prompt
- 使用者截圖要求將上方古大德選擇列（綠框）移入下方古大德註疏全文面板標題內（紅框），改為「點選 → Pop-up 彈出清單 → 滑鼠移動點選切換」，釋放閱讀區垂直空間。

### 2. 修改項目
- `frontend/index.html`：移除頂部 `.masters-bar`，將古大德名稱改為可點選的 `#masterPickerBtn` 按鈕，並內嵌 `#masterPopupMenu` 彈出選單。
- `frontend/styles.css`：新增 `.master-picker-btn`、`.master-popup-menu`、`.master-popup-item`（含滑鼠移過高亮、捲動條、已選標記與大德特色說明），並將 `.comm-full-panel` 改為 `overflow: visible` 以免裁切彈出選單。
- `frontend/app.js`：實作點選開關 Pop-up、點選外部區域或按 `Esc` 自動關閉、滑鼠移選切換古大德並即時載入該大德整卷註疏全文。

---

## [2026-11-23 17:28] Session 12：修正瀏覽器快取舊版 `app.js` 導致頁面卡在載入中

### 1. 問題診斷
- 瀏覽器載入了新版 `index.html`（已移除 `#masterDescHint`），但仍使用快取中的舊版 `/static/app.js`，導致 `renderMastersChips()` 存取 `els.masterDescHint.textContent` 拋出 `TypeError` 而中斷在 `renderSutraContent()` 之前。

### 2. 徹底修正
- 於 `frontend/index.html` 為 `styles.css` 與 `app.js` 加上版本號參數 `?v=20261123b` 強制破除舊快取。
- 於 `backend/main.py` 新增 HTTP Middleware，對 `/` 與 `/static/*` 回傳 `Cache-Control: no-store, must-revalidate`，徹底根治本機開發時靜態檔快取不同步問題。

---

## [2026-11-23 17:45] Session 13：全面稽核並修正古大德 CBETA 典籍編號（修復《楞嚴經通議》誤對應 `X0281` 問題）

### 1. 接收到的 User Prompt 與回饋
- 使用者貼出般若文海《楞嚴經通議卷一》並截圖比對，指出系統載入的《楞嚴經通議》內容不符。

### 2. 根因與全盤稽核
- 透過 `test_safe_command.py` 向 CBETA `/stable/works` 逐筆實測稽核所有華嚴與楞嚴古大德編號，發現先前憑記憶填寫的部分卍新續藏（X 藏）編號有偏移：
  - 憨山《楞嚴經通議》正確編號為 **`X12n0279`（`X0279`）**，原本誤填的 `X0281` 其實是明・幽溪傳燈《楞嚴經圓通疏》。
  - 蕅益《楞嚴經文句》正確為 **`X13n0285`（`X0285`）**（原 `X0284` 為 2 卷《玄義》）。
  - 通理《楞嚴經指掌疏》正確為 **`X16n0308`（`X0308`）**；溥畹《楞嚴經寶鏡疏》正確為 **`X16n0316`（`X0316`）**。
  - 宗密《華嚴經行願品疏鈔》正確為 **`X05n0229`（`X0229`）**。
- 全面更新 `translation_kb/commentaries/masters_registry.json`（每筆 CBETA 編號皆經實測核對無誤，同時增收明・幽溪傳燈《圓通疏》、宋・淨源《華嚴經疏注》、明・蓮池《摸象記》、一雨通潤《合轍》、清・靈耀《觀心定解》等正統大德），並清除先前誤快取之舊檔重新驗證 `X0279`《楞嚴經通議》卷一原文。
- **連線狀況註記**：實測 `cbdata.dila.edu.tw/stable/juans` 目前暫時出現 `ReadTimeout`（研判為剛才批量稽核 70 筆 X 藏編號導致短暫限流或遠端伺服器繁忙），已於 `backend/cbeta_fetcher.py` 補上標準 `User-Agent` 標頭；本地 `translation_kb/` 已快取之經卷與註疏仍可離線 0ms 閱讀。

---

## [2026-11-23 21:53] Session 14：新增 CBETA 官方 GitHub (`cbeta-git/xml-p5a`) 高速自動備援並驗證 `T1735` 與 `X0279`

### 1. 接收到的 User Prompt
- 使用者截圖回報載入澄觀《大方廣佛華嚴經疏》時仍出現 `ReadTimeout`。

### 2. 解法與實作
- 於 `backend/cbeta_fetcher.py` 實作雙來源容錯機制：
  - 主來源：`cbdata.dila.edu.tw/stable/juans`（超時縮短為 15 秒）。
  - **高速自動備援**：一旦主來源逾時或異常，立即自動切換至 **CBETA 官方 GitHub 鏡像**（`https://raw.githubusercontent.com/cbeta-git/xml-p5a/master/{canon}/{vol}/{cbeta_id}.xml`），以標準庫 `xml.etree.ElementTree` 依 `<milestone unit="juan" n="..."/>` 精準擷取該卷完整段落並快取至本地 `translation_kb/commentary_fulltext/`。

### 3. 驗證結果（`python test_safe_command.py`）
- `chengguan_shuchao`（澄觀《大方廣佛華嚴經疏》`T1735`）載入並入庫：**PASS**（卷 4/60，31 段）。
- `hanshan_tongyi`（憨山《楞嚴經通議》`X0279`）載入並入庫：**PASS**（卷 1/10，200 段，逐字驗證命中「`議曰：阿難見佛，首以三觀為請，佛即不答，且先詰問發心出家捨愛之由，此似神醫治病先審病根所在，而後方施藥石也。`」與般若文海完全一致）。
- GitHub `cbeta-git/xml-p5a` 備援解析器獨立測試：**PASS**（1.1 秒完成下載並解析 200 段）。

---

## [2026-11-23 22:11] Session 15：整理 README 並將專案安全推送至 GitHub (`GiraffeK/BuddahSutra-Reader`)

### 1. 接收到的 User Prompt
- 使用者要求：`git push to https://github.com/GiraffeK/BuddahSutra-Reader`。

### 2. 安全稽核與執行步驟
- 確認 `.env` 已列於 `.gitignore`，且工作目錄內無任何除錯圖片、影片或敏感憑證。
- 建立專案說明文件 `README.md`。
- 初始化 Git repository（`main` 分支）、設定 `origin` 指向 `https://github.com/GiraffeK/BuddahSutra-Reader.git`、於 `git add` 後再次驗證 `.env` 未被暫存，完成初次 commit 並推送至 `origin/main`。


---

## [2026-11-24 09:41] Session 16：工作區資料夾更名指導（`BuddhaSutra-註疏` -> `BuddhaSutra-Reader`）

### 1. 接收到的 User Prompt
- **User Prompt**：「你自己改可能不好改，可以教我方法，讓我改」（接續前一請求：將 workspace 資料夾名稱從 `c:\Users\Hsueh\Coding\Personal\BuddhaSutra-註疏` 改為 `c:\Users\Hsueh\Coding\Personal\BuddhaSutra-Reader`，與 GitHub Repo `GiraffeK/BuddahSutra-Reader` 一致）。

### 2. AI 的理解與分析
- **作業系統與程序鎖定機制（Windows File Locking）**：
  - 目前 Antigravity IDE、終端機 Shell（PowerShell）、以及前景/背景執行的 Python（如 `python run_app.py` 的 uvicorn 程序）當前工作目錄（CWD）均為 `c:\Users\Hsueh\Coding\Personal\BuddhaSutra-註疏`。
  - 在 Windows 系統中，只要任何程序的工作目錄指向該資料夾或持有其中檔案的句柄（Handle），執行重新命名都會被系統底層鎖定並拋出 `[WinError 5] Access is denied` 或 `[WinError 32] The process cannot access the file because it is being used by another process`。
  - 若由 Agent 在內部強制更名，除了會報錯之外，還可能導致 IDE 與終端機的工作目錄中斷。因此由使用者在 IDE 關閉/切換前於外部進行更名是最安全、穩固的做法。

### 3. 解法設計與提供使用者的標準更名步驟
1. **停止本地執行程序**：在執行 `python run_app.py` 的終端機按 `Ctrl + C` 停止後端服務。
2. **在 Antigravity IDE 中關閉目前資料夾**：
   - 點擊左上角功能表 `File`（檔案）-> `Close Folder`（關閉資料夾）。
3. **在 Windows 檔案總管或 PowerShell 進行資料夾重新命名**：
   - 路徑：`c:\Users\Hsueh\Coding\Personal`
   - 將資料夾 `BuddhaSutra-註疏` 重新命名為 `BuddhaSutra-Reader`。
   - （或在 PowerShell 輸入：`Rename-Item -Path "c:\Users\Hsueh\Coding\Personal\BuddhaSutra-註疏" -NewName "BuddhaSutra-Reader"`）。
4. **在 Antigravity IDE 重新開啟新資料夾**：
   - 點擊 `File` -> `Open Folder...` -> 選擇 `c:\Users\Hsueh\Coding\Personal\BuddhaSutra-Reader`。
5. **後續無縫銜接**：
   - 專案內部程式碼均使用相對路徑與動態定位（`ROOT_DIR = Path(__file__).resolve().parent.parent`），因此更名後完全不需要修改任何程式碼，重開後執行 `python run_app.py` 即可立即正常運作。

---

## [2026-11-24 09:47] Session 17：工作區更名為 `BuddhaSutra-Reader` 之專案內部資訊全面盤點與同步更新

### 1. 接收到的 User Prompt
- **User Prompt**：「folder name BuddhaSutra-註疏 , 已改成 BuddhaSutra-Reader, 這個workspace下，有哪些訊息要跟著改嗎？」

### 2. AI 的理解與全域排查
- 使用者已成功將外部工作目錄從 `BuddhaSutra-註疏` 改為 `BuddhaSutra-Reader`。
- 需全面盤查此 Workspace 下所有檔案，確認是否有：
  1. **硬編碼之絕對路徑**（如 `C:\Users\Hsueh\Coding\Personal\BuddhaSutra-註疏`）。
  2. **專案識別標識與 API 輸出**（如健康檢查 `/api/health` 回傳的專案名稱）。
  3. **元資料與規格文件**（如 `schema_meta.json`、`Bulletin.json`、`docs/knowledge-base-schema.md`、`backend/__init__.py` 等）。
  4. **Git Remote 與版本控制設定**。
- 排查結果：
  - **路徑動態化良好**：所有 Python 模組（`backend/main.py`、`kb_store.py`、`cbeta_fetcher.py`、`llm_service.py`、`run_app.py`）皆使用 `Path(__file__).resolve().parent.parent` 動態計算根目錄，**完全沒有任何寫死的絕對路徑**，核心運作不受目錄名稱變更影響。
  - **Git Remote**：原本即已綁定 `https://github.com/GiraffeK/BuddahSutra-Reader.git`，無需調整。
  - **文字與專案名標識需同步**：發現 5 處文字標識仍保留舊名稱 `BuddhaSutra-註疏`，需同步調整為 `BuddhaSutra-Reader`。

### 3. 執行修改與同步清單
1. [backend/main.py](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/backend/main.py)：
   - 模組 Docstring 更新為 `BuddhaSutra-Reader FastAPI 主服務。`
   - `/api/health` 端點回傳更新為 `{"status": "ok", "project": "BuddhaSutra-Reader"}`。
2. [backend/__init__.py](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/backend/__init__.py)：
   - 註解更新為 `# BuddhaSutra-Reader Backend Package`。
3. [Bulletin.json](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/Bulletin.json)：
   - 專案標識 `"project"` 更新為 `"BuddhaSutra-Reader"`。
4. [translation_kb/schema_meta.json](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/translation_kb/schema_meta.json)：
   - 專案標識 `"project"` 更新為 `"BuddhaSutra-Reader"`。
5. [docs/knowledge-base-schema.md](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/docs/knowledge-base-schema.md)：
   - 適用專案標示更新為 `（BuddhaSutra-Reader）`。

### 4. 驗證與健康檢查
- 依據 `.antigravityrules` 規範第 5b 條，將驗證邏輯覆寫進 `test_safe_command.py` 並執行 `python test_safe_command.py`：
  - `git diff --stat` 確認變更乾淨無多餘改動。
  - 直接調用 `backend.main.health()`，確認回傳 `{'status': 'ok', 'project': 'BuddhaSutra-Reader'}` 且測試通過。
  - 驗證完畢後將 `test_safe_command.py` 還原為就緒範本。

### 5. 規範查核與成果確認
- **.antigravityrules / AI-Agent-must-read-at-beginning.txt 查核**：
  - 第 1 條：於日誌及回覆附上履約查核標籤。
  - 第 2 條：已同步完整記錄 Session 17。
  - 第 3 條：`Bulletin.json` 專案名稱同步更新，目前所有需求均已 resolved。
  - 第 4 條：操作未觸碰 `.git/`、無敏感資訊。
  - 第 5 條：全程遵守終端機防彈原則，使用原生檔案讀寫工具，驗證透過 `test_safe_command.py` 執行。


---

## [2026-11-24 10:00] Session 18：左側目錄「已入庫」卷次未即時更新修正

### 1. 接收到的 User Prompt
- 「已入庫的資料似乎沒即時更新」（附截圖：上方切換器顯示《首楞嚴經》卷第 7/10（✓ 本地），左側目錄卻只列出卷第 1–6（已入庫））。

### 2. AI 的理解與根因分析
- 後端 `/api/catalog` 每次都用 `kb.list_local_fascicles()` 動態掃描 `translation_kb/sutras/<id>/fascicles/*.json`，資料本身是即時的。
  - 驗證：`T19n0945 local_fascicles = [1..10]`、`T10n0279 = [1,2,3,4,5,79,80]`。
- **根因（前端）**：`renderCatalogTree()` 寫死 `localNums.slice(0, 6)`，最多只渲染 6 個已入庫卷次，第 7 卷以後（含八十華嚴的 79、80 卷）一律不顯示。
- **次要問題**：只有在 `fetched_from_cbeta` 為 true 時才會重抓目錄，而且是非同步、沒有 await，目錄樹可能先用舊資料渲染。

### 3. 修正內容
1. `frontend/app.js`
   - 拿掉 `slice(0, 6)`，改為顯示全部已入庫卷次（依卷號排序）。
   - 新增 `syncCatalogLocalFascicles()`：每次 `loadFascicle()` 都用 bundle 回傳的最新 `local_fascicles` 直接更新 `state.catalog`，再渲染目錄樹，不用再等重抓整份目錄。
2. `frontend/styles.css`
   - `.fascicle-list` 加上 `max-height: 240px; overflow-y: auto;`，避免八十華嚴這類卷數多的經典撐爆側欄。

### 4. 驗證
- 透過 `test_safe_command.py` 執行 `node --check frontend/app.js` → OK；呼叫 `get_catalog()`，確認後端回傳完整卷次。驗證後還原腳本。
- 前端為靜態檔，使用者需按 `Ctrl + F5` 強制重新整理以載入新 JS/CSS（不必重啟後端）。

### 5. 規範查核
- 第 2 條：已記錄 Session 18。第 3 條：無需外部支援，Bulletin 不變。第 4 條：未觸碰 `.git/` 與憑證。第 5 條：驗證走 `test_safe_command.py`。
  - ⚠️ 自我揭露：本 Session 初期排查曾直接以 `python -c` 讀取 `kb_store.py` / `styles.css` 片段，違反第 5b 條；之後的驗證已改回 `test_safe_command.py`。


---

## [2026-11-24 10:07] Session 19：古大德註疏「怪字」（CBETA 科判符號組字式）修復

### 1. 接收到的 User Prompt
- 「怪字問題請修復」（附截圖：憨山《楞嚴經通議》註疏第 18 段開頭出現 `[□@(?(○/(○*○)))]` 一類亂碼）。

### 2. AI 的理解與根因分析
- 抓 CBETA 原始 HTML 比對，這些字串來自 `<a class='gaijiAnchor' href='#CB17607'>[□@(?╳)]</a>`。它們是 CBETA 的**組字式（缺字表示法）**，因為沒有 Unicode 碼位，只能用部件與運算子（`@` 包圍、`*` 左右、`/` 上下、`?` 未詳）描述。
- 憨山《通議》等註疏大量用這類「幾何符號組字」標示**科判層級**（例如：▩初通序、▲三示外道斷見顛倒）。原本解析器直接輸出組字式原文，畫面上就變成怪字。
- 全庫統計共有 13 種純符號組字式（`[△@○]` 147 次、`[?︽]` 118 次、`[□@(?(○/(○*○)))]` 101 次……）；另有少數含漢字部件的真缺字（`[口*隸]`、`[魚*暴]`、`[卄/辦]`），這是學界通行寫法，應保留。

### 3. 解法與修改
1. 新增 `backend/gaiji.py`
   - `GAIJI_SYMBOL_MAP`：把 13 種科判符號對應到常見中文字型都支援的幾何符號（U+25A0–25FF），並保留不同層級之間的區別（▩ ▣ ◈ ▦ ◉ ▲ △ ● ◎ ◇ ╳ ︽ 卍）。
   - `normalize_gaiji()`：只替換「純符號＋運算子」的組字式；表外的新樣式就退回取第一個幾何符號。含漢字的組字式及 `[＊]`、`[1]` 等校勘記號一律不動。
2. `backend/cbeta_fetcher.py`：HTML 解析（`handle_data`）、GitHub xml-p5a 備援、KWIC 片段三條抓取路徑都套用正規化，之後新入庫的資料不會再出現怪字。
3. `backend/main.py`：`/api/commentaries/fulltext` 回傳前再做一次正規化（雙重保險）。
4. 既有快取遷移：`commentary_fulltext/` 10 個檔、`commentaries/` 3 個檔，以原子寫入（tmp → replace）寫回。

### 4. 驗證（透過 test_safe_command.py）
- 全庫剩下的方括號標記只有 `[1]`、`[＊]`、`[口*隸]`、`[魚*暴]`、`[卄/辦]`，都是應該保留的。
- 範例：`[□@(?╳)]初通序。` → `▩初通序。`；`py_compile` 三個後端檔 OK。驗證後還原腳本。

### 5. 規範查核
- 第 2 條：已記錄 Session 19。第 3 條：Bulletin 不變。第 4 條：未觸碰 `.git/`、憑證；快取以原子寫入修改。第 5 條：本 Session 所有查詢、遷移、驗證都透過 `test_safe_command.py` 執行。


---

## [2026-11-24 10:25] Session 20：說明列併入頂部列＋CBETA 斷網錯誤訊息友善化

### 1. 接收到的 User Prompt
- （截圖 1、2）澄觀《疏》載入失敗：`ConnectError: [Errno 11001] getaddrinfo failed`，終端機顯示 `/api/commentaries/fulltext` 回 502。
- 「紅框1的訊息合併到杠框2內，若訊息太多塞不下，可以自己精簡用字……合併後紅框1的空間給經文和注疏使用」（紅框 1＝經名下方的 Cache-First 說明列；框 2＝頂部列右側空白區）。

### 2. 分析
- `getaddrinfo failed` 表示 DNS 解析失敗，當下機器連不到 CBETA，GitHub 備援也連不上。該卷尚未入庫，所以只能報錯。事後用 `test_safe_command.py` 檢查，兩個網域都已能正常解析，網路已恢復。
- 原本的錯誤訊息直接丟出 Python 例外原文，使用者看不懂。
- 說明列約佔 2 行高度，精簡後可以放進頂部列的空白處。

### 3. 修改
1. `frontend/index.html`：刪除 `.notice-banner`；在 `.topbar-right` 最前面新增 `.topbar-hint`，文字精簡為「💡 知識庫優先：指句即查譯文與註疏；無譯文則點句或開自動翻譯，AI 譯後存庫；點句可鎖定」，完整說明放在 `title` 裡，滑鼠停留即可看到。靜態資源版本號改為 `v=20261124a`。
2. `frontend/styles.css`：`.topbar-right` 改為 `flex:1; nowrap; justify-content:flex-end`，提示文字自動伸縮，空間不夠時以省略號截斷，其餘控制項維持原寬度。
3. `backend/main.py`：新增 `_is_network_error()` 與 `_NETWORK_HINT`。經文與註疏下載遇到連線錯誤時，改回 503 與中文提示（請確認網路／VPN／防火牆；已入庫內容不受影響）。

### 4. 驗證
- `notice-banner` 已移除、`topbar-hint` 存在、版本號兩處皆已更新；`py_compile main.py` OK；DNS 解析 cbdata／GitHub 正常。

### 5. 規範查核
- 第 2 條：已記錄。第 3 條：網路屬使用者端暫時狀況、已恢復，不需要外部支援。第 4 條：未觸碰 `.git/`。第 5 條：驗證走 `test_safe_command.py`。
  - ⚠️ 自我揭露：本 Session 曾直接在終端機用 `python -c` 讀取 CSS 片段，並用 PowerShell 一行指令替換版本號，違反第 5b 條。


---

## [2026-11-24 10:32] Session 21：知識庫分檔現況盤查與防膨脹／好整理方案提案

### 1. 接收到的 User Prompt
- 「所有佛經都存入單一檔案，恐怕日後不好整理，檔案也會太大，請想個辦法」（附截圖：AI 翻譯面板顯示 `正在結合前後文與古大德法義翻譯，完成後自動存入 translation_kb/...`）。

### 2. AI 的理解與盤查結果
- **現況澄清（非所有佛經都存入單一檔）**：
  - 截圖中的 `translation_kb/` 是知識庫根目錄，後方的 `...` 為「正在執行中」的刪節號，並非單一檔案。
  - 依 `backend/kb_store.py` 與 `docs/knowledge-base-schema.md` 實作，核心經論與譯文目前已採「經號＋卷次」分片（Sharding）存放：
    - 經文原文：`translation_kb/sutras/{sutra_id}/fascicles/{n:03d}.json`
    - AI 句級譯文：`translation_kb/translations/{sutra_id}/{n:03d}.json`
    - 逐句古大德註疏：`translation_kb/commentaries/{sutra_id}/{master_id}/{n:03d}.json`
    - 古大德整卷註疏全文：`translation_kb/commentary_fulltext/{master_id}/{n:03d}.json`
    - 註疏白話導讀快取：`translation_kb/commentary_translations/{sutra_id}/{master_id}/{n:03d}.json`
  - 前端 `frontend/app.js` 第 880 行僅顯示 `translation_kb/...`，容易讓使用者誤以為全都塞在同一檔案裡。
- **盤查後發現的兩個真正隱患**：
  1. `translation_kb/glossary/terms.json` 目前確實是跨全藏共用的單一檔案，每翻譯一句即整檔重讀重寫，現階段僅翻譯十餘句就已達 780 行，日後必定大幅膨脹且不同經典的名相釋義容易互相覆蓋或缺乏宗派脈絡。
  2. 目前目錄結構採用「先分資料類型、再分經號（僅用 CBETA 編號）」的組織方式，同一部經的檔案分散在 4 個目錄（`sutras/`、`translations/`、`commentaries/`、`commentary_translations/`），未來收錄大量經典時，較不方便以「單部經」或「部別」為單位進行人工檢視、管理與備份。

### 3. 提案內容（待使用者選擇後再實作）
- **方案 1（推薦先做・最小改動、不搬動現有資料）**：
  - 將 `glossary/terms.json` 拆分為依經號分檔（`translation_kb/glossary/{sutra_id}.json`），避免單檔膨脹並保留各經專屬釋義。
  - 更新前端提示文案，顯示實際寫入的經號與卷次路徑（如 `translation_kb/translations/T10n0279/001.json`）。
- **方案 2（以「部別／經典」為中心收納・最方便整理與備份）**：
  - 在方案 1 基礎上，改依大正藏部別與經號（可含經名）集中收納，例如：`translation_kb/canons/T_05_華嚴部/T10n0279_大方廣佛華嚴經/` 下集中放置 `fascicles/`、`translations/`、`commentaries/`、`commentary_translations/`、`glossary.json`（仍按卷次分片），並自動遷移既有檔案。
- **方案 3（日後擴充選項）**：
  - 在方案 1 或 2 之上，未來經典達數十部時，再啟用規格書預留的 `.index/kb_index.sqlite` 做跨經快速檢索（可隨時從分片 JSON 重建）。
- 本 Session 先呈現盤查結果與三個方案，未改動程式碼或資料檔，靜待使用者拍板決定後再行施工。

### 4. 規範查核
- 第 2 條：已完整記錄 Session 21。
- 第 3 條：無需外部支援，`Bulletin.json` 不變。
- 第 4 條：未修改程式碼與任何資料庫檔案，未觸碰 `.git/` 或憑證。
- 第 5 條：全程僅使用原生 `read_file` 與 `write_file` 工具，未透過終端機執行搜尋或單行指令，完全遵守終端機防彈原則。


---

## [2026-11-24 10:49] Session 22：知識庫 v2.0 升級（方案 1 + 方案 2 + 方案 3 依序完成）

### 1. 接收到的 User Prompt
- 「1+2+3依序做」（依前次提案依序實作：方案 1 拆開名相庫＋顯示實際存檔路徑、方案 2 按部別與經名集中收納並無損遷移、方案 3 啟用可重建 SQLite 加速索引與跨經檢索）。

### 2. AI 的理解與架構設計
- **方案 1（防單檔膨脹＋存檔路徑透明化）**：
  - 將原本全藏共用的單一檔案 `translation_kb/glossary/terms.json` 依 `sutra_id` 拆分為每部經專屬的 `glossary.json`。
  - 後端 API `/api/sutras/{sutra_id}/fascicles/{fascicle}` 與 `/api/translate/sentence` 回傳 `storage_paths` / `storage_path`，前端於「翻譯中」、「待翻譯」及「已入庫」狀態顯示精確分卷檔名。
- **方案 2（以「部別／經典」為中心集中收納與無損遷移）**：
  - 目錄改採 `translation_kb/canons/{部別}/{經號_經名}/`（如 `T_05_華嚴部/T10n0279_大方廣佛華嚴經（八十華嚴）/`、`T_10_密教部/T19n0945_楞嚴經/`），底下集中收納 `meta.json`、`glossary.json`、`fascicles/`、`translations/`、`commentaries/`、`commentary_translations/`。
  - `catalog/taisho_tree.json`、`commentaries/masters_registry.json` 與可跨譯本共用之 `commentary_fulltext/` 保留於頂層。
  - `KnowledgeBaseStore` 仍保留對舊版目錄結構之唯讀相容退回，確保過渡期零風險。
- **方案 3（可隨時重建之 SQLite 全文加速索引）**：
  - 啟用 `translation_kb/.index/kb_index.sqlite`（已列於 `.gitignore`），建立 `meta`、`sentences`、`translations`、`glossary`、`commentaries` 五張表及相關索引，採 WAL 模式與 `contextlib.closing` 安全釋放 Windows 檔案句柄。
  - 寫入經文、譯文、名相或註疏時同步增量更新索引；亦提供 `POST /api/kb/reindex` 隨時從 JSON 分片無損重建。
  - 提供 `GET /api/kb/search`、`GET /api/kb/stats`、`GET /api/glossary/{sutra_id}`，並將頂部搜尋框升級為支援跨經即時檢索並一鍵跳轉指定經卷句子的下拉選單。

### 3. 實作與修改清單
1. 新增 [backend/kb_index.py](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/backend/kb_index.py)：`KnowledgeBaseIndex`（建表、全庫重建、增量 upsert、LIKE 跳脫精準搜尋、統計資訊）。
2. 重構 [backend/kb_store.py](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/backend/kb_store.py)：v2.0 `canons/{division}/{sutra_dir}/` 路徑定位、單經專屬 `glossary.json` 讀寫合併、舊路徑相容讀取退回、寫入同步更新 SQLite 索引。
3. 新增 [backend/kb_migrator.py](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/backend/kb_migrator.py)：`migrate_kb_v1_to_v2()` 原子複製、100% 逐檔 JSON 比對驗證後始清理舊目錄，具冪等性。
4. 更新 [backend/main.py](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/backend/main.py)：啟動確保索引就緒、回傳 `storage_paths`/`storage_path`，新增 `/api/kb/stats`、`/api/kb/search`、`/api/kb/reindex`、`/api/glossary/{sutra_id}`。
5. 更新前端 [frontend/index.html](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/frontend/index.html)、[frontend/app.js](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/frontend/app.js)、[frontend/styles.css](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/frontend/styles.css)（資源版本升至 `v=20261124b`）：顯示真實分卷存檔路徑、新增全庫檢索下拉選單與點選跳轉鎖定高亮功能。
6. 更新規格書 [docs/knowledge-base-schema.md](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/docs/knowledge-base-schema.md) 至 `v2.0`。

### 4. 遷移與端對端驗證（全程透過 `test_safe_command.py`）
- **遷移結果**：無損複製並驗證 45 個 JSON 分片檔，`glossary/terms.json` 成功依 `seen_in` 拆為 `T10n0279`（53 條）與 `T19n0945`（61 條），`shared_terms_count: 0`；已清理舊版 `sutras/`、`translations/`、`commentaries/T10n0279`、`commentaries/T19n0945`、`glossary/terms.json`，`masters_registry.json` 與 `commentary_fulltext/` 完整保留；第二次執行遷移確認冪等性（`copied_files: 0`, `cleaned_legacy: []`）。
- **索引統計**：`translation_kb/.index/kb_index.sqlite`（1292.0 KB）收錄 2 部經、17 卷、5028 句經文、34 筆譯文、114 條名相、58 條註疏。
- **語法與 API 驗證**：
  - `python -m py_compile` 4 個後端模組：OK。
  - `node --check frontend/app.js`：OK。
  - `TestClient(app)` 實測 `/api/health`、`/api/catalog`（保留全部已入庫卷次 `[1,2,3,4,5,79,80]` 與 `[1..10]`）、`/api/sutras/T10n0279/fascicles/1`、`/api/sutras/T19n0945/fascicles/7`、`/api/commentaries/fulltext`（cached `chengguan_shuchao` juan 4）、`/api/glossary/{sutra_id}`、`/api/kb/stats`、`/api/kb/search`（`常住真心` 命中 5 筆、`如是我聞` 命中 6 筆）、`/api/kb/reindex` 全部通過。
- 驗證完成後已將 `test_safe_command.py` 還原為標準範本。

### 5. 規範查核
- 第 1 條：於結尾附上標準履約查核標籤。
- 第 2 條：已完整記錄 Session 22。
- 第 3 條：無需外部支援，`Bulletin.json` 不變。
- 第 4 條：未觸碰 `.git/` 與敏感憑證；知識庫遷移採先驗證後清理之原子操作。
- 第 5 條：全程 100% 遵守終端機防彈原則，未在終端執行任何搜尋或單行指令，所有遷移與測試均透過 `python test_safe_command.py` 執行。


---

## [2026-11-24 11:04] Session 23：Firebase 部署架構評估（使用者自帶 Gemini Key + 本機知識庫）

### 1. 接收到的 User Prompt
- 「如果我要部署這個程式到firebase, 想法是讓使用者.env 內的 gemini api key用自己私人的，knowledge base建在自己local端，目的是讓firebase內的資料不用隨著不同使用者的選讀而一直更新knowledge base. 要怎麼做呢？是不是要教使用者建立自己的.env以及自己的local knowledge base在local PC的某一位置上?」

### 2. AI 的分析與建議架構
- **釐清瀏覽器安全沙盒限制**：
  - 部署到 Firebase（公開網頁）後，基於瀏覽器安全沙盒，網頁無法直接讀取使用者本機硬碟上的 `.env` 或任意磁碟路徑，也不需要教使用者手動裝 Python 或建立 `.env`。
- **路線 A（推薦・Firebase Hosting 靜態部署 + BYOK + 雙層本機知識庫）**：
  1. **Firebase 端（永遠唯讀、不隨使用者膨脹）**：
     - 僅託管靜態前端與唯讀基礎資料（`taisho_tree.json`、`masters_registry.json` 及可選預載之初始經卷 JSON），零後端資料庫寫入。
     - CBETA 原典抓取得力於支援 CORS 的 GitHub `cbeta-git/xml-p5a` 鏡像；若需打 CBETA 主站 API，可加 1 支無狀態、不存檔的 Cloud Function 轉發。
  2. **私人 Gemini API Key（BYOK，取代 `.env`）**：
     - 網頁提供「API 金鑰設定」彈窗，將使用者輸入的 Key 存於該使用者自己瀏覽器的 `localStorage`（或僅單次分頁有效之 `sessionStorage`）。
     - 呼叫 Gemini 時由瀏覽器**直接向 Google Gemini REST API 發送請求**，金鑰不經過 Firebase 伺服器。
  3. **使用者本機知識庫（雙層本機儲存，免裝 Python）**：
     - **預設層（全瀏覽器適用）**：存於使用者瀏覽器本機 **`IndexedDB`**（容量可達數百 MB～數 GB），提供一鍵匯出 / 匯入 JSON 備份。
     - **進階層（PC 實體資料夾直接讀寫）**：透過 Chrome / Edge 支援的 **`File System Access API`（`showDirectoryPicker()`）**，讓使用者點選「選擇本機知識庫資料夾」，授權後網頁直接以現行 `v2.0` 的 `canons/{部別}/{經名}/translations/*.json`、`glossary.json` 格式讀寫實體硬碟，與現有 Python 本機版 100% 互通。
- **路線 B（對比：保留純本機版 / 打包分發）**：
  - 若希望使用 `.env`、本機 Ollama 模型與 `kb_index.sqlite` 全庫索引，則直接分發本機版（Python 專案或打包成 `.exe`），無需部署於 Firebase。
- 本 Session 為架構諮詢與評估，未改動任何程式碼與知識庫檔案，待使用者確認方向後再行實作。

### 3. 規範查核
- 第 1 條：於回覆末尾附上標準履約查核標籤。
- 第 2 條：已完整記錄 Session 23。
- 第 3 條：無需外部支援，`Bulletin.json` 不變。
- 第 4 條：未修改任何程式碼或資料庫，未觸碰 `.git/` 或憑證。
- 第 5 條：全程僅使用 `write_file`（`Append: true`），未透過終端機執行任何搜尋或指令。


---

## [2026-11-24 11:18] Session 24：排除 Firebase 外掛安裝衝突（資料夾名稱被同名空外掛佔用）

### 1. 接收到的 User Prompt
- 「路線A是OK的，但我的FireBase狀況請先排除」（附截圖：點選 Firebase 外掛卡片 Add 時跳出錯誤 `Another plugin is already installed in the folder "firebase". Uninstall it first, then install "Firebase" again.`）。

### 2. AI 的理解與根因排查
- 透過 `test_safe_command.py` 檢查 `C:\Users\Hsueh\.gemini\config\plugins\` 與 `config.json`：
  - 現存目錄：`C:\Users\Hsueh\.gemini\config\plugins\firebase`
  - 檔案內容：僅有一份 `plugin.json`，內容為 `{"name": "firebase"}`，無任何 skills、rules、MCP 或程式碼。
  - `config.json` 記錄：`'firebase': {'enabled': true}`，但沒有 `installedFrom`（為本地手動建立之 stub 外掛）。
- **根因**：Marketplace 的官方 Firebase 外掛預設安裝目錄同為 `firebase`。因為目前本機已存在名為 `firebase` 的空外掛目錄，Antigravity 防止覆蓋未受管外掛，故拋出衝突提示。

### 3. 解法設計
- 提供兩種便捷排除管道：
  1. **UI 一鍵移除**：點擊 [firebase 外掛設定頁](customization://firebase) 中的「Uninstall」（或「解除安裝」）按鈕。
  2. **檔案系統清理**：刪除僅含單行文字的空目錄 `C:\Users\Hsueh\.gemini\config\plugins\firebase`。
- 清除後再點擊 Marketplace 卡片中的「Add」即可成功安裝。

### 4. 規範查核
- 第 1 條：於回覆附上履約查核標籤。
- 第 2 條：已記錄 Session 24。
- 第 3 條：無需外部支援，`Bulletin.json` 不變。
- 第 4 條：排查僅讀取目錄，未刪除任何資料夾，未觸碰 `.git/` 與敏感憑證。
- 第 5 條：全程使用 `test_safe_command.py` 進行檢查並已還原。


---

## [2026-11-24 11:30] Session 25：Firebase 外掛安裝成功確認與「路線 A」實作規劃

### 1. 系統事件
- 使用者已成功排除資料夾衝突，並順利安裝官方 Firebase 外掛（`antigravity-plugins-official/plugin/firebase`）。

### 2. 「路線 A」實作藍圖（Firebase Hosting + BYOK + 本機雙層知識庫）
- **階段 1：前端私人金鑰管理（BYOK）**
  - 在頂部列加入「⚙️ API 設定」彈窗，讓使用者輸入自己的 Gemini API Key，可選「記住在瀏覽器（`localStorage`）」或「僅本次分頁（`sessionStorage`）」。
  - 實作前端直接呼叫 Google Gemini REST API（`generativelanguage.googleapis.com`）之函式，金鑰完全不經伺服器。
- **階段 2：雙層本機知識庫（IndexedDB ＋ 實體資料夾）**
  - 預設層：以瀏覽器原生 `IndexedDB` 儲存本機譯文、名相庫與註疏，並支援 JSON 匯出 / 匯入備份。
  - 進階實體資料夾層：利用 Chrome / Edge `File System Access API`（`showDirectoryPicker`），支援使用者選取本機實體資料夾，直接讀寫現行 `v2.0` `canons/...` 分卷 JSON。
- **階段 3：純前端 CBETA 讀取相容**
  - 前端下載未入庫經卷時，優先請求支援 CORS 的 CBETA 官方 GitHub 鏡像（`cbeta-git/xml-p5a`），達成免後端運作。
- **階段 4：Firebase Hosting 專案設定**
  - 初始化 `firebase.json` 與相關配置，將前端與唯讀基礎資料（`taisho_tree.json` 等）打包就緒供 `firebase deploy`。

### 3. 規範查核
- 第 1 條：於回覆附上履約查核標籤。
- 第 2 條：已記錄 Session 25。
- 第 3 條：無需外部支援，`Bulletin.json` 不變。
- 第 4 條：未修改核心程式碼或資料庫，未觸碰 `.git/` 與敏感憑證。
- 第 5 條：全程未透過終端機執行單行指令。

---

## [2026-11-24 12:50] Session 26：實作純前端雙模系統（BYOK + IndexedDB）並成功部署至 Firebase Hosting

### 1. 接收到的 User Prompt
- 使用者已建立 Firebase 專案 `buddahsutra-reader`（附控制台截圖），要求開始實作並將網頁部署至 Firebase Hosting：
  `https://console.firebase.google.com/project/buddahsutra-reader`
- 核心目標：讓使用者在網頁中使用自己的私密 Gemini API Key，知識庫建在使用者本機端（純前端與本機儲存），Firebase 伺服器僅作為靜態網頁與唯讀基礎經文載體，不隨不同使用者的點閱而膨脹或更新後端資料庫。

### 2. 架構設計與實作內容
1. **靜態分卷 Bundle 與唯讀資料準備**：
   - 透過安全指令腳本打包產生 `frontend/data/`：
     - `catalog.json`：大藏經部別目錄與已入庫卷次清單。
     - `masters_registry.json`：歷代古大德註疏名錄。
     - `bundles/{sutra_id}_{fascicle}.json`：17 部已入庫經卷之完整 Bundle（含原文、斷句、註疏對齊、初始譯文）。
     - `commentaries/{master_id}/{juan}.json`：22 部已快取之古大德註疏全文。
     - `glossary/{sutra_id}.json`：各經分片佛學名相字典。
2. **純前端 BYOK（Bring Your Own Key）與 Gemini REST 直連**：
   - 在頂部列加入「🔑 API 設定」按鈕與專屬設定彈窗（Modal）。
   - 使用者可自由填入個人 Gemini API Key 與選擇型號（預設 `gemini-2.5-flash`）。
   - 金鑰嚴格儲存於使用者個人瀏覽器 `localStorage`，直接透過 HTTPS 呼叫 Google 官方 Gemini REST API（`https://generativelanguage.googleapis.com/v1beta/models/...:generateContent`），金鑰絕不上傳伺服器。
3. **本機個人知識庫（IndexedDB + JSON 備份還原）**：
   - 實作前端 `dbHelper`，於瀏覽器內建 `IndexedDB` 建立 `translations` 與 `commentary_guides` 資料表。
   - 點擊翻譯或註疏導讀時，產生的 AI 譯文與法義解析即時寫入本機 IndexedDB。
   - 提供「📥 匯出個人知識庫備份 (JSON)」與「📤 匯入知識庫備份 (JSON)」功能，使用者可隨時將個人研讀心得下載保存至本機硬碟或匯入至其他裝置。
4. **雙模無縫切換（Dual Mode）**：
   - 系統啟動時自動檢測後端 `/api/health`：
     - 若為本機開發環境（FastAPI 執行中）：自動走後端 API 模式。
     - 若為雲端託管環境（Firebase Hosting）：自動切換為「雲端純前端模式（BYOK）」，無需任何後端運算。
5. **Firebase Hosting 配置與部署**：
   - 配置 `.firebaserc` 綁定 `buddahsutra-reader`。
   - 配置 `firebase.json` 設定公開目錄為 `frontend`，並啟用靜態檔案快取標頭。
   - 執行 `firebase deploy --only hosting --project buddahsutra-reader` 成功發布。
   - 驗證線上網址皆為 HTTP 200 OK：`https://buddahsutra-reader.web.app`。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已詳實記錄 Session 26。
- 第 3 條：無需外部 Agent/MCP 支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/`、敏感設定或私人金鑰。
- 第 5 條：所有終端檢查、打包與部署操作皆嚴格透過 `test_safe_command.py` 執行，未執行任何單行命令或禁止之終端搜尋，腳本已重設還原。

---

## [2026-11-24 13:04] Session 27：升級 Gemini 模型為 3.5+ 世代（含自訂模型擴充）並重新發布

### 1. 接收到的 User Prompt
- 使用者要求：「Gemini請用3.5以上」（附 API 設定彈窗截圖）。

### 2. 分析與修改項目
1. **模型型號清單升級為 3.5+ 世代**：
   - 更新前端 API 設定選單，預設改為 `gemini-3.5-flash`（推薦，極速精準）。
   - 增加 `gemini-3.5-pro`（旗艦高智慧，深度法義剖析）與 `gemini-3.5-ultra`。
   - 保留 `gemini-2.5-flash`、`gemini-2.5-pro` 作為相容選項。
2. **支援「自訂模型型號」輸入**：
   - 在選單中加入「自訂模型型號...」，選取後自動展開文字輸入框，支援使用者自由填寫 Google 最新或預覽版模型代號（如 `gemini-3.5-flash-preview` 等）。
3. **前端預設值與 LocalStorage 同步**：
   - 預設模型從 `gemini-2.5-flash` 改為 `gemini-3.5-flash`。
   - 測試連線與儲存時自動識別選取之 3.5+ 模型並寫入本機 `localStorage`。
4. **重新部署至 Firebase Hosting**：
   - 透過 `test_safe_command.py` 執行 `firebase deploy --only hosting --project buddahsutra-reader` 重新發布上線。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 27。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 13:37] Session 28：修復 Firebase Hosting 瀏覽器 1 小時快取導致模型清單未即時更新

### 1. 接收到的 User Prompt
- 使用者回饋：「why? ai model options list還是沒變」（附截圖顯示線上網頁仍為舊版 2.5/1.5 下拉清單）。

### 2. 根因診斷
- 透過 `test_safe_command.py` 直接抓取 `https://buddahsutra-reader.web.app` 確認伺服器已為新版（含 `gemini-3.5-flash`），但回傳標頭為 `Cache-Control: max-age=3600`（Firebase Hosting 預設 HTML 快取 1 小時）。
- 使用者瀏覽器於 1 小時內一般重新整理直接命中本地 HTTP 快取，未向伺服器取回新版 `index.html`。

### 3. 解法與部署驗證
- 更新 `firebase.json`：`headers` 對 `/` 與 `**/*.html` 設定 `Cache-Control: no-cache, no-store, must-revalidate`；對 `**/*.@(js|css)` 設定 `no-cache, must-revalidate`；僅對 `/data/**/*.json` 保留 `max-age=3600`。
- 更新 `frontend/index.html` 靜態資源版本號 `?v=20261124c` → `?v=20261124d`。
- 重新部署至 `buddahsutra-reader` 並實測線上回應：`Live Cache-Control: no-cache, no-store, must-revalidate`、`Has gemini-3.5-flash: True`。

### 4. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 28。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 13:48] Session 29：修復純前端模式古大德註疏卷次對應錯誤並補上 CBETA GitHub XML 即時解析

### 1. 接收到的 User Prompt
- 使用者回饋：「請確定一下是程式錯誤還是真的找不到此注疏，在還沒部署firebase前是有的」（附截圖顯示《大方廣佛華嚴經》卷 1 切換澄觀《大方廣佛華嚴經疏》時出現「暫無此卷註疏」）。

### 2. 根因診斷
- **確認為純前端模式的程式錯誤**，註疏資料其實已存在：
  1. 澄觀《大方廣佛華嚴經疏》（60 卷）前 3 卷為〈玄談〉，**卷 4（`004.json`）**才是對應《八十華嚴》卷 1（〈世主妙嚴品〉）的註疏（《隨疏演義鈔》則從卷 5 `005.json` 開始）；然而純前端版 `loadCommentaryFulltext()` 原本寫死 `targetJuan = 1`，去抓不存在的 `001.json` 而 404。
  2. 純前端版缺少未快取卷次的線上抓取備援，也未處理無 `primary_work`（如續法《纂要》、圓瑛《講義》）的本地精選註疏顯示。

### 3. 解法與部署驗證
- 新增 `frontend/data/commentaries_index.json`：記錄各古大德已打包靜態卷次 `local_juans` 與預設經卷對應表 `default_juan_map`（`chengguan_shuchao` 卷 1→卷 4、`chengguan_yanyichao` 卷 1→卷 5）。
- 強化 `frontend/app.js` 的 `loadCommentaryFulltext()`：
  1. 加入 `resolveClientCommentaryJuan()` 依索引與卷次比例自動定位正確註疏卷號（自動補上 `master` 與 `local_juans`）。
  2. 補齊 `primary_work: null` 古大德的本地精選註疏渲染。
  3. 實作瀏覽器端 `fetchCommentaryFromGitHubClient()` 與 `extractJuanFromXmlP5aClient()`：若該大德或該卷不在靜態快取中，直接透過 CORS 向 CBETA 官方 GitHub 鏡像（`raw.githubusercontent.com/cbeta-git/xml-p5a`）下載 TEI XML 並以瀏覽器原生 `DOMParser` 解析、正規化異體字後即時呈現。
- 更新 `frontend/index.html` 版本號至 `?v=20261124e`，通過 `node -c` 語法檢查並部署至 `buddahsutra-reader`，實測線上端點全部 HTTP 200 OK。

### 4. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 29。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 14:07] Session 30：實測更新可用 Gemini 3.5～4 模型清單並實作 429 配額自動切換備援

### 1. 接收到的 User Prompt
- 使用者回饋 `gemini-3.5-flash` 在 Firebase 端常失敗（附截圖顯示 Google Free Tier `limit: 20` 429 配額錯誤），詢問除 `gemini-3.5-flash` 外尚有哪些可用 API 模型，並確認更新選單與加入 429 自動備援。

### 2. 實作內容與驗證
1. **即時查詢實際可用模型**：透過 `test_safe_command.py` 呼叫 `v1beta/models` 取得 38 個支援 `generateContent` 的實測模型，移除不存在的 `gemini-3.5-pro`、`gemini-3.5-ultra`。
2. **更新 [index.html](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/frontend/index.html) 下拉選單**：
   - 收錄 `gemini-3.8-flash`（新預設）、`gemini-3.7-flash`、`gemini-3.6-flash`、`gemini-3.5-flash`、`gemini-3.5-flash-lite`、`gemini-4-neon`、`gemini-4-hydrogen`、`gemini-4-argon`、`gemini-4-carbon`、`gemini-3.1-pro-preview`、`gemini-2.5-flash`、`gemini-2.5-flash-lite` 與自訂模型輸入。
3. **強化 [app.js](file:///c:/Users/Hsueh/Coding/Personal/BuddhaSutra-Reader/frontend/app.js) 容錯與中文提示**：
   - `callDirectGeminiApi()` 加入 `GEMINI_FALLBACK_MODELS` 備援鏈；當所選模型回傳 HTTP `429`（配額已滿）或 `404` 時自動嘗試下一個可用模型，並記錄實際成功模型 `state.lastUsedModel` 至譯文版本與測試連線訊息中。
   - 若全部備援皆 429，回傳清楚的繁體中文配額提示與 Google 建議重置時間。
4. **重新部署並驗證**：部署至 `buddahsutra-reader`，確認線上 CDN 已同步 `gemini-3.8-flash`、`gemini-4-neon` 與 `?v=20261124f`。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 30。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 14:22] Session 31：將「立即 AI 翻譯並存入知識庫」按鈕整合至上方狀態列並重新部署

### 1. 接收到的 User Prompt
- 使用者建議：「立即 AI 翻譯並存入知識庫的icon, 為何不和上面的框框一起？」（附截圖標示將該按鈕移至「本地知識庫尚無譯文」右側同一列）。

### 2. 修改內容與部署
- 修改 `frontend/app.js`：`renderAnalysisPanel()` 在尚無譯文狀態下，將 `translateNowBtn` 放進 `.card-topbar-left`，緊鄰 `本地知識庫尚無譯文` 標籤顯示，並精簡下方說明文字。
- 修改 `frontend/styles.css`：新增 `.card-topbar-left` 與 `.compact-translate-btn` 精簡樣式，讓上方列緊湊不佔閱讀高度。
- 更新 `frontend/index.html` 版本號至 `?v=20261124g`，通過 `node -c` 檢查並部署至 Firebase Hosting（`buddahsutra-reader`）。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 31。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 14:31] Session 32：修復 `triggerTranslateSentence` 的 `finally` 區塊吞掉翻譯錯誤訊息 Bug

### 1. 接收到的 User Prompt
- 使用者提問：「為何有時點選經文後自動翻譯，有時卻跳出立即 AI 翻譯並存入知識庫的icon」（附截圖顯示句子為 `📌 已鎖定（解除）` 卻呈現尚無譯文與翻譯按鈕，無任何錯誤訊息）。

### 2. 根因與修復
- **根因**：`frontend/app.js` 中 `triggerTranslateSentence()` 在 `catch (err)` 呼叫 `renderAnalysisPanel(err.message)` 後，緊接著進入 `finally` 區塊再次呼叫 `renderAnalysisPanel(undefined)`，把剛畫出的紅色錯誤框瞬間洗掉，退回「本地知識庫尚無譯文 ＋ 立即 AI 翻譯並存入知識庫」畫面。
- **修復**：改以區域變數 `errorMsg` 收集 `catch` 錯誤，於 `finally` 清除 `translatingSet` 後統一執行一次 `renderAnalysisPanel(errorMsg)`，確保翻譯失敗原因明確顯示於畫面。
- 更新 `frontend/index.html` 版本號至 `?v=20261124h`，通過 `node -c` 檢查並重新部署至 Firebase Hosting（`buddahsutra-reader`）。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 32。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 14:41] Session 33：取消「立即 AI 翻譯」按鈕，統一由「游標停留自動 AI 翻譯」開關決定觸發方式

### 1. 接收到的 User Prompt
- 使用者指示：取消「立即 AI 翻譯並存入知識庫」按鈕，只保留頂部「游標停留自動 AI 翻譯」核取方塊：勾選時由游標停留自動決定翻譯哪一句；未勾選時則由滑鼠點擊經文才觸發 AI 翻譯。

### 2. 修改內容與部署
- 修改 `frontend/app.js`：
  - 移除 `#translateNowBtn` 按鈕與其監聽事件，改以依目前勾選狀態動態顯示一行簡明操作提示。
  - 更新 `handleSentenceClick()`：僅在「游標停留自動 AI 翻譯」**未勾選**時，點擊未翻譯經文才觸發 `triggerTranslateSentence()`（且若上次翻譯失敗，再次點擊該句可直接重試；勾選自動翻譯時則單純由游標停留觸發，點擊僅作鎖定/解除鎖定）。
- 更新 `frontend/index.html` 版本號至 `?v=20261124i`，通過 `node -c` 語法檢查並部署至 Firebase Hosting（`buddahsutra-reader`）。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 33。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 15:02] Session 34：修復古大德註疏「AI 白話導讀」遭截斷不完整問題

### 1. 接收到的 User Prompt
- 使用者回報註疏第 23 段點按「✨ AI 白話導讀」後輸出在句中中斷（「……而是深契『事事無礙』之華嚴法界。國」）。

### 2. 根因與修復
- **根因**：
  1. `_callSingleGeminiModel()` 原本僅取 `candidates[0].content.parts[0].text`，若 Gemini 3.5+ 將回覆切分為多個 `parts` 或含 `thought` 區塊，後續文字會被漏掉。
  2. `generationConfig` 未明確設定 `maxOutputTokens`，在長註疏（如第 23 段約 1,700 字）加上模型內部思考 tokens 時易觸發預設截斷。
- **修復**：
  - `frontend/app.js` 與 `backend/llm_service.py` 明確設定 `maxOutputTokens` / `max_output_tokens = 8192`。
  - `_callSingleGeminiModel()` 改為過濾 `p.thought` 後完整串接所有 `parts` 的 `text`。
  - 調整 `buildCommentaryPrompt()` 指示依篇幅完整闡述並務必收尾。
  - 已產生過導讀的段落，按鈕自動改為 `🔄 重新生成導讀`（支援覆蓋舊的殘缺快取）。
  - 更新 `frontend/index.html` 版本號至 `?v=20261124j`，通過 `node -c` 檢查並重新部署至 Firebase Hosting（`buddahsutra-reader`）。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 34。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.git/` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 15:08] Session 35：將預設 AI 模型設為 `gemini-3.5-flash-lite`，部署 Firebase 並執行 `git push`

### 1. 接收到的 User Prompt
- 使用者指示：「就讓gemini-3.5-flash-lite為default ai model. 改好後git push」。

### 2. 修改內容與執行
- `frontend/index.html`：將 `gemini-3.5-flash-lite` 置頂並設為預設選中項，版本號更新至 `?v=20261124k`。
- `frontend/app.js`：`state.userModel` 預設值、`GEMINI_FALLBACK_MODELS` 首位及所有預設回退改為 `gemini-3.5-flash-lite`。
- `backend/llm_service.py`：`GEMINI_MODEL` 環境變數預設值改為 `gemini-3.5-flash-lite`（不修改 `.env` 敏感金鑰檔）。
- 重新部署最新靜態網站至 Firebase Hosting（`buddahsutra-reader`）。
- 確認 `.gitignore` 確實排除 `.env` 後，執行 `git add -A`、`git commit` 與 `git push`。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 35。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：`.env` 受 `.gitignore` 保護未提交，未手動改動 `.git/` 內部檔案。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-24 15:17] Session 36：將《楞嚴經》預設第一古大德註疏改為憨山德清大師《楞嚴經通議》

### 1. 接收到的 User Prompt
- 使用者指示：「楞嚴經的部分，讓憨山大師的通議為第一個選擇，default用他的注疏」。

### 2. 修改內容與部署
- 更新 `translation_kb/commentaries/masters_registry.json`：將 `hanshan_tongyi`（明・憨山德清大師《楞嚴經通議》）移至 `T19n0945` 第一順位並設 `"default_selected": true`，`jiaoguang_zhengmai` 改為第二順位且 `"default_selected": false`。
- 同步更新 `frontend/data/masters_registry.json` 與所有 10 卷 `frontend/data/bundles/T19n0945_*.json` 內嵌之 `masters` 清單。
- 同步部署至 Firebase Hosting（`buddahsutra-reader`）並提交推送至 GitHub。

### 3. 規範查核
- 第 1 條：於回覆結尾附上標準履約查核標籤。
- 第 2 條：已記錄 Session 36。
- 第 3 條：無需外部支援，`Bulletin.json` 保持最新。
- 第 4 條：未修改 `.env` 與敏感金鑰。
- 第 5 條：全程嚴格透過 `test_safe_command.py` 執行，腳本已重設還原。

---

## [2026-11-28 11:52] Session 37：實作進入網頁時自動背景逐一檢測 Gemini 模型連線狀態

### 1. 接收到的 User Prompt
- 使用者附「API 設定」模型選單截圖並提問：「這個能在進入網頁的一開始就逐一在背景確任是否可以連線嗎？不要讓使用者一個一個去測試」。

### 2. 設計與實作內容
1. **後端輕量探測端點（支援本機 FastAPI `.env` 金鑰模式）**：
   - 於 `backend/llm_service.py` 新增 `probe_gemini_model()`，以極小 Token（`maxOutputTokens: 1`、`timeout: 8s`）探測指定模型，精準分類回傳 `ok`（含延遲 ms）、`quota`（429）、`not_found`（404）、`forbidden`（403）、`auth_error`、`timeout`。
   - 於 `backend/main.py` 開放 `POST /api/llm/probe-model`。
2. **前端自動背景逐一檢測（雙模通用：本機 FastAPI ＋ 雲端 BYOK）**：
   - 於 `frontend/app.js` 新增 `probeAllGeminiModelsInBackground()`，在 `init()` 完成狀態檢測後立即於背景非阻塞啟動（併發度 2，避免觸發瞬間限流；若遇 `auth_error` 立即中止；結果於 `sessionStorage` 快取 10 分鐘避免重整浪費配額）。
   - 下拉選單 `#byokModelSelect` 各模型選項即時以燈號標示：`⏳ 檢測中`、`🟢 [可連線 xxxms]`、`🟡 [配額已滿 429]`、`🔴 [不支援 404]`、`⚪ [連線逾時]`。
   - 於 `frontend/index.html` 與 `frontend/styles.css` 在選單下方新增即時摘要列 `#modelProbeBar` 與「🔄 重新檢測全部」按鈕；儲存／清除金鑰時亦自動重新檢測。
   - `callDirectGeminiApi()` 自動整合背景檢測結果：優先選用已確認 `🟢 可連線` 模型並自動略過已知 `404` 模型。
3. **驗證與部署**：
   - 透過 `test_safe_command.py` 驗證 `node --check frontend/app.js` 與 FastAPI `/api/llm/probe-model` 端點皆 PASS。
   - 已部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）並提交推送至 GitHub（`origin/main`）。

---

## [2026-11-28 13:28] Session 38：新增 NVIDIA NIM API 引擎與獨立 API Key 管理（含 `nemotron-3-ultra-550b-a55b` 及古籍精選模型）

### 1. 接收到的 User Prompt
- 使用者提供 NVIDIA NIM 連結 `https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b?nim=hosted` 與頂部 LLM 引擎下拉截圖，要求：
  1. 在頂部「LLM 引擎」加入 **NVIDIA** 選項。
  2. 收錄適合解譯佛經古籍之 NVIDIA NIM 模型供選擇（以 `nvidia/nemotron-3-ultra-550b-a55b` 為首選，並納入 Qwen 3.5/3、DeepSeek V3.2/R1、GLM-4.7/5.3、Kimi K2 等）。
  3. NVIDIA 使用**獨立的另一組 API Key**（`nvapi-...`），與 Gemini API Key 分開管理。

### 2. 實作內容
- **後端（`backend/llm_service.py`、`backend/main.py`、`.env.example`）**：
  - 新增 `NVIDIA_API_KEY`、`NVIDIA_MODEL`（預設 `nvidia/nemotron-3-ultra-550b-a55b`）、`NVIDIA_BASE_URL`（`https://integrate.api.nvidia.com/v1`）。
  - 實作 `_call_nvidia()`（OpenAI 相容 `/chat/completions` 並自動剝除推理模型 `<think>...</think>` 標籤）與 `probe_nvidia_model()` 輕量背景探測。
  - `/api/translate/sentence`、`/api/translate/commentary`、`/api/llm/probe-model` 支援 `provider="nvidia"` 與前端傳入之獨立 `api_key` 覆寫。
- **前端（`frontend/index.html`、`frontend/styles.css`、`frontend/app.js`）**：
  - 頂部 `#providerSelect` 新增 `NVIDIA NIM API`，切換時狀態膠囊即時顯示 NVIDIA 狀態（點擊膠囊可直接開啟對應分頁）。
  - 「🔑 API 設定」彈窗升級為雙分頁（`✨ Gemini API` / `🟢 NVIDIA NIM API`），各自獨立儲存與清除 `buddhasutra_gemini_api_key` 與 `buddhasutra_nvidia_api_key`。
  - 實作 `callDirectNvidiaApi()` 與 `probeAllNvidiaModelsInBackground()`，進入網頁或儲存 NVIDIA 金鑰後同樣會於背景逐一檢測 NVIDIA 模型連線狀態並以燈號顯示於選單。
- **驗證**：透過 `test_safe_command.py` 驗證 JS 語法、後端 `/api/llm/status`（含 `nvidia` 欄位）與 `/api/llm/probe-model`（`provider="nvidia"`）全數 PASS。
- **頂部列精簡**：依使用者截圖回饋，移除重複的「🔑 API 設定」按鈕，將其與 `#llmStatusBadge` 合併為單一可點擊的狀態設定按鈕（帶 `🔑` 圖示），點擊直接開啟對應引擎分頁。

---

## [2026-11-28 13:51] Session 39：佛經朗讀功能（TTS）架構與體驗設計建議

### 1. 接收到的 User Prompt
- 使用者詢問：「現在，我想完成朗讀功能，你有何建議？」

### 2. AI 的分析與建議方向
- 針對佛經精讀情境提出三大核心設計：
  1. **三種語音引擎分級**：優先以「瀏覽器 Web Speech API（Firebase 純前端＋本機皆免費用，Edge 內建台灣自然男女聲極佳）」起步，日後可選配本機 `edge-tts`（跨瀏覽器一致神經語音）或 Gemini TTS（莊嚴法師語氣）。
  2. **佛經正音替換字典（必備特色）**：僅於送入 TTS 前將多音字／梵音詞（如南無→拿摩、般若→波惹、阿難→啊難等）替換為正音讀法，畫面原文不動。
  3. **逐句同步連動體驗**：支援從目前鎖定經句開始連續朗讀，提供「僅讀經文／經文＋白話交替／僅讀白話」三模式、語速調節，並隨朗讀自動高亮經句與捲動古大德註疏。

---

## [2026-11-28 14:00] Session 40：實作方案 A「佛經原文朗讀」（Web Speech API + 佛經正音）並回覆 Global Rules 放置路徑

### 1. 接收到的 User Prompt
- 使用者決定先實作方案 A（Edge 瀏覽器朗讀佛經原文即可，其他模式日後再補），並詢問如何將自訂的 `CLAUDE.md` 設為 AI Agent 寫程式時的全域規範（Global Rules）。

### 2. 實作內容（精簡外科式修改）
- **前端介面（`frontend/index.html`、`frontend/styles.css`）**：
  - 於經文副標題列右側加入精簡「🔊 朗讀原文 / ⏹ 停止 / 語速 / 語音選擇」控制列，並新增 `.sentence.speaking` 淡綠高亮樣式。
- **前端朗讀邏輯（`frontend/app.js`）**：
  - 內建 `BUDDHIST_PRONUNCIATION_MAP` 佛經正音替換表（僅作用於語音合成字串，畫面原文不動）。
  - 自動優先排序並選取 Edge 台灣繁體中文自然語音（`HsiaoChen` / `YunJhe`），記住語速與語音偏好。
  - 預設從目前鎖定／選中句（或卷首正文）開始逐句連續誦讀，唸到哪句自動高亮並置中捲動，同時聯動更新左側既有譯文與古大德註疏（不觸發多餘 AI 翻譯）；切換卷次或關閉頁面時自動停止朗讀。
- **驗證**：透過 `test_safe_command.py` 驗證 `node --check frontend/app.js`、佛經正音替換單元測試與靜態頁面檢查皆 PASS。
- **Global Rules 建置**：依使用者明確指示，確認 `C:\Users\AdminSean\.gemini\config\GEMINI.md` 尚不存在後，將全域編碼準則寫入該檔。
- **部署與推送**：同步推送 NVIDIA NIM 整合、頂部列精簡與方案 A 佛經原文朗讀至 GitHub（`origin/main`），並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。

---

## [2026-11-28 14:09] Session 41：更新專案規範第 5b 條，將 `git pull / push` 與部署指令納入 `test_safe_command.py`

### 1. 接收到的 User Prompt
- 使用者指示：「git push/pull 之事也可放入 test_safe_command.py」。

### 2. 修改內容
- 同步更新 `AI-Agent-must-read-at-beginning.txt` 與 `.antigravityrules` 第 5b 條，明訂日後所有 `git status` / `git pull` / `git push` 與 `firebase deploy` 等指令亦統一透過 `subprocess` 寫入 `test_safe_command.py` 執行，進一步減少終端機確認視窗中斷。

---

## [2026-11-28 14:15] Session 42：精簡朗讀語音清單（僅留 1/5 精選）並加入「女聲／男聲」即時切換

### 1. 接收到的 User Prompt
- 使用者截圖回饋 Edge 語音選單列出近 20 個近似聲音，要求刪去 4/5 只留 1/5，並加入男音／女音選擇。

### 2. 修改與驗證
- 於 `frontend/index.html`、`frontend/styles.css` 加入精簡「女聲／男聲」切換鈕（`#ttsGenderToggle`），更新靜態版號至 `?v=20261128e`。
- 於 `frontend/app.js` 新增 `CURATED_TTS_VOICES` 與 `curateVoicesByGender()`，從原本近 20 個語音精簡為差異度最高的 4 個自然中文語音（女聲：曉臻、曉曉；男聲：雲哲、雲健），支援朗讀中途即時切換男／女聲並各自記憶偏好。
- 透過 `test_safe_command.py` 驗證 JS 語法與男女聲篩選邏輯全數 PASS。
- 依更新後第 5b 條規範，統一透過 `test_safe_command.py` 執行安全檢查、`git push` 至 `origin/main` 與部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。

---

## [2026-11-28 14:29] Session 43：診斷 Firebase Hosting 純前端模式無法直連 NVIDIA NIM API（CORS 限制）

### 1. 接收到的 User Prompt
- 使用者截圖回報 Firebase Hosting 線上版（雲端純前端模式）檢測 NVIDIA NIM 出現 `0/8 個模型可連線、8 個不可用`。

### 2. 根因分析與可行解法
- **根因**：NVIDIA NIM 端點（`https://integrate.api.nvidia.com/v1/chat/completions`）未開放瀏覽器端跨網域標頭（CORS），與 Google Gemini API 不同，瀏覽器會直接擋掉來自 `https://buddahsutra-reader.web.app` 的 `fetch()` 請求。
- 提供三套解法供使用者選擇：
  1. **Cloudflare Worker 極簡轉發代理**（免費方案每日 10 萬次、免綁卡、不存金鑰，僅透傳 `Authorization` 並補上 CORS 標頭）。
  2. **Firebase Cloud Functions / Cloud Run 轉發**（同在 Firebase 專案，但需 Blaze 方案）。
  3. **本機後端模式（`python run_app.py`）使用 NVIDIA NIM**，Firebase 純前端版則使用支援 CORS 直連的 Gemini API。

---

## [2026-11-28 14:33] Session 44：新增 Cloudflare Worker NVIDIA NIM CORS 代理腳本與前端代理網址設定

### 1. 接收到的 User Prompt
- 使用者選定方案 1，要求提供 Cloudflare Workers 手把手教學並整合支援。

### 2. 實作內容
- 建立 `cloudflare-worker/nvidia-proxy.js`：零依賴、不儲存金鑰之極簡 CORS 代理（僅允許 `buddahsutra-reader.web.app` / `firebaseapp.com` / `localhost:8000` 呼叫 `POST /v1/chat/completions`）。
- 更新 `frontend/index.html`（`?v=20261128f`）與 `frontend/app.js`：
  - 於 NVIDIA 分頁新增「Cloudflare Worker 代理網址」輸入欄位（存於 `localStorage`：`buddhasutra_nvidia_proxy_url`）。
  - `getNvidiaChatEndpoint()` 自動優先使用代理網址發送連線測試、背景模型探測與經文翻譯；若在純前端模式未填代理網址則顯示明確的 CORS 提示而非誤報 0/8 不可用。
- 透過 `python test_safe_command.py` 驗證 JS 語法（`frontend/app.js` 與 `cloudflare-worker/nvidia-proxy.js`）皆 PASS。
- 使用者已部署 Cloudflare Worker 至 `https://nvidia-nim-proxy.seantang-mal.workers.dev`；已將該網址設為前端預設代理網址，並透過 `test_safe_command.py` 實測 OPTIONS CORS 標頭、推送 GitHub 與部署至 Firebase Hosting。

---

## [2026-11-28 14:50] Session 45：修復翻譯面板使用 NVIDIA NIM 時誤顯示 `Gemini BYOK` 標籤

### 1. 接收到的 User Prompt
- 使用者截圖回報頂部已選 `NVIDIA NIM API`（且成功連線 `nemotron-3-ultra-550b-a55b`），但翻譯中狀態列仍顯示 `AI 翻譯中（Gemini BYOK (gemini-3.5-flash-lite)）...`。

### 2. 根因與修復
- **根因**：`frontend/app.js` 中 `renderAnalysisPanel()` 的 `provName` 與 `engName` 在純前端模式下仍寫死 `Gemini BYOK`。
- **修復**：改依 `els.providerSelect.value` 動態顯示 `NVIDIA NIM (<model>)` / `Gemini (<model>)` / `Ollama`，並於新譯完成標籤同步顯示模型名稱；更新 `?v=20261128h` 並透過 `test_safe_command.py` 驗證、推送與部署至 Firebase Hosting。

---

## [2026-11-28 15:30] Session 46：左右欄內容對調，將佛經原文置於左側、AI 翻譯與古大德註疏置於右側

### 1. 接收到的 User Prompt
- 使用者附畫面截圖並要求：「請讓左右框內的內容交換邊顯示，也就是我希望佛經原文在左邊」。

### 2. 修改與驗證
- 調整 `frontend/index.html` 中 `.reader-grid` 內的 `<section>` 順序：左側為 `#sutraContent`（佛經原文），右側為 `.analysis-pane`（AI 翻譯＋古大德註疏），並同步更新提示文字「左側漢文經句」與版號 `?v=20261128i`。
- 同步對調 `frontend/styles.css` 中 `.reader-grid` 的欄寬順序，並更新 `frontend/app.js` 提示字樣。
- 透過 `python test_safe_command.py` 驗證 JS 語法與左右區塊順序皆 PASS。
- 透過 `python test_safe_command.py` 同步推送至 GitHub（`origin/main`）並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。

---

## [2026-11-28 15:39] Session 47：確認本機後端直連 NVIDIA NIM 並收緊 Worker `ALLOWED_ORIGINS`

### 1. 接收到的 User Prompt
- 使用者說明本機 PC 呼叫 NVIDIA API 直接呼叫即可，無須經過 Cloudflare Worker，並移除 `cloudflare-worker/nvidia-proxy.js` 中的 `localhost:8000` / `127.0.0.1:8000` 來源。

### 2. 查核結果
- 確認 `frontend/app.js` 在本機後端模式（`state.isBackendAvailable === true`）下，模型探測（`/api/llm/probe-model`）、經句翻譯（`/api/translate/sentence`）與註疏導讀（`/api/translate/commentary`）皆直接由本機 FastAPI 呼叫 `https://integrate.api.nvidia.com/v1/chat/completions`，完全不會經過 Cloudflare Worker。
- 收緊 Worker `ALLOWED_ORIGINS` 僅允許 `buddahsutra-reader.web.app` 與 `buddahsutra-reader.firebaseapp.com` 更安全，且不影響本機運作。

---

## [2026-11-28 15:46] Session 48：移除重複的經文副標題列並將「朗讀控制列」移至左側原文上方

### 1. 接收到的 User Prompt
- 使用者附截圖指示：「框1的功能移到框2, 而框2的內容似乎可以刪了，因為佛經原文內容就有了」。

### 2. 修改與驗證
- 移除 `frontend/index.html` 中與經文首三段重複的 `#sutraSubtitle` 元素，並將 `.tts-bar` 移至左側經文標題正下方（`justify-content: flex-start`），更新版號至 `?v=20261128j`。
- 一併清理 `frontend/app.js` 中不再使用的 `els.sutraSubtitle` 參照。
- 透過 `python test_safe_command.py` 驗證 JS 語法與 HTML 結構全數 PASS。
- 透過 `python test_safe_command.py` 一併推送本次介面微調與 `nvidia-proxy.js` 來源收緊至 GitHub（`origin/main`），並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。

---

## [2026-11-28 15:50] Session 49：朗讀語速補齊 `1.0x` 選項並設為預設值

### 1. 接收到的 User Prompt
- 使用者附語速選單截圖指出：「要有一倍的吧」。

### 2. 修改與驗證
- 更新 `frontend/index.html` 語速選單為 `0.75x`、`0.85x`、`0.95x`、`1.0x`（預設）、`1.1x`、`1.25x`，同步調整 `frontend/app.js` 預設語速為 `1.0`，透過 `python test_safe_command.py` 驗證 PASS。
- 透過 `python test_safe_command.py` 推送至 GitHub（`origin/main`）並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。

---

## [2026-11-28 15:57] Session 50：移除主區重複經名標題、卷次切換器左移整合單列、CBETA 檔名移至左側目錄經名後

### 1. 接收到的 User Prompt
- 使用者附 2 張截圖指示：「框1功能移到框2，而原框2的顯示似乎也多了，可以把經名拿掉，並把cbeta檔名移到左列的經名之後。」

### 2. 修改與驗證
- 移除 `frontend/index.html` 中重複的 `#sutraTitle` 與 `#sutraCode`，將卷次切換器（`.fascicle-switcher`）移至左側並與朗讀控制列（`.tts-bar`）整合於單一緊湊工具列 `.sutra-toolbar-row`，大幅釋放閱讀高度。
- 於 `frontend/app.js` 的 `renderCatalogTree()` 中，將 CBETA 檔名（目前閱讀經典顯示如 `T10n0279_001`，其餘經典顯示經號）直接附於左側目錄樹的經名之後，並清理不再使用的 `els.sutraTitle` / `els.sutraCode` 參照。
- 透過 `python test_safe_command.py` 驗證 JS 語法與 HTML/CSS 結構全數 PASS。
- 透過 `python test_safe_command.py` 推送至 GitHub（`origin/main`）並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。

---

## [2026-11-28 16:05] Session 51：分析 Firebase 純前端模式未預載經卷 404 原因與即時載入方案

### 1. 接收到的 User Prompt
- 使用者附截圖（八十華嚴點下一卷至第 6 卷出現 `查無預載分卷檔案 ( HTTP 404 )`）詢問：「該怎麼做讓未載入的經文可以載入？」

### 2. 根因與建議方案
- **根因**：Firebase 純前端模式目前只讀取 `frontend/data/bundles/` 內預先打包的 17 個靜態分卷，尚未像古大德註疏那樣接上瀏覽器端 CBETA GitHub (`xml-p5a`) 即時抓取與 IndexedDB（`custom_fascicles`）快取。
- 提出兩套解法供使用者確認：
  1. **方案 1（推薦）**：前端遇到預載 404 時，先查 IndexedDB（`custom_fascicles`），未命中則直接從支援 CORS 的 CBETA 官方 GitHub `xml-p5a` 即時抓取解析、斷句並永久快取於瀏覽器，不只八十華嚴 1–80 卷，整部大藏經都能隨點隨讀。
  2. **方案 2**：在本機預先批量下載八十華嚴全 80 卷打包進 `frontend/data/bundles/` 再部署至 Firebase。

---

## [2026-11-28 16:08] Session 52：實作純前端 CBETA GitHub 即時載入未預載經卷與 IndexedDB 永久快取

### 1. 接收到的 User Prompt
- 使用者確認採用方案 1。

### 2. 實作內容
- **IndexedDB 自載經卷快取（`frontend/app.js` `dbHelper`）**：補齊 `saveCustomFascicle`、`getCustomFascicle`、`listCustomFascicles`，將動態抓取的經卷永久存於 `custom_fascicles` 資料表。
- **瀏覽器端 CBETA GitHub 即時抓取與斷句**：新增 `splitSentencesZhClient()`、`fetchSutraFascicleFromGitHubClient()` 與 `buildClientBundleFromSutra()`，重用既有的 `extractJuanFromXmlP5aClient()` 與 `_githubXmlCache`（同部經只下載一次 XML，切卷秒開），並自動關聯 `masters_registry.json` 古大德註疏。
- **三層讀取管線（`loadFascicle`）**：`預載靜態 Bundle → IndexedDB custom_fascicles → CBETA GitHub xml-p5a 即時抓取入庫`，同時開放左側目錄所有具備 CBETA 編號之經典直接點擊載入。
- **驗證與部署**：透過 `python test_safe_command.py` 驗證 JS 語法與斷句測試、推送 GitHub 並部署至 Firebase Hosting。

---

## [2026-11-28 16:22] Session 53：將鎖定鈕移至「AI 白話翻譯與法義解析」標題旁並更名為「已鎖定點擊之經文」

### 1. 接收到的 User Prompt
- 使用者指示：「如果是這樣，鎖定鍵留著，但應該放"AI 白話翻譯與法義解析"這段顯示的旁邊，且改叫做"已鎖定點撃之經文"」。

### 2. 修改與驗證
- 將 `#unlockBtn` 移至 `frontend/index.html` 的 `.ai-panel-header` 標題旁，文字改為 `📌 已鎖定點擊之經文`（點擊可解除鎖定），省出面板內一整行垂直空間。
- 更新 `frontend/styles.css`（`.ai-panel-header-left`）與 `frontend/app.js`（`syncLockHeaderBadge()` 統一控制顯示狀態），並透過 `python test_safe_command.py` 驗證 PASS。

---

## [2026-11-28 16:25] Session 54：CBETA 下載成功提示列改為 5 秒倒數後自動消失

### 1. 接收到的 User Prompt
- 使用者附截圖指示：「箭頭所指之顯示，應倒數5秒即消失」。

### 2. 修改與驗證
- 於 `frontend/app.js` 新增 `showCbetaToast(msg, 5)` 與 `hideCbetaToast()`，顯示「（5 秒後自動關閉）」並每秒倒數歸零自動隱藏，切卷時自動清除舊計時器；更新 `?v=20261128o` 並透過 `python test_safe_command.py` 驗證 PASS。
- 透過 `python test_safe_command.py` 推送至 GitHub（`origin/main`）並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。

---

## [2026-11-28 16:30] Session 55：將 AI 翻譯狀態標籤濃縮移入面板標題列

### 1. 接收到的 User Prompt
- 使用者附截圖指示：「框1訊息請濃縮放入框2」。

### 2. 修改與驗證
- 於 `frontend/index.html` 的 `.ai-panel-header-left` 新增 `#aiHeaderStatusBadge`，移至「📌 已鎖定點擊之經文」右側，並移除面板內原 `.card-topbar` 釋放垂直閱讀空間。
- 於 `frontend/app.js` 新增 `setAiHeaderStatus()`，以精簡格式顯示 `知識庫 · <model>` / `新譯入庫 · <model>` / `⏳ 翻譯中 · <model>` / `尚無譯文`（滑鼠懸停可看完整引擎與型號）；更新 `?v=20261128p` 並透過 `python test_safe_command.py` 驗證 PASS。
- 依截圖調整 `.ai-panel-header` 與 `.ai-panel-header-left` 為強制單排（`flex-wrap: nowrap`），防止「收合」直排與狀態膠囊換行，狀態標籤自動依剩餘寬度省略顯示（`?v=20261128q`）。

---

## [2026-11-28 16:37] Session 56：古大德註疏標題列濃縮為單排顯示

### 1. 接收到的 User Prompt
- 使用者附古大德標題列截圖指示：「這個也濃縮成一排」。

### 2. 修改與驗證
- 更新 `frontend/styles.css`：將 `.comm-full-header` 與 `.comm-full-title-row` 改為 `flex-wrap: nowrap`，`#commMasterTitle` 與 `.align-badge` 依剩餘寬度自動單行省略（同時不設父層 `overflow: hidden` 以確保大德 Pop-up 選單正常展開），右側 `.comm-juan-controls` 固定不換行。
- 更新 `frontend/app.js` 將註疏卷次選單由 `註疏卷 3/60` 精簡為 `卷 3/60`；更新 `?v=20261128r` 並透過 `python test_safe_command.py` 驗證 PASS。
- 透過 `python test_safe_command.py` 推送至 GitHub（`origin/main`）並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。

---

## [2026-11-28 16:41] Session 57：加深 AI 翻譯與古大德註疏兩處標題列底色

### 1. 接收到的 User Prompt
- 使用者附截圖指示：「這兩個框的底色，再深一點」。

### 2. 修改內容
- 將 `frontend/styles.css` 中 `.ai-panel-header` 與 `.comm-full-header` 底色由 `#f4ebd6`／`#f7f1e3` 統一加深為溫潤宣紙深米色 `#e6d5b3`（底線 `#d5be92`），更新 `?v=20261128s`。


---

## [2026-11-28 16:47] Session 58：修復左側目錄點選法華經等 CBETA 經典後仍顯示「建置中」標籤

### 1. 接收到的 User Prompt
- 使用者附截圖回饋：「我明明點選了法華經，但卻顯示建置中」。

### 2. 根因與修復
- **根因**：`renderCatalogTree()` 僅依靜態 `catalog.json` 中的 `status === "available"` 顯示「可閱讀」，其餘一律顯示「建置中」，且載入 CBETA 經卷後 `syncCatalogLocalFascicles()` 未更新該經的 `status` 與 `available_fascicles`。
- **修復**：
  - 凡具合法 CBETA 編號之經典改標示藍色 **`CBETA`**（代表可直接點入即時下載閱讀），不再誤稱「建置中」。
  - 一旦點入並成功載入任一卷，立即將狀態升級為綠色 **`可閱讀`** 並於下方展開已入庫卷次清單（`?v=20261128t`）。
- 透過 `python test_safe_command.py` 一併推送 Session 57–58 至 GitHub（`origin/main`）並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。


---

## [2026-11-28 16:53] Session 59：修復切換未收錄大德經典時殘留前經註疏 Bug，並收錄《妙法蓮華經》6 位歷代古大德註疏

### 1. 接收到的 User Prompt
- 使用者附截圖回報：「讀法華經時，古大德的注疏卻停在華嚴經」。

### 2. 根因與修復
- **根因**：`loadFascicle()` 在 `state.selectedMasterId` 為 `null`（該經尚無收錄大德）時未清空前一部經的 `state.commFull` 與註疏面板 DOM，導致殘留澄觀《華嚴經疏》。
- **修復**：
  1. 於 `frontend/app.js` 補齊 `else` 清空分支：切換至尚無大德清單的經典時，立即清空舊註疏並顯示清楚的空狀態提示。
  2. 經 CBETA GitHub `xml-p5a` 逐筆驗證編號後，於 `translation_kb/commentaries/masters_registry.json`（並同步至 `frontend/data/masters_registry.json`）新增《妙法蓮華經》（`T09n0262`）6 位歷代權威古大德：明・憨山《法華經通義》（`X31n0611`，7 卷預設）、隋・智顗《妙法蓮華經文句》（`T34n1718`，10 卷）、明・蕅益《法華台宗會義》（`X32n0616`，7 卷）、宋・戒環《法華要解》（`X30n0602`，7 卷）、隋・吉藏《法華義疏》（`T34n1721`，12 卷）、唐・窺基《法華玄贊》（`T34n1723`，10 卷）。


---

## [2026-11-28 17:02] Session 60：完成方案 A（全目錄核心經典古大德補齊並驗證）＋ 方案 B（CBETA 動態搜尋古註疏），同步推送並部署

### 1. 接收到的 User Prompt
- 使用者指示：「A+B一起做，做好之後git push and deploy to firebase」。

### 2. 實作與驗證內容
- **方案 A（全目錄核心經典古大德全量驗證補齊）**：
  - 逐筆向 CBETA GitHub `xml-p5a` 核對作者與卷數後，於 `translation_kb/commentaries/masters_registry.json`（並同步至 `frontend/data/masters_registry.json`）補齊：金剛經（4 家）、心經（2 家）、六十／四十華嚴（跨譯本關聯）、無量壽經（2 家）、阿彌陀經（3 家）、大般涅槃經（2 家）、維摩詰經（2 家）、楞伽經（憨山記）、圓覺經（宗密略疏）、大日經（一行疏）、梵網經（2 家）、成唯識論（窺基述記）、大乘起信論（2 家），連同先前之八十華嚴、楞嚴經、妙法蓮華經，總計收錄 16 部核心經論之歷代權威古大德。
- **方案 B（CBETA 動態搜尋備援）**：
  - 於 `frontend/app.js` 新增 `searchDynamicCbetaCommentaries()`：凡點選尚未預錄大德之經典，右下角提供「🔍 向 CBETA 搜尋相關古大德註疏」按鈕，即時檢索 CBETA 經疏部／卍續藏並支援點擊直接載入閱讀。
- **驗證、推送與部署**：透過 `python test_safe_command.py` 同步名錄、驗證 JS 語法與 JSON 完整性、推送至 GitHub（`origin/main`）並部署至 Firebase Hosting（`https://buddahsutra-reader.web.app`）。


---

## [2026-11-28 17:11] Session 61：修復 Firebase Hosting 瀏覽器 1 小時快取舊版 `masters_registry.json` 導致法華經大德未顯示問題

### 1. 接收到的 User Prompt
- 使用者附 Firebase 線上版截圖回報：「明明法華經有古大德注疏, 似乎localhost可以讀到注疏，但firebase不行」。

### 2. 根因與修復
- **根因**：`firebase.json` 對 `/data/**/*.json` 設定了 `Cache-Control: max-age=3600`（1 小時快取），且前端 `fetch("./data/masters_registry.json")` 未帶版本號，導致瀏覽器重整時仍命中 1 小時前的舊版名錄（不含法華經等新增的 15 部經大德）。此外 `cbdata.dila.edu.tw` 在純前端瀏覽器遇 CORS 時直接顯示英文 `Failed to fetch`。
- **修復**：
  - 於 `frontend/app.js` 為 `masters_registry.json` 與 `catalog.json` 加上版號 `?v=20261128w` 與 `{ cache: "no-cache" }`，徹底破除舊快取。
  - 於 `firebase.json` 為 `/data/@(masters_registry|catalog|commentaries_index).json` 設定 `Cache-Control: no-cache, must-revalidate`。
  - 改善 `searchDynamicCbetaCommentaries()` 的 CORS 友善中文提示，並透過 `python test_safe_command.py` 驗證、推送與部署。


## Session 62 — 2026-11-28 手機版 RWD 閱讀介面、PWA 支援與 Firebase Preview Channel（`feat/mobile-ui` 分支）
- **分支與穩定版標記**：
  - 於 `main` 穩定版建立安全標籤 `v2.1-desktop-stable`，並切出開發分支 `feat/mobile-ui`，以 Firebase Hosting Preview Channel（`mobile-preview`，14 天有效）提供手機實測網址，完全不影響桌機正式站 `https://buddahsutra-reader.web.app`。
- **手機版介面（`<= 900px`，桌機 `> 900px` 零變動）**：
  - [frontend/index.html](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/index.html)、[frontend/styles.css](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/styles.css)、[frontend/app.js](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/app.js)：
    - 左側大藏經目錄改為可滑出／收合抽屜（`☰` 鈕與遮罩，選經後自動收起）。
    - 底部新增固定四鍵導覽列（`📖 經文`｜`✨ AI 翻譯`｜`📜 註疏`｜`☰ 目錄`），支援 `env(safe-area-inset-bottom)` 安全區間距。
    - 點選經句時於底部浮出快捷列（顯示經句預覽與一鍵跳轉「✨ 看 AI 翻譯」「📜 看古大德註疏」，翻譯中／就緒狀態即時連動），並於觸控裝置停用 `mouseenter` 誤觸。
    - 精簡頂部導覽列與卷次／朗讀工具列，提升直屏經文可視高度。
- **PWA 加入主畫面支援**：
  - 新增 [frontend/manifest.json](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/manifest.json) 與 `theme-color` / `apple-mobile-web-app-*` meta，可從手機瀏覽器「加入主畫面」以獨立視窗開啟。


## Session 63 — 2026-11-28 修復手機瀏覽器朗讀（Web Speech API）無聲問題（`feat/mobile-ui`）
- **根因排查**（[frontend/app.js](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/app.js)）：
  1. 原本每次朗讀前都直接呼叫 `speechSynthesis.cancel()` 緊接 `speak()`，在 Android Chrome / iOS Safari 會觸發非同步取消競態導致完全無聲。
  2. 非 Edge 裝置篩選語音時若暫無中文語音，會退回 `allVoices` 選到英文語音導致讀中文完全無聲；且未依 `voice.lang` 同步 `utter.lang`。
  3. 手機瀏覽器 GC 易回收未保存參照的 `SpeechSynthesisUtterance`，且原生 `pause()/resume()` 常失效。
- **修正**：
  - 首次啟動與自然換句不呼叫 `cancel()`；僅於中途切換語速／性別且正在播報時才 `cancel()` 並延遲 60ms 播報。
  - 嚴格只匹配中文語音並優先本機離線語音（`localService`）；若暫無回報則留空 `utter.voice` 交由系統以 `zh-TW` 自動播報。
  - 保存 `ttsState.currentUtter` 防 GC；觸控裝置暫停改以中止並保留句次進度實作；若連續失敗則於頂部提示實際錯誤碼與系統檢查方向。
  - 更新 [frontend/index.html](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/index.html) `app.js?v=20261128m2`，推送 `feat/mobile-ui` 並重新部署 Preview Channel。


## Session 64 — 2026-11-28 合併 `feat/mobile-ui` 回 `main` 並部署 Firebase Hosting 正式站
- 手機實測（含 iOS 靜音鍵確認、抽屜目錄、底部四鍵分頁、經句快捷列、PWA 與朗讀）均通過。
- 將 `feat/mobile-ui` 以 `--no-ff` 合併回 `main`、推送至 GitHub `origin/main`、清理已合併的 `feat/mobile-ui` 分支，並部署至 Firebase Hosting 正式站 `https://buddahsutra-reader.web.app`。


## Session 65 — 2026-11-28 濾除 CBETA XML 梵音附註（如 `subhūti`）＋ 佛經破音正音詞典擴充與自訂正音介面
- **修復 CBETA XML 非漢文附註滲入正文**：
  - [frontend/app.js](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/app.js)（`extractJuanFromXmlP5aClient`）與 [backend/cbeta_fetcher.py](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/backend/cbeta_fetcher.py)（`_extract_juan_from_xml_p5a`）新增跳過 `<foreign>`、`<sic>` 以及 `xml:lang` 非 `zh*` 或 `place="foot"` 的 `<cb:t>` 節點，徹底移除如 `subhūti須菩提` 之梵文羅馬轉寫。
  - 前端自載經卷加上 `parser_version: 2`，舊版 IndexedDB 快取（如已下載之《金剛經》）將於再次開啟時自動重抓刷新。
- **第一層：擴充內建佛經破音詞組正音表**（[frontend/app.js](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/app.js)）：
  - 擴充 `BUDDHIST_PRONUNCIATION_MAP` 至 72 條高頻佛經詞組（含 `祇樹給孤獨`→`奇樹己孤獨`、`還至本處`→`環至本處`、`著衣`→`卓衣`、`長老`→`掌老`、`迦葉`→`家設`、`行深`→`形深`、`大乘`→`大稱`、`法華`→`法花` 等），僅調整朗讀發音、絕不更動畫面原字。
- **第二層：使用者自訂正音表介面**（[frontend/index.html](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/index.html)、[frontend/styles.css](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/styles.css)、[frontend/app.js](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/app.js)）：
  - 於朗讀工具列新增「**正音**」快捷鈕，並於設定視窗新增「**🔊 朗讀正音**」分頁，支援新增／刪除「原詞 → 改唸為」、即時「🔊 試聽讀音」，自訂規則優先套用並保存於 `localStorage`。


## Session 66 — 2026-11-28 補內建正音「著地」（ㄓㄠˊ ㄉㄧˋ）
- 使用者回報《金剛經》「右膝著地」朗讀錯誤；於 [frontend/app.js](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/app.js) `BUDDHIST_PRONUNCIATION_MAP` 新增 `著地`→`着地`（ㄓㄠˊ），並更新 `app.js?v=20261128m4`。


## Session 67 — 2026-11-28 將佛經高頻破音詞典抽離為獨立設定檔 `佛經高頻破音詞典-設定.lst`
- 新增獨立純文字設定檔 [frontend/data/佛經高頻破音詞典-設定.lst](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/data/佛經高頻破音詞典-設定.lst)，格式為每行 `經文原詞 = 改唸為`（亦相容 `→`、`#` 註解與空行），自動依原詞長度由長到短套用。
- 修改 [frontend/app.js](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/app.js) 於啟動時以 `loadBuiltinPronunciationDict()` 動態載入該 `.lst` 檔，並更新 [frontend/index.html](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/frontend/index.html)（`app.js?v=20261128m5`）與 [firebase.json](file:///c:/Users/AdminSean/Coding/Personal/BuddahSutra-Reader/firebase.json)（為 `/data/**/*.lst` 加上 UTF-8 `Content-Type` 與 `no-cache`）。
