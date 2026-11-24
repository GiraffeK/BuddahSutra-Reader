# 翻譯知識庫（`translation_kb/`）資料結構設計規格書

> 版本：`v2.0`  
> 適用專案：大藏經 AI 白話翻譯與古大德註疏系統（`BuddhaSutra-Reader`）  
> 核心原則：**依「部別／經典／卷次」分片之 JSON 檔案為單一真實來源（Single Source of Truth）**、單經獨立名相庫、可讀可版本控管、並搭配可隨時從 JSON 重建之 SQLite 全文索引。

---

## 1. 目錄樹結構設計（v2.0）

```text
translation_kb/
├── schema_meta.json                    # 知識庫版本（2.0）、布局模式與索引路徑
├── catalog/
│   └── taisho_tree.json                # 完整大正新脩大藏經 25 部階層目錄樹
├── commentaries/
│   └── masters_registry.json           # 歷代註疏大德總表（朝代、名號、代表著作、對應卷次）
├── commentary_fulltext/                # 古大德整卷註疏原文快取（依著述作品獨立存放，可跨譯本共用）
│   ├── chengguan_shuchao/
│   │   └── 004.json
│   └── hanshan_tongyi/
│       └── 001.json
├── canons/                             # ★ 依「部別 / 經號_經名」集中管理每部經典的一切資產
│   ├── T_05_華嚴部/
│   │   └── T10n0279_大方廣佛華嚴經（八十華嚴）/
│   │       ├── meta.json               # 經名、譯者、卷數、關聯古大德清單
│   │       ├── glossary.json           # 本經專屬佛學名相知識庫（不再跨藏混用單檔）
│   │       ├── fascicles/              # 經文原文基準庫（按卷分片）
│   │       │   ├── 001.json
│   │       │   └── ...
│   │       ├── translations/           # ★ AI 經文翻譯知識庫（按卷分片，Key = sentence_id）
│   │       │   └── 001.json
│   │       ├── commentaries/           # 逐句註疏對照快取（依大德／卷次分片）
│   │       │   └── chengguan_shuchao/
│   │       │       └── 001.json
│   │       └── commentary_translations/# 古大德文言註疏之 AI 白話導讀快取
│   │           └── ...
│   └── T_10_密教部/
│       └── T19n0945_楞嚴經/
│           ├── meta.json
│           ├── glossary.json
│           ├── fascicles/
│           ├── translations/
│           ├── commentaries/
│           └── commentary_translations/
└── .index/                             # ★ 可隨時由 JSON 重建之 SQLite 全文加速索引（已列入 .gitignore）
    └── kb_index.sqlite
```

### 為什麼採用「部別／經典集中 ＋ 依卷分片 ＋ 單經獨立名相 ＋ SQLite 索引」？
1. **以「單部經」為整理單位**：某部經的原文、翻譯、註疏對照與佛學名相全集中在同一資料夾且含中文經名，備份、分享或移除極為直覺。
2. **避免單檔過大**：經文與翻譯按卷分片（單檔 100KB–500KB）；原本全藏共用的 `glossary/terms.json` 亦改為每部經獨立一個 `glossary.json`，徹底杜絕單檔膨脹與跨宗派釋義覆蓋。
3. **避免小檔爆炸**：仍以卷為分片粒度，不拆成每句一個檔案。
4. **跨經毫秒級檢索**：透過 `translation_kb/.index/kb_index.sqlite`（表：`sentences`、`translations`、`glossary`、`commentaries`），經由 `GET /api/kb/search`、`GET /api/kb/stats`、`POST /api/kb/reindex` 與 `GET /api/glossary/{sutra_id}` 提供全庫搜尋；任何時候刪除 `.index/` 皆可自 JSON 無損重建。

---

## 2. 核心資料結構（JSON Schema）

### 2.1 經文原文檔：`canons/{division}/{sutra_dir}/fascicles/{fascicle}.json`

```json
{
  "schema_version": "1.0",
  "sutra_id": "T10n0279",
  "sutra_title": "大方廣佛華嚴經",
  "edition": "八十華嚴（唐・實叉難陀譯）",
  "fascicle": 1,
  "fascicle_title": "世主妙嚴品第一之一",
  "paragraphs": [
    {
      "paragraph_id": "T10n0279_001_p0001",
      "index": 1,
      "type": "prose",
      "sentences": [
        {
          "sentence_id": "T10n0279_001_p0001_s001",
          "index": 1,
          "text": "如是我聞：",
          "source_hash": "sha256:9f86d081..."
        },
        {
          "sentence_id": "T10n0279_001_p0001_s002",
          "index": 2,
          "text": "一時，佛在摩竭提國阿蘭若法菩提場中，始成正覺。",
          "source_hash": "sha256:4a2b7c19..."
        }
      ]
    }
  ]
}
```
- **`sentence_id` 編碼規則**：`{經號}_{3位卷號}_p{4位段號}_s{3位句號}`，保證全大藏經唯一、可排序。
- **`source_hash`**：將經文去空白後取 SHA-256 前 12 碼，未來若校勘修正原文錯字，系統能自動偵測舊翻譯是否需要更新。

