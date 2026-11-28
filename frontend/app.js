// 大正新脩大藏經｜AI 翻譯與古大德註疏全文同步對齊 前端主邏輯
// 支援雙模運作：本機後端模式 (FastAPI) 與 雲端純前端模式 (Firebase Hosting + BYOK Gemini + IndexedDB)

const state = {
  isBackendAvailable: false,
  userApiKey: localStorage.getItem("buddhasutra_gemini_api_key") || "",
  userModel: localStorage.getItem("buddhasutra_gemini_model") || "gemini-3.5-flash-lite",
  lastUsedModel: "",
  modelProbeResults: {}, // model -> { ok, status, http_status, latency_ms, message }
  modelProbeRunning: false,
  modelProbeRunId: 0,
  nvidiaApiKey: localStorage.getItem("buddhasutra_nvidia_api_key") || "",
  nvidiaProxyUrl: (
    localStorage.getItem("buddhasutra_nvidia_proxy_url") ||
    "https://nvidia-nim-proxy.seantang-mal.workers.dev"
  ).replace(/\/+$/, ""),
  nvidiaModel: localStorage.getItem("buddhasutra_nvidia_model") || "nvidia/nemotron-3-ultra-550b-a55b",
  lastUsedNvidiaModel: "",
  nvidiaProbeResults: {},
  nvidiaProbeRunning: false,
  nvidiaProbeRunId: 0,
  activeApiTab: "gemini",
  catalog: null,
  currentSutraId: "T10n0279",
  currentFascicle: 1,
  bundle: null, // { sutra, masters, commentaries, translations, fascicle_count, local_fascicles }
  selectedMasterId: null,
  commFull: null, // { master, juan, total_juans, paragraphs, local_juans, fetched_from_cbeta }
  commCursorIdx: 0,
  commAlignedIdx: null,
  commMatchedPhrase: null,
  commAlignMode: "", // "forward" | "global" | "hold" | ""
  activeSentenceId: null,
  lockedSentenceId: null,
  translatingSet: new Set(),
  commentaryGuides: {}, // para_id -> record
  hoverTimer: null,
  kbSearchTimer: null,
  llmStatus: null,
};

const els = {
  catalogTree: document.getElementById("catalogTree"),
  kbStatsBadge: document.getElementById("kbStatsBadge"),
  prevFascicleBtn: document.getElementById("prevFascicleBtn"),
  fascicleSelect: document.getElementById("fascicleSelect"),
  nextFascicleBtn: document.getElementById("nextFascicleBtn"),
  cbetaToast: document.getElementById("cbetaToast"),
  masterPickerAnchor: document.getElementById("masterPickerAnchor"),
  masterPickerBtn: document.getElementById("masterPickerBtn"),
  masterPopupMenu: document.getElementById("masterPopupMenu"),
  mastersChips: document.getElementById("mastersChips"),
  sutraContent: document.getElementById("sutraContent"),
  aiPanelWrap: document.getElementById("aiPanelWrap"),
  toggleAiCollapseBtn: document.getElementById("toggleAiCollapseBtn"),
  unlockBtn: document.getElementById("unlockBtn"),
  aiHeaderStatusBadge: document.getElementById("aiHeaderStatusBadge"),
  analysisPanel: document.getElementById("analysisPanel"),
  commMasterTitle: document.getElementById("commMasterTitle"),
  commAlignBadge: document.getElementById("commAlignBadge"),
  prevCommJuanBtn: document.getElementById("prevCommJuanBtn"),
  commJuanSelect: document.getElementById("commJuanSelect"),
  nextCommJuanBtn: document.getElementById("nextCommJuanBtn"),
  commFullBody: document.getElementById("commFullBody"),
  providerSelect: document.getElementById("providerSelect"),
  llmStatusBadge: document.getElementById("llmStatusBadge"),
  autoHoverTranslate: document.getElementById("autoHoverTranslate"),
  searchBoxWrap: document.getElementById("searchBoxWrap"),
  searchInput: document.getElementById("searchInput"),
  kbSearchDropdown: document.getElementById("kbSearchDropdown"),
  jumpParaInput: document.getElementById("jumpParaInput"),
  jumpParaBtn: document.getElementById("jumpParaBtn"),
  // 佛經原文朗讀（Web Speech API）
  ttsBar: document.getElementById("ttsBar"),
  ttsPlayBtn: document.getElementById("ttsPlayBtn"),
  ttsStopBtn: document.getElementById("ttsStopBtn"),
  ttsRateSelect: document.getElementById("ttsRateSelect"),
  ttsGenderToggle: document.getElementById("ttsGenderToggle"),
  ttsVoiceSelect: document.getElementById("ttsVoiceSelect"),
  // BYOK
  byokBtn: document.getElementById("byokBtn"),
  byokModal: document.getElementById("byokModal"),
  closeByokModalBtn: document.getElementById("closeByokModalBtn"),
  appModeLabel: document.getElementById("appModeLabel"),
  tabGeminiBtn: document.getElementById("tabGeminiBtn"),
  tabNvidiaBtn: document.getElementById("tabNvidiaBtn"),
  geminiSettingsPane: document.getElementById("geminiSettingsPane"),
  nvidiaSettingsPane: document.getElementById("nvidiaSettingsPane"),
  byokApiKeyInput: document.getElementById("byokApiKeyInput"),
  toggleKeyVisibilityBtn: document.getElementById("toggleKeyVisibilityBtn"),
  byokModelSelect: document.getElementById("byokModelSelect"),
  byokCustomModelInput: document.getElementById("byokCustomModelInput"),
  modelProbeSummary: document.getElementById("modelProbeSummary"),
  reprobeModelsBtn: document.getElementById("reprobeModelsBtn"),
  saveByokKeyBtn: document.getElementById("saveByokKeyBtn"),
  testByokKeyBtn: document.getElementById("testByokKeyBtn"),
  clearByokKeyBtn: document.getElementById("clearByokKeyBtn"),
  byokStatusMsg: document.getElementById("byokStatusMsg"),
  // NVIDIA NIM
  nvidiaApiKeyInput: document.getElementById("nvidiaApiKeyInput"),
  nvidiaProxyUrlInput: document.getElementById("nvidiaProxyUrlInput"),
  toggleNvidiaKeyVisibilityBtn: document.getElementById("toggleNvidiaKeyVisibilityBtn"),
  nvidiaModelSelect: document.getElementById("nvidiaModelSelect"),
  nvidiaCustomModelInput: document.getElementById("nvidiaCustomModelInput"),
  nvidiaProbeSummary: document.getElementById("nvidiaProbeSummary"),
  reprobeNvidiaModelsBtn: document.getElementById("reprobeNvidiaModelsBtn"),
  saveNvidiaKeyBtn: document.getElementById("saveNvidiaKeyBtn"),
  testNvidiaKeyBtn: document.getElementById("testNvidiaKeyBtn"),
  clearNvidiaKeyBtn: document.getElementById("clearNvidiaKeyBtn"),
  nvidiaStatusMsg: document.getElementById("nvidiaStatusMsg"),
  exportKbBtn: document.getElementById("exportKbBtn"),
  importKbInput: document.getElementById("importKbInput"),
  kbStorageStats: document.getElementById("kbStorageStats"),
  // 手機版 UI 元件
  mobileMenuBtn: document.getElementById("mobileMenuBtn"),
  mobileSidebarCloseBtn: document.getElementById("mobileSidebarCloseBtn"),
  mobileDrawerBackdrop: document.getElementById("mobileDrawerBackdrop"),
  mobileBottomNav: document.getElementById("mobileBottomNav"),
  mobileNavMenuBtn: document.getElementById("mobileNavMenuBtn"),
  mobileSentenceBar: document.getElementById("mobileSentenceBar"),
  mobileSentencePreview: document.getElementById("mobileSentencePreview"),
  mobileSentenceCloseBtn: document.getElementById("mobileSentenceCloseBtn"),
  mobileGoAiBtn: document.getElementById("mobileGoAiBtn"),
  mobileGoCommBtn: document.getElementById("mobileGoCommBtn"),
};

const STOP_PHRASES = new Set([
  "爾時", "一時", "如是我聞", "復次", "佛言", "白佛言", "所謂", "何以故",
  "阿難", "世尊", "佛告", "爾時世尊", "是故", "云何",
]);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  return data;
}

// ==================== 本地 IndexedDB 知識庫管理 ====================
const dbHelper = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("BuddhaSutraReaderDB", 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("translations")) {
          db.createObjectStore("translations", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("commentary_guides")) {
          db.createObjectStore("commentary_guides", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("custom_fascicles")) {
          db.createObjectStore("custom_fascicles", { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  async saveTranslation(sutraId, fascicle, sentenceId, entry) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("translations", "readwrite");
      const store = tx.objectStore("translations");
      const id = `${sutraId}:${fascicle}:${sentenceId}`;
      store.put({ id, sutra_id: sutraId, fascicle, sentence_id: sentenceId, entry, updated_at: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  async getTranslationsForFascicle(sutraId, fascicle) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("translations", "readonly");
      const store = tx.objectStore("translations");
      const req = store.getAll();
      req.onsuccess = () => {
        const result = {};
        for (const item of req.result || []) {
          if (item.sutra_id === sutraId && item.fascicle === fascicle) {
            result[item.sentence_id] = item.entry;
          }
        }
        resolve(result);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  async saveCommentaryGuide(masterId, juan, paraId, record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("commentary_guides", "readwrite");
      const store = tx.objectStore("commentary_guides");
      const id = `${masterId}:${juan}:${paraId}`;
      store.put({ id, master_id: masterId, juan, para_id: paraId, record, updated_at: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  async getCommentaryGuides(masterId, juan) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("commentary_guides", "readonly");
      const store = tx.objectStore("commentary_guides");
      const req = store.getAll();
      req.onsuccess = () => {
        const result = {};
        for (const item of req.result || []) {
          if (item.master_id === masterId && item.juan === juan) {
            result[item.para_id] = item.record;
          }
        }
        resolve(result);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  async exportAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["translations", "commentary_guides"], "readonly");
      const transReq = tx.objectStore("translations").getAll();
      const commReq = tx.objectStore("commentary_guides").getAll();
      tx.oncomplete = () => {
        resolve({
          version: "1.0",
          exported_at: new Date().toISOString(),
          translations: transReq.result || [],
          commentary_guides: commReq.result || [],
        });
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  async importAll(data) {
    if (!data || typeof data !== "object") throw new Error("無效的備份檔案格式");
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["translations", "commentary_guides"], "readwrite");
      const transStore = tx.objectStore("translations");
      const commStore = tx.objectStore("commentary_guides");
      (data.translations || []).forEach((t) => transStore.put(t));
      (data.commentary_guides || []).forEach((c) => commStore.put(c));
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  async getStats() {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction(["translations", "commentary_guides"], "readonly");
      const transReq = tx.objectStore("translations").count();
      const commReq = tx.objectStore("commentary_guides").count();
      tx.oncomplete = () => {
        resolve({
          translations: transReq.result || 0,
          commentary_guides: commReq.result || 0,
        });
      };
      tx.onerror = () => resolve({ translations: 0, commentary_guides: 0 });
    });
  },

  async saveCustomFascicle(sutraId, fascicle, sutraObj) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("custom_fascicles", "readwrite");
      const store = tx.objectStore("custom_fascicles");
      const id = `${sutraId}:${fascicle}`;
      store.put({ id, sutra_id: sutraId, fascicle, sutra: sutraObj, updated_at: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  async getCustomFascicle(sutraId, fascicle) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("custom_fascicles", "readonly");
      const req = tx.objectStore("custom_fascicles").get(`${sutraId}:${fascicle}`);
      req.onsuccess = () => resolve(req.result?.sutra || null);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  async listCustomFascicles(sutraId) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction("custom_fascicles", "readonly");
      const req = tx.objectStore("custom_fascicles").getAll();
      req.onsuccess = () => {
        const nums = (req.result || [])
          .filter((item) => item.sutra_id === sutraId && Number.isInteger(item.fascicle))
          .map((item) => item.fascicle);
        resolve(Array.from(new Set(nums)).sort((a, b) => a - b));
      };
      req.onerror = () => resolve([]);
    });
  },
};

// ==================== 純前端 BYOK Gemini 呼叫器 ====================
function buildSentencePrompt(sutraTitle, edition, targetText, prevSentences, nextSentences, commentaries) {
  let commBlock = "（本句目前無對應古大德註疏節錄，請依佛學正統義理謹慎翻譯）";
  if (commentaries && commentaries.length) {
    commBlock = commentaries
      .map(
        (c) =>
          `- 【${c.dynasty || ""}・${c.master_name || ""} ${c.work_title || ""}】（${c.section_heading || ""}）：${c.original_commentary || ""}`
      )
      .join("\n");
  }

  const prevStr = prevSentences.length ? prevSentences.join(" ") : "（段首）";
  const nextStr = nextSentences.length ? nextSentences.join(" ") : "（段末）";

  return `你是一位精通漢傳佛教典籍與歷代祖師註疏的佛學專家。請將以下《${sutraTitle}》（${edition}）中的指定句子翻譯並解析，輸出為**繁體中文純 JSON**（不要加額外說明文字）。

【上文脈絡】
${prevStr}

【待翻譯目標句】
${targetText}

【下文脈絡】
${nextStr}

【參考古大德註疏（請以此為法義核心依據，避免望文生義）】
${commBlock}

請嚴格輸出以下 JSON 結構：
{
  "literal_translation": "緊貼原文逐字對照之白話直譯（繁體中文）",
  "colloquial_translation": "流暢自然、現代人易懂的白話口語化新譯（繁體中文）",
  "dharma_analysis": "結合上述古大德註疏的法義解析（2~4句，準確深刻）",
  "terms": [
    {"term": "句中關鍵佛學名相", "explanation": "簡明精準的佛學解釋"}
  ]
}`;
}

function buildCommentaryPrompt(masterName, workTitle, originalCommentary) {
  return `你是一位精通漢傳佛學、古漢語文言文與祖師註疏的佛學專家。
請為以下【${masterName}《${workTitle}》】的文言註疏段落撰寫一份「現代白話法義導讀」。

【古大德註疏原文】
${originalCommentary}

請以繁體中文撰寫，約 200~450 字（若原文篇幅較長可條理分段說明），完整闡述此段註疏的核心意旨、祖師立意剖析、以及對修持經文的關鍵啟發。請務必完整收尾、切勿中斷，直接輸出純文字導讀即可。`;
}

const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-4-neon",
  "gemini-4-hydrogen",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

async function _callSingleGeminiModel(apiKey, model, prompt, isJson) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      ...(isJson ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rawMsg = data.error?.message || `HTTP ${res.status}`;
    const err = new Error(rawMsg);
    err.status = res.status;
    err.model = model;
    throw err;
  }

  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const rawText = parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  if (!rawText) throw new Error("Gemini 未回傳有效內容");

  if (!isJson) return rawText.trim();

  // JSON 解析與防護
  let text = rawText.trim();
  const fence = text.match(/```(?:json)?\s*(\{.*?\})\s*```/s);
  if (fence) {
    text = fence[1];
  } else {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s !== -1 && e > s) text = text.slice(s, e + 1);
  }
  return JSON.parse(text);
}

async function callDirectGeminiApi(prompt, isJson = true, allowFallback = true) {
  const apiKey = state.userApiKey.trim();
  if (!apiKey) {
    throw new Error("尚未設定 Gemini API Key，請點擊頂部「🔑 API 設定」填入個人金鑰。");
  }
  const primaryModel = state.userModel || "gemini-3.5-flash-lite";
  let candidates = allowFallback
    ? [primaryModel, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== primaryModel)]
    : [primaryModel];

  // 若背景檢測已有結果，優先嘗試確認可連線(ok)的模型，並略過已知 404 模型
  if (allowFallback && Object.keys(state.modelProbeResults || {}).length > 0) {
    const probes = state.modelProbeResults;
    const filtered = candidates.filter((m) => probes[m]?.status !== "not_found");
    if (filtered.length > 0) candidates = filtered;
    const rank = (m) => {
      const st = probes[m]?.status;
      if (st === "ok") return m === primaryModel ? 0 : 1;
      if (!st || st === "checking") return m === primaryModel ? 2 : 3;
      if (st === "quota") return 4;
      return 5;
    };
    candidates = [...candidates].sort((a, b) => rank(a) - rank(b));
  }

  let lastErr = null;
  const triedQuotaModels = [];

  for (const model of candidates) {
    try {
      const result = await _callSingleGeminiModel(apiKey, model, prompt, isJson);
      state.lastUsedModel = model;
      return result;
    } catch (err) {
      lastErr = err;
      const isQuota = err.status === 429 || /quota|rate.?limit/i.test(err.message || "");
      const isNotFound = err.status === 404;
      if (allowFallback && (isQuota || isNotFound)) {
        if (isQuota) triedQuotaModels.push(model);
        continue;
      }
      throw err;
    }
  }

  if (triedQuotaModels.length) {
    const retryMatch = (lastErr?.message || "").match(/retry in ([0-9a-zA-Z.]+)/i);
    const retryHint = retryMatch ? `（Google 建議等候：${retryMatch[1]}）` : "";
    throw new Error(
      `此 API Key 的免費層配額已達上限（已自動嘗試 ${triedQuotaModels.join("、")} 皆回傳 429）${retryHint}。建議至 Google AI Studio 綁定計費，或稍候配額重置後再試。`
    );
  }
  throw lastErr || new Error("Gemini API 呼叫失敗");
}

// ==================== 純前端 NVIDIA NIM 呼叫器 ====================
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_FALLBACK_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b",
  "qwen/qwen3.5-397b-a17b",
  "qwen/qwen3-235b-a22b",
  "deepseek-ai/deepseek-v3.2",
  "deepseek-ai/deepseek-r1",
  "z-ai/glm-4.7",
  "z-ai/glm-5.3-flash",
  "moonshotai/kimi-k2",
];

function stripThinkTags(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function getNvidiaChatEndpoint(proxyOverride = null) {
  const raw = proxyOverride !== null ? proxyOverride : state.nvidiaProxyUrl;
  const cleaned = String(raw || "").trim().replace(/\/+$/, "");
  if (cleaned) {
    return cleaned.endsWith("/v1/chat/completions") ? cleaned : `${cleaned}/v1/chat/completions`;
  }
  return `${NVIDIA_BASE_URL}/chat/completions`;
}

async function _callSingleNvidiaModel(apiKey, model, prompt, isJson) {
  const url = getNvidiaChatEndpoint();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 4096,
        stream: false,
      }),
    });
  } catch (netErr) {
    const hint = state.nvidiaProxyUrl
      ? `無法連線至 NVIDIA 代理網址（${state.nvidiaProxyUrl}），請確認 Cloudflare Worker 是否已部署且網址正確。`
      : "無法由瀏覽器直連 NVIDIA NIM API（瀏覽器 CORS 限制）。請於「🔑 API 設定 → NVIDIA」填入 Cloudflare Worker 代理網址，或改用本機後端模式（python run_app.py）。";
    const err = new Error(hint);
    err.status = 0;
    err.model = model;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rawMsg = data.detail || data.error?.message || `HTTP ${res.status}`;
    const err = new Error(rawMsg);
    err.status = res.status;
    err.model = model;
    throw err;
  }

  const rawText = stripThinkTags(data.choices?.[0]?.message?.content || "");
  if (!rawText) throw new Error("NVIDIA NIM 未回傳有效內容");
  if (!isJson) return rawText;

  let text = rawText;
  const fence = text.match(/```(?:json)?\s*(\{.*?\})\s*```/s);
  if (fence) {
    text = fence[1];
  } else {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s !== -1 && e > s) text = text.slice(s, e + 1);
  }
  return JSON.parse(text);
}

