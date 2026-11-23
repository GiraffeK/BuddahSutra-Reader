# 大正新脩大藏經｜AI 白話翻譯與古大德註疏系統（BuddahSutra-Reader）

一套專為精讀漢傳佛教經典打造的本地 Web 閱讀與研究系統，結合 **大正新脩大藏經階層目錄**、**游標指句連動 AI 白話翻譯（Cache-First 本地知識庫）** 與 **歷代正統古大德註疏全文順向對齊**。

## 核心特色

- **大正新脩大藏經階層目錄樹**：完整收錄大正藏 25 大部階層分類，起始以 **《大方廣佛華嚴經》（八十華嚴・唐實叉難陀譯 `T10n0279`）** 與 **《大佛頂首楞嚴經》（十卷・唐般剌蜜帝譯 `T19n0945`）** 為主，並支援全卷次（1–80 卷 / 1–10 卷）自由切換。
- **CBETA 自動抓取與 GitHub 高速備援**：首次開啟尚未入庫的卷次或古大德註疏時，自動向 CBETA Online API 下載並斷句入庫；若 CBETA 主站逾時，自動秒切至 CBETA 官方 GitHub 鏡像（`cbeta-git/xml-p5a`）。
- **Cache-First 本地翻譯知識庫（`translation_kb/`）**：
  - 採「依經號／卷次分片 JSON」結構（詳見 [docs/knowledge-base-schema.md](docs/knowledge-base-schema.md)）。
  - AI 翻譯過的句子自動以原子寫入（Atomic Write）永久保存；再次指到即 0ms 本地命中，不重複消耗 Token。
  - 支援多引擎版本並存（Gemini / Ollama）與佛學名相自動沉澱（`translation_kb/glossary/terms.json`）。
- **雙引擎 LLM 支援**：預設 **Gemini API**（`google-genai`），並可即時切換 **本機 Ollama 模型**；翻譯時自動帶入前後文與古大德法義作為參考依據。
- **歷代古大德註疏全文同步捲動對齊**：
  - 完整收錄經 CBETA 實測核對之華嚴 8 部名著（澄觀《疏》/《演義鈔》、李通玄《新華嚴經論》、憨山《華嚴綱要》、淨源《疏注》、智儼《搜玄記》、法藏《探玄記》、宗密《行願品疏鈔》等）與楞嚴 13 位歷代名家（交光《正脈疏》、憨山《通議》、蕅益《文句》、幽溪傳燈《圓通疏》、長水子璿《義疏》、戒環《要解》、通理《指掌疏》、溥畹《寶鏡疏》等）。
  - 透過紅框標題列 Pop-up 選單自由切換精讀大德，採 **順向單調視窗對齊（Monotonic Forward-Window Alignment）** 自動捲動並高亮對應註疏段落，支援古文註疏一鍵 AI 白話導讀。
- **三欄獨立捲動閱讀介面**：左欄目錄、中欄（AI 翻譯＋古大德全文）、右欄漢文原文各自擁有獨立上下捲軸。

## 快速啟動

### 1. 安裝 Python 套件
需 Python 3.11+（建議使用虛擬環境）：
```bash
pip install fastapi uvicorn httpx pydantic python-dotenv google-genai
```

### 2. 設定環境變數
複製 `.env.example` 為 `.env` 並填入你的 Gemini API Key（或啟動本機 Ollama 服務）：
```bash
cp .env.example .env
```

### 3. 啟動系統
```bash
python run_app.py
```
開啟瀏覽器前往 `http://127.0.0.1:8000` 即可開始使用。

## 專案結構

```text
├── backend/                # FastAPI 後端、KB 讀寫引擎、Gemini/Ollama 雙引擎、CBETA 抓取器
├── frontend/               # 宣紙風格三欄獨立捲動閱讀器（HTML / CSS / JS）
├── translation_kb/         # 本地結構化翻譯知識庫、大正藏目錄、經文與古大德註疏快取
├── docs/                   # 翻譯知識庫資料結構設計規格書
├── run_app.py              # 一鍵啟動腳本
└── .env.example            # 環境變數範本（實際 .env 已列入 .gitignore 不會上傳）
```
