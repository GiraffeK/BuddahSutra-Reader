// 大正新脩大藏經｜AI 翻譯與古大德註疏全文同步對齊 前端主邏輯
// 支援雙模運作：本機後端模式 (FastAPI) 與 雲端純前端模式 (Firebase Hosting + BYOK Gemini + IndexedDB)

const state = {
  isBackendAvailable: false,
  userApiKey: localStorage.getItem("buddhasutra_gemini_api_key") || "",
  userModel: localStorage.getItem("buddhasutra_gemini_model") || "gemini-3.5-flash-lite",
  lastUsedModel: "",
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
  sutraTitle: document.getElementById("sutraTitle"),
  sutraCode: document.getElementById("sutraCode"),
  sutraSubtitle: document.getElementById("sutraSubtitle"),
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
  // BYOK
  byokBtn: document.getElementById("byokBtn"),
  byokModal: document.getElementById("byokModal"),
  closeByokModalBtn: document.getElementById("closeByokModalBtn"),
  appModeLabel: document.getElementById("appModeLabel"),
  byokApiKeyInput: document.getElementById("byokApiKeyInput"),
  toggleKeyVisibilityBtn: document.getElementById("toggleKeyVisibilityBtn"),
  byokModelSelect: document.getElementById("byokModelSelect"),
  byokCustomModelInput: document.getElementById("byokCustomModelInput"),
  saveByokKeyBtn: document.getElementById("saveByokKeyBtn"),
  testByokKeyBtn: document.getElementById("testByokKeyBtn"),
  clearByokKeyBtn: document.getElementById("clearByokKeyBtn"),
  byokStatusMsg: document.getElementById("byokStatusMsg"),
  exportKbBtn: document.getElementById("exportKbBtn"),
  importKbInput: document.getElementById("importKbInput"),
  kbStorageStats: document.getElementById("kbStorageStats"),
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
  const candidates = allowFallback
    ? [primaryModel, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== primaryModel)]
    : [primaryModel];

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

// ---------- 初始化 ----------
async function init() {
  bindEvents();
  initByokModal();
  await checkBackendAvailability();
  await Promise.all([loadLlmStatus(), loadCatalog()]);
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
  els.providerSelect.addEventListener("change", updateLlmBadge);

  els.toggleAiCollapseBtn.addEventListener("click", () => {
    const collapsed = els.aiPanelWrap.classList.toggle("collapsed");
    els.toggleAiCollapseBtn.textContent = collapsed ? "展開" : "收合";
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
    }
  });
}