async function callDirectNvidiaApi(prompt, isJson = true, allowFallback = true) {
  const apiKey = state.nvidiaApiKey.trim();
  if (!apiKey) {
    throw new Error("尚未設定 NVIDIA API Key，請點擊頂部「🔑 API 設定」→「🟢 NVIDIA NIM API」填入個人金鑰。");
  }
  const primaryModel = state.nvidiaModel || "nvidia/nemotron-3-ultra-550b-a55b";
  let candidates = allowFallback
    ? [primaryModel, ...NVIDIA_FALLBACK_MODELS.filter((m) => m !== primaryModel)]
    : [primaryModel];

  if (allowFallback && Object.keys(state.nvidiaProbeResults || {}).length > 0) {
    const probes = state.nvidiaProbeResults;
    const filtered = candidates.filter((m) => probes[m]?.status !== "not_found");
    if (filtered.length > 0) candidates = filtered;
    const rank = (m) => {
      const st = probes[m]?.status;
      if (st === "ok") return m === primaryModel ? 0 : 1;
      if (!st || st === "checking") return m === primaryModel ? 2 : 3;
      if (st === "quota") return 4;
      return 5;
    };
    candidates = [...candidates].sort((a, b) => rank(a) - rank(b));
  }

  let lastErr = null;
  for (const model of candidates) {
    try {
      const result = await _callSingleNvidiaModel(apiKey, model, prompt, isJson);
      state.lastUsedNvidiaModel = model;
      return result;
    } catch (err) {
      lastErr = err;
      const isRetryable = err.status === 429 || err.status === 404;
      if (allowFallback && isRetryable) continue;
      throw err;
    }
  }
  throw lastErr || new Error("NVIDIA NIM API 呼叫失敗");
}

// ==================== 背景逐一檢測 Gemini 模型連線狀態 ====================
const MODEL_PROBE_CACHE_TTL_MS = 10 * 60 * 1000;

function getPresetGeminiModels() {
  if (!els.byokModelSelect) return [];
  return Array.from(els.byokModelSelect.options)
    .map((o) => o.value)
    .filter((v) => v && v !== "custom");
}

function getProbeCacheKey(apiKeyOverride = "") {
  const key = (apiKeyOverride || state.userApiKey || "").trim();
  if (key) return `buddhasutra_model_probes_v1:key_${key.slice(-6)}`;
  if (state.isBackendAvailable && state.llmStatus?.gemini?.configured) {
    return "buddhasutra_model_probes_v1:backend_env";
  }
  return null;
}

function formatProbeSuffix(res) {
  if (!res) return { icon: "", suffix: "" };
  switch (res.status) {
    case "checking":
      return { icon: "⏳ ", suffix: " — 檢測中..." };
    case "ok":
      return { icon: "🟢 ", suffix: res.latency_ms ? ` [可連線 ${res.latency_ms}ms]` : " [可連線]" };
    case "quota":
      return { icon: "🟡 ", suffix: " [配額已滿 429]" };
    case "not_found":
      return { icon: "🔴 ", suffix: " [不支援 404]" };
    case "forbidden":
      return { icon: "🔴 ", suffix: " [無權限 403]" };
    case "auth_error":
      return { icon: "🔴 ", suffix: " [金鑰無效]" };
    case "timeout":
      return { icon: "⚪ ", suffix: " [連線逾時]" };
    default:
      return { icon: "🔴 ", suffix: res.http_status ? ` [失敗 ${res.http_status}]` : " [無法連線]" };
  }
}

function applyModelProbeOptionLabels() {
  if (!els.byokModelSelect) return;
  for (const opt of els.byokModelSelect.options) {
    if (!opt.value || opt.value === "custom") continue;
    if (!opt.dataset.baseLabel) opt.dataset.baseLabel = opt.textContent;
    const base = opt.dataset.baseLabel;
    const res = state.modelProbeResults[opt.value];
    if (!res) {
      opt.textContent = base;
    } else {
      const { icon, suffix } = formatProbeSuffix(res);
      opt.textContent = `${icon}${base}${suffix}`;
    }
  }
}

function updateModelProbeSummary(customText = null, tone = "") {
  if (!els.modelProbeSummary) return;
  if (customText !== null) {
    els.modelProbeSummary.textContent = customText;
    els.modelProbeSummary.className = `model-probe-summary ${tone}`.trim();
    return;
  }

  const models = getPresetGeminiModels();
  const total = models.length;
  let done = 0;
  let okCount = 0;
  let quotaCount = 0;
  let failCount = 0;

  for (const m of models) {
    const r = state.modelProbeResults[m];
    if (!r || r.status === "checking") continue;
    done++;
    if (r.status === "ok") okCount++;
    else if (r.status === "quota") quotaCount++;
    else failCount++;
  }

  if (state.modelProbeRunning) {
    els.modelProbeSummary.textContent = `🔄 背景檢測中 (${done}/${total})… 目前 ${okCount} 個可連線`;
    els.modelProbeSummary.className = "model-probe-summary";
  } else if (done > 0) {
    const parts = [`${okCount}/${total} 個模型可連線`];
    if (quotaCount > 0) parts.push(`${quotaCount} 個配額滿`);
    if (failCount > 0) parts.push(`${failCount} 個不可用`);
    els.modelProbeSummary.textContent = `✓ 背景檢測完成：${parts.join("、")}`;
    els.modelProbeSummary.className = `model-probe-summary ${okCount > 0 ? "ok" : "warn"}`;
  }
}

async function probeSingleGeminiModelDirect(apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ok" }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 },
      }),
      signal: controller.signal,
    });
    const latency_ms = Math.round(performance.now() - t0);
    if (res.ok) {
      return { model, ok: true, status: "ok", http_status: 200, latency_ms, message: "可連線" };
    }
    const data = await res.json().catch(() => ({}));
    const rawMsg = data.error?.message || `HTTP ${res.status}`;
    const low = rawMsg.toLowerCase();
    let status = "error";
    if (res.status === 429 || /quota|rate.?limit/.test(low)) status = "quota";
    else if (res.status === 404 || low.includes("not found")) status = "not_found";
    else if ((res.status === 400 || res.status === 401) && (low.includes("api key") || low.includes("api_key_invalid"))) status = "auth_error";
    else if (res.status === 403) status = low.includes("api key") ? "auth_error" : "forbidden";
    return { model, ok: false, status, http_status: res.status, latency_ms, message: rawMsg };
  } catch (err) {
    const latency_ms = Math.round(performance.now() - t0);
    const isAbort = err?.name === "AbortError";
    return {
      model,
      ok: false,
      status: isAbort ? "timeout" : "error",
      http_status: null,
      latency_ms,
      message: isAbort ? "連線逾時" : (err?.message || "網路錯誤"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeSingleGeminiModel(model, apiKeyOverride = "") {
  const key = (apiKeyOverride || state.userApiKey || "").trim();
  if (key) {
    return probeSingleGeminiModelDirect(key, model);
  }
  if (state.isBackendAvailable && state.llmStatus?.gemini?.configured) {
    try {
      return await apiJson("/api/llm/probe-model", {
        method: "POST",
        body: JSON.stringify({ model }),
      });
    } catch (err) {
      return { model, ok: false, status: "error", http_status: null, latency_ms: 0, message: err.message };
    }
  }
  return { model, ok: false, status: "no_key", http_status: null, latency_ms: 0, message: "尚未設定金鑰" };
}

async function probeAllGeminiModelsInBackground({ force = false, apiKeyOverride = "" } = {}) {
  const models = getPresetGeminiModels();
  if (!models.length) return;

  const cacheKey = getProbeCacheKey(apiKeyOverride);
  if (!cacheKey) {
    state.modelProbeResults = {};
    state.modelProbeRunning = false;
    applyModelProbeOptionLabels();
    updateModelProbeSummary("尚未設定 Gemini API Key，設定後將自動背景檢測全部模型", "warn");
    return;
  }

  // 優先讀取本分頁 10 分鐘內快取，避免重整頁面重複消耗配額
  if (!force) {
    try {
      const cachedRaw = sessionStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && Date.now() - (cached.ts || 0) < MODEL_PROBE_CACHE_TTL_MS && cached.results) {
          state.modelProbeResults = cached.results;
          state.modelProbeRunning = false;
          applyModelProbeOptionLabels();
          updateModelProbeSummary();
          return;
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  const runId = ++state.modelProbeRunId;
  state.modelProbeRunning = true;
  state.modelProbeResults = {};
  for (const m of models) {
    state.modelProbeResults[m] = { model: m, ok: false, status: "checking", latency_ms: 0 };
  }
  if (els.reprobeModelsBtn) els.reprobeModelsBtn.disabled = true;
  applyModelProbeOptionLabels();
  updateModelProbeSummary();

  let abortedByAuth = false;
  let cursor = 0;
  const concurrency = 2;

  async function worker() {
    while (cursor < models.length && !abortedByAuth && state.modelProbeRunId === runId) {
      const m = models[cursor++];
      const res = await probeSingleGeminiModel(m, apiKeyOverride);
      if (state.modelProbeRunId !== runId) return;
      state.modelProbeResults[m] = res;
      if (res.status === "auth_error") {
        abortedByAuth = true;
        for (const rem of models) {
          if (state.modelProbeResults[rem]?.status === "checking") {
            state.modelProbeResults[rem] = { model: rem, ok: false, status: "auth_error", message: "金鑰無效" };
          }
        }
      }
      applyModelProbeOptionLabels();
      updateModelProbeSummary();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (state.modelProbeRunId !== runId) return;

  state.modelProbeRunning = false;
  if (els.reprobeModelsBtn) els.reprobeModelsBtn.disabled = false;

  if (abortedByAuth) {
    updateModelProbeSummary("❌ API Key 無效或無存取權限，已停止背景檢測", "err");
  } else {
    updateModelProbeSummary();
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), results: state.modelProbeResults }));
    } catch {
      // ignore
    }
  }
}

// ==================== 背景逐一檢測 NVIDIA NIM 模型連線狀態 ====================
function getPresetNvidiaModels() {
  if (!els.nvidiaModelSelect) return [];
  return Array.from(els.nvidiaModelSelect.options)
    .map((o) => o.value)
    .filter((v) => v && v !== "custom");
}

function getNvidiaProbeCacheKey(apiKeyOverride = "") {
  const key = (apiKeyOverride || state.nvidiaApiKey || "").trim();
  const proxyTag = state.nvidiaProxyUrl ? `_p${state.nvidiaProxyUrl.slice(-8)}` : "_direct";
  if (key) return `buddhasutra_nvidia_probes_v2:key_${key.slice(-6)}${proxyTag}`;
  if (state.isBackendAvailable && state.llmStatus?.nvidia?.configured) {
    return "buddhasutra_nvidia_probes_v2:backend_env";
  }
  return null;
}

function applyNvidiaProbeOptionLabels() {
  if (!els.nvidiaModelSelect) return;
  for (const opt of els.nvidiaModelSelect.options) {
    if (!opt.value || opt.value === "custom") continue;
    if (!opt.dataset.baseLabel) opt.dataset.baseLabel = opt.textContent;
    const base = opt.dataset.baseLabel;
    const res = state.nvidiaProbeResults[opt.value];
    if (!res) {
      opt.textContent = base;
    } else {
      const { icon, suffix } = formatProbeSuffix(res);
      opt.textContent = `${icon}${base}${suffix}`;
    }
  }
}

function updateNvidiaProbeSummary(customText = null, tone = "") {
  if (!els.nvidiaProbeSummary) return;
  if (customText !== null) {
    els.nvidiaProbeSummary.textContent = customText;
    els.nvidiaProbeSummary.className = `model-probe-summary ${tone}`.trim();
    return;
  }

  const models = getPresetNvidiaModels();
  const total = models.length;
  let done = 0;
  let okCount = 0;
  let quotaCount = 0;
  let failCount = 0;

  for (const m of models) {
    const r = state.nvidiaProbeResults[m];
    if (!r || r.status === "checking") continue;
    done++;
    if (r.status === "ok") okCount++;
    else if (r.status === "quota") quotaCount++;
    else failCount++;
  }

  if (state.nvidiaProbeRunning) {
    els.nvidiaProbeSummary.textContent = `🔄 NVIDIA 背景檢測中 (${done}/${total})… 目前 ${okCount} 個可連線`;
    els.nvidiaProbeSummary.className = "model-probe-summary";
  } else if (done > 0) {
    const parts = [`${okCount}/${total} 個模型可連線`];
    if (quotaCount > 0) parts.push(`${quotaCount} 個限流`);
    if (failCount > 0) parts.push(`${failCount} 個不可用`);
    els.nvidiaProbeSummary.textContent = `✓ NVIDIA 背景檢測完成：${parts.join("、")}`;
    els.nvidiaProbeSummary.className = `model-probe-summary ${okCount > 0 ? "ok" : "warn"}`;
  }
}

async function probeSingleNvidiaModel(model, apiKeyOverride = "") {
  const key = (apiKeyOverride || state.nvidiaApiKey || "").trim();
  // 本機後端模式優先由 FastAPI 代理探測（完全避開瀏覽器 CORS 限制）
  if (state.isBackendAvailable) {
    if (!key && !state.llmStatus?.nvidia?.configured) {
      return { model, ok: false, status: "no_key", http_status: null, latency_ms: 0, message: "尚未設定金鑰" };
    }
    try {
      return await apiJson("/api/llm/probe-model", {
        method: "POST",
        body: JSON.stringify({ model, provider: "nvidia", api_key: key || undefined }),
      });
    } catch (err) {
      return { model, ok: false, status: "error", http_status: null, latency_ms: 0, message: err.message };
    }
  }

  if (!key) {
    return { model, ok: false, status: "no_key", http_status: null, latency_ms: 0, message: "尚未設定金鑰" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const t0 = performance.now();
  try {
    const res = await fetch(getNvidiaChatEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    const latency_ms = Math.round(performance.now() - t0);
    if (res.ok) {
      return { model, ok: true, status: "ok", http_status: 200, latency_ms, message: "可連線" };
    }
    const data = await res.json().catch(() => ({}));
    const rawMsg = data.detail || data.error?.message || `HTTP ${res.status}`;
    const low = rawMsg.toLowerCase();
    let status = "error";
    if (res.status === 429 || /rate.?limit|quota/.test(low)) status = "quota";
    else if (res.status === 404 || low.includes("not found")) status = "not_found";
    else if (res.status === 401 || low.includes("unauthorized") || low.includes("invalid api key")) status = "auth_error";
    else if (res.status === 403) status = "forbidden";
    return { model, ok: false, status, http_status: res.status, latency_ms, message: rawMsg };
  } catch (err) {
    const latency_ms = Math.round(performance.now() - t0);
    const isAbort = err?.name === "AbortError";
    return {
      model,
      ok: false,
      status: isAbort ? "timeout" : state.nvidiaProxyUrl ? "error" : "cors",
      http_status: null,
      latency_ms,
      message: isAbort
        ? "連線逾時"
        : state.nvidiaProxyUrl
          ? "代理網址連線失敗，請檢查 Cloudflare Worker"
          : "瀏覽器 CORS 限制（請填入 Cloudflare Worker 代理網址）",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeAllNvidiaModelsInBackground({ force = false, apiKeyOverride = "" } = {}) {
  const models = getPresetNvidiaModels();
  if (!models.length) return;

  const cacheKey = getNvidiaProbeCacheKey(apiKeyOverride);
  if (!cacheKey) {
    state.nvidiaProbeResults = {};
    state.nvidiaProbeRunning = false;
    applyNvidiaProbeOptionLabels();
    updateNvidiaProbeSummary("尚未設定 NVIDIA API Key，設定後將自動背景檢測全部模型", "warn");
    return;
  }

  if (!force) {
    try {
      const cachedRaw = sessionStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && Date.now() - (cached.ts || 0) < MODEL_PROBE_CACHE_TTL_MS && cached.results) {
          state.nvidiaProbeResults = cached.results;
          state.nvidiaProbeRunning = false;
          applyNvidiaProbeOptionLabels();
          updateNvidiaProbeSummary();
          return;
        }
      }
    } catch {
      // ignore
    }
  }

  if (!state.isBackendAvailable && !state.nvidiaProxyUrl) {
    state.nvidiaProbeResults = {};
    state.nvidiaProbeRunning = false;
    applyNvidiaProbeOptionLabels();
    updateNvidiaProbeSummary("⚠️ 雲端純前端模式需先填入 Cloudflare Worker 代理網址才能繞過 NVIDIA CORS 限制", "warn");
    return;
  }

  const runId = ++state.nvidiaProbeRunId;
  state.nvidiaProbeRunning = true;
  state.nvidiaProbeResults = {};
  for (const m of models) {
    state.nvidiaProbeResults[m] = { model: m, ok: false, status: "checking", latency_ms: 0 };
  }
  if (els.reprobeNvidiaModelsBtn) els.reprobeNvidiaModelsBtn.disabled = true;
  applyNvidiaProbeOptionLabels();
  updateNvidiaProbeSummary();

  let abortedByAuth = false;
  let cursor = 0;
  const concurrency = 2;

  async function worker() {
    while (cursor < models.length && !abortedByAuth && state.nvidiaProbeRunId === runId) {
      const m = models[cursor++];
      const res = await probeSingleNvidiaModel(m, apiKeyOverride);
      if (state.nvidiaProbeRunId !== runId) return;
      state.nvidiaProbeResults[m] = res;
      if (res.status === "auth_error") {
        abortedByAuth = true;
        for (const rem of models) {
          if (state.nvidiaProbeResults[rem]?.status === "checking") {
            state.nvidiaProbeResults[rem] = { model: rem, ok: false, status: "auth_error", message: "金鑰無效" };
          }
        }
      }
      applyNvidiaProbeOptionLabels();
      updateNvidiaProbeSummary();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (state.nvidiaProbeRunId !== runId) return;

  state.nvidiaProbeRunning = false;
  if (els.reprobeNvidiaModelsBtn) els.reprobeNvidiaModelsBtn.disabled = false;

  if (abortedByAuth) {
    updateNvidiaProbeSummary("❌ NVIDIA API Key 無效或無存取權限，已停止背景檢測", "err");
  } else {
    updateNvidiaProbeSummary();
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), results: state.nvidiaProbeResults }));
    } catch {
      // ignore
    }
  }
}

// ==================== 佛經原文朗讀（方案 A：Web Speech API + 佛經正音） ====================
const BUDDHIST_PRONUNCIATION_MAP = [
  [/南無/g, "拿摩"],
  [/般若/g, "波惹"],
  [/阿彌陀/g, "啊彌陀"],
  [/阿難/g, "啊難"],
  [/阿耨多羅/g, "啊耨多羅"],
  [/阿羅漢/g, "啊羅漢"],
  [/阿修羅/g, "啊修羅"],
  [/阿僧祇/g, "啊僧祇"],
  [/阿蘭若/g, "啊蘭惹"],
  [/阿毗達磨/g, "啊毗達磨"],
  [/阿闍梨/g, "啊闍梨"],
  [/阿鼻/g, "啊鼻"],
  [/摩訶/g, "摩呵"],
  [/伽藍/g, "茄藍"],
  [/伽耶/g, "茄耶"],
  [/波斯匿/g, "波斯逆"],
  [/舍利弗/g, "設利弗"],
  [/優婆塞/g, "優婆賽"],
];

function normalizeSutraPronunciation(text) {
  let out = String(text || "").replace(/\[\*\]|\[＊\]/g, "");
  for (const [pattern, reading] of BUDDHIST_PRONUNCIATION_MAP) {
    out = out.replace(pattern, reading);
  }
  return out;
}

const ttsState = {
  playing: false,
  paused: false,
  queue: [],
  idx: 0,
  runId: 0,
  speakingSentenceId: null,
  gender: localStorage.getItem("buddhasutra_tts_gender") || "female",
  voices: [],
};

// 精選差異度最高的 4 個自然中文語音（女 2 / 男 2，刪去過於接近與舊版機械音）
const CURATED_TTS_VOICES = [
  { key: "hsiaochen", match: /曉臻|hsiaochen/i, gender: "female", label: "女聲｜曉臻（台灣溫潤）" },
  { key: "xiaoxiao", match: /晓晓|曉曉|xiaoxiao/i, gender: "female", label: "女聲｜曉曉（清亮流暢）" },
  { key: "yunjhe", match: /雲哲|云哲|yunjhe/i, gender: "male", label: "男聲｜雲哲（台灣沉穩）" },
  { key: "yunjian", match: /云健|雲健|yunjian/i, gender: "male", label: "男聲｜雲健（渾厚穩重）" },
];

function inferVoiceGender(name) {
  const n = String(name || "");
  if (/雲|云|男|yunjhe|yunjian|yunxi|yunyang|yunxia|wanlung|kangkang|danny|zhiwei/i.test(n)) {
    return "male";
  }
  return "female";
}

function curateVoicesByGender(allVoices, gender) {
  const curated = [];
  for (const spec of CURATED_TTS_VOICES) {
    if (spec.gender !== gender) continue;
    const hit = allVoices.find((v) => spec.match.test(v.name || ""));
    if (hit) curated.push({ voice: hit, label: spec.label });
  }
  if (curated.length) return curated;

  // 非 Edge 瀏覽器備援：只保留中文語音（切勿退回英文語音，否則朗讀中文會完全無聲）
  const zh = allVoices.filter((v) => /^zh(?:[-_]|$)/i.test(v.lang || "") || /chinese|mandarin|中文|國語|普通話|台灣|臺灣/i.test(v.name || ""));
  if (!zh.length) return [];
  // 優先本機離線可用語音（localService），避免手機選到連不上的遠端語音而無聲
  const sortedZh = [...zh].sort((a, b) => Number(Boolean(b.localService)) - Number(Boolean(a.localService)));
  const sameGender = sortedZh.filter((v) => inferVoiceGender(v.name) === gender);
  const fallbackPool = sameGender.length ? sameGender : sortedZh;
  return fallbackPool.slice(0, 2).map((v) => ({
    voice: v,
    label: `${gender === "male" ? "男聲" : "女聲"}｜${(v.name || "").replace(/^Microsoft\s+/i, "").replace(/\s*-\s*Chinese.*$/i, "")}`,
  }));
}

function initSutraTts() {
  if (!("speechSynthesis" in window) || !els.ttsBar) {
    if (els.ttsBar) els.ttsBar.style.display = "none";
    return;
  }

  const savedRate = localStorage.getItem("buddhasutra_tts_rate");
  if (savedRate && els.ttsRateSelect) els.ttsRateSelect.value = savedRate;

  syncGenderToggleUi();
  els.ttsGenderToggle?.querySelectorAll(".tts-gender-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.gender === "male" ? "male" : "female";
      if (ttsState.gender === g) return;
      ttsState.gender = g;
      localStorage.setItem("buddhasutra_tts_gender", g);
      syncGenderToggleUi();
      populateTtsVoices();
      if (ttsState.playing && !ttsState.paused) {
        speakQueueIndex(ttsState.idx, ttsState.runId);
      }
    });
  });

  populateTtsVoices();
  window.speechSynthesis.addEventListener("voiceschanged", populateTtsVoices);

  els.ttsPlayBtn?.addEventListener("click", toggleSutraTts);
  els.ttsStopBtn?.addEventListener("click", stopSutraTts);
  els.ttsRateSelect?.addEventListener("change", () => {
    localStorage.setItem("buddhasutra_tts_rate", els.ttsRateSelect.value);
    if (ttsState.playing && !ttsState.paused) {
      speakQueueIndex(ttsState.idx, ttsState.runId);
    }
  });
  els.ttsVoiceSelect?.addEventListener("change", () => {
    localStorage.setItem(`buddhasutra_tts_voice_${ttsState.gender}`, els.ttsVoiceSelect.value);
    if (ttsState.playing && !ttsState.paused) {
      speakQueueIndex(ttsState.idx, ttsState.runId);
    }
  });
  window.addEventListener("beforeunload", stopSutraTts);
}