---

### 2.2 AI 翻譯知識庫：`canons/{division}/{sutra_dir}/translations/{fascicle}.json`（最核心）

```json
{
  "schema_version": "1.0",
  "sutra_id": "T10n0279",
  "fascicle": 1,
  "updated_at": "2026-11-23T11:05:00+08:00",
  "entries": {
    "T10n0279_001_p0001_s002": {
      "sentence_id": "T10n0279_001_p0001_s002",
      "source_text": "一時，佛在摩竭提國阿蘭若法菩提場中，始成正覺。",
      "source_hash": "sha256:4a2b7c19...",
      "active_version_id": "v_20261123_110500_gemini",
      "locked_by_human": false,
      "versions": [
        {
          "version_id": "v_20261123_110500_gemini",
          "provider": "gemini",
          "model": "gemini-2.5-flash",
          "prompt_version": "v1.0",
          "referenced_masters": ["chengguan_shuchao", "hanshan_gangyao"],
          "created_at": "2026-11-23T11:05:00+08:00",
          "content": {
            "literal_translation": "在某個時候，佛陀在摩竭提國寂靜無喧的法菩提道場中，初次證得無上正等正覺。",
            "colloquial_translation": "那時候，佛陀正在摩竭提國一處清淨寂靜的菩提道場裡，剛剛證悟圓滿成佛。",
            "dharma_analysis": "「阿蘭若法」在清涼澄觀《疏鈔》中不只指外在寂靜處，更表離一切煩惱喧雜的清淨法性；「始成正覺」顯發法界緣起之初成，十方同時頓現。",
            "terms": [
              {
                "term": "阿蘭若法",
                "explanation": "梵語 Araṇya，意為寂靜處、無諍處；於華嚴宗中亦指遠離煩惱喧鬧的真實法性。"
              },
              {
                "term": "菩提場",
                "explanation": "佛陀證悟無上正覺的道場，表法身智慧圓滿顯現之處。"
              }
            ]
          }
        }
      ]
    }
  }
}
```

#### 設計亮點
1. **O(1) 查詢速度**：`entries` 以 `sentence_id` 為 Dictionary Key，查本地知識庫瞬間完成。
2. **多模型版本並存（Gemini vs. Ollama）**：
   - 預設讀取 `active_version_id`。
   - 若使用者想比較 Gemini 與本機 Ollama 的譯文，點擊「用另一引擎重譯」會新增一筆到 `versions[]`，不會覆蓋原本的好譯文，可隨時切換。
3. **人工校訂保護（`locked_by_human`）**：日後若你親手微調某句翻譯，系統標記 `locked_by_human: true`，後續批次任務不會覆蓋你的心血。
4. **法義溯源（`referenced_masters`）**：記錄這次 AI 翻譯參考了哪幾位古大德的註疏。

---

### 2.3 古大德總表與註疏檔：`commentaries/`

