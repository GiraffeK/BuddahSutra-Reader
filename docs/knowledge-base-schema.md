# 翻譯知識庫（`translation_kb/`）資料結構設計規格書

> 版本：`v1.0`  
> 適用專案：大藏經 AI 白話翻譯與古大德註疏系統（`BuddhaSutra-註疏`）  
> 核心原則：**JSON 檔案為單一真實來源（Single Source of Truth）**、可讀可版本控管、依「經號＋卷次」分片（Sharding）、支援多 AI 引擎版本留存與人工校訂鎖定。

---

## 1. 目錄樹結構設計

```text
translation_kb/
├── schema_meta.json                    # 知識庫版本、最後更新時間、統計摘要
├── catalog/
│   └── taisho_tree.json                # 完整大正新脩大藏經 32 部階層目錄樹
├── sutras/                             # 經文原文基準庫（依經號/卷次分片）
│   ├── T10n0279/                       # 八十華嚴（唐・實叉難陀譯，主預設譯本）
│   │   ├── meta.json                   # 經名、譯者、卷數、品目對照、關聯古大德清單
│   │   └── fascicles/
│   │       ├── 001.json                # 卷第一（段落 + 句級切分 + 原文 Hash）
│   │       └── ...
│   └── T19n0945/                       # 首楞嚴經（唐・般剌蜜帝譯）
│       ├── meta.json
│       └── fascicles/
│           └── 001.json
├── commentaries/                       # 古大德註疏庫（全部收錄，供使用者自由勾選）
│   ├── masters_registry.json           # 歷代註疏大德總表（朝代、名號、代表著作、針對譯本、特色）
│   ├── T10n0279/                       # 華嚴經系古大德註疏（含針對80/60/40卷之跨譯本對照標記）
│   │   ├── chengguan_shuchao/          # 唐・澄觀大師《華嚴經疏》《隨疏演義鈔》（針對80華嚴）
│   │   │   └── 001.json
│   │   ├── litongxuan_lun/             # 唐・李通玄長者《新華嚴經論》（針對80華嚴）
│   │   ├── hanshan_gangyao/            # 明・憨山德清《華嚴經綱要》（針對80華嚴）
│   │   ├── xufa_zuanyao/               # 清・續法大師《華嚴經疏論纂要》（會通澄觀＋李通玄）
│   │   ├── zhiyan_souxuan/             # 唐・智儼大師《華嚴經搜玄記》（針對60華嚴，附跨譯本對應）
│   │   ├── fazang_tanxuan/             # 唐・法藏大師《華嚴經探玄記》（針對60華嚴，附跨譯本對應）
│   │   └── zongmi_xingyuan/            # 唐・宗密大師《華嚴經行願品疏鈔》（針對40華嚴）
│   └── T19n0945/                       # 楞嚴經系古大德註疏
│       ├── zixuan_yishu/               # 宋・長水子璿《首楞嚴義疏注經》
│       ├── jiaoguang_zhengmai/         # 明・交光真鑑《楞嚴經正脈疏》
│       ├── hanshan_tongyi/             # 明・憨山德清《楞嚴經通議》
│       ├── ouyi_wenju/                 # 明・蕅益智旭《大佛頂經文句》
│       └── yuanying_jiangyi/           # 民國・圓瑛大師《楞嚴經講義》
├── translations/                       # ★ AI 經文翻譯知識庫（Cache-First 核心儲存區）
│   ├── T10n0279/
│   │   └── 001.json                    # 卷第一所有已翻譯句子（Key = sentence_id）
│   └── T19n0945/
│       └── 001.json
├── commentary_translations/            # ★ 古大德文言註疏之 AI 白話導讀快取
│   └── T10n0279/
│       └── chengguan_shuchao/
│           └── 001.json                # Key = commentary_id
├── glossary/                           # ★ 跨經共用的佛學名相知識庫
│   └── terms.json                      # 累積常見佛學名相，確保跨卷/跨經釋義一致
└── .index/                             # 自動生成之加速索引（可隨時由 JSON 重建，不入 Git）
    └── kb_index.sqlite
```

### 為什麼選「依經號＋卷次分片（Per-Fascicle JSON）」？
1. **避免單檔過大**：整部八十華嚴若塞同一檔案將達數十 MB，讀寫極慢；按卷分片後單檔約 100KB–500KB，毫秒級載入。
2. **避免小檔爆炸**：若每句一個檔案，全藏數百萬句會拖垮 Windows NTFS 檔案系統；按卷分片兼顧效能與管理。
3. **人類可讀、易備份**：隨時可用文字編輯器檢視、人工校訂或用 Git 追蹤變更。

---

## 2. 核心資料結構（JSON Schema）

### 2.1 經文原文檔：`sutras/{sutra_id}/fascicles/{fascicle}.json`

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

### 2.2 AI 翻譯知識庫：`translations/{sutra_id}/{fascicle}.json`（最核心）

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

#### B. 註疏條目與經文對齊：`commentaries/{sutra_id}/{master_id}/{fascicle}.json`
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
[Step 1] 查詢 translation_kb/translations/{sutra_id}/{fascicle}.json
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
                            存入 translation_kb/translations/{sutra_id}/{fascicle}.json
                            並同步將新名相寫入 glossary/terms.json
                                  │
                                  ▼
                            回傳前端顯示（下次再指到此句即 0ms 命中！）
```

### 關鍵工程保護機制
1. **併發去重（In-Flight Deduplication）**：若使用者滑鼠在 1 秒內重複指到同一個尚未翻譯的句子，後端以 `sentence_id` 加鎖合併請求，只打一次 LLM API。
2. **原子寫入（Atomic File Write）**：寫回 JSON 時先寫暫存檔再 `os.replace()`，避免中途當機導致整個卷的知識庫 JSON 損毀。
3. **API 金鑰隔離**：Gemini API Key 僅存於 `.env`（加入 `.gitignore`），絕不寫進 `translation_kb/` 或任何日誌中。