function syncGenderToggleUi() {
  els.ttsGenderToggle?.querySelectorAll(".tts-gender-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.gender === ttsState.gender);
  });
}

function populateTtsVoices() {
  if (!els.ttsVoiceSelect || !("speechSynthesis" in window)) return;
  const all = window.speechSynthesis.getVoices() || [];
  if (!all.length) return;

  const curated = curateVoicesByGender(all, ttsState.gender);
  ttsState.voices = curated.map((c) => c.voice);

  const savedVoice = localStorage.getItem(`buddhasutra_tts_voice_${ttsState.gender}`);
  els.ttsVoiceSelect.innerHTML = "";
  curated.forEach(({ voice, label }) => {
    const opt = document.createElement("option");
    opt.value = voice.name;
    opt.textContent = label;
    if (savedVoice && voice.name === savedVoice) opt.selected = true;
    els.ttsVoiceSelect.appendChild(opt);
  });
}

function updateTtsButtons() {
  if (!els.ttsPlayBtn || !els.ttsStopBtn) return;
  if (!ttsState.playing) {
    els.ttsPlayBtn.textContent = "🔊 朗讀原文";
    els.ttsPlayBtn.classList.remove("active");
    els.ttsStopBtn.style.display = "none";
  } else if (ttsState.paused) {
    els.ttsPlayBtn.textContent = "▶ 繼續朗讀";
    els.ttsPlayBtn.classList.add("active");
    els.ttsStopBtn.style.display = "inline-block";
  } else {
    els.ttsPlayBtn.textContent = "⏸ 暫停朗讀";
    els.ttsPlayBtn.classList.add("active");
    els.ttsStopBtn.style.display = "inline-block";
  }
}

function syncSpeakingHighlight(sentenceId) {
  ttsState.speakingSentenceId = sentenceId;
  document.querySelectorAll(".sentence.speaking").forEach((el) => el.classList.remove("speaking"));
  if (!sentenceId) return;
  const el = document.querySelector(`.sentence[data-sentence-id="${sentenceId}"]`);
  if (el) {
    el.classList.add("speaking");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function toggleSutraTts() {
  if (!("speechSynthesis" in window)) {
    showCbetaToast("⚠️ 此手機瀏覽器不支援網頁語音朗讀，建議改用 Chrome 或 Safari 開啟。", false);
    return;
  }
  const isTouch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  if (ttsState.playing && !ttsState.paused) {
    ttsState.paused = true;
    if (isTouch) {
      // 手機瀏覽器 pause()/resume() 常失效，改為中止當前句並保留進度
      ttsState.runId += 1;
      window.speechSynthesis.cancel();
    } else {
      window.speechSynthesis.pause();
    }
    updateTtsButtons();
    return;
  }
  if (ttsState.playing && ttsState.paused) {
    ttsState.paused = false;
    updateTtsButtons();
    if (isTouch) {
      ttsState.runId += 1;
      speakQueueIndex(ttsState.idx, ttsState.runId, false);
    } else {
      window.speechSynthesis.resume();
    }
    return;
  }
  startSutraTts();
}

function startSutraTts() {
  if (!state.bundle?.sutra?.paragraphs?.length) return;
  const queue = [];
  for (const p of state.bundle.sutra.paragraphs) {
    if (p.type !== "prose") continue;
    for (const s of p.sentences || []) {
      if (s.text && s.text.trim()) {
        queue.push({ sentence_id: s.sentence_id, text: s.text });
      }
    }
  }
  if (!queue.length) return;

  // 若手機啟動時尚未載入 voices，點擊當下再抓一次
  if (!ttsState.voices.length) populateTtsVoices();

  const anchorId = state.lockedSentenceId || state.activeSentenceId;
  const startIdx = anchorId ? Math.max(0, queue.findIndex((q) => q.sentence_id === anchorId)) : 0;

  ttsState.queue = queue;
  ttsState.idx = startIdx;
  ttsState.playing = true;
  ttsState.paused = false;
  ttsState.runId += 1;
  ttsState.consecutiveErrors = 0;
  updateTtsButtons();
  // 首次啟動切勿先呼叫 cancel()，避免 Android Chrome / iOS Safari 吞掉隨後的 speak()
  speakQueueIndex(startIdx, ttsState.runId, false);
}

function speakQueueIndex(index, runId, shouldCancelFirst = true) {
  if (runId !== ttsState.runId || !ttsState.playing) return;
  if (index >= ttsState.queue.length) {
    stopSutraTts();
    return;
  }

  ttsState.idx = index;
  const item = ttsState.queue[index];
  syncSpeakingHighlight(item.sentence_id);

  // 同步顯示右側句子的既有譯文與古大德註疏（不觸發自動 AI 翻譯）
  state.activeSentenceId = item.sentence_id;
  syncSentenceHighlight();
  renderAnalysisPanel();
  alignCommentaryToSentence(item.sentence_id);

  const synth = window.speechSynthesis;
  const doSpeak = () => {
    if (runId !== ttsState.runId || !ttsState.playing) return;
    const utter = new SpeechSynthesisUtterance(normalizeSutraPronunciation(item.text));
    utter.rate = parseFloat(els.ttsRateSelect?.value || "1.0") || 1.0;
    utter.volume = 1.0;
    utter.pitch = 1.0;

    const selectedName = els.ttsVoiceSelect?.value;
    const voice = ttsState.voices.find((v) => v.name === selectedName) || ttsState.voices[0] || null;
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang || "zh-TW";
    } else {
      // 若瀏覽器尚未回報中文 voice，保持 voice=null 讓系統依 lang 自動挑選內建中文語音
      utter.lang = "zh-TW";
    }

    // 保留參照避免手機瀏覽器 GC 回收 utter 導致無聲或中斷
    ttsState.currentUtter = utter;

    utter.onstart = () => {
      ttsState.consecutiveErrors = 0;
    };
    utter.onend = () => {
      if (runId === ttsState.runId && ttsState.playing) {
        // 上一句已自然結束，不需要再呼叫 cancel()
        speakQueueIndex(index + 1, runId, false);
      }
    };
    utter.onerror = (ev) => {
      if (ev?.error === "interrupted" || ev?.error === "canceled") return;
      ttsState.consecutiveErrors = (ttsState.consecutiveErrors || 0) + 1;
      if (ttsState.consecutiveErrors >= 2) {
        stopSutraTts();
        const reason = ev?.error || "unknown";
        showCbetaToast(
          `⚠️ 手機語音朗讀失敗（${reason}）。請確認手機未開靜音，且系統已安裝中文語音引擎（Android：設定→文字轉語音；iOS：輔助使用→語音內容）。`,
          false
        );
        return;
      }
      if (runId === ttsState.runId && ttsState.playing) {
        speakQueueIndex(index + 1, runId, false);
      }
    };

    try {
      if (synth.paused) synth.resume();
    } catch {}
    synth.speak(utter);
  };

  if (shouldCancelFirst && (synth.speaking || synth.pending)) {
    synth.cancel();
    setTimeout(doSpeak, 60);
  } else {
    doSpeak();
  }
}

function stopSutraTts() {
  ttsState.runId += 1;
  ttsState.playing = false;
  ttsState.paused = false;
  ttsState.queue = [];
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  syncSpeakingHighlight(null);
  updateTtsButtons();
}

// ---------- 手機版 RWD 抽屜與分頁切換 ----------
const mobileUiState = {
  tab: "sutra", // "sutra" | "ai" | "comm"
  sentenceBarDismissedId: null,
};

function isMobileViewport() {
  return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
}

function toggleMobileDrawer(open) {
  const next = typeof open === "boolean" ? open : !document.body.classList.contains("mobile-drawer-open");
  document.body.classList.toggle("mobile-drawer-open", next);
}

function setMobileTab(tab) {
  const valid = tab === "ai" || tab === "comm" ? tab : "sutra";
  mobileUiState.tab = valid;
  document.body.classList.remove("mobile-tab-sutra", "mobile-tab-ai", "mobile-tab-comm");
  document.body.classList.add(`mobile-tab-${valid}`);
  els.mobileBottomNav?.querySelectorAll("[data-mobile-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mobileTab === valid);
  });
  if (valid === "comm" && state.commAlignedIdx !== null) {
    setTimeout(() => {
      const targetEl = els.commFullBody?.querySelector(`[data-comm-index="${state.commAlignedIdx}"]`);
      targetEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }
  updateMobileSentenceBar();
}

function updateMobileSentenceBar() {
  if (!els.mobileSentenceBar) return;
  const sid = state.lockedSentenceId || state.activeSentenceId;
  if (!isMobileViewport() || mobileUiState.tab !== "sutra" || !sid || mobileUiState.sentenceBarDismissedId === sid) {
    els.mobileSentenceBar.style.display = "none";
    return;
  }
  const txt = findSentenceText(sid);
  if (!txt) {
    els.mobileSentenceBar.style.display = "none";
    return;
  }
  els.mobileSentencePreview.textContent = txt;
  const isTranslating = state.translatingSet.has(sid);
  const hasTrans = Boolean(state.bundle?.translations?.[sid]);
  if (els.mobileGoAiBtn) {
    els.mobileGoAiBtn.textContent = isTranslating
      ? "⏳ AI 翻譯中（點我看）"
      : hasTrans
        ? "✨ 看 AI 翻譯（已就緒）"
        : "✨ 看 AI 翻譯";
  }
  els.mobileSentenceBar.style.display = "flex";
}

function initMobileUi() {
  els.mobileMenuBtn?.addEventListener("click", () => toggleMobileDrawer(true));
  els.mobileNavMenuBtn?.addEventListener("click", () => toggleMobileDrawer(true));
  els.mobileSidebarCloseBtn?.addEventListener("click", () => toggleMobileDrawer(false));
  els.mobileDrawerBackdrop?.addEventListener("click", () => toggleMobileDrawer(false));

  els.mobileBottomNav?.querySelectorAll("[data-mobile-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleMobileDrawer(false);
      setMobileTab(btn.dataset.mobileTab);
    });
  });

  els.mobileGoAiBtn?.addEventListener("click", () => setMobileTab("ai"));
  els.mobileGoCommBtn?.addEventListener("click", () => setMobileTab("comm"));
  els.mobileSentenceCloseBtn?.addEventListener("click", () => {
    mobileUiState.sentenceBarDismissedId = state.lockedSentenceId || state.activeSentenceId;
    if (els.mobileSentenceBar) els.mobileSentenceBar.style.display = "none";
  });

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) {
      toggleMobileDrawer(false);
      if (els.mobileSentenceBar) els.mobileSentenceBar.style.display = "none";
    } else {
      updateMobileSentenceBar();
    }
  });
}