#### A. `commentaries/masters_registry.json`（涵蓋所有收錄大德）
```json
{
  "masters": [
    {
      "master_id": "zhiyan_souxuan",
      "sutra_family": "huayan",
      "dynasty": "唐",
      "name": "智儼大師（華嚴二祖）",
      "work_title": "《華嚴經搜玄記》",
      "cbeta_id": "T35n1732",
      "target_edition": "T09n0278",
      "target_edition_label": "六十華嚴",
      "description": "針對六十華嚴。奠定華嚴宗判教與十玄門的理論基礎。",
      "default_selected": false
    },
    {
      "master_id": "fazang_tanxuan",
      "sutra_family": "huayan",
      "dynasty": "唐",
      "name": "法藏大師（賢首國師，華嚴三祖）",
      "work_title": "《華嚴經探玄記》",
      "cbeta_id": "T35n1733",
      "target_edition": "T09n0278",
      "target_edition_label": "六十華嚴",
      "description": "針對六十華嚴。華嚴宗義理集大成之作，體系最為嚴密。",
      "default_selected": false
    },
    {
      "master_id": "chengguan_shuchao",
      "sutra_family": "huayan",
      "dynasty": "唐",
      "name": "澄觀大師（清涼國師，華嚴四祖）",
      "work_title": "《華嚴經疏》、《隨疏演義鈔》（合稱《華嚴疏鈔》）",
      "cbeta_id": "T35n1735 / T36n1736",
      "target_edition": "T10n0279",
      "target_edition_label": "八十華嚴",
      "description": "針對八十華嚴。全書規模宏大，逐句消文釋義，是研究八十華嚴最權威的標準註解。",
      "default_selected": true
    },
    {
      "master_id": "litongxuan_lun",
      "sutra_family": "huayan",
      "dynasty": "唐",
      "name": "李通玄長者（棗柏大士）",
      "work_title": "《新華嚴經論》",
      "cbeta_id": "T36n1739",
      "target_edition": "T10n0279",
      "target_edition_label": "八十華嚴",
      "description": "針對八十華嚴。以居士身分著述，不拘泥繁瑣科判，風格直指心性與實修，與澄觀《疏鈔》相輔相成。",
      "default_selected": true
    },
    {
      "master_id": "zongmi_xingyuan",
      "sutra_family": "huayan",
      "dynasty": "唐",
      "name": "宗密大師（圭峰禪師，華嚴五祖）",
      "work_title": "《華嚴經行願品疏鈔》",
      "cbeta_id": "X05n0227",
      "target_edition": "T10n0293",
      "target_edition_label": "四十華嚴",
      "description": "針對四十華嚴（特別是〈普賢行願品〉），融通華嚴教理與禪宗心法。",
      "default_selected": false
    },
    {
      "master_id": "hanshan_gangyao",
      "sutra_family": "huayan",
      "dynasty": "明",
      "name": "憨山德清大師",
      "work_title": "《華嚴經綱要》",
      "cbeta_id": "X08n0240",
      "target_edition": "T10n0279",
      "target_edition_label": "八十華嚴",
      "description": "針對八十華嚴。有感於清涼《疏鈔》過於龐雜，刪繁就簡、提綱挈領，最適合現代人入門對照閱讀。",
      "default_selected": true
    },
    {
      "master_id": "xufa_zuanyao",
      "sutra_family": "huayan",
      "dynasty": "清",
      "name": "續法大師",
      "work_title": "《華嚴經疏論纂要》",
      "cbeta_id": "X07n0233",
      "target_edition": "T10n0279",
      "target_edition_label": "八十華嚴",
      "description": "會通澄觀的《疏鈔》與李通玄的《合論》，將兩大系統的精華彙編一處。",
      "default_selected": false
    }
  ]
}
```
> 註：同架構亦收錄《楞嚴經》歷代大德（長水子璿、戒環、交光真鑑、憨山德清、蕅益智旭、圓瑛大師），使用者可在前端勾選想對照的 1～N 位大德。

#### B. 註疏條目與經文對齊：`canons/{division}/{sutra_dir}/commentaries/{master_id}/{fascicle}.json`
```json
{
  "master_id": "chengguan_shuchao",
  "sutra_id": "T10n0279",
  "fascicle": 1,
  "entries": [
    {
      "commentary_id": "chengguan_T10n0279_001_c002",
      "target_sentence_ids": [
        "T10n0279_001_p0001_s002"
      ],
      "alignment_type": "exact",
      "section_heading": "序分・六種成就（時成就、主成就、處成就）",
      "original_commentary": "疏曰：言一時者，師資合會，說聽究竟，總名一時……阿蘭若者，此云無諍，亦云寂靜……",
      "cross_edition_note": null
    }
  ]
}
```
- **`alignment_type`**：
  - `"exact"`：直接對應八十華嚴該句。
  - `"cross_edition"`：如智儼《搜玄記》／法藏《探玄記》原註六十華嚴、宗密原註四十華嚴，透過對應同品同義之八十華嚴 `target_sentence_ids` 掛載，並在 `cross_edition_note` 標註六十／四十卷異文差異，讓讀者一目了然！

---

## 3. 查詢、寫入與防呆流程（Cache-First Pipeline）

```text
游標指到 / 點擊句子 (sentence_id)
        │
        ▼
[Step 1] 查詢 translation_kb/canons/{division}/{sutra_dir}/translations/{fascicle}.json
        │
   ┌────┴─────────────────────────┐
   │ Hit（命中本地知識庫）          │ Miss（本地找不到）
   ▼                              ▼
[0ms 立即回傳]              [Step 2] 讀取上下文（前後各2句）
顯示白話翻譯＋解析           ＋ 讀取該句已勾選的古大德註疏
＋ 顯示「來源：本地知識庫」          │
                                  ▼
                            [Step 3] 呼叫 LLM（預設 Gemini API，
                            可切換本機 Ollama；若 Gemini 失敗可選擇 fallback）
                                  │
                                  ▼
                            [Step 4] Atomic Write（寫入 .tmp → os.replace）
                            存入 canons/{division}/{sutra_dir}/translations/{fascicle}.json
                            並同步寫入該經 glossary.json 與 .index/kb_index.sqlite
                                  │
                                  ▼
                            回傳前端顯示（下次再指到此句即 0ms 命中！）
```

### 關鍵工程保護機制
1. **併發去重（In-Flight Deduplication）**：若使用者滑鼠在 1 秒內重複指到同一個尚未翻譯的句子，後端以 `sentence_id` 加鎖合併請求，只打一次 LLM API。
2. **原子寫入（Atomic File Write）**：寫回 JSON 時先寫暫存檔再 `os.replace()`，避免中途當機導致整個卷的知識庫 JSON 損毀。
3. **API 金鑰隔離**：Gemini API Key 僅存於 `.env`（加入 `.gitignore`），絕不寫進 `translation_kb/` 或任何日誌中。
