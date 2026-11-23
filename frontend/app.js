// 大正新脩大藏經｜AI 翻譯與古大德註疏全文同步對齊 前端主邏輯

const state = {
  catalog: null,
  currentSutraId: "T10n0279",
  currentFascicle: 1,
  bundle: null, // { sutra, masters, commentaries, translations, fascicle_count, local_fascicles }
  selectedMasterId: null,
  commFull: null, // { master, juan, total_juans, paragraphs, local_juans, fetched_from_cbeta }
  commBlocks: [],
  commCursorIdx: 0,
  commAlignedIdx: null,
  commMatchedPhrase: null,
  commAlignMode: "", // "forward" | "global" | "hold" | ""
  activeSentenceId: null,
  lockedSentenceId: null,
  translatingSet: new Set(),
  commentaryGuides: {}, // para_id -> record
  hoverTimer: null,
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
  searchInput: document.getElementById("searchInput"),
  jumpParaInput: document.getElementById("jumpParaInput"),
  jumpParaBtn: document.getElementById("jumpParaBtn"),
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

// ---------- 初始化 ----------
async function init() {
  bindEvents();
  await Promise.all([loadLlmStatus(), loadCatalog()]);
  await loadFascicle(state.currentSutraId, state.currentFascicle);
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
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMasterPopup();
  });
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
  try {
    state.llmStatus = await apiJson("/api/llm/status");
    if (state.llmStatus.default_provider) {
      els.providerSelect.value = state.llmStatus.default_provider;
    }
    updateLlmBadge();
  } catch {
    els.llmStatusBadge.textContent = "後端未連線";
    els.llmStatusBadge.className = "status-pill status-warn";
  }
}