// ---------- 初始化 ----------
async function init() {
  bindEvents();
  initByokModal();
  initSutraTts();
  initMobileUi();
  await checkBackendAvailability();
  await Promise.all([loadLlmStatus(), loadCatalog()]);
  // 背景逐一確認已設定金鑰之 Gemini / NVIDIA 模型連線狀態（不阻塞經文載入）
  probeAllGeminiModelsInBackground();
  probeAllNvidiaModelsInBackground();
  await loadFascicle(state.currentSutraId, state.currentFascicle);
}

async function checkBackendAvailability() {
  try {
    const res = await fetch("/api/health", { method: "GET" });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.status === "ok") {
        state.isBackendAvailable = true;
      }
    }
  } catch {
    state.isBackendAvailable = false;
  }

  if (els.appModeLabel) {
    els.appModeLabel.textContent = state.isBackendAvailable
      ? "本機後端模式 (FastAPI Connected)"
      : "雲端純前端模式 (Firebase Hosting / Client-Only)";
    els.appModeLabel.style.color = state.isBackendAvailable ? "#2c6e49" : "#8c5a2b";
  }
}

function bindEvents() {
  els.providerSelect.addEventListener("change", () => {
    localStorage.setItem("buddhasutra_llm_provider", els.providerSelect.value);
    updateLlmBadge();
    if (els.providerSelect.value === "nvidia" && Object.keys(state.nvidiaProbeResults).length === 0) {
      probeAllNvidiaModelsInBackground();
    }
  });

  els.llmStatusBadge?.addEventListener("click", () => {
    const p = els.providerSelect?.value;
    openByokModal(p === "nvidia" ? "nvidia" : "gemini");
  });

  els.toggleAiCollapseBtn.addEventListener("click", () => {
    const collapsed = els.aiPanelWrap.classList.toggle("collapsed");
    els.toggleAiCollapseBtn.textContent = collapsed ? "展開" : "收合";
  });

  els.unlockBtn?.addEventListener("click", () => {
    state.lockedSentenceId = null;
    syncSentenceHighlight();
    renderAnalysisPanel();
  });

  els.jumpParaBtn.addEventListener("click", () => {
    const idx = parseInt(els.jumpParaInput.value, 10);
    if (!idx) return;
    const el = document.querySelector(`[data-para-index="${idx}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  els.searchInput.addEventListener("input", () => {
    const q = els.searchInput.value.trim();
    renderCatalogTree(q);
    highlightSearchInSutra(q);
    scheduleKbIndexSearch(q);
  });

  els.searchInput.addEventListener("focus", () => {
    const q = els.searchInput.value.trim();
    if (q.length >= 2) scheduleKbIndexSearch(q);
  });

  els.fascicleSelect.addEventListener("change", () => {
    const f = parseInt(els.fascicleSelect.value, 10);
    if (f) loadFascicle(state.currentSutraId, f);
  });

  els.prevFascicleBtn.addEventListener("click", () => {
    if (state.currentFascicle > 1) {
      loadFascicle(state.currentSutraId, state.currentFascicle - 1);
    }
  });

  els.nextFascicleBtn.addEventListener("click", () => {
    const total = state.bundle?.fascicle_count || 1;
    if (state.currentFascicle < total) {
      loadFascicle(state.currentSutraId, state.currentFascicle + 1);
    }
  });

  els.commJuanSelect.addEventListener("change", () => {
    const j = parseInt(els.commJuanSelect.value, 10);
    if (j && state.selectedMasterId) {
      loadCommentaryFulltext(state.selectedMasterId, j);
    }
  });

  els.prevCommJuanBtn.addEventListener("click", () => {
    if (state.commFull && state.commFull.juan > 1) {
      loadCommentaryFulltext(state.selectedMasterId, state.commFull.juan - 1);
    }
  });

  els.nextCommJuanBtn.addEventListener("click", () => {
    if (state.commFull && state.commFull.juan < state.commFull.total_juans) {
      loadCommentaryFulltext(state.selectedMasterId, state.commFull.juan + 1);
    }
  });

  // 點選古大德按鈕 -> 開關 Pop-up 選單
  els.masterPickerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMasterPopup();
  });

  document.addEventListener("click", (e) => {
    if (
      els.masterPopupMenu.style.display !== "none" &&
      !els.masterPickerAnchor.contains(e.target)
    ) {
      closeMasterPopup();
    }
    if (
      els.kbSearchDropdown.style.display !== "none" &&
      !els.searchBoxWrap.contains(e.target)
    ) {
      closeKbSearchDropdown();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMasterPopup();
      closeKbSearchDropdown();
      closeByokModal();
      toggleMobileDrawer(false);
    }
  });
}

function switchApiModalTab(tab) {
  const target = tab === "nvidia" ? "nvidia" : "gemini";
  state.activeApiTab = target;
  if (els.tabGeminiBtn) els.tabGeminiBtn.classList.toggle("active", target === "gemini");
  if (els.tabNvidiaBtn) els.tabNvidiaBtn.classList.toggle("active", target === "nvidia");
  if (els.geminiSettingsPane) els.geminiSettingsPane.style.display = target === "gemini" ? "block" : "none";
  if (els.nvidiaSettingsPane) els.nvidiaSettingsPane.style.display = target === "nvidia" ? "block" : "none";
}

function showNvidiaStatus(msg, type = "ok") {
  if (!els.nvidiaStatusMsg) return;
  els.nvidiaStatusMsg.textContent = msg;
  els.nvidiaStatusMsg.className = `byok-status-msg ${type}`;
  els.nvidiaStatusMsg.style.display = "block";
}

function hideNvidiaStatus() {
  if (els.nvidiaStatusMsg) els.nvidiaStatusMsg.style.display = "none";
}

function initByokModal() {
  if (els.byokApiKeyInput) els.byokApiKeyInput.value = state.userApiKey;
  if (els.nvidiaApiKeyInput) els.nvidiaApiKeyInput.value = state.nvidiaApiKey;
  if (els.nvidiaProxyUrlInput) els.nvidiaProxyUrlInput.value = state.nvidiaProxyUrl;
  if (els.byokModelSelect) {
    for (const opt of els.byokModelSelect.options) {
      if (opt.value && opt.value !== "custom" && !opt.dataset.baseLabel) {
        opt.dataset.baseLabel = opt.textContent;
      }
    }
  }
  if (els.nvidiaModelSelect) {
    for (const opt of els.nvidiaModelSelect.options) {
      if (opt.value && opt.value !== "custom" && !opt.dataset.baseLabel) {
        opt.dataset.baseLabel = opt.textContent;
      }
    }
  }

  els.tabGeminiBtn?.addEventListener("click", () => switchApiModalTab("gemini"));
  els.tabNvidiaBtn?.addEventListener("click", () => switchApiModalTab("nvidia"));

  els.byokBtn?.addEventListener("click", () => {
    const p = els.providerSelect?.value;
    openByokModal(p === "nvidia" ? "nvidia" : "gemini");
  });
  els.closeByokModalBtn?.addEventListener("click", closeByokModal);
  els.byokModal?.addEventListener("click", (e) => {
    if (e.target === els.byokModal) closeByokModal();
  });

  els.reprobeModelsBtn?.addEventListener("click", () => {
    const typedKey = els.byokApiKeyInput?.value.trim() || "";
    probeAllGeminiModelsInBackground({ force: true, apiKeyOverride: typedKey });
  });

  els.reprobeNvidiaModelsBtn?.addEventListener("click", () => {
    const typedKey = els.nvidiaApiKeyInput?.value.trim() || "";
    probeAllNvidiaModelsInBackground({ force: true, apiKeyOverride: typedKey });
  });

  els.nvidiaModelSelect?.addEventListener("change", () => {
    const isCustom = els.nvidiaModelSelect.value === "custom";
    if (els.nvidiaCustomModelInput) {
      els.nvidiaCustomModelInput.style.display = isCustom ? "block" : "none";
      if (isCustom) els.nvidiaCustomModelInput.focus();
    }
  });

  els.toggleNvidiaKeyVisibilityBtn?.addEventListener("click", () => {
    const isPw = els.nvidiaApiKeyInput.type === "password";
    els.nvidiaApiKeyInput.type = isPw ? "text" : "password";
    els.toggleNvidiaKeyVisibilityBtn.textContent = isPw ? "隱藏" : "顯示";
  });

  function resolveSelectedNvidiaModel() {
    if (els.nvidiaModelSelect?.value === "custom") {
      return els.nvidiaCustomModelInput?.value.trim() || "nvidia/nemotron-3-ultra-550b-a55b";
    }
    return els.nvidiaModelSelect?.value || "nvidia/nemotron-3-ultra-550b-a55b";
  }

  els.saveNvidiaKeyBtn?.addEventListener("click", () => {
    const key = els.nvidiaApiKeyInput.value.trim();
    const proxyUrl = (els.nvidiaProxyUrlInput?.value || "").trim().replace(/\/+$/, "");
    const model = resolveSelectedNvidiaModel();
    state.nvidiaApiKey = key;
    state.nvidiaProxyUrl = proxyUrl;
    state.nvidiaModel = model;
    localStorage.setItem("buddhasutra_nvidia_api_key", key);
    localStorage.setItem("buddhasutra_nvidia_proxy_url", proxyUrl);
    localStorage.setItem("buddhasutra_nvidia_model", model);
    showNvidiaStatus(`✓ NVIDIA 金鑰與設定 (${model}) 已獨立儲存至本機瀏覽器！`, "ok");
    updateLlmBadge();
    probeAllNvidiaModelsInBackground({ force: true });
  });

  els.clearNvidiaKeyBtn?.addEventListener("click", () => {
    if (!confirm("確定要清除本機儲存的 NVIDIA API Key 嗎？（不影響 Gemini 金鑰）")) return;
    state.nvidiaApiKey = "";
    localStorage.removeItem("buddhasutra_nvidia_api_key");
    els.nvidiaApiKeyInput.value = "";
    showNvidiaStatus("已清除本機 NVIDIA 金鑰。", "err");
    updateLlmBadge();
    probeAllNvidiaModelsInBackground({ force: true });
  });

  els.testNvidiaKeyBtn?.addEventListener("click", async () => {
    const key = els.nvidiaApiKeyInput.value.trim();
    const proxyUrl = (els.nvidiaProxyUrlInput?.value || "").trim().replace(/\/+$/, "");
    state.nvidiaProxyUrl = proxyUrl;
    const hasBackendKey = state.isBackendAvailable && state.llmStatus?.nvidia?.configured;
    if (!key && !hasBackendKey) {
      showNvidiaStatus("請先輸入 nvapi- 開頭的 NVIDIA API Key 再進行測試。", "err");
      return;
    }
    const testModel = resolveSelectedNvidiaModel();
    showNvidiaStatus(`正在連線 NVIDIA NIM API 測試中 (${testModel})...`, "ok");
    const res = await probeSingleNvidiaModel(testModel, key);
    if (res.ok) {
      if (key) {
        state.nvidiaApiKey = key;
        localStorage.setItem("buddhasutra_nvidia_api_key", key);
      }
      localStorage.setItem("buddhasutra_nvidia_proxy_url", proxyUrl);
      state.nvidiaModel = testModel;
      localStorage.setItem("buddhasutra_nvidia_model", testModel);
      state.nvidiaProbeResults[testModel] = res;
      applyNvidiaProbeOptionLabels();
      showNvidiaStatus(`✓ 連線成功！NVIDIA NIM (${testModel}) 正常運作（${res.latency_ms}ms）。`, "ok");
      updateLlmBadge();
    } else {
      showNvidiaStatus(`❌ 測試失敗：${res.message || res.status}`, "err");
    }
  });

  els.byokModelSelect?.addEventListener("change", () => {
    const isCustom = els.byokModelSelect.value === "custom";
    if (els.byokCustomModelInput) {
      els.byokCustomModelInput.style.display = isCustom ? "block" : "none";
      if (isCustom) els.byokCustomModelInput.focus();
    }
  });

  els.toggleKeyVisibilityBtn?.addEventListener("click", () => {
    const isPw = els.byokApiKeyInput.type === "password";
    els.byokApiKeyInput.type = isPw ? "text" : "password";
    els.toggleKeyVisibilityBtn.textContent = isPw ? "隱藏" : "顯示";
  });

  function resolveSelectedModel() {
    if (els.byokModelSelect?.value === "custom") {
      return els.byokCustomModelInput?.value.trim() || "gemini-3.5-flash-lite";
    }
    return els.byokModelSelect?.value || "gemini-3.5-flash-lite";
  }

  els.saveByokKeyBtn?.addEventListener("click", () => {
    const key = els.byokApiKeyInput.value.trim();
    const model = resolveSelectedModel();
    state.userApiKey = key;
    state.userModel = model;
    localStorage.setItem("buddhasutra_gemini_api_key", key);
    localStorage.setItem("buddhasutra_gemini_model", model);
    showByokStatus(`✓ 金鑰與模型 (${model}) 已儲存至本機瀏覽器 LocalStorage！`, "ok");
    updateLlmBadge();
    probeAllGeminiModelsInBackground({ force: true });
  });

  els.clearByokKeyBtn?.addEventListener("click", () => {
    if (!confirm("確定要清除本機儲存的 Gemini API Key 嗎？")) return;
    state.userApiKey = "";
    localStorage.removeItem("buddhasutra_gemini_api_key");
    els.byokApiKeyInput.value = "";
    showByokStatus("已清除本機金鑰。", "err");
    updateLlmBadge();
    probeAllGeminiModelsInBackground({ force: true });
  });

  els.testByokKeyBtn?.addEventListener("click", async () => {
    const key = els.byokApiKeyInput.value.trim();
    if (!key) {
      showByokStatus("請先輸入 API Key 再進行測試。", "err");
      return;
    }
    const testModel = resolveSelectedModel();
    showByokStatus(`正在連線 Google Gemini API 測試中 (${testModel})...`, "ok");
    try {
      state.userApiKey = key;
      state.userModel = testModel;
      await callDirectGeminiApi("請輸出繁體中文 JSON：{\"status\": \"ok\"}", true, true);
      const actualModel = state.lastUsedModel || testModel;
      localStorage.setItem("buddhasutra_gemini_api_key", key);
      localStorage.setItem("buddhasutra_gemini_model", testModel);
      if (actualModel !== testModel) {
        showByokStatus(
          `✓ 金鑰有效！${testModel} 目前免費配額已滿（429），系統已自動切換至備援模型 ${actualModel} 連線成功！`,
          "ok"
        );
      } else {
        showByokStatus(`✓ 連線成功！Gemini (${actualModel}) 正常運作。`, "ok");
      }
      updateLlmBadge();
    } catch (err) {
      showByokStatus(`❌ 測試失敗：${err.message}`, "err");
    }
  });

  els.exportKbBtn?.addEventListener("click", async () => {
    try {
      const data = await dbHelper.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BuddhaSutra_KB_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`匯出失敗：${err.message}`);
    }
  });

  els.importKbInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await dbHelper.importAll(json);
      alert("✓ 知識庫備份匯入成功！已合併至本機 IndexedDB。");
      await updateKbModalStats();
      if (state.bundle) {
        await loadFascicle(state.currentSutraId, state.currentFascicle);
      }
    } catch (err) {
      alert(`匯入失敗：${err.message}`);
    } finally {
      e.target.value = "";
    }
  });
}

async function openByokModal(initialTab = null) {
  if (els.byokModal) els.byokModal.style.display = "flex";
  if (els.byokApiKeyInput) els.byokApiKeyInput.value = state.userApiKey;
  if (els.nvidiaApiKeyInput) els.nvidiaApiKeyInput.value = state.nvidiaApiKey;
  if (els.nvidiaProxyUrlInput) els.nvidiaProxyUrlInput.value = state.nvidiaProxyUrl;

  switchApiModalTab(initialTab || (els.providerSelect?.value === "nvidia" ? "nvidia" : "gemini"));

  const currentM = state.userModel || "gemini-3.5-flash-lite";
  let hasOption = false;
  if (els.byokModelSelect) {
    for (const opt of els.byokModelSelect.options) {
      if (opt.value === currentM) {
        hasOption = true;
        break;
      }
    }
    if (hasOption) {
      els.byokModelSelect.value = currentM;
      if (els.byokCustomModelInput) els.byokCustomModelInput.style.display = "none";
    } else {
      els.byokModelSelect.value = "custom";
      if (els.byokCustomModelInput) {
        els.byokCustomModelInput.style.display = "block";
        els.byokCustomModelInput.value = currentM;
      }
    }
  }

  const currentNvM = state.nvidiaModel || "nvidia/nemotron-3-ultra-550b-a55b";
  let hasNvOption = false;
  if (els.nvidiaModelSelect) {
    for (const opt of els.nvidiaModelSelect.options) {
      if (opt.value === currentNvM) {
        hasNvOption = true;
        break;
      }
    }
    if (hasNvOption) {
      els.nvidiaModelSelect.value = currentNvM;
      if (els.nvidiaCustomModelInput) els.nvidiaCustomModelInput.style.display = "none";
    } else {
      els.nvidiaModelSelect.value = "custom";
      if (els.nvidiaCustomModelInput) {
        els.nvidiaCustomModelInput.style.display = "block";
        els.nvidiaCustomModelInput.value = currentNvM;
      }
    }
  }

  hideByokStatus();
  hideNvidiaStatus();
  await updateKbModalStats();
}

function closeByokModal() {
  if (els.byokModal) els.byokModal.style.display = "none";
}

function showByokStatus(msg, type = "ok") {
  if (!els.byokStatusMsg) return;
  els.byokStatusMsg.textContent = msg;
  els.byokStatusMsg.className = `byok-status-msg ${type}`;
  els.byokStatusMsg.style.display = "block";
}

function hideByokStatus() {
  if (els.byokStatusMsg) els.byokStatusMsg.style.display = "none";
}

async function updateKbModalStats() {
  if (!els.kbStorageStats) return;
  const stats = await dbHelper.getStats();
  els.kbStorageStats.textContent = `本機 IndexedDB 目前已存：${stats.translations} 筆經句翻譯、${stats.commentary_guides} 筆古大德白話導讀。`;
}

function toggleMasterPopup() {
  const isOpen = els.masterPopupMenu.style.display !== "none";
  if (isOpen) {
    closeMasterPopup();
  } else {
    els.masterPopupMenu.style.display = "flex";
    els.masterPickerBtn.classList.add("open");
  }
}

function closeMasterPopup() {
  els.masterPopupMenu.style.display = "none";
  els.masterPickerBtn.classList.remove("open");
}

async function loadLlmStatus() {
  const savedProvider = localStorage.getItem("buddhasutra_llm_provider");
  if (state.isBackendAvailable) {
    try {
      state.llmStatus = await apiJson("/api/llm/status");
      if (savedProvider && ["gemini", "nvidia", "ollama"].includes(savedProvider)) {
        els.providerSelect.value = savedProvider;
      } else if (state.llmStatus.default_provider) {
        els.providerSelect.value = state.llmStatus.default_provider;
      }
      updateLlmBadge();
      return;
    } catch {
      state.isBackendAvailable = false;
    }
  }

  // 純前端 BYOK 模式
  if (savedProvider && ["gemini", "nvidia"].includes(savedProvider)) {
    els.providerSelect.value = savedProvider;
  }
  state.llmStatus = {
    default_provider: els.providerSelect.value || "gemini",
    gemini: {
      configured: Boolean(state.userApiKey),
      model: state.userModel,
    },
    nvidia: {
      configured: Boolean(state.nvidiaApiKey),
      model: state.nvidiaModel,
    },
    ollama: { reachable: false },
  };
  updateLlmBadge();
}

function updateLlmBadge() {
  const p = els.providerSelect.value;

  if (p === "nvidia") {
    const shortNvModel = (state.nvidiaModel || state.llmStatus?.nvidia?.model || "nemotron-3-ultra-550b-a55b")
      .split("/")
      .pop();
    const configured = Boolean(state.nvidiaApiKey) || (state.isBackendAvailable && state.llmStatus?.nvidia?.configured);
    if (configured) {
      els.llmStatusBadge.textContent = `🔑 NVIDIA 就緒 (${shortNvModel})`;
      els.llmStatusBadge.className = "status-pill status-ok status-btn";
      els.llmStatusBadge.title = `NVIDIA NIM 模型：${state.nvidiaModel}，點擊可設定獨立金鑰、切換模型與管理知識庫`;
    } else {
      els.llmStatusBadge.textContent = "🔑 請設定 NVIDIA API Key";
      els.llmStatusBadge.className = "status-pill status-warn status-btn";
      els.llmStatusBadge.title = "點擊開啟「🟢 NVIDIA NIM API」設定獨立金鑰（nvapi-...）";
    }
    return;
  }

  if (!state.isBackendAvailable) {
    if (p === "ollama") {
      els.llmStatusBadge.textContent = "🔑 Ollama 僅限本機模式";
      els.llmStatusBadge.className = "status-pill status-warn status-btn";
      els.llmStatusBadge.title = "雲端純前端模式無法連線本機 Ollama，點擊可設定 Gemini 或 NVIDIA 金鑰";
      return;
    }
    if (state.userApiKey) {
      els.llmStatusBadge.textContent = `🔑 Gemini 就緒 (${state.userModel}・BYOK)`;
      els.llmStatusBadge.className = "status-pill status-ok status-btn";
      els.llmStatusBadge.title = "已設定個人本機 API Key，點擊可重設、測試或備份知識庫";
    } else {
      els.llmStatusBadge.textContent = "🔑 請設定 Gemini API Key";
      els.llmStatusBadge.className = "status-pill status-warn status-btn";
      els.llmStatusBadge.title = "點擊填入個人 Gemini API Key 即可開啟 AI 白話翻譯";
    }
    return;
  }

  if (!state.llmStatus) return;
  if (p === "gemini") {
    const configured = state.llmStatus.gemini.configured || Boolean(state.userApiKey);
    if (configured) {
      const m = state.userModel || state.llmStatus.gemini.model;
      els.llmStatusBadge.textContent = `🔑 Gemini 就緒 (${m})`;
      els.llmStatusBadge.className = "status-pill status-ok status-btn";
      els.llmStatusBadge.title = "點擊可管理 API Key、切換模型與備份知識庫";
    } else {
      els.llmStatusBadge.textContent = "🔑 請設定 Gemini API Key";
      els.llmStatusBadge.className = "status-pill status-warn status-btn";
      els.llmStatusBadge.title = "點擊設定 Gemini API Key";
    }
  } else {
    if (state.llmStatus.ollama.reachable) {
      const m = state.llmStatus.ollama.available_models[0] || state.llmStatus.ollama.default_model;
      els.llmStatusBadge.textContent = `🔑 Ollama 就緒 (${m})`;
      els.llmStatusBadge.className = "status-pill status-ok status-btn";
      els.llmStatusBadge.title = "點擊可管理 API 設定與本機知識庫";
    } else {
      els.llmStatusBadge.textContent = "🔑 Ollama 本機未啟動";
      els.llmStatusBadge.className = "status-pill status-warn status-btn";
      els.llmStatusBadge.title = "本機 Ollama 未啟動，點擊可改設定 Gemini / NVIDIA API Key";
    }
  }
}

// ---------- 目錄樹 ----------
async function loadCatalog() {
  if (state.isBackendAvailable) {
    try {
      state.catalog = await apiJson("/api/catalog");
      renderCatalogTree("");
      return;
    } catch {
      state.isBackendAvailable = false;
    }
  }

  // 純前端模式：讀取 ./data/catalog.json（帶版本號避免命中舊版 1 小時 CDN/瀏覽器快取）
  try {
    const res = await fetch("./data/catalog.json?v=20261128w", { cache: "no-cache" });
    state.catalog = await res.json();
    renderCatalogTree("");
  } catch (err) {
    els.catalogTree.innerHTML = `<div class="error-box">⚠️ 載入目錄失敗：${escapeHtml(err.message)}</div>`;
  }
}

function renderCatalogTree(query) {
  if (!state.catalog) return;
  const q = query.toLowerCase();
  const frag = document.createDocumentFragment();

  state.catalog.divisions.forEach((div) => {
    const matchingSutras = div.sutras.filter(
      (s) => !q || s.title.toLowerCase().includes(q) || s.sutra_id.toLowerCase().includes(q)
    );
    const divMatch = !q || div.name.toLowerCase().includes(q) || matchingSutras.length > 0;
    if (!divMatch) return;

    const divEl = document.createElement("div");
    const hasAvail = div.sutras.some((s) => s.status === "available" || s.sutra_id === state.currentSutraId);
    divEl.className = "division-item" + (hasAvail || q ? " open" : "");

    const btn = document.createElement("button");
    btn.className = "division-btn";
    btn.innerHTML = `<span>▸ ${escapeHtml(div.name)}</span><span class="division-vol">${escapeHtml(div.volumes)}</span>`;
    btn.addEventListener("click", () => divEl.classList.toggle("open"));
    divEl.appendChild(btn);

    const listEl = document.createElement("div");
    listEl.className = "sutra-list";

    const sutrasToShow = q && !div.name.toLowerCase().includes(q) ? matchingSutras : div.sutras;
    if (sutrasToShow.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "font-size:12px;color:#8b8172;padding:3px 8px;";
      empty.textContent = "（目錄結構已預留）";
      listEl.appendChild(empty);
    }

    sutrasToShow.forEach((sutra) => {
      const node = document.createElement("div");
      node.className = "sutra-node";

      const sBtn = document.createElement("button");
      const hasCbetaId = /^[A-Z]+\d+n\d+[A-Za-z]?$/.test(sutra.sutra_id || "");
      const isAvail = sutra.status === "available" || (sutra.local_fascicles?.length > 0);
      sBtn.className =
        "sutra-btn" +
        (isAvail || hasCbetaId ? "" : " planned") +
        (sutra.sutra_id === state.currentSutraId ? " active" : "");

      const badge = isAvail
        ? `<span class="badge-avail">可閱讀</span>`
        : hasCbetaId
          ? `<span class="badge-cbeta">CBETA</span>`
          : `<span class="badge-planned">建置中</span>`;

      const isActiveSutra = sutra.sutra_id === state.currentSutraId;
      const cbetaLabel = isActiveSutra
        ? `${sutra.sutra_id}_${String(state.currentFascicle).padStart(3, "0")}`
        : sutra.sutra_id;
      sBtn.innerHTML = `<span>${escapeHtml(sutra.title)} <span class="sidebar-cbeta-code">${escapeHtml(cbetaLabel)}</span></span>${badge}`;
      sBtn.title = `${sutra.sutra_id}｜${sutra.translator}（共 ${sutra.fascicle_count} 卷）`;

      sBtn.addEventListener("click", () => {
        if (!isAvail && !/^[A-Z]+\d+n\d+[A-Za-z]?$/.test(sutra.sutra_id || "")) {
          alert(`《${sutra.title}》（${sutra.sutra_id}）尚無對應 CBETA 編號。`);
          return;
        }
        loadFascicle(sutra.sutra_id, 1);
      });
      node.appendChild(sBtn);

      if (isAvail && sutra.available_fascicles?.length) {
        const fList = document.createElement("div");
        fList.className = "fascicle-list";
        const localNums = sutra.local_fascicles?.length
          ? [...sutra.local_fascicles].sort((a, b) => a - b)
          : [1];
        localNums.forEach((fNum) => {
          const fBtn = document.createElement("button");
          fBtn.className =
            "fascicle-btn" +
            (sutra.sutra_id === state.currentSutraId && fNum === state.currentFascicle ? " active" : "");
          fBtn.textContent = `卷第 ${fNum}（已入庫）`;
          fBtn.addEventListener("click", () => loadFascicle(sutra.sutra_id, fNum));
          fList.appendChild(fBtn);
        });
        node.appendChild(fList);
      }

      listEl.appendChild(node);
    });

    divEl.appendChild(listEl);
    frag.appendChild(divEl);
  });

  els.catalogTree.innerHTML = "";
  els.catalogTree.appendChild(frag);
}

function closeKbSearchDropdown() {
  els.kbSearchDropdown.style.display = "none";
}

function scheduleKbIndexSearch(query) {
  if (state.kbSearchTimer) {
    clearTimeout(state.kbSearchTimer);
    state.kbSearchTimer = null;
  }
  if (!query || query.length < 2) {
    closeKbSearchDropdown();
    return;
  }
  state.kbSearchTimer = setTimeout(async () => {
    try {
      if (state.isBackendAvailable) {
        const data = await apiJson(`/api/kb/search?q=${encodeURIComponent(query)}&limit=18`);
        if (els.searchInput.value.trim() !== query) return;
        renderKbSearchDropdown(data);
      } else {
        // 純前端索引搜尋
        searchClientKb(query);
      }
    } catch {
      closeKbSearchDropdown();
    }
  }, 250);
}

function searchClientKb(query) {
  const q = query.trim().toLowerCase();
  const translations = [];
  const sentences = [];

  // 1. 當前卷已譯句子
  if (state.bundle?.translations) {
    for (const [sid, entry] of Object.entries(state.bundle.translations)) {
      const activeVer = entry.versions?.[0] || {};
      const c = activeVer.content || {};
      const fullText = (entry.source_text || "") + (c.colloquial_translation || "") + (c.literal_translation || "");
      if (fullText.toLowerCase().includes(q)) {
        translations.push({
          sutra_id: state.currentSutraId,
          sutra_title: state.bundle.sutra?.sutra_title || state.currentSutraId,
          fascicle: state.currentFascicle,
          sentence_id: sid,
          source_text: entry.source_text || "",
          colloquial_translation: c.colloquial_translation || "",
          provider: activeVer.provider || "Gemini",
        });
      }
    }
  }

  // 2. 當前卷原文
  if (state.bundle?.sutra?.paragraphs) {
    for (const p of state.bundle.sutra.paragraphs) {
      for (const s of p.sentences || []) {
        if (s.text && s.text.toLowerCase().includes(q)) {
          sentences.push({
            sutra_id: state.currentSutraId,
            sutra_title: state.bundle.sutra?.sutra_title || state.currentSutraId,
            fascicle: state.currentFascicle,
            sentence_id: s.sentence_id,
            para_index: p.index,
            text: s.text,
          });
        }
      }
    }
  }

  renderKbSearchDropdown({
    query,
    glossary: [],
    translations: translations.slice(0, 10),
    sentences: sentences.slice(0, 10),
    total: translations.length + sentences.length,
  });
}

function renderKbSearchDropdown(data) {
  const { query, glossary = [], translations = [], sentences = [], total = 0 } = data || {};
  if (!query || query.length < 2) {
    closeKbSearchDropdown();
    return;
  }

  let html = `<div class="kb-search-head">全庫索引檢索「${escapeHtml(query)}」・共 ${total} 筆（點擊跳轉）</div>`;

  if (total === 0) {
    html += `<div class="kb-search-empty">本地知識庫尚無符合「${escapeHtml(query)}」的經句、譯文或名相。</div>`;
    els.kbSearchDropdown.innerHTML = html;
    els.kbSearchDropdown.style.display = "block";
    return;
  }

  if (glossary.length) {
    html += `<div class="kb-search-group-title">佛學名相（${glossary.length}）</div>`;
    glossary.slice(0, 6).forEach((g) => {
      const f = g.first_seen_fascicle || 1;
      html += `
        <button type="button" class="kb-search-item" data-sutra="${escapeHtml(g.sutra_id)}" data-fascicle="${f}">
          <div class="kb-search-meta">${escapeHtml(g.term)}｜${escapeHtml(g.sutra_title)}（卷${f}）</div>
          <div class="kb-search-snippet">${escapeHtml(g.explanation)}</div>
        </button>`;
    });
  }

  if (translations.length) {
    html += `<div class="kb-search-group-title">已存 AI 譯文（${translations.length}）</div>`;
    translations.slice(0, 6).forEach((t) => {
      html += `
        <button type="button" class="kb-search-item" data-sutra="${escapeHtml(t.sutra_id)}" data-fascicle="${t.fascicle}" data-sid="${escapeHtml(t.sentence_id)}">
          <div class="kb-search-meta">${escapeHtml(t.sutra_title)} 卷${t.fascicle}｜${escapeHtml(t.provider)}</div>
          <div class="kb-search-snippet">${escapeHtml(t.source_text)} → ${escapeHtml((t.colloquial_translation || "").slice(0, 65))}</div>
        </button>`;
    });
  }

  if (sentences.length) {
    html += `<div class="kb-search-group-title">已入庫經文（${sentences.length}）</div>`;
    sentences.slice(0, 6).forEach((s) => {
      html += `
        <button type="button" class="kb-search-item" data-sutra="${escapeHtml(s.sutra_id)}" data-fascicle="${s.fascicle}" data-sid="${escapeHtml(s.sentence_id)}">
          <div class="kb-search-meta">${escapeHtml(s.sutra_title)} 卷${s.fascicle} 第${s.para_index}段</div>
          <div class="kb-search-snippet">${escapeHtml(s.text)}</div>
        </button>`;
    });
  }

  els.kbSearchDropdown.innerHTML = html;
  els.kbSearchDropdown.style.display = "block";

  els.kbSearchDropdown.querySelectorAll(".kb-search-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sutraId = btn.dataset.sutra;
      const fascicle = parseInt(btn.dataset.fascicle || "1", 10);
      const sid = btn.dataset.sid || null;
      jumpToSearchResult(sutraId, fascicle, sid);
    });
  });
}

async function jumpToSearchResult(sutraId, fascicle, sentenceId = null) {
  closeKbSearchDropdown();
  if (sutraId === state.currentSutraId && fascicle === state.currentFascicle) {
    if (sentenceId) {
      state.lockedSentenceId = sentenceId;
      state.activeSentenceId = sentenceId;
      syncSentenceHighlight();
      renderAnalysisPanel();
      alignCommentaryToSentence(sentenceId);
      const el = document.querySelector(`[data-sentence-id="${CSS.escape(sentenceId)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }
  await loadFascicle(sutraId, fascicle, sentenceId);
}

function getCurrentTranslationPath() {
  if (!state.isBackendAvailable) {
    return `本機 IndexedDB (個人儲存) / ${state.currentSutraId} 卷${state.currentFascicle}`;
  }
  return state.bundle?.storage_paths?.translation_file || "translation_kb/canons/...";
}

let _mastersRegistryCache = null;

async function getMastersRegistryClient() {
  if (_mastersRegistryCache) return _mastersRegistryCache;
  try {
    const res = await fetch("./data/masters_registry.json?v=20261128w", { cache: "no-cache" });
    if (res.ok) {
      _mastersRegistryCache = await res.json();
      return _mastersRegistryCache;
    }
  } catch {}
  return { masters: [] };
}

function findCatalogSutraMeta(sutraId) {
  for (const div of state.catalog?.divisions || []) {
    const found = (div.sutras || []).find((s) => s.sutra_id === sutraId);
    if (found) return found;
  }
  return null;
}

function splitSentencesZhClient(text) {
  const cleaned = String(text || "")
    .replace(/\[\*\]|\[＊\]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/(?<=[。；？！][」』）]?)(?![」』）])/);
  const result = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (result.length && /^[」』）”。；？！，、：]+$/.test(p)) {
      result[result.length - 1] += p;
    } else {
      result.push(p);
    }
  }
  return result;
}

async function fetchSutraFascicleFromGitHubClient(sutraId, fascicle) {
  const m = String(sutraId || "").trim().match(/^([A-Z]+)(\d+)n\d+[A-Za-z]?$/);
  if (!m) {
    throw new Error(`無法推導 CBETA GitHub 路徑：${sutraId}`);
  }
  const canon = m[1];
  const vol = `${m[1]}${m[2]}`;
  const url = `https://raw.githubusercontent.com/cbeta-git/xml-p5a/master/${canon}/${vol}/${sutraId}.xml`;

  let xmlText = _githubXmlCache.get(sutraId);
  if (!xmlText) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`從 CBETA GitHub 下載經文失敗（HTTP ${res.status}）`);
    xmlText = await res.text();
    _githubXmlCache.set(sutraId, xmlText);
  }

  const rawParas = extractJuanFromXmlP5aClient(xmlText, fascicle, sutraId);
  if (!rawParas.length) {
    throw new Error(`CBETA (${sutraId}) 查無第 ${fascicle} 卷內容`);
  }

  const paragraphs = [];
  for (const rp of rawParas) {
    const paraId = `${sutraId}_${String(fascicle).padStart(3, "0")}_p${String(paragraphs.length + 1).padStart(4, "0")}`;
    const sents = rp.type === "heading" ? [rp.text] : splitSentencesZhClient(rp.text);
    if (!sents.length) continue;
    paragraphs.push({
      paragraph_id: paraId,
      index: paragraphs.length + 1,
      type: rp.type,
      sentences: sents.map((sText, idx) => ({
        sentence_id: `${paraId}_s${String(idx + 1).padStart(3, "0")}`,
        index: idx + 1,
        text: sText,
      })),
    });
  }

  const meta = findCatalogSutraMeta(sutraId);
  return {
    schema_version: "1.0",
    source: `CBETA GitHub xml-p5a (${sutraId}.xml)`,
    sutra_id: sutraId,
    sutra_title: meta?.title || sutraId,
    edition: `${meta?.fascicle_count || fascicle}卷本`,
    translator: meta?.translator || "",
    fascicle,
    fascicle_count: Number(meta?.fascicle_count) || fascicle,
    fascicle_title: `卷第${fascicle}`,
    paragraphs,
  };
}

async function buildClientBundleFromSutra(sutraId, fascicle, sutraObj, fetchedFromCbeta) {
  const meta = findCatalogSutraMeta(sutraId);
  const registry = await getMastersRegistryClient();
  const masters = (registry.masters || []).filter(
    (m) => m.sutra_id === sutraId || (Array.isArray(m.applicable_sutras) && m.applicable_sutras.includes(sutraId))
  );
  const customNums = await dbHelper.listCustomFascicles(sutraId).catch(() => []);
  const existingLocal = meta?.local_fascicles || [];
  const mergedLocal = Array.from(new Set([...existingLocal, ...customNums, fascicle])).sort((a, b) => a - b);

  return {
    sutra: sutraObj,
    masters,
    commentaries: {},
    translations: {},
    fascicle_count: Number(sutraObj.fascicle_count || meta?.fascicle_count || fascicle),
    local_fascicles: mergedLocal,
    fetched_from_cbeta: fetchedFromCbeta,
  };
}

let _cbetaToastTimer = null;

function hideCbetaToast() {
  if (_cbetaToastTimer) {
    clearInterval(_cbetaToastTimer);
    _cbetaToastTimer = null;
  }
  if (els.cbetaToast) els.cbetaToast.style.display = "none";
}

function showCbetaToast(baseMsg, seconds = 5) {
  hideCbetaToast();
  if (!els.cbetaToast) return;
  let remaining = seconds;
  els.cbetaToast.textContent = `${baseMsg}（${remaining} 秒後自動關閉）`;
  els.cbetaToast.style.display = "block";
  _cbetaToastTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      hideCbetaToast();
    } else if (els.cbetaToast) {
      els.cbetaToast.textContent = `${baseMsg}（${remaining} 秒後自動關閉）`;
    }
  }, 1000);
}

