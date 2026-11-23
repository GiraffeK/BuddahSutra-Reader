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