function updateLlmBadge() {
  if (!state.llmStatus) return;
  const p = els.providerSelect.value;
  if (p === "gemini") {
    if (state.llmStatus.gemini.configured) {
      els.llmStatusBadge.textContent = `Gemini 就緒 (${state.llmStatus.gemini.model})`;
      els.llmStatusBadge.className = "status-pill status-ok";
    } else {
      els.llmStatusBadge.textContent = "Gemini 尚未設定 .env 金鑰";
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
  state.catalog = await apiJson("/api/catalog");
  renderCatalogTree("");
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
        const localNums = sutra.local_fascicles?.length ? sutra.local_fascicles : [1];
        localNums.slice(0, 6).forEach((fNum) => {
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

// ---------- 載入經卷 ----------
async function loadFascicle(sutraId, fascicle) {
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
      <p class="empty-desc">首次開啟將自動從 CBETA 下載、斷句並永久存入 <code>translation_kb/sutras/</code>。</p>
    </div>`;

  let bundle;
  try {
    bundle = await apiJson(`/api/sutras/${sutraId}/fascicles/${fascicle}`);
  } catch (err) {
    els.sutraContent.innerHTML = `<div class="error-box">⚠️ 載入第 ${fascicle} 卷失敗：${escapeHtml(err.message)}</div>`;
    return;
  }
  state.bundle = bundle;

  if (bundle.fetched_from_cbeta) {
    els.cbetaToast.textContent = `✓ 已自動從 CBETA 下載「${bundle.sutra.sutra_title}」第 ${fascicle} 卷，並永久存入本地知識庫！`;
    els.cbetaToast.style.display = "block";
    loadCatalog().catch(() => {});
  }

  // 決定預設精讀的單一古大德
  const validIds = new Set(bundle.masters.map((m) => m.master_id));
  if (sutraChanged || !state.selectedMasterId || !validIds.has(state.selectedMasterId)) {
    const defMaster = bundle.masters.find((m) => m.default_selected) || bundle.masters[0];
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

  const firstCachedId = Object.keys(bundle.translations || {})[0];
  if (firstCachedId) {
    state.activeSentenceId = firstCachedId;
    renderAnalysisPanel();
    syncSentenceHighlight();
  } else {
    renderAnalysisPanel();
  }

  els.sutraContent.scrollTop = 0;

  // 同步載入所選古大德的對應整卷註疏全文
  if (state.selectedMasterId) {
    await loadCommentaryFulltext(state.selectedMasterId, null);
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
  state.bundle.sutra.paragraphs.forEach((p) => {
    if (p.type === "prose") totalSent += p.sentences.length;
  });
  const cachedCount = Object.keys(state.bundle.translations || {}).length;
  els.kbStatsBadge.textContent = `本卷知識庫 ${cachedCount} / ${totalSent} 句`;
}

// ---------- 古大德 Pop-up 選單 ----------
function renderMastersChips() {
  if (!state.bundle) return;
  els.mastersChips.innerHTML = "";

  state.bundle.masters.forEach((m) => {
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
async function loadCommentaryFulltext(masterId, explicitJuan = null) {
  const masterMeta = state.bundle?.masters.find((m) => m.master_id === masterId);
  els.commMasterTitle.textContent = masterMeta
    ? `${masterMeta.dynasty}・${masterMeta.name.split("（")[0]} ${masterMeta.work_title}`
    : "古大德註疏全文";
  els.commAlignBadge.textContent = "載入全文中...";
  els.commAlignBadge.className = "align-badge hold";
  els.commFullBody.innerHTML = `
    <div class="empty-state" style="padding:24px;">
      <p class="empty-title" style="font-size:14px;">正在載入古大德註疏整卷全文...</p>
      <p class="empty-desc" style="font-size:12.5px;margin:0;">首次開啟將自動定位對應卷次並永久快取至 <code>translation_kb/commentary_fulltext/</code>。</p>
    </div>`;

  try {
    const q = new URLSearchParams({
      sutra_id: state.currentSutraId,
      fascicle: String(state.currentFascicle),
      master_id: masterId,
    });
    if (explicitJuan !== null) q.set("juan", String(explicitJuan));
    const data = await apiJson(`/api/commentaries/fulltext?${q.toString()}`);
    state.commFull = data;
    state.commCursorIdx = 0;
    state.commAlignedIdx = null;
    state.commMatchedPhrase = null;
    renderCommJuanControls();
    renderCommFullBody();

    // 若目前已有選中經句，立即執行順向對齊並捲動高亮
    if (state.activeSentenceId) {
      alignCommentaryToSentence(state.activeSentenceId);
    } else {
      els.commAlignBadge.textContent = `已載入第 ${data.juan} 卷（共 ${data.paragraphs.length} 段）`;
      els.commAlignBadge.className = "align-badge";
    }
  } catch (err) {
    state.commFull = null;
    els.commAlignBadge.textContent = "載入失敗";
    els.commFullBody.innerHTML = `<div class="error-box">⚠️ ${escapeHtml(err.message)}</div>`;
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

function normalizeForMatch(str) {
  return String(str || "")
    .replace(/\[\*\]|\[＊\]|\[[△▽▲▼○●◎□■◇◆╳︽︾?@()/+\-*]+\]/g, "")
    .replace(/[虗灰勅徧却甞胷脉緜]/g, (ch) => ({
      虗: "虛",
      "灰": "灰",
      勅: "敕",
      徧: "遍",
      却: "卻",
      甞: "嘗",
      胷: "胸",
      脉: "脈",
      緜: "綿",
    }[ch] || ch))
    .replace(/[，。；？！：「」『』、（）\s△▽▲▼○●◎□■◇◆·•]/g, "");
}

function getCurrentSutraNormalizedText() {
  if (!state.bundle?.sutra?.paragraphs) return "";
  const parts = [];
  for (const p of state.bundle.sutra.paragraphs) {
    if (p.type === "prose") {
      for (const s of p.sentences || []) {
        parts.push(s.text || "");
      }
    }
  }
  return normalizeForMatch(parts.join(""));
}

const KEPAN_PREFIX_RE = /^(?:\[[△▽▲▼○●◎□■◇◆╳︽︾?@()/+\-*]+\]|[△▽▲▼○●◎□■◇◆])+/;
const COMM_OPENER_RE = /^(?:議曰|疏曰|釋曰|解曰|註曰|注曰|通曰|鈔曰|正脈曰|合解曰|演義曰|案曰|按曰)[：:]/;
const BYLINE_HINT_RE = /(?:譯語|筆受|沙門|比丘|菩薩戒弟子|法師|大師|居士|釋德清|澄觀|真鑑|戒環|智旭|子璿|通潤|傳燈|淨源|智儼|法藏|宗密|李通玄).*[譯述撰解疏註受語書]$|[譯述撰解疏受語]$/;

function classifyCommentaryPara(p, idx, sutraNorm) {
  const raw = (p.text || "").trim();
  if (p.type === "heading") {
    if (idx > 0 && raw.length <= 36 && !/[卷序品]/.test(raw) && BYLINE_HINT_RE.test(raw)) {
      return { role: "byline", displayText: raw };
    }
    return { role: "title", displayText: raw };
  }

  if (KEPAN_PREFIX_RE.test(raw)) {
    const cleaned = raw.replace(KEPAN_PREFIX_RE, "").trim();
    return { role: "kepan", displayText: cleaned || raw };
  }

  // 判斷是否為「引經原文」：不以大德註解起手詞開頭，且與本卷經文高度重疊
  if (sutraNorm && !COMM_OPENER_RE.test(raw)) {
    const norm = normalizeForMatch(raw);
    if (norm.length >= 6 && sutraNorm.includes(norm)) {
      return { role: "sutra", displayText: raw };
    }
    if (norm.length >= 12) {
      let total = 0;
      let hits = 0;
      const step = norm.length > 80 ? 5 : 3;
      for (let i = 0; i <= norm.length - 5; i += step) {
        total++;
        if (sutraNorm.includes(norm.slice(i, i + 5))) hits++;
      }
      if (total > 0 && hits / total >= 0.5) {
        return { role: "sutra", displayText: raw };
      }
    }
  }

  return { role: "commentary", displayText: raw };
}

function buildCommentaryBlocks(paragraphs) {
  const sutraNorm = getCurrentSutraNormalizedText();
  const items = paragraphs.map((p, idx) => ({
    ...p,
    rawIdx: idx,
    ...classifyCommentaryPara(p, idx, sutraNorm),
  }));

  const blocks = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];

    if (cur.role === "title") {
      blocks.push({ kind: "title", items: [cur], rawIndices: [cur.rawIdx] });
      i++;
      continue;
    }

    if (cur.role === "byline") {
      const group = [];
      while (i < items.length && items[i].role === "byline") {
        group.push(items[i]);
        i++;
      }
      blocks.push({
        kind: "byline",
        items: group,
        rawIndices: group.map((x) => x.rawIdx),
      });
      continue;
    }

    if (cur.role === "kepan") {
      blocks.push({ kind: "kepan", items: [cur], rawIndices: [cur.rawIdx] });
      i++;
      continue;
    }

    if (cur.role === "sutra") {
      const group = [];
      while (i < items.length && items[i].role === "sutra") {
        group.push(items[i]);
        i++;
      }
      blocks.push({
        kind: "sutra",
        items: group,
        rawIndices: group.map((x) => x.rawIdx),
      });
      continue;
    }

    // 連續古大德註疏段落：合併為同一連貫註疏區塊（仿般若文海書卷排版）
    const commItems = [];
    while (i < items.length && items[i].role === "commentary") {
      commItems.push(items[i]);
      i++;
    }

    // 將 CBETA 常見的短起手句（如「議曰：此出斷見之疑也。」）或極短尾句自然併入相鄰段落
    const mergedParas = [];
    for (let k = 0; k < commItems.length; k++) {
      const item = commItems[k];
      const next = commItems[k + 1];

      // 短起手句（例如「議曰：此出斷見之疑也。」<= 32 字）與緊接下一段合為同一自然段
      if (
        COMM_OPENER_RE.test(item.displayText) &&
        item.displayText.length <= 32 &&
        next &&
        !COMM_OPENER_RE.test(next.displayText)
      ) {
        mergedParas.push({
          text: item.displayText + next.displayText,
          rawIndices: [item.rawIdx, next.rawIdx],
        });
        k++;
        continue;
      }

      // 極短尾句（<= 28 字且不以起手詞開頭）自然併入前一段末尾
      if (
        mergedParas.length > 0 &&
        item.displayText.length <= 28 &&
        !COMM_OPENER_RE.test(item.displayText) &&
        mergedParas[mergedParas.length - 1].text.length >= 45
      ) {
        const prev = mergedParas[mergedParas.length - 1];
        prev.text += item.displayText;
        prev.rawIndices.push(item.rawIdx);
        continue;
      }

      mergedParas.push({
        text: item.displayText,
        rawIndices: [item.rawIdx],
      });
    }

    const first = commItems[0];
    const groupId =
      commItems.length > 1
        ? `${first.para_id}_g${commItems.length}`
        : first.para_id;

    blocks.push({
      kind: "commentary",
      groupId,
      combinedText: mergedParas.map((mp) => mp.text).join("\n"),
      mergedParas,
      items: commItems,
      rawIndices: commItems.map((x) => x.rawIdx),
    });
  }

  return blocks;
}

function renderCommFullBody() {
  if (!state.commFull || !state.commFull.paragraphs.length) {
    els.commFullBody.innerHTML = `<div class="empty-state" style="padding:20px;">此卷暫無註疏段落，請嘗試切換上方註疏卷次。</div>`;
    return;
  }

  const blocks = buildCommentaryBlocks(state.commFull.paragraphs);
  state.commBlocks = blocks;

  const frag = document.createDocumentFragment();
  const sheet = document.createElement("div");
  sheet.className = "comm-book-sheet";

  blocks.forEach((blk, blkIdx) => {
    if (blk.kind === "title") {
      const el = document.createElement("h3");
      el.className = "comm-book-title";
      el.dataset.blkIdx = String(blkIdx);
      el.dataset.rawIndices = blk.rawIndices.join(",");
      el.textContent = blk.items[0].displayText;
      sheet.appendChild(el);
      return;
    }

    if (blk.kind === "byline") {
      const el = document.createElement("div");
      el.className = "comm-book-bylines";
      el.dataset.blkIdx = String(blkIdx);
      el.dataset.rawIndices = blk.rawIndices.join(",");
      el.innerHTML = blk.items
        .map((it) => `<div class="comm-byline-line">${escapeHtml(it.displayText)}</div>`)
        .join("");
      sheet.appendChild(el);
      return;
    }

    if (blk.kind === "kepan") {
      const el = document.createElement("div");
      el.className = "comm-kepan";
      el.dataset.blkIdx = String(blkIdx);
      el.dataset.rawIndices = blk.rawIndices.join(",");
      const headingText = blk.items[0].displayText.replace(/[。.]$/, "：");
      el.innerHTML = `<span class="comm-kepan-text">${escapeHtml(headingText)}</span>`;
      sheet.appendChild(el);
      return;
    }

    if (blk.kind === "sutra") {
      const box = document.createElement("div");
      box.className = "comm-sutra-block";
      box.dataset.blkIdx = String(blkIdx);
      box.dataset.rawIndices = blk.rawIndices.join(",");
      box.innerHTML = blk.items
        .map(
          (it) =>
            `<p class="comm-sutra-p" data-raw-indices="${it.rawIdx}">${escapeHtml(it.displayText)}</p>`
        )
        .join("");
      sheet.appendChild(box);
      return;
    }

    // 古大德註疏連貫群組
    const groupEl = document.createElement("div");
    groupEl.className = "comm-prose-group";
    groupEl.dataset.blkIdx = String(blkIdx);
    groupEl.dataset.rawIndices = blk.rawIndices.join(",");

    const guide = state.commentaryGuides[blk.groupId];
    const parasHtml = blk.mergedParas
      .map(
        (mp) =>
          `<p class="comm-prose-p" data-raw-indices="${mp.rawIndices.join(",")}">${escapeHtml(mp.text)}</p>`
      )
      .join("");

    groupEl.innerHTML = `
      <div class="comm-group-toolbar">
        <button class="mini-btn comm-guide-btn" data-blk-idx="${blkIdx}" title="將此整段古大德註疏轉為現代白話導讀">✨ AI 白話導讀</button>
      </div>
      <div class="comm-prose-flow">${parasHtml}</div>
      ${
        guide
          ? `<div class="plain-guide-box"><strong>白話導讀（${guide.from_kb ? "知識庫" : guide.provider}）：</strong>${escapeHtml(guide.plain_guide)}</div>`
          : ""
      }
    `;
    sheet.appendChild(groupEl);
  });

  frag.appendChild(sheet);
  els.commFullBody.innerHTML = "";
  els.commFullBody.appendChild(frag);

  els.commFullBody.querySelectorAll(".comm-guide-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const bIdx = parseInt(btn.dataset.blkIdx, 10);
      const blk = state.commBlocks?.[bIdx];
      if (blk) {
        triggerTranslateCommentaryPara(
          { para_id: blk.groupId, text: blk.combinedText },
          btn
        );
      }
    });
  });
}

// ---------- 順向單調視窗對齊演算法（Monotonic Forward-Window Alignment） ----------
function extractSearchPhrases(text) {
  const clean = text.replace(/\[\*\]|\[＊\]|\s+/g, "");
  const clauses = clean
    .split(/[，。；？！：「」『』、（）]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

  const phrases = [];
  for (const c of clauses) {
    if (STOP_PHRASES.has(c)) continue;
    if (c.length <= 6) {
      phrases.push(c);
    } else {
      phrases.push(c.slice(0, 5));
      phrases.push(c.slice(-4));
      if (c.length >= 9) phrases.push(c.slice(2, 6));
    }
  }
  return Array.from(new Set(phrases)).filter((p) => p.length >= 3 && !STOP_PHRASES.has(p));
}

function getSutraProgressRatio(sentenceId) {
  if (!state.bundle) return 0;
  const paras = state.bundle.sutra.paragraphs;
  for (let i = 0; i < paras.length; i++) {
    if (paras[i].sentences.some((s) => s.sentence_id === sentenceId)) {
      return i / Math.max(1, paras.length - 1);
    }
  }
  return 0;
}

function scoreCommentaryParagraph(paraText, phrases) {
  let bestScore = 0;
  let bestPhrase = null;
  for (const ph of phrases) {
    if (paraText.includes(ph)) {
      const sc = ph.length;
      if (sc > bestScore) {
        bestScore = sc;
        bestPhrase = ph;
      }
    }
  }
  return { score: bestScore, phrase: bestPhrase };
}

function alignCommentaryToSentence(sentenceId) {
  if (!state.commFull || !state.commFull.paragraphs.length) return;
  const text = findSentenceText(sentenceId);
  const phrases = extractSearchPhrases(text);
  const paras = state.commFull.paragraphs;

  if (phrases.length === 0) return;

  // Pass 1: 順向近鄰視窗 [cursor - 2, cursor + 35]（杜絕全經高頻詞誤跳）
  const winStart = Math.max(0, state.commCursorIdx - 2);
  const winEnd = Math.min(paras.length - 1, state.commCursorIdx + 35);
  let bestIdx = -1;
  let bestScore = 0;
  let bestPhrase = null;
  let mode = "forward";

  for (let i = winStart; i <= winEnd; i++) {
    const { score, phrase } = scoreCommentaryParagraph(paras[i].text, phrases);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
      bestPhrase = phrase;
    }
  }

  // Pass 2: 若使用者跨段跳讀（近鄰視窗未命中），依原經相對進度比例掃描全卷重定位
  if (bestIdx === -1) {
    const ratio = getSutraProgressRatio(sentenceId);
    const expectedIdx = Math.round(ratio * (paras.length - 1));
    let bestCost = Infinity;
    for (let i = 0; i < paras.length; i++) {
      const { score, phrase } = scoreCommentaryParagraph(paras[i].text, phrases);
      if (score > 0) {
        // 越靠近預期比例位置且片語越長者優先
        const cost = Math.abs(i - expectedIdx) - score * 6;
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = i;
          bestPhrase = phrase;
          bestScore = score;
          mode = "global";
        }
      }
    }
  }

  if (bestIdx !== -1) {
    state.commCursorIdx = bestIdx;
    state.commAlignedIdx = bestIdx;
    state.commMatchedPhrase = bestPhrase;
    state.commAlignMode = mode;
    els.commAlignBadge.textContent =
      mode === "forward"
        ? `✓ 順向對齊第 ${bestIdx + 1} 段（「${bestPhrase}」）`
        : `↘ 跳段定位第 ${bestIdx + 1} 段（「${bestPhrase}」）`;
    els.commAlignBadge.className = "align-badge";
    highlightAndScrollCommentary(bestIdx, bestPhrase);
  } else {
    // Pass 3: 總釋未單獨牒經 -> 停留在當前科判大段不變空
    state.commAlignMode = "hold";
    els.commAlignBadge.textContent = `↳ 承上段科判總釋（停於第 ${state.commCursorIdx + 1} 段）`;
    els.commAlignBadge.className = "align-badge hold";
    highlightAndScrollCommentary(state.commCursorIdx, null);
  }
}

function highlightAndScrollCommentary(targetIdx, matchedPhrase) {
  // 清除先前高亮與 <mark>
  els.commFullBody.querySelectorAll(".aligned, .aligned-context").forEach((el) => {
    el.classList.remove("aligned", "aligned-context");
  });
  els.commFullBody.querySelectorAll("mark.comm-hit").forEach((mk) => {
    mk.replaceWith(document.createTextNode(mk.textContent || ""));
  });

  // 找到包含 targetIdx 的段落與所屬區塊
  const targetStr = String(targetIdx);
  let targetPara = null;
  let targetBlock = null;

  for (const el of els.commFullBody.querySelectorAll("[data-blk-idx]")) {
    const indices = (el.dataset.rawIndices || "").split(",");
    if (indices.includes(targetStr)) {
      targetBlock = el;
      break;
    }
  }
  if (!targetBlock) return;

  for (const p of targetBlock.querySelectorAll("[data-raw-indices]")) {
    const indices = (p.dataset.rawIndices || "").split(",");
    if (indices.includes(targetStr)) {
      targetPara = p;
      break;
    }
  }

  targetBlock.classList.add("aligned");
  if (targetPara) targetPara.classList.add("aligned");

  // 若對齊命中「引經原文」區塊，順帶柔和標示緊接在後的「古大德註疏群組」方便一併閱讀
  if (targetBlock.classList.contains("comm-sutra-block")) {
    const nextEl = targetBlock.nextElementSibling;
    if (nextEl && nextEl.classList.contains("comm-prose-group")) {
      nextEl.classList.add("aligned-context");
    }
  }

  const textHost = targetPara || targetBlock.querySelector(".comm-kepan-text") || targetBlock;
  if (matchedPhrase && textHost) {
    const rawText = textHost.textContent || "";
    if (rawText.includes(matchedPhrase)) {
      const escapedFull = escapeHtml(rawText);
      const escapedPh = escapeHtml(matchedPhrase);
      textHost.innerHTML = escapedFull.replace(
        escapedPh,
        `<mark class="comm-hit">${escapedPh}</mark>`
      );
    }
  }

  const scrollTarget = targetBlock.classList.contains("comm-sutra-block")
    ? targetBlock
    : targetPara || targetBlock;
  scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- 渲染漢文原文 ----------
function renderSutraContent() {
  if (!state.bundle) return;
  els.sutraContent.innerHTML = "";

  state.bundle.sutra.paragraphs.forEach((para) => {
    const card = document.createElement("article");
    card.className = "para-card" + (para.type === "heading" ? " heading-para" : "");
    card.dataset.paraIndex = para.index;

    const num = document.createElement("div");
    num.className = "para-num";
    num.textContent = para.index;
    card.appendChild(num);

    const textDiv = document.createElement("div");
    textDiv.className = "para-text";

    para.sentences.forEach((sent) => {
      const span = document.createElement("span");
      const isCached = Boolean(state.bundle.translations?.[sent.sentence_id]);
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
  if (state.lockedSentenceId === sentenceId) {
    state.lockedSentenceId = null;
  } else {
    state.lockedSentenceId = sentenceId;
    state.activeSentenceId = sentenceId;
  }
  syncSentenceHighlight();
  renderAnalysisPanel();
  alignCommentaryToSentence(sentenceId);

  if (state.lockedSentenceId === sentenceId && !state.bundle?.translations?.[sentenceId]) {
    triggerTranslateSentence(sentenceId, false);
  }
}

function findSentenceText(sentenceId) {
  if (!state.bundle) return "";
  for (const p of state.bundle.sutra.paragraphs) {
    for (const s of p.sentences) {
      if (s.sentence_id === sentenceId) return s.text;
    }
  }
  return "";
}

async function triggerTranslateSentence(sentenceId, forceRefresh = false) {
  if (state.translatingSet.has(sentenceId)) return;
  state.translatingSet.add(sentenceId);
  renderAnalysisPanel();

  try {
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
    updateKbStats();
    syncSentenceHighlight();
    renderAnalysisPanel();
  } catch (err) {
    renderAnalysisPanel(err.message);
  } finally {
    state.translatingSet.delete(sentenceId);
    if (state.activeSentenceId === sentenceId) {
      renderAnalysisPanel(state.bundle?.translations?.[sentenceId] ? null : undefined);
    }
  }
}

async function triggerTranslateCommentaryPara(para, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = "導讀生成中...";
  try {
    const res = await apiJson("/api/translate/commentary", {
      method: "POST",
      body: JSON.stringify({
        sutra_id: state.currentSutraId,
        master_id: state.selectedMasterId,
        fascicle: state.commFull?.juan || state.currentFascicle,
        commentary_id: para.para_id,
        original_text: para.text,
        provider: els.providerSelect.value,
      }),
    });
    state.commentaryGuides[para.para_id] = { ...res.record, from_kb: res.from_kb };
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

  let aiBodyHtml = "";
  let statusBadge = `<span class="badge-ai">本地知識庫尚無譯文</span>`;

  if (isTranslating) {
    statusBadge = `<span class="badge-ai">AI 翻譯中（${escapeHtml(els.providerSelect.value)}）...</span>`;
    aiBodyHtml = `<p style="color:#766a59;font-size:13.5px;margin:0;">正在結合前後文與古大德法義翻譯，完成後自動存入 <code>translation_kb/</code>...</p>`;
  } else if (entry) {
    const activeVer =
      entry.versions.find((v) => v.version_id === entry.active_version_id) ||
      entry.versions[entry.versions.length - 1];
    const c = activeVer.content || {};
    const fromKb = entry._lastFromKb !== false;
    statusBadge = fromKb
      ? `<span class="badge-kb">本地知識庫命中（${escapeHtml(activeVer.provider)} / ${escapeHtml(activeVer.model)}）</span>`
      : `<span class="badge-ai">AI 新譯並已入庫（${escapeHtml(activeVer.provider)}）</span>`;

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
        <span style="font-size:11.5px;color:#766a59;">已存版本數：${entry.versions.length}</span>
      </div>
    `;
  } else {
    aiBodyHtml = `
      <p style="font-size:13px;color:#766a59;margin:0 0 8px;">
        此句尚未在 <code>translation_kb/</code> 建立譯文，點擊即可由 <strong>${escapeHtml(els.providerSelect.value)}</strong> 翻譯並永久存庫。
      </p>
      <button class="primary-btn" id="translateNowBtn">立即 AI 翻譯並存入知識庫</button>
    `;
  }

  els.analysisPanel.innerHTML = `
    <div class="card-topbar" style="margin-bottom:8px;padding-bottom:6px;">
      ${statusBadge}
      ${
        isLocked
          ? `<button class="badge-lock" id="unlockBtn">📌 已鎖定（解除）</button>`
          : `<span style="font-size:11px;color:#766a59;">點擊原文鎖定</span>`
      }
    </div>
    <div class="source-quote" style="font-size:14.5px;padding:6px 10px;margin-bottom:10px;">${escapeHtml(sourceText)}</div>
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
  const translateNowBtn = document.getElementById("translateNowBtn");
  if (translateNowBtn) {
    translateNowBtn.addEventListener("click", () => triggerTranslateSentence(sid, false));
  }
  const retranslateBtn = document.getElementById("retranslateBtn");
  if (retranslateBtn) {
    retranslateBtn.addEventListener("click", () => triggerTranslateSentence(sid, true));
  }
}

init();