// ---------- 載入經卷 ----------
async function loadFascicle(sutraId, fascicle, targetSentenceId = null) {
  stopSutraTts();
  const sutraChanged = state.currentSutraId !== sutraId;
  state.currentSutraId = sutraId;
  state.currentFascicle = fascicle;
  state.activeSentenceId = null;
  state.lockedSentenceId = null;
  state.commCursorIdx = 0;
  state.commAlignedIdx = null;
  state.commMatchedPhrase = null;
  hideCbetaToast();

  els.sutraContent.innerHTML = `
    <div class="empty-state">
      <p class="empty-title">載入 ${escapeHtml(sutraId)} 第 ${fascicle} 卷中...</p>
      <p class="empty-desc">首次開啟未預載卷次將自動從 CBETA 官方鏡像下載並存於瀏覽器本機。</p>
    </div>`;

  let bundle;
  if (state.isBackendAvailable) {
    try {
      bundle = await apiJson(`/api/sutras/${sutraId}/fascicles/${fascicle}`);
    } catch (err) {
      state.isBackendAvailable = false;
    }
  }

  if (!bundle) {
    // Tier 1：優先讀取已預載的靜態 Bundle
    try {
      const res = await fetch(`./data/bundles/${sutraId}_${fascicle}.json`);
      if (res.ok) {
        bundle = await res.json();
        const customNums = await dbHelper.listCustomFascicles(sutraId).catch(() => []);
        if (customNums.length) {
          bundle.local_fascicles = Array.from(
            new Set([...(bundle.local_fascicles || []), ...customNums])
          ).sort((a, b) => a - b);
        }
      }
    } catch {}

    // Tier 2：讀取瀏覽器 IndexedDB 已快取的自載經卷
    if (!bundle) {
      try {
        const cachedSutra = await dbHelper.getCustomFascicle(sutraId, fascicle);
        if (cachedSutra) {
          bundle = await buildClientBundleFromSutra(sutraId, fascicle, cachedSutra, false);
        }
      } catch {}
    }

    // Tier 3：自動從 CBETA 官方 GitHub (xml-p5a) 即時下載解析並存入 IndexedDB
    if (!bundle) {
      try {
        els.sutraContent.innerHTML = `
          <div class="empty-state">
            <p class="empty-title">正在從 CBETA 官方鏡像下載 ${escapeHtml(sutraId)} 第 ${fascicle} 卷...</p>
            <p class="empty-desc">下載完成後將自動斷句並永久快取於本機瀏覽器 IndexedDB，下次開啟 0ms 秒開。</p>
          </div>`;
        const fetchedSutra = await fetchSutraFascicleFromGitHubClient(sutraId, fascicle);
        await dbHelper.saveCustomFascicle(sutraId, fascicle, fetchedSutra).catch(() => {});
        bundle = await buildClientBundleFromSutra(sutraId, fascicle, fetchedSutra, true);
      } catch (err) {
        els.sutraContent.innerHTML = `<div class="error-box">⚠️ 載入第 ${fascicle} 卷失敗：${escapeHtml(err.message)}</div>`;
        return;
      }
    }

    // 疊加本機 IndexedDB 中使用者個人的翻譯
    try {
      const localTrans = await dbHelper.getTranslationsForFascicle(sutraId, fascicle);
      bundle.translations = { ...(bundle.translations || {}), ...localTrans };
    } catch {
      // IndexedDB 若失敗不阻塞基本經文閱讀
    }
  }

  state.bundle = bundle;

  if (bundle.fetched_from_cbeta) {
    showCbetaToast(
      `✓ 已自動從 CBETA 下載「${bundle.sutra.sutra_title}」第 ${fascicle} 卷，並永久存入本地知識庫！`,
      5
    );
  }

  // 以本次 bundle 回傳的最新已入庫卷次，即時同步左側目錄樹
  syncCatalogLocalFascicles(sutraId, bundle.local_fascicles);

  // 決定預設精讀的單一古大德
  const validIds = new Set((bundle.masters || []).map((m) => m.master_id));
  if (sutraChanged || !state.selectedMasterId || !validIds.has(state.selectedMasterId)) {
    const defMaster = (bundle.masters || []).find((m) => m.default_selected) || (bundle.masters || [])[0];
    state.selectedMasterId = defMaster ? defMaster.master_id : null;
  }

  renderFascicleSwitcher();
  updateKbStats();
  renderCatalogTree(els.searchInput.value.trim());
  renderMastersChips();
  renderSutraContent();

  if (targetSentenceId) {
    state.activeSentenceId = targetSentenceId;
    state.lockedSentenceId = targetSentenceId;
    renderAnalysisPanel();
    syncSentenceHighlight();
    const targetEl = document.querySelector(`[data-sentence-id="${CSS.escape(targetSentenceId)}"]`);
    if (targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    const firstCachedId = Object.keys(bundle.translations || {})[0];
    if (firstCachedId) {
      state.activeSentenceId = firstCachedId;
      renderAnalysisPanel();
      syncSentenceHighlight();
    } else {
      renderAnalysisPanel();
    }
    els.sutraContent.scrollTop = 0;
  }

  // 手機版選完經文／卷次後自動收起左側目錄抽屜並切回經文頁
  if (isMobileViewport()) {
    toggleMobileDrawer(false);
    mobileUiState.sentenceBarDismissedId = null;
    setMobileTab("sutra");
  }

  // 同步載入所選古大德的對應整卷註疏全文；若此經尚無收錄古大德則清空舊註疏並提供 CBETA 動態搜尋（方案 B）
  if (state.selectedMasterId) {
    await loadCommentaryFulltext(state.selectedMasterId, null);
  } else {
    state.commFull = null;
    state.commCursorIdx = 0;
    state.commAlignedIdx = null;
    state.commMatchedPhrase = null;
    const sutraTitleStr = bundle.sutra?.sutra_title || sutraId;
    els.commMasterTitle.textContent = "本經尚無預錄古大德註疏";
    els.commAlignBadge.textContent = "可線上搜尋";
    els.commAlignBadge.className = "align-badge hold";
    els.commJuanSelect.innerHTML = "";
    els.prevCommJuanBtn.disabled = true;
    els.nextCommJuanBtn.disabled = true;
    els.commFullBody.innerHTML = `
      <div class="empty-state" style="padding:24px;">
        <p class="empty-title" style="font-size:14px;">《${escapeHtml(sutraTitleStr)}》尚未預錄古大德註疏</p>
        <p class="empty-desc" style="font-size:12.5px;margin:0 0 12px;">可點擊下方按鈕即時向 CBETA 檢索相關古大德註疏並直接載入閱讀；左側經文、朗讀與 AI 白話翻譯均可正常使用。</p>
        <button id="searchCbetaCommBtn" type="button" class="primary-btn">🔍 向 CBETA 搜尋相關古大德註疏</button>
        <div id="cbetaDynamicMastersList" style="margin-top:12px;text-align:left;"></div>
      </div>`;
    document.getElementById("searchCbetaCommBtn")?.addEventListener("click", () => {
      searchDynamicCbetaCommentaries(sutraId, sutraTitleStr);
    });
  }
}

async function searchDynamicCbetaCommentaries(sutraId, sutraTitle) {
  const btn = document.getElementById("searchCbetaCommBtn");
  const listEl = document.getElementById("cbetaDynamicMastersList");
  if (!listEl) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "搜尋 CBETA 註疏中...";
  }

  // 擷取經名核心關鍵字（去掉括號、佛說、大方廣等前綴以提高命中率）
  const keyword = String(sutraTitle || "")
    .replace(/（.*?）|\(.*?\)/g, "")
    .replace(/^(?:佛說|大方廣|大佛頂|大方等|佛垂般)/, "")
    .replace(/經$/, "")
    .trim()
    .slice(0, 6);

  try {
    const url = `https://cbdata.dila.edu.tw/stable/works?q=${encodeURIComponent(keyword || sutraTitle)}&rows=30`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CBETA 檢索失敗（HTTP ${res.status}）`);
    const data = await res.json();
    const rawList = data.results || [];
    const filtered = rawList.filter((w) => {
      const wid = w.work || "";
      const title = w.title || "";
      if (wid === sutraId.replace(/^[A-Z]+\d+n/, (m) => m[0])) return false;
      const isCommCanon = /^X/.test(wid) || /^T1[6-9]\d\d|^T2[0-9]\d\d/.test(wid);
      const isCommTitle = /(?:疏|註|注|解|記|論|義|鈔|直說|要解|通義|玄贊|文句|科註|略疏)/.test(title);
      return isCommCanon && isCommTitle;
    });

    if (!filtered.length) {
      listEl.innerHTML = `<p style="font-size:12.5px;color:#766a59;text-align:center;">CBETA 未檢索到「${escapeHtml(keyword)}」相關古註疏，您仍可直接點選左側經句使用 AI 白話翻譯。</p>`;
      return;
    }

    listEl.innerHTML = `<div style="font-size:12px;color:#6b411c;font-weight:600;margin-bottom:6px;">找到 ${filtered.length} 部相關古註疏（點選立即載入）：</div>`;
    filtered.slice(0, 12).forEach((w) => {
      const workCode = w.work || "";
      const vol = w.vol || "";
      const cbetaId = vol && workCode ? `${vol}n${workCode.replace(/^[A-Z]+/, "").padStart(4, "0")}` : workCode;
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "master-popup-item";
      itemBtn.style.border = "1px solid #e4dccb";
      itemBtn.style.marginBottom = "6px";
      itemBtn.style.background = "#fffdf8";
      itemBtn.innerHTML = `
        <div class="master-popup-row1">
          <span>${escapeHtml(w.byline || "古大德")} 《${escapeHtml(w.title || workCode)}》</span>
          <span class="chip-tag">${escapeHtml(cbetaId)}・${escapeHtml(w.juan || 1)}卷</span>
        </div>`;
      itemBtn.addEventListener("click", () => {
        const dynMaster = {
          master_id: `cbeta_dyn_${workCode}`,
          sutra_id: sutraId,
          dynasty: "",
          name: w.byline || "古大德",
          work_title: `《${w.title || workCode}》`,
          cbeta_id: cbetaId,
          primary_work: workCode,
          total_juans: Number(w.juan) || 1,
          target_edition: sutraId,
          target_edition_label: "CBETA 動態檢索",
          description: "即時檢索自 CBETA 線上典籍庫",
        };
        state.bundle.masters = state.bundle.masters || [];
        if (!state.bundle.masters.some((m) => m.master_id === dynMaster.master_id)) {
          state.bundle.masters.push(dynMaster);
        }
        state.selectedMasterId = dynMaster.master_id;
        renderMastersChips();
        loadCommentaryFulltext(dynMaster.master_id, null);
      });
      listEl.appendChild(itemBtn);
    });
  } catch (err) {
    const msg = /failed to fetch|networkerror/i.test(err?.message || "")
      ? "CBETA 線上檢索端點（cbdata.dila.edu.tw）目前不允許純前端瀏覽器跨域查詢（CORS）或暫時無回應；已收錄之 17 部核心經論（含法華、華嚴、楞嚴、金剛、心經、淨土三經等）古大德皆會自動從 GitHub 鏡像載入。"
      : err.message;
    listEl.innerHTML = `<div class="error-box">⚠️ ${escapeHtml(msg)}</div>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔍 重新搜尋 CBETA 註疏";
    }
  }
}