function initByokModal() {
  if (els.byokApiKeyInput) els.byokApiKeyInput.value = state.userApiKey;

  els.byokBtn?.addEventListener("click", openByokModal);
  els.closeByokModalBtn?.addEventListener("click", closeByokModal);
  els.byokModal?.addEventListener("click", (e) => {
    if (e.target === els.byokModal) closeByokModal();
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
  });

  els.clearByokKeyBtn?.addEventListener("click", () => {
    if (!confirm("確定要清除本機儲存的 Gemini API Key 嗎？")) return;
    state.userApiKey = "";
    localStorage.removeItem("buddhasutra_gemini_api_key");
    els.byokApiKeyInput.value = "";
    showByokStatus("已清除本機金鑰。", "err");
    updateLlmBadge();
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

async function openByokModal() {
  if (els.byokModal) els.byokModal.style.display = "flex";
  if (els.byokApiKeyInput) els.byokApiKeyInput.value = state.userApiKey;

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

  hideByokStatus();
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
  if (state.isBackendAvailable) {
    try {
      state.llmStatus = await apiJson("/api/llm/status");
      if (state.llmStatus.default_provider) {
        els.providerSelect.value = state.llmStatus.default_provider;
      }
      updateLlmBadge();
      return;
    } catch {
      state.isBackendAvailable = false;
    }
  }

  // 純前端 BYOK 模式
  state.llmStatus = {
    default_provider: "gemini",
    gemini: {
      configured: Boolean(state.userApiKey),
      model: state.userModel,
    },
    ollama: { reachable: false },
  };
  updateLlmBadge();
}

function updateLlmBadge() {
  if (!state.isBackendAvailable) {
    if (state.userApiKey) {
      els.llmStatusBadge.textContent = `Gemini 就緒 (${state.userModel}・BYOK)`;
      els.llmStatusBadge.className = "status-pill status-ok";
      els.llmStatusBadge.title = "已設定個人本機 API Key，點擊可重設或測試";
    } else {
      els.llmStatusBadge.textContent = "請設定 Gemini API Key";
      els.llmStatusBadge.className = "status-pill status-warn";
      els.llmStatusBadge.title = "點擊「🔑 API 設定」填入金鑰即可開啟 AI 白話翻譯";
    }
    return;
  }

  if (!state.llmStatus) return;
  const p = els.providerSelect.value;
  if (p === "gemini") {
    if (state.llmStatus.gemini.configured) {
      els.llmStatusBadge.textContent = `Gemini 就緒 (${state.llmStatus.gemini.model})`;
      els.llmStatusBadge.className = "status-pill status-ok";
    } else {
      els.llmStatusBadge.textContent = "Gemini 尚未設定金鑰";
      els.llmStatusBadge.className = "status-pill status-warn";
    }
  } else {
    if (state.llmStatus.ollama.reachable) {
      const m = state.llmStatus.ollama.available_models[0] || state.llmStatus.ollama.default_model;
      els.llmStatusBadge.textContent = `Ollama 就緒 (${m})`;
      els.llmStatusBadge.className = "status-pill status-ok";
    } else {
      els.llmStatusBadge.textContent = "Ollama 本機未啟動";
      els.llmStatusBadge.className = "status-pill status-warn";
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

  // 純前端模式：讀取 ./data/catalog.json
  try {
    const res = await fetch("./data/catalog.json");
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
    const hasAvail = div.sutras.some((s) => s.status === "available");
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
      const isAvail = sutra.status === "available";
      sBtn.className =
        "sutra-btn" +
        (isAvail ? "" : " planned") +
        (sutra.sutra_id === state.currentSutraId ? " active" : "");

      const badge = isAvail
        ? `<span class="badge-avail">可閱讀</span>`
        : `<span class="badge-planned">建置中</span>`;

      sBtn.innerHTML = `<span>${escapeHtml(sutra.title)}</span>${badge}`;
      sBtn.title = `${sutra.sutra_id}｜${sutra.translator}（共 ${sutra.fascicle_count} 卷）`;

      sBtn.addEventListener("click", () => {
        if (!isAvail) {
          alert(`《${sutra.title}》（${sutra.sutra_id}）目錄已建好！\n目前起始開放精讀：《大方廣佛華嚴經（八十華嚴）》與《首楞嚴經》。`);
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

// ---------- 載入經卷 ----------
async function loadFascicle(sutraId, fascicle, targetSentenceId = null) {
  const sutraChanged = state.currentSutraId !== sutraId;
  state.currentSutraId = sutraId;
  state.currentFascicle = fascicle;
  state.activeSentenceId = null;
  state.lockedSentenceId = null;
  state.commCursorIdx = 0;
  state.commAlignedIdx = null;
  state.commMatchedPhrase = null;
  els.cbetaToast.style.display = "none";

  els.sutraContent.innerHTML = `
    <div class="empty-state">
      <p class="empty-title">載入 ${escapeHtml(sutraId)} 第 ${fascicle} 卷中...</p>
      <p class="empty-desc">首次開啟將載入經文斷句與古大德註疏對照。</p>
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
    // 純前端模式：先抓取靜態 Bundle
    try {
      const res = await fetch(`./data/bundles/${sutraId}_${fascicle}.json`);
      if (!res.ok) throw new Error(`查無預載分卷檔案（HTTP ${res.status}）`);
      bundle = await res.json();
    } catch (err) {
      els.sutraContent.innerHTML = `<div class="error-box">⚠️ 載入第 ${fascicle} 卷失敗：${escapeHtml(err.message)}</div>`;
      return;
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
    els.cbetaToast.textContent = `✓ 已自動從 CBETA 下載「${bundle.sutra.sutra_title}」第 ${fascicle} 卷，並永久存入本地知識庫！`;
    els.cbetaToast.style.display = "block";
  }

  // 以本次 bundle 回傳的最新已入庫卷次，即時同步左側目錄樹
  syncCatalogLocalFascicles(sutraId, bundle.local_fascicles);

  // 決定預設精讀的單一古大德
  const validIds = new Set((bundle.masters || []).map((m) => m.master_id));
  if (sutraChanged || !state.selectedMasterId || !validIds.has(state.selectedMasterId)) {
    const defMaster = (bundle.masters || []).find((m) => m.default_selected) || (bundle.masters || [])[0];
    state.selectedMasterId = defMaster ? defMaster.master_id : null;
  }

  els.sutraTitle.textContent = bundle.sutra.sutra_title;
  els.sutraCode.textContent = `${bundle.sutra.sutra_id}_${String(fascicle).padStart(3, "0")}`;
  els.sutraSubtitle.textContent = `${bundle.sutra.edition}｜${bundle.sutra.translator}｜${bundle.sutra.fascicle_title}`;

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

  // 同步載入所選古大德的對應整卷註疏全文
  if (state.selectedMasterId) {
    await loadCommentaryFulltext(state.selectedMasterId, null);
  }
}

function syncCatalogLocalFascicles(sutraId, localFascicles) {
  if (!state.catalog || !Array.isArray(localFascicles)) return;
  for (const div of state.catalog.divisions || []) {
    const s = (div.sutras || []).find((x) => x.sutra_id === sutraId);
    if (s) {
      s.local_fascicles = [...localFascicles];
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
    opt.textContent = `註疏卷 ${i}/${total}${localSet.has(i) ? " ✓" : ""}`;
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
  syncSentenceHighlight();
  renderAnalysisPanel();
  alignCommentaryToSentence(sentenceId);

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
  try {
    if (state.isBackendAvailable) {
      const res = await apiJson("/api/translate/sentence", {
        method: "POST",
        body: JSON.stringify({
          sutra_id: state.currentSutraId,
          fascicle: state.currentFascicle,
          sentence_id: sentenceId,
          provider: els.providerSelect.value,
          selected_masters: state.selectedMasterId ? [state.selectedMasterId] : [],
          force_refresh: forceRefresh,
        }),
      });
      state.bundle.translations[sentenceId] = res.entry;
      state.bundle.translations[sentenceId]._lastFromKb = res.from_kb;
    } else {
      // 純前端 BYOK 模式
      if (!state.userApiKey) {
        state.translatingSet.delete(sentenceId);
        openByokModal();
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

      const parsed = await callDirectGeminiApi(prompt, true, true);
      const actualModel = state.lastUsedModel || state.userModel;
      const entry = {
        sentence_id: sentenceId,
        source_text: targetText,
        active_version_id: "v_byok_1",
        versions: [
          {
            version_id: "v_byok_1",
            provider: "gemini-byok",
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

  try {
    if (state.isBackendAvailable) {
      const res = await apiJson("/api/translate/commentary", {
        method: "POST",
        body: JSON.stringify({
          sutra_id: state.currentSutraId,
          master_id: state.selectedMasterId,
          fascicle: state.commFull?.juan || state.currentFascicle,
          commentary_id: para.para_id,
          original_text: para.text,
          provider: els.providerSelect.value,
          force_refresh: forceRefresh,
        }),
      });
      state.commentaryGuides[para.para_id] = { ...res.record, from_kb: res.from_kb };
    } else {
      // 純前端 BYOK 模式
      if (!state.userApiKey) {
        btnEl.disabled = false;
        btnEl.textContent = "✨ AI 白話導讀";
        openByokModal();
        showByokStatus("請先輸入您的個人 Gemini API Key 即可開啟註疏導讀！", "err");
        return;
      }

      const prompt = buildCommentaryPrompt(
        state.commFull?.master?.name || "古大德",
        state.commFull?.master?.work_title || "註疏",
        para.text
      );
      const guideText = await callDirectGeminiApi(prompt, false, true);

      const record = {
        plain_guide: guideText,
        provider: "gemini-byok",
        model: state.lastUsedModel || state.userModel,
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

// ---------- 渲染上方 AI 翻譯面板 ----------
function renderAnalysisPanel(errorMsg = null) {
  const sid = state.activeSentenceId;
  if (!sid || !state.bundle) {
    els.analysisPanel.innerHTML = `
      <div class="empty-state" style="padding:18px;">
        <p class="empty-title" style="font-size:14px;">請將游標移至右側漢文經句</p>
        <p class="empty-desc" style="font-size:12.5px;margin:0;">帶金色底線為本地知識庫已存譯文；點擊可鎖定並呼叫 AI 翻譯。</p>
      </div>`;
    return;
  }

  const sourceText = findSentenceText(sid);
  const entry = state.bundle.translations?.[sid];
  const isTranslating = state.translatingSet.has(sid);
  const isLocked = state.lockedSentenceId === sid;
  const transPath = getCurrentTranslationPath();

  let aiBodyHtml = "";
  let statusBadge = `<span class="badge-ai">本地知識庫尚無譯文</span>`;
  let topbarLeftExtra = "";

  if (isTranslating) {
    const provName = state.isBackendAvailable ? els.providerSelect.value : `Gemini BYOK (${state.userModel})`;
    statusBadge = `<span class="badge-ai">AI 翻譯中（${escapeHtml(provName)}）...</span>`;
    aiBodyHtml = `<p style="color:#766a59;font-size:13.5px;margin:0;">正在結合前後文與古大德法義翻譯，完成後自動存入 <code>${escapeHtml(transPath)}</code>...</p>`;
  } else if (entry) {
    const activeVer =
      entry.versions?.find((v) => v.version_id === entry.active_version_id) ||
      entry.versions?.[(entry.versions?.length || 1) - 1] ||
      {};
    const c = activeVer.content || {};
    const fromKb = entry._lastFromKb !== false;
    statusBadge = fromKb
      ? `<span class="badge-kb">本地知識庫命中（${escapeHtml(activeVer.provider || "Gemini")} / ${escapeHtml(activeVer.model || "")}）</span>`
      : `<span class="badge-ai">AI 新譯並已入庫（${escapeHtml(activeVer.provider || "Gemini")}）</span>`;

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
    const engName = state.isBackendAvailable ? els.providerSelect.value : "Gemini API (BYOK)";
    const actionHint = els.autoHoverTranslate.checked
      ? `游標停留 0.5 秒將自動由 <strong>${escapeHtml(engName)}</strong> 翻譯並存入本機知識庫。`
      : `請直接<strong>點擊右側經句</strong>，即由 <strong>${escapeHtml(engName)}</strong> 翻譯並存入本機知識庫（或勾選頂部「游標停留自動 AI 翻譯」）。`;
    aiBodyHtml = `
      <p style="font-size:12.5px;color:#766a59;margin:0;">
        此句尚未在 <code>${escapeHtml(transPath)}</code> 建立譯文；${actionHint}
      </p>
    `;
  }

  els.analysisPanel.innerHTML = `
    <div class="card-topbar" style="margin-bottom:8px;padding-bottom:6px;">
      <div class="card-topbar-left">
        ${statusBadge}
      </div>
      ${
        isLocked
          ? `<button class="badge-lock" id="unlockBtn">📌 已鎖定（解除）</button>`
          : `<span style="font-size:11px;color:#766a59;">點擊原文鎖定</span>`
      }
    </div>
    <div class="source-quote" style="font-size:14.5px;padding:6px 10px;margin-bottom:8px;">${escapeHtml(sourceText)}</div>
    ${aiBodyHtml}
    ${errorMsg ? `<div class="error-box">⚠️ ${escapeHtml(errorMsg)}</div>` : ""}
  `;

  const unlockBtn = document.getElementById("unlockBtn");
  if (unlockBtn) {
    unlockBtn.addEventListener("click", () => {
      state.lockedSentenceId = null;
      syncSentenceHighlight();
      renderAnalysisPanel();
    });
  }
  const retranslateBtn = document.getElementById("retranslateBtn");
  if (retranslateBtn) {
    retranslateBtn.addEventListener("click", () => triggerTranslateSentence(sid, true));
  }
}

init();
