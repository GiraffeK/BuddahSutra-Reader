"""
BuddhaSutra-Reader FastAPI 主服務。
提供大藏經階層目錄、經文與古大德註疏讀取、以及 Cache-First AI 翻譯 API。
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.cbeta_fetcher import (
    fetch_cbeta_fascicle,
    fetch_commentary_fulltext_juan,
    resolve_commentary_juan,
    search_cbeta_commentaries_for_sentence,
)
from backend.gaiji import normalize_paragraphs
from backend.kb_store import KnowledgeBaseStore
from backend.llm_service import LLMTranslationService

ROOT_DIR = Path(__file__).resolve().parent.parent
KB_DIR = ROOT_DIR / "translation_kb"
FRONTEND_DIR = ROOT_DIR / "frontend"

app = FastAPI(title="大正新脩大藏經 AI 白話翻譯與古大德註疏系統", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_static_cache(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
    return response

kb = KnowledgeBaseStore(KB_DIR)
if kb.index is not None:
    try:
        kb.index.ensure_ready(kb)
    except Exception:
        pass
llm = LLMTranslationService()

# 併發去重鎖：避免滑鼠重複劃過同一未翻譯句子時打多次 LLM API
_inflight_locks: dict[str, asyncio.Lock] = {}


def _get_inflight_lock(key: str) -> asyncio.Lock:
    if key not in _inflight_locks:
        _inflight_locks[key] = asyncio.Lock()
    return _inflight_locks[key]


_NETWORK_HINT = (
    "無法連線 CBETA（網路或 DNS 解析失敗）。此卷尚未入庫，需要連網下載；"
    "請確認網路／VPN／防火牆後重試。已入庫的經卷與註疏不受影響。"
)


def _is_network_error(exc: BaseException) -> bool:
    import httpx

    return isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, OSError))


class TranslateSentenceRequest(BaseModel):
    sutra_id: str
    fascicle: int
    sentence_id: str
    provider: str | None = Field(default=None, description="gemini 或 ollama，預設走設定值 gemini")
    model: str | None = None
    selected_masters: list[str] | None = None
    force_refresh: bool = False


class TranslateCommentaryRequest(BaseModel):
    sutra_id: str
    master_id: str
    fascicle: int
    commentary_id: str
    original_text: str | None = None
    provider: str | None = None
    model: str | None = None
    force_refresh: bool = False


class LookupCommentariesRequest(BaseModel):
    sutra_id: str
    fascicle: int
    sentence_id: str
    selected_masters: list[str] | None = None


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "project": "BuddhaSutra-Reader"}


@app.get("/api/llm/status")
async def llm_status() -> dict[str, Any]:
    return await llm.get_status()


@app.get("/api/catalog")
async def get_catalog() -> dict[str, Any]:
    try:
        cat = kb.get_catalog()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # 動態附加每部經在本地 translation_kb/sutras/ 已入庫的卷次清單
    for div in cat.get("divisions", []):
        for s in div.get("sutras", []):
            s["local_fascicles"] = kb.list_local_fascicles(s["sutra_id"])
    return cat


@app.get("/api/kb/stats")
async def get_kb_stats() -> dict[str, Any]:
    index_stats = kb.index.get_stats() if kb.index is not None else None
    return {"storage": kb.get_storage_summary(), "index": index_stats}


@app.get("/api/kb/search")
async def search_kb(
    q: str = "",
    scope: str = "all",
    sutra_id: str | None = None,
    limit: int = 30,
) -> dict[str, Any]:
    if kb.index is None:
        raise HTTPException(status_code=503, detail="SQLite 索引未啟用")
    return kb.index.search(q, scope=scope, sutra_id=sutra_id, limit=limit)


@app.post("/api/kb/reindex")
async def reindex_kb() -> dict[str, Any]:
    if kb.index is None:
        raise HTTPException(status_code=503, detail="SQLite 索引未啟用")
    stats = kb.index.rebuild_from_json(kb)
    return {"status": "ok", "index": stats}


@app.get("/api/glossary/{sutra_id}")
async def get_sutra_glossary(sutra_id: str) -> dict[str, Any]:
    return kb.get_glossary(sutra_id)


@app.get("/api/sutras/{sutra_id}/fascicles/{fascicle}")
async def get_fascicle_bundle(sutra_id: str, fascicle: int) -> dict[str, Any]:
    """一次回傳該卷原文、歷代大德清單、註疏對照、以及本地知識庫所有已翻譯句子。
    若本地尚未匯入該卷，則自動從 CBETA Online Data API 下載、斷句並永久存入 translation_kb/sutras/。"""
    fetched_from_cbeta = False
    try:
        sutra_data = kb.get_sutra_fascicle(sutra_id, fascicle)
    except FileNotFoundError:
        fetch_lock = _get_inflight_lock(f"cbeta:{sutra_id}:{fascicle}")
        async with fetch_lock:
            try:
                sutra_data = kb.get_sutra_fascicle(sutra_id, fascicle)
            except FileNotFoundError:
                try:
                    sutra_data = await fetch_cbeta_fascicle(sutra_id, fascicle)
                    kb.save_sutra_fascicle(sutra_id, fascicle, sutra_data)
                    fetched_from_cbeta = True
                except FileNotFoundError as exc:
                    raise HTTPException(status_code=404, detail=str(exc)) from exc
                except Exception as exc:
                    if _is_network_error(exc):
                        raise HTTPException(status_code=503, detail=_NETWORK_HINT) from exc
                    raise HTTPException(status_code=502, detail=f"從 CBETA 下載經文失敗：{exc}") from exc

    masters = kb.get_masters_for_sutra(sutra_id)
    commentaries = kb.get_commentaries_for_fascicle(sutra_id, fascicle)
    cached_translations = kb.get_all_translations_for_fascicle(sutra_id, fascicle)
    fascicle_count = int(sutra_data.get("fascicle_count") or kb.get_sutra_fascicle_count(sutra_id))
    local_fascicles = kb.list_local_fascicles(sutra_id)

    return {
        "sutra": sutra_data,
        "masters": masters,
        "commentaries": commentaries,
        "translations": cached_translations,
        "fascicle_count": fascicle_count,
        "local_fascicles": local_fascicles,
        "fetched_from_cbeta": fetched_from_cbeta,
        "storage_paths": kb.get_storage_paths(sutra_id, fascicle),
    }


@app.post("/api/translate/sentence")
async def translate_sentence(req: TranslateSentenceRequest) -> dict[str, Any]:
    lock_key = f"{req.sutra_id}:{req.fascicle}:{req.sentence_id}"
    storage_path = kb.get_storage_paths(req.sutra_id, req.fascicle)["translation_file"]
    async with _get_inflight_lock(lock_key):
        # Step 1: Cache-First 查詢本地翻譯知識庫
        if not req.force_refresh:
            cached = kb.get_sentence_translation(req.sutra_id, req.fascicle, req.sentence_id)
            if cached:
                return {"from_kb": True, "entry": cached, "storage_path": storage_path}

        # Step 2: 讀取原文上下文與已勾選古大德註疏
        try:
            ctx = kb.get_sentence_with_context(req.sutra_id, req.fascicle, req.sentence_id)
        except (FileNotFoundError, KeyError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        commentaries = kb.get_commentaries_for_sentence(
            req.sutra_id, req.fascicle, req.sentence_id, req.selected_masters
        )
        # 若本地尚未收錄該句之古大德註疏（例如卷二以後），自動向 CBETA 檢索並永久快取入庫
        if not commentaries:
            all_masters = kb.get_masters_for_sutra(req.sutra_id)
            target_masters = (
                [m for m in all_masters if m["master_id"] in req.selected_masters]
                if req.selected_masters
                else all_masters
            )
            fetched_map = await search_cbeta_commentaries_for_sentence(
                req.sutra_id, req.fascicle, req.sentence_id, ctx["sentence"]["text"], target_masters
            )
            for mid, new_entries in fetched_map.items():
                kb.save_commentary_entries(req.sutra_id, mid, req.fascicle, new_entries)
            if fetched_map:
                commentaries = kb.get_commentaries_for_sentence(
                    req.sutra_id, req.fascicle, req.sentence_id, req.selected_masters
                )

        # Step 3: 呼叫 LLM（預設 Gemini API，可選 Ollama）
        try:
            content, used_provider, used_model = await llm.translate_sentence(
                sutra_title=ctx["sutra_title"],
                edition=ctx["edition"],
                target_text=ctx["sentence"]["text"],
                prev_sentences=ctx["prev_sentences"],
                next_sentences=ctx["next_sentences"],
                commentaries=commentaries,
                provider=req.provider,
                model_override=req.model,
            )
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        # Step 4: 原子寫入本地翻譯知識庫
        referenced_masters = sorted({c["master_id"] for c in commentaries})
        saved = kb.save_sentence_translation(
            sutra_id=req.sutra_id,
            fascicle=req.fascicle,
            sentence_id=req.sentence_id,
            source_text=ctx["sentence"]["text"],
            provider=used_provider,
            model=used_model,
            content=content,
            referenced_masters=referenced_masters,
        )
        return {"from_kb": False, "entry": saved, "storage_path": storage_path}


@app.get("/api/commentaries/fulltext")
async def get_commentary_fulltext_api(
    sutra_id: str,
    fascicle: int,
    master_id: str,
    juan: int | None = None,
) -> dict[str, Any]:
    """載入指定古大德的整卷註疏全文（優先讀本地快取，否則自動定位對應卷次並從 CBETA 下載永久入庫）。"""
    masters = {m["master_id"]: m for m in kb.get_masters_for_sutra(sutra_id)}
    master = masters.get(master_id)
    if not master:
        raise HTTPException(status_code=404, detail=f"找不到古大德：{master_id}")

    # 若無 CBETA 線上典籍（例如圓瑛大師講義），回傳本地精選註疏組成全文段落
    if not master.get("primary_work"):
        local_entries = kb.get_commentaries_for_fascicle(sutra_id, fascicle).get(master_id, [])
        paras = [
            {
                "index": i + 1,
                "para_id": e["commentary_id"],
                "type": "prose",
                "text": f"【{e.get('section_heading', '')}】{e.get('original_commentary', '')}",
            }
            for i, e in enumerate(local_entries)
        ]
        return {
            "master": master,
            "juan": fascicle,
            "total_juans": master.get("total_juans", 1),
            "fetched_from_cbeta": False,
            "local_juans": [fascicle],
            "paragraphs": paras,
        }

    target_juan = juan
    if target_juan is None:
        # 依目前經卷開頭正文書句自動定位該大德對應卷號
        sutra_data = kb.get_sutra_fascicle(sutra_id, fascicle)
        prose_sents = [
            s["text"]
            for p in sutra_data.get("paragraphs", [])
            if p.get("type") == "prose"
            for s in p.get("sentences", [])
        ]
        sutra_total = int(sutra_data.get("fascicle_count") or kb.get_sutra_fascicle_count(sutra_id))
        target_juan = await resolve_commentary_juan(
            work_code=master["primary_work"],
            total_commentary_juans=int(master.get("total_juans") or 1),
            sutra_fascicle=fascicle,
            sutra_fascicle_count=sutra_total,
            sample_sentences=prose_sents,
        )

    fetched_from_cbeta = False
    data = kb.get_commentary_fulltext(master_id, target_juan)
    if data is None:
        lock = _get_inflight_lock(f"comm_full:{master_id}:{target_juan}")
        async with lock:
            data = kb.get_commentary_fulltext(master_id, target_juan)
            if data is None:
                try:
                    data = await fetch_commentary_fulltext_juan(master, target_juan)
                    kb.save_commentary_fulltext(master_id, target_juan, data)
                    fetched_from_cbeta = True
                except FileNotFoundError as exc:
                    raise HTTPException(status_code=404, detail=str(exc)) from exc
                except Exception as exc:
                    if _is_network_error(exc):
                        raise HTTPException(status_code=503, detail=_NETWORK_HINT) from exc
                    raise HTTPException(
                        status_code=502,
                        detail=f"載入古大德註疏全文失敗：{type(exc).__name__}: {exc}",
                    ) from exc

    return {
        "master": master,
        "juan": data["juan"],
        "total_juans": data.get("total_juans") or master.get("total_juans", 1),
        "fetched_from_cbeta": fetched_from_cbeta,
        "local_juans": kb.list_local_commentary_juans(master_id),
        "paragraphs": normalize_paragraphs(data.get("paragraphs", [])),
    }


@app.post("/api/commentaries/lookup")
async def lookup_commentaries(req: LookupCommentariesRequest) -> dict[str, Any]:
    """針對指定經句：優先查本地知識庫，若尚未收錄則即時向 CBETA 檢索各古大德註疏並寫入本地快取。"""
    lock_key = f"comm:{req.sutra_id}:{req.fascicle}:{req.sentence_id}"
    async with _get_inflight_lock(lock_key):
        try:
            ctx = kb.get_sentence_with_context(req.sutra_id, req.fascicle, req.sentence_id)
        except (FileNotFoundError, KeyError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        all_masters = kb.get_masters_for_sutra(req.sutra_id)
        target_masters = (
            [m for m in all_masters if m["master_id"] in req.selected_masters]
            if req.selected_masters
            else all_masters
        )

        # 檢查哪些大德在此句還沒有本地條目
        existing_all = kb.get_commentaries_for_fascicle(req.sutra_id, req.fascicle)
        missing_masters = []
        for m in target_masters:
            mid = m["master_id"]
            has_sent = any(
                req.sentence_id in (e.get("target_sentence_ids") or [])
                for e in existing_all.get(mid, [])
            )
            if not has_sent:
                missing_masters.append(m)

        fetched_count = 0
        if missing_masters:
            fetched_map = await search_cbeta_commentaries_for_sentence(
                req.sutra_id,
                req.fascicle,
                req.sentence_id,
                ctx["sentence"]["text"],
                missing_masters,
            )
            for mid, new_entries in fetched_map.items():
                kb.save_commentary_entries(req.sutra_id, mid, req.fascicle, new_entries)
                fetched_count += len(new_entries)

        updated_all = kb.get_commentaries_for_fascicle(req.sutra_id, req.fascicle)
        return {
            "fetched_count": fetched_count,
            "commentaries": updated_all,
        }


@app.post("/api/translate/commentary")
async def translate_commentary(req: TranslateCommentaryRequest) -> dict[str, Any]:
    if not req.force_refresh:
        cached = kb.get_commentary_translation(
            req.sutra_id, req.master_id, req.fascicle, req.commentary_id
        )
        if cached:
            return {"from_kb": True, "record": cached}

    masters = {m["master_id"]: m for m in kb.get_masters_for_sutra(req.sutra_id)}
    master = masters.get(req.master_id)
    if not master:
        raise HTTPException(status_code=404, detail="找不到指定的古大德")

    orig_text = (req.original_text or "").strip()
    if not orig_text:
        all_comm = kb.get_commentaries_for_fascicle(req.sutra_id, req.fascicle).get(req.master_id, [])
        target = next((c for c in all_comm if c["commentary_id"] == req.commentary_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="找不到指定的古大德註疏條目")
        orig_text = target["original_commentary"]

    try:
        plain_guide, used_provider, used_model = await llm.translate_commentary(
            master_name=master["name"],
            work_title=master["work_title"],
            original_commentary=orig_text,
            provider=req.provider,
            model_override=req.model,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    saved = kb.save_commentary_translation(
        sutra_id=req.sutra_id,
        master_id=req.master_id,
        fascicle=req.fascicle,
        commentary_id=req.commentary_id,
        plain_guide=plain_guide,
        provider=used_provider,
        model=used_model,
    )
    return {"from_kb": False, "record": saved}


if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/styles.css")
    async def serve_styles() -> FileResponse:
        return FileResponse(FRONTEND_DIR / "styles.css")

    @app.get("/app.js")
    async def serve_app_js() -> FileResponse:
        return FileResponse(FRONTEND_DIR / "app.js")

    @app.get("/")
    async def serve_index() -> FileResponse:
        return FileResponse(FRONTEND_DIR / "index.html")