function syncCatalogLocalFascicles(sutraId, localFascicles) {
  if (!state.catalog || !Array.isArray(localFascicles)) return;
  for (const div of state.catalog.divisions || []) {
    const s = (div.sutras || []).find((x) => x.sutra_id === sutraId);
    if (s) {
      s.local_fascicles = [...localFascicles];
      if (localFascicles.length > 0) {
        s.status = "available";
        s.available_fascicles = Array.from(
          new Set([...(s.available_fascicles || []), ...localFascicles])
        ).sort((a, b) => a - b);
      }
      return;
    }
  }
}

function renderFascicleSwitcher() {
  if (!state.bundle) return;
  const total = state.bundle.fascicle_count || 1;
  const localSet = new Set(state.bundle.local_fascicles || []);
  els.fascicleSelect.innerHTML = "";
  for (let i = 1; i <= total; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `卷第 ${i} / ${total}${localSet.has(i) ? "（✓ 本地）" : "（CBETA）"}`;
    if (i === state.currentFascicle) opt.selected = true;
    els.fascicleSelect.appendChild(opt);
  }
  els.prevFascicleBtn.disabled = state.currentFascicle <= 1;
  els.nextFascicleBtn.disabled = state.currentFascicle >= total;
}

function updateKbStats() {
  if (!state.bundle) return;
  let totalSent = 0;
  (state.bundle.sutra?.paragraphs || []).forEach((p) => {
    if (p.type === "prose") totalSent += (p.sentences || []).length;
  });
  const cachedCount = Object.keys(state.bundle.translations || {}).length;
  els.kbStatsBadge.textContent = `本卷知識庫 ${cachedCount} / ${totalSent} 句`;
}

// ---------- 古大德 Pop-up 選單 ----------
function renderMastersChips() {
  if (!state.bundle) return;
  els.mastersChips.innerHTML = "";

  (state.bundle.masters || []).forEach((m) => {
    const item = document.createElement("button");
    const isSel = m.master_id === state.selectedMasterId;
    item.type = "button";
    item.className = "master-popup-item" + (isSel ? " selected" : "");
    item.innerHTML = `
      <div class="master-popup-row1">
        <span>${isSel ? "✓ " : ""}${escapeHtml(m.dynasty)}・${escapeHtml(m.name)} ${escapeHtml(m.work_title)}</span>
        <span class="chip-tag">${escapeHtml(m.target_edition_label)}</span>
      </div>
      <div class="master-popup-desc">${escapeHtml(m.description)}（共 ${escapeHtml(m.total_juans || "?")} 卷）</div>
    `;
    item.addEventListener("click", () => {
      closeMasterPopup();
      if (state.selectedMasterId === m.master_id) return;
      state.selectedMasterId = m.master_id;
      state.commCursorIdx = 0;
      state.commAlignedIdx = null;
      state.commMatchedPhrase = null;
      renderMastersChips();
      loadCommentaryFulltext(m.master_id, null);
    });
    els.mastersChips.appendChild(item);
  });
}

// ---------- 載入古大德整卷註疏全文 ----------
let _commIndexCache = null;
const _githubXmlCache = new Map();

const GAIJI_MAP = {
  "[□@(?╳)]": "▩",
  "[□@(?○)]": "▣",
  "[△@○]": "▲",
  "[○@△]": "▲",
  "[○@□]": "▣",
  "[□@○]": "▣",
  "[╳]": "❖",
  "[△]": "△",
  "[○]": "○",
  "[□]": "□",
  "[◇]": "◇",
  "[◎]": "◎",
  "[●]": "●",
};

function normalizeGaijiClient(text) {
  let out = String(text || "");
  for (const [k, v] of Object.entries(GAIJI_MAP)) {
    if (out.includes(k)) out = out.split(k).join(v);
  }
  out = out.replace(/\[[□△○◇◎●╳@(?/)\s]+\]/g, "◈");
  return out;
}

async function getCommIndex() {
  if (_commIndexCache) return _commIndexCache;
  try {
    const res = await fetch("./data/commentaries_index.json");
    if (res.ok) {
      _commIndexCache = await res.json();
      return _commIndexCache;
    }
  } catch {}
  _commIndexCache = { local_juans: {}, default_juan_map: {} };
  return _commIndexCache;
}

function resolveClientCommentaryJuan(masterMeta, sutraFascicle, sutraTotal, commIndex) {
  const mid = masterMeta?.master_id || "";
  const mapped = commIndex?.default_juan_map?.[mid]?.[String(sutraFascicle)];
  if (mapped) return mapped;

  const totalComm = Number(masterMeta?.total_juans) || 1;
  if (mid === "chengguan_shuchao") {
    return Math.max(4, Math.min(totalComm, Math.round(4 + ((sutraFascicle - 1) * (totalComm - 4)) / Math.max(1, sutraTotal - 1))));
  }
  if (mid === "chengguan_yanyichao") {
    return Math.max(5, Math.min(totalComm, Math.round(5 + ((sutraFascicle - 1) * (totalComm - 5)) / Math.max(1, sutraTotal - 1))));
  }
  if (totalComm === sutraTotal) {
    return Math.max(1, Math.min(totalComm, sutraFascicle));
  }
  const ratio = (sutraFascicle - 0.5) / Math.max(1, sutraTotal);
  return Math.max(1, Math.min(totalComm, Math.round(ratio * totalComm + 0.5)));
}

function extractJuanFromXmlP5aClient(xmlText, targetJuan, workCode) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const body = doc.getElementsByTagName("body")[0];
  if (!body) return [];

  const SKIP_TAGS = new Set(["note", "rdg", "figDesc", "lb", "pb", "milestone", "mulu"]);
  const BLOCK_TAGS = new Set(["p", "lg", "head", "byline", "juan"]);

  function collectText(node) {
    let parts = [];
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        parts.push(child.nodeValue || "");
      } else if (child.nodeType === 1) {
        const lt = child.localName || child.nodeName.split(":").pop();
        if (SKIP_TAGS.has(lt)) continue;
        parts.push(collectText(child));
      }
    }
    return parts.join("");
  }

  let currentJuan = 0;
  const paragraphs = [];

  function walk(node) {
    if (node.nodeType !== 1) return;
    const lt = node.localName || node.nodeName.split(":").pop();
    if (lt === "milestone" && node.getAttribute("unit") === "juan") {
      const nVal = node.getAttribute("n") || "";
      if (/^\d+$/.test(nVal)) currentJuan = parseInt(nVal, 10);
      return;
    }
    if (currentJuan > targetJuan) return;

    if (currentJuan === targetJuan && BLOCK_TAGS.has(lt)) {
      const raw = collectText(node);
      const clean = normalizeGaijiClient(raw).replace(/\[\*\]|\[＊\]|\s+/g, "").trim();
      if (clean) {
        const idx = paragraphs.length + 1;
        const bType = (lt === "head" || lt === "byline" || lt === "juan") ? "heading" : "prose";
        paragraphs.push({
          index: idx,
          para_id: `${workCode}_${String(targetJuan).padStart(3, "0")}_p${String(idx).padStart(4, "0")}`,
          type: bType,
          text: clean,
        });
      }
      return;
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(body);
  return paragraphs;
}

async function fetchCommentaryFromGitHubClient(masterMeta, targetJuan) {
  const cbetaId = (masterMeta?.cbeta_id || "").trim();
  const m = cbetaId.match(/^([A-Z]+)(\d+)n\d+[A-Za-z]?$/);
  if (!m) {
    throw new Error(`無法推導 CBETA GitHub 路徑：${cbetaId}`);
  }
  const canon = m[1];
  const vol = `${m[1]}${m[2]}`;
  const url = `https://raw.githubusercontent.com/cbeta-git/xml-p5a/master/${canon}/${vol}/${cbetaId}.xml`;

  let xmlText = _githubXmlCache.get(cbetaId);
  if (!xmlText) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`從 CBETA GitHub 下載失敗（HTTP ${res.status}）`);
    xmlText = await res.text();
    _githubXmlCache.set(cbetaId, xmlText);
  }

  const workCode = masterMeta.primary_work || cbetaId;
  const paragraphs = extractJuanFromXmlP5aClient(xmlText, targetJuan, workCode);
  if (!paragraphs.length) {
    throw new Error(`CBETA (${cbetaId}) 查無第 ${targetJuan} 卷內容`);
  }

  return {
    schema_version: "1.0",
    source: `CBETA GitHub xml-p5a (${cbetaId}.xml)`,
    master: masterMeta,
    master_id: masterMeta.master_id,
    work: workCode,
    title: masterMeta.work_title || "",
    juan: targetJuan,
    total_juans: Number(masterMeta.total_juans) || 1,
    paragraphs,
    fetched_from_cbeta: true,
  };
}

async function loadCommentaryFulltext(masterId, explicitJuan = null) {
  const masterMeta = (state.bundle?.masters || []).find((m) => m.master_id === masterId);
  els.commMasterTitle.textContent = masterMeta
    ? `${masterMeta.dynasty}・${masterMeta.name.split("（")[0]} ${masterMeta.work_title}`
    : "古大德註疏全文";
  els.commAlignBadge.textContent = "載入全文中...";
  els.commAlignBadge.className = "align-badge hold";
  els.commFullBody.innerHTML = `
    <div class="empty-state" style="padding:24px;">
      <p class="empty-title" style="font-size:14px;">正在載入古大德註疏整卷全文...</p>
      <p class="empty-desc" style="font-size:12.5px;margin:0;">首次開啟將自動定位對應卷次。</p>
    </div>`;

  let data;
  if (state.isBackendAvailable) {
    try {
      const q = new URLSearchParams({
        sutra_id: state.currentSutraId,
        fascicle: String(state.currentFascicle),
        master_id: masterId,
      });
      if (explicitJuan !== null) q.set("juan", String(explicitJuan));
      data = await apiJson(`/api/commentaries/fulltext?${q.toString()}`);
    } catch {
      state.isBackendAvailable = false;
    }
  }

  if (!data) {
    // 純前端模式
    if (masterMeta && !masterMeta.primary_work) {
      // 無 CBETA 線上典籍者（如續法《纂要》、圓瑛《講義》），改用本卷精選註疏
      const localEntries = state.bundle?.commentaries?.[masterId] || [];
      data = {
        master: masterMeta,
        juan: state.currentFascicle,
        total_juans: Number(masterMeta.total_juans) || 1,
        local_juans: [state.currentFascicle],
        fetched_from_cbeta: false,
        paragraphs: localEntries.map((e, i) => ({
          index: i + 1,
          para_id: e.commentary_id,
          type: "prose",
          text: `【${e.section_heading || ""}】${e.original_commentary || ""}`,
        })),
      };
    } else {
      const commIndex = await getCommIndex();
      const sutraTotal = state.bundle?.fascicle_count || 1;
      const targetJuan =
        explicitJuan !== null
          ? explicitJuan
          : resolveClientCommentaryJuan(masterMeta, state.currentFascicle, sutraTotal, commIndex);
      const juanStr = String(targetJuan).padStart(3, "0");
      const localJuans = commIndex.local_juans?.[masterId] || [];

      // Tier 1：優先讀取已打包在 Firebase Hosting 的靜態註疏 JSON
      try {
        const res = await fetch(`./data/commentaries/${masterId}/${juanStr}.json`);
        if (res.ok) {
          data = await res.json();
          data.master = data.master || masterMeta;
          data.local_juans = localJuans.length ? localJuans : [targetJuan];
        }
      } catch {}

      // Tier 2：若靜態檔未收錄該卷，直接從 CBETA GitHub xml-p5a 即時下載解析
      if (!data && masterMeta?.cbeta_id) {
        try {
          els.commAlignBadge.textContent = `自 CBETA 下載卷 ${targetJuan}...`;
          data = await fetchCommentaryFromGitHubClient(masterMeta, targetJuan);
          data.local_juans = Array.from(new Set([...localJuans, targetJuan])).sort((a, b) => a - b);
        } catch (err) {
          state.commFull = null;
          els.commAlignBadge.textContent = "載入失敗";
          els.commFullBody.innerHTML = `<div class="error-box">⚠️ 載入 ${escapeHtml(masterMeta?.name || masterId)} 第 ${targetJuan} 卷失敗：${escapeHtml(err.message)}</div>`;
          return;
        }
      }

      if (!data) {
        state.commFull = null;
        els.commAlignBadge.textContent = "暫無此卷註疏";
        els.commFullBody.innerHTML = `<div class="empty-state" style="padding:24px;">${escapeHtml(masterMeta?.name || masterId)} 第 ${targetJuan} 卷暫無資料。</div>`;
        return;
      }
    }

    // 載入本機 IndexedDB 中的白話導讀
    try {
      const localGuides = await dbHelper.getCommentaryGuides(masterId, data.juan || 1);
      state.commentaryGuides = { ...state.commentaryGuides, ...localGuides };
    } catch {}
  }

  state.commFull = data;
  state.commCursorIdx = 0;
  state.commAlignedIdx = null;
  state.commMatchedPhrase = null;
  renderCommJuanControls();
  renderCommFullBody();

  if (state.activeSentenceId) {
    alignCommentaryToSentence(state.activeSentenceId);
  } else {
    els.commAlignBadge.textContent = `已載入第 ${data.juan} 卷（共 ${data.paragraphs?.length || 0} 段）`;
    els.commAlignBadge.className = "align-badge";
  }
}

function renderCommJuanControls() {
  if (!state.commFull) return;
  const total = state.commFull.total_juans || 1;
  const cur = state.commFull.juan || 1;
  const localSet = new Set(state.commFull.local_juans || []);
  els.commJuanSelect.innerHTML = "";
  for (let i = 1; i <= total; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `卷 ${i}/${total}${localSet.has(i) ? " ✓" : ""}`;
    if (i === cur) opt.selected = true;
    els.commJuanSelect.appendChild(opt);
  }
  els.prevCommJuanBtn.disabled = cur <= 1;
  els.nextCommJuanBtn.disabled = cur >= total;
}

function renderCommFullBody() {
  if (!state.commFull || !state.commFull.paragraphs?.length) {
    els.commFullBody.innerHTML = `<div class="empty-state" style="padding:20px;">此卷暫無註疏段落，請嘗試切換上方註疏卷次。</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  state.commFull.paragraphs.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "comm-para" + (p.type === "heading" ? " comm-heading" : "");
    div.dataset.commIndex = String(idx);
    div.dataset.paraId = p.para_id;

    const head = document.createElement("div");
    head.className = "comm-para-head";

    const tag = document.createElement("span");
    tag.className = "comm-para-num";
    tag.textContent = `第 ${idx + 1} 段`;
    head.appendChild(tag);

    const guideRec = state.commentaryGuides[p.para_id];
    const guideBtn = document.createElement("button");
    guideBtn.type = "button";
    guideBtn.className = "comm-guide-btn";
    guideBtn.innerHTML = guideRec ? `<span>🔄 重新生成導讀</span>` : `<span>✨ AI 白話導讀</span>`;
    guideBtn.addEventListener("click", () => triggerTranslateCommentaryPara(p, guideBtn, Boolean(guideRec)));
    head.appendChild(guideBtn);
    div.appendChild(head);

    const textDiv = document.createElement("div");
    textDiv.className = "comm-para-text";
    textDiv.textContent = p.text;
    div.appendChild(textDiv);

    if (guideRec) {
      const guideBox = document.createElement("div");
      guideBox.className = "comm-guide-box";
      guideBox.innerHTML = `
        <div class="comm-guide-title">
          <span>✨ 祖師法義導讀</span>
          <span style="font-size:11px;color:#766a59;">${guideRec.from_kb ? "本地存檔" : "AI 新譯"}（${escapeHtml(guideRec.provider || "Gemini")}）</span>
        </div>
        <div class="comm-guide-content">${escapeHtml(guideRec.plain_guide || "")}</div>
      `;
      div.appendChild(guideBox);
    }

    frag.appendChild(div);
  });

  els.commFullBody.innerHTML = "";
  els.commFullBody.appendChild(frag);
}

// ---------- 註疏順向定位演算法 ----------
function extractSearchPhrases(sentenceText) {
  const clean = sentenceText
    .replace(/[，、。；？！：「」『』\s\(\)（）—…]/g, "")
    .trim();
  if (clean.length < 2) return [];

  const candidates = [];
  for (let len = 6; len >= 3; len--) {
    for (let i = 0; i <= clean.length - len; i++) {
      const sub = clean.slice(i, i + len);
      if (!STOP_PHRASES.has(sub)) candidates.push(sub);
    }
  }
  return candidates;
}

function alignCommentaryToSentence(sentenceId) {
  if (!state.commFull || !state.commFull.paragraphs?.length) return;

  const targetSent = findSentenceText(sentenceId);
  if (!targetSent) return;

  const phrases = extractSearchPhrases(targetSent);
  if (!phrases.length) return;

  const paras = state.commFull.paragraphs;
  let bestIdx = null;
  let bestPhrase = null;
  let bestLen = 0;

  // 順向搜尋
  const cursor = Math.max(0, state.commCursorIdx - 1);
  for (let i = cursor; i < paras.length; i++) {
    const text = paras[i].text;
    for (const ph of phrases) {
      if (text.includes(ph)) {
        if (ph.length > bestLen) {
          bestLen = ph.length;
          bestIdx = i;
          bestPhrase = ph;
        }
      }
    }
    if (bestIdx !== null && bestLen >= 4) break;
  }

  // 全域回溯備援
  if (bestIdx === null) {
    for (let i = 0; i < paras.length; i++) {
      const text = paras[i].text;
      for (const ph of phrases) {
        if (text.includes(ph)) {
          if (ph.length > bestLen) {
            bestLen = ph.length;
            bestIdx = i;
            bestPhrase = ph;
          }
        }
      }
      if (bestIdx !== null && bestLen >= 4) break;
    }
  }

  if (bestIdx !== null) {
    state.commCursorIdx = bestIdx;
    state.commAlignedIdx = bestIdx;
    state.commMatchedPhrase = bestPhrase;
    highlightAndScrollCommentary(bestIdx, bestPhrase);
    els.commAlignBadge.textContent = `對齊第 ${bestIdx + 1} 段（引「${bestPhrase}」）`;
    els.commAlignBadge.className = "align-badge match";
  } else {
    els.commAlignBadge.textContent = `保持第 ${state.commCursorIdx + 1} 段（未明引經文）`;
    els.commAlignBadge.className = "align-badge hold";
  }
}

function highlightAndScrollCommentary(paraIdx, matchedPhrase = null) {
  const container = els.commFullBody;
  container.querySelectorAll(".comm-para.highlighted").forEach((el) => el.classList.remove("highlighted"));

  const targetEl = container.querySelector(`[data-comm-index="${paraIdx}"]`);
  if (!targetEl) return;

  targetEl.classList.add("highlighted");

  if (matchedPhrase) {
    const textDiv = targetEl.querySelector(".comm-para-text");
    if (textDiv) {
      const raw = textDiv.textContent;
      const parts = raw.split(matchedPhrase);
      if (parts.length > 1) {
        textDiv.innerHTML = parts
          .map((p) => escapeHtml(p))
          .join(`<span class="comm-phrase-hit">${escapeHtml(matchedPhrase)}</span>`);
      }
    }
  }

  targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- 渲染經文全文 ----------
function renderSutraContent() {
  if (!state.bundle?.sutra) return;
  els.sutraContent.innerHTML = "";

  const paras = state.bundle.sutra.paragraphs || [];
  paras.forEach((p) => {
    const card = document.createElement("div");
    card.className = "para-card" + (p.type === "heading" ? " heading" : "");
    card.dataset.paraIndex = String(p.index);

    const badge = document.createElement("div");
    badge.className = "para-index-badge";
    badge.textContent = String(p.index);
    card.appendChild(badge);

    const textDiv = document.createElement("div");
    textDiv.className = "para-text";

    (p.sentences || []).forEach((sent) => {
      const isCached = Boolean(state.bundle.translations?.[sent.sentence_id]);
      const span = document.createElement("span");
      span.className = "sentence" + (isCached ? " cached" : "");
      span.dataset.sentenceId = sent.sentence_id;
      span.textContent = sent.text;

      span.addEventListener("mouseenter", () => handleSentenceHover(sent.sentence_id));
      span.addEventListener("mouseleave", () => {
        if (state.hoverTimer) {
          clearTimeout(state.hoverTimer);
          state.hoverTimer = null;
        }
      });
      span.addEventListener("click", () => handleSentenceClick(sent.sentence_id));

      textDiv.appendChild(span);
    });

    card.appendChild(textDiv);
    els.sutraContent.appendChild(card);
  });
}

function highlightSearchInSutra(query) {
  document.querySelectorAll(".sentence").forEach((el) => {
    const hit = query && el.textContent.includes(query);
    el.classList.toggle("search-hit", Boolean(hit));
  });
}

function syncSentenceHighlight() {
  document.querySelectorAll(".sentence").forEach((el) => {
    const sid = el.dataset.sentenceId;
    el.classList.toggle("hovered", sid === state.activeSentenceId);
    el.classList.toggle("locked", sid === state.lockedSentenceId);
    el.classList.toggle("cached", Boolean(state.bundle?.translations?.[sid]));
  });
}

// ---------- 游標連動與 Cache-First 翻譯 ----------
function handleSentenceHover(sentenceId) {
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
    return;
  }
  if (state.lockedSentenceId && state.lockedSentenceId !== sentenceId) {
    return;
  }
  state.activeSentenceId = sentenceId;
  syncSentenceHighlight();
  renderAnalysisPanel();
  alignCommentaryToSentence(sentenceId);

  if (state.bundle?.translations?.[sentenceId]) return;

  if (els.autoHoverTranslate.checked) {
    if (state.hoverTimer) clearTimeout(state.hoverTimer);
    state.hoverTimer = setTimeout(() => {
      triggerTranslateSentence(sentenceId, false);
    }, 500);
  }
}

function handleSentenceClick(sentenceId) {
  const isUntranslated = !state.bundle?.translations?.[sentenceId];
  const clickToTranslate = !els.autoHoverTranslate.checked;

  if (state.lockedSentenceId === sentenceId) {
    if (clickToTranslate && isUntranslated) {
      // 未勾選自動翻譯且尚無譯文時，再次點擊同一句直接重試翻譯（解除鎖定可點上方「已鎖定」鈕）
      triggerTranslateSentence(sentenceId, false);
      return;
    }
    state.lockedSentenceId = null;
  } else {
    state.lockedSentenceId = sentenceId;
    state.activeSentenceId = sentenceId;
  }
  mobileUiState.sentenceBarDismissedId = null;
  syncSentenceHighlight();
  renderAnalysisPanel();
  alignCommentaryToSentence(sentenceId);
  updateMobileSentenceBar();

  if (clickToTranslate && state.lockedSentenceId === sentenceId && isUntranslated) {
    triggerTranslateSentence(sentenceId, false);
  }
}

function findSentenceText(sentenceId) {
  if (!state.bundle?.sutra) return "";
  for (const p of state.bundle.sutra.paragraphs || []) {
    for (const s of p.sentences || []) {
      if (s.sentence_id === sentenceId) return s.text;
    }
  }
  return "";
}

function findSurroundingSentences(sentenceId) {
  if (!state.bundle?.sutra) return { prev: [], next: [] };
  const all = [];
  let targetIdx = -1;
  for (const p of state.bundle.sutra.paragraphs || []) {
    for (const s of p.sentences || []) {
      all.push(s.text);
      if (s.sentence_id === sentenceId) targetIdx = all.length - 1;
    }
  }
  if (targetIdx === -1) return { prev: [], next: [] };
  const prev = all.slice(Math.max(0, targetIdx - 2), targetIdx);
  const next = all.slice(targetIdx + 1, targetIdx + 3);
  return { prev, next };
}

async function triggerTranslateSentence(sentenceId, forceRefresh = false) {
  if (state.translatingSet.has(sentenceId)) return;
  state.translatingSet.add(sentenceId);
  renderAnalysisPanel();

  let errorMsg = null;
  const chosenProvider = els.providerSelect.value;
  try {
    if (state.isBackendAvailable) {
      const chosenModel =
        chosenProvider === "nvidia"
          ? state.nvidiaModel
          : chosenProvider === "gemini"
            ? state.userModel
            : undefined;
      const chosenKey =
        chosenProvider === "nvidia"
          ? state.nvidiaApiKey.trim() || undefined
          : chosenProvider === "gemini"
            ? state.userApiKey.trim() || undefined
            : undefined;
      const res = await apiJson("/api/translate/sentence", {
        method: "POST",
        body: JSON.stringify({
          sutra_id: state.currentSutraId,
          fascicle: state.currentFascicle,
          sentence_id: sentenceId,
          provider: chosenProvider,
          model: chosenModel,
          api_key: chosenKey,
          selected_masters: state.selectedMasterId ? [state.selectedMasterId] : [],
          force_refresh: forceRefresh,
        }),
      });
      state.bundle.translations[sentenceId] = res.entry;
      state.bundle.translations[sentenceId]._lastFromKb = res.from_kb;
    } else {
      // 純前端 BYOK 模式（支援 Gemini 與 NVIDIA NIM 各自獨立金鑰）
      if (chosenProvider === "nvidia") {
        if (!state.nvidiaApiKey) {
          state.translatingSet.delete(sentenceId);
          openByokModal("nvidia");
          showNvidiaStatus("請先輸入您的個人 NVIDIA API Key（nvapi-...）即可開啟白話翻譯！", "err");
          renderAnalysisPanel();
          return;
        }
      } else if (!state.userApiKey) {
        state.translatingSet.delete(sentenceId);
        openByokModal("gemini");
        showByokStatus("請先輸入您的個人 Gemini API Key 即可開啟白話翻譯！", "err");
        renderAnalysisPanel();
        return;
      }

      const targetText = findSentenceText(sentenceId);
      const { prev, next } = findSurroundingSentences(sentenceId);
      const commentaries = []; // 前端參考可依目前註疏
      if (state.commFull && state.commAlignedIdx !== null) {
        const p = state.commFull.paragraphs[state.commAlignedIdx];
        if (p) {
          commentaries.push({
            master_name: state.commFull.master?.name || "古大德",
            work_title: state.commFull.master?.work_title || "",
            dynasty: state.commFull.master?.dynasty || "",
            section_heading: `第${state.commAlignedIdx + 1}段`,
            original_commentary: p.text,
          });
        }
      }

      const prompt = buildSentencePrompt(
        state.bundle?.sutra?.sutra_title || state.currentSutraId,
        state.bundle?.sutra?.edition || "大藏經",
        targetText,
        prev,
        next,
        commentaries
      );

      const isNv = chosenProvider === "nvidia";
      const parsed = isNv
        ? await callDirectNvidiaApi(prompt, true, true)
        : await callDirectGeminiApi(prompt, true, true);
      const actualModel = isNv
        ? state.lastUsedNvidiaModel || state.nvidiaModel
        : state.lastUsedModel || state.userModel;
      const entry = {
        sentence_id: sentenceId,
        source_text: targetText,
        active_version_id: "v_byok_1",
        versions: [
          {
            version_id: "v_byok_1",
            provider: isNv ? "nvidia-byok" : "gemini-byok",
            model: actualModel,
            created_at: new Date().toISOString(),
            content: parsed,
          },
        ],
      };

      // 永久儲存至本機 IndexedDB
      await dbHelper.saveTranslation(state.currentSutraId, state.currentFascicle, sentenceId, entry);

      state.bundle.translations[sentenceId] = entry;
      state.bundle.translations[sentenceId]._lastFromKb = false;
    }

    updateKbStats();
    syncSentenceHighlight();
  } catch (err) {
    errorMsg = err?.message || String(err);
  } finally {
    state.translatingSet.delete(sentenceId);
    if (state.activeSentenceId === sentenceId) {
      renderAnalysisPanel(errorMsg);
    }
  }
}

async function triggerTranslateCommentaryPara(para, btnEl, forceRefresh = false) {
  btnEl.disabled = true;
  btnEl.textContent = "導讀生成中...";

  const chosenProvider = els.providerSelect.value;
  try {
    if (state.isBackendAvailable) {
      const chosenModel =
        chosenProvider === "nvidia"
          ? state.nvidiaModel
          : chosenProvider === "gemini"
            ? state.userModel
            : undefined;
      const chosenKey =
        chosenProvider === "nvidia"
          ? state.nvidiaApiKey.trim() || undefined
          : chosenProvider === "gemini"
            ? state.userApiKey.trim() || undefined
            : undefined;
      const res = await apiJson("/api/translate/commentary", {
        method: "POST",
        body: JSON.stringify({
          sutra_id: state.currentSutraId,
          master_id: state.selectedMasterId,
          fascicle: state.commFull?.juan || state.currentFascicle,
          commentary_id: para.para_id,
          original_text: para.text,
          provider: chosenProvider,
          model: chosenModel,
          api_key: chosenKey,
          force_refresh: forceRefresh,
        }),
      });
      state.commentaryGuides[para.para_id] = { ...res.record, from_kb: res.from_kb };
    } else {
      // 純前端 BYOK 模式（支援 Gemini 與 NVIDIA NIM 獨立金鑰）
      const isNv = chosenProvider === "nvidia";
      if (isNv && !state.nvidiaApiKey) {
        btnEl.disabled = false;
        btnEl.textContent = "✨ AI 白話導讀";
        openByokModal("nvidia");
        showNvidiaStatus("請先輸入您的個人 NVIDIA API Key（nvapi-...）即可開啟註疏導讀！", "err");
        return;
      }
      if (!isNv && !state.userApiKey) {
        btnEl.disabled = false;
        btnEl.textContent = "✨ AI 白話導讀";
        openByokModal("gemini");
        showByokStatus("請先輸入您的個人 Gemini API Key 即可開啟註疏導讀！", "err");
        return;
      }

      const prompt = buildCommentaryPrompt(
        state.commFull?.master?.name || "古大德",
        state.commFull?.master?.work_title || "註疏",
        para.text
      );
      const guideText = isNv
        ? await callDirectNvidiaApi(prompt, false, true)
        : await callDirectGeminiApi(prompt, false, true);

      const record = {
        plain_guide: guideText,
        provider: isNv ? "nvidia-byok" : "gemini-byok",
        model: isNv
          ? state.lastUsedNvidiaModel || state.nvidiaModel
          : state.lastUsedModel || state.userModel,
        from_kb: false,
      };

      await dbHelper.saveCommentaryGuide(
        state.selectedMasterId,
        state.commFull?.juan || 1,
        para.para_id,
        record
      );
      state.commentaryGuides[para.para_id] = record;
    }

    renderCommFullBody();
    if (state.commAlignedIdx !== null) {
      highlightAndScrollCommentary(state.commAlignedIdx, state.commMatchedPhrase);
    }
  } catch (err) {
    alert(`古大德註疏白話導讀失敗：${err.message}`);
    btnEl.disabled = false;
    btnEl.textContent = "✨ AI 白話導讀";
  }
}

function syncLockHeaderBadge() {
  if (!els.unlockBtn) return;
  els.unlockBtn.style.display = state.lockedSentenceId ? "inline-flex" : "none";
}

function setAiHeaderStatus(text, cls = "badge-ai", title = "") {
  if (!els.aiHeaderStatusBadge) return;
  if (!text) {
    els.aiHeaderStatusBadge.style.display = "none";
    els.aiHeaderStatusBadge.textContent = "";
    return;
  }
  els.aiHeaderStatusBadge.textContent = text;
  els.aiHeaderStatusBadge.className = `${cls} ai-header-status`;
  els.aiHeaderStatusBadge.title = title || text;
  els.aiHeaderStatusBadge.style.display = "inline-block";
}

// ---------- 渲染上方 AI 翻譯面板 ----------
function renderAnalysisPanel(errorMsg = null) {
  syncLockHeaderBadge();
  const sid = state.activeSentenceId;
  if (!sid || !state.bundle) {
    setAiHeaderStatus("");
    els.analysisPanel.innerHTML = `
      <div class="empty-state" style="padding:18px;">
        <p class="empty-title" style="font-size:14px;">請將游標移至左側漢文經句</p>
        <p class="empty-desc" style="font-size:12.5px;margin:0;">帶金色底線為本地知識庫已存譯文；點擊可鎖定並呼叫 AI 翻譯。</p>
      </div>`;
    return;
  }

  const sourceText = findSentenceText(sid);
  const entry = state.bundle.translations?.[sid];
  const isTranslating = state.translatingSet.has(sid);
  const transPath = getCurrentTranslationPath();

  let aiBodyHtml = "";

  if (isTranslating) {
    const p = els.providerSelect.value;
    const shortModel =
      p === "nvidia"
        ? (state.nvidiaModel || "").split("/").pop()
        : p === "ollama"
          ? "Ollama"
          : state.userModel;
    setAiHeaderStatus(`⏳ 翻譯中 · ${shortModel}`, "badge-ai", `AI 翻譯中（${p} / ${shortModel}）`);
    aiBodyHtml = `<p style="color:#766a59;font-size:13.5px;margin:0;">正在結合前後文與古大德法義翻譯，完成後自動存入 <code>${escapeHtml(transPath)}</code>...</p>`;
  } else if (entry) {
    const activeVer =
      entry.versions?.find((v) => v.version_id === entry.active_version_id) ||
      entry.versions?.[(entry.versions?.length || 1) - 1] ||
      {};
    const c = activeVer.content || {};
    const fromKb = entry._lastFromKb !== false;
    const shortModel = String(activeVer.model || activeVer.provider || "AI").split("/").pop();
    const fullTitle = `${fromKb ? "本地知識庫命中" : "AI 新譯並已入庫"}（${activeVer.provider || "Gemini"}${activeVer.model ? ` / ${activeVer.model}` : ""}）`;
    setAiHeaderStatus(
      fromKb ? `知識庫 · ${shortModel}` : `新譯入庫 · ${shortModel}`,
      fromKb ? "badge-kb" : "badge-ai",
      fullTitle
    );

    const termsHtml = (c.terms || [])
      .map(
        (t) =>
          `<div class="term-item"><strong>${escapeHtml(t.term)}</strong>：${escapeHtml(t.explanation)}</div>`
      )
      .join("");

    aiBodyHtml = `
      <div class="section-block"><h4>白話直譯</h4><p>${escapeHtml(c.literal_translation)}</p></div>
      <div class="section-block"><h4>白話口語化新譯</h4><p>${escapeHtml(c.colloquial_translation)}</p></div>
      <div class="section-block"><h4>法義解析</h4><p>${escapeHtml(c.dharma_analysis)}</p></div>
      ${termsHtml ? `<div class="section-block"><h4>名相註解</h4>${termsHtml}</div>` : ""}
      <div class="action-row">
        <button class="secondary-btn" id="retranslateBtn">以目前引擎重譯並保留新版本</button>
        <span style="font-size:11.5px;color:#766a59;">已存版本數：${entry.versions?.length || 1}</span>
      </div>
      <div class="storage-path-note">分卷存檔位置：<code>${escapeHtml(transPath)}</code></div>
    `;
  } else {
    const p = els.providerSelect.value;
    const engName =
      p === "nvidia"
        ? `NVIDIA NIM (${(state.nvidiaModel || "").split("/").pop()})`
        : p === "ollama"
          ? "Ollama"
          : `Gemini (${state.userModel})`;
    setAiHeaderStatus("尚無譯文", "badge-ai", "本地知識庫尚無譯文；點擊左側經句可即時翻譯");
    const actionHint = els.autoHoverTranslate.checked
      ? `游標停留 0.5 秒將自動由 <strong>${escapeHtml(engName)}</strong> 翻譯並存入本機知識庫。`
      : `請直接<strong>點擊左側經句</strong>，即由 <strong>${escapeHtml(engName)}</strong> 翻譯並存入本機知識庫（或勾選頂部「游標停留自動 AI 翻譯」）。`;
    aiBodyHtml = `
      <p style="font-size:12.5px;color:#766a59;margin:0;">
        此句尚未在 <code>${escapeHtml(transPath)}</code> 建立譯文；${actionHint}
      </p>
    `;
  }

  els.analysisPanel.innerHTML = `
    <div class="source-quote" style="font-size:14.5px;padding:6px 10px;margin-bottom:8px;">${escapeHtml(sourceText)}</div>
    ${aiBodyHtml}
    ${errorMsg ? `<div class="error-box">⚠️ ${escapeHtml(errorMsg)}</div>` : ""}
  `;

  const retranslateBtn = document.getElementById("retranslateBtn");
  if (retranslateBtn) {
    retranslateBtn.addEventListener("click", () => triggerTranslateSentence(sid, true));
  }
  updateMobileSentenceBar();
}

init();
