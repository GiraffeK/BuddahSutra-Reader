"""
translation_kb SQLite 加速索引模組（方案 3）。

核心原則：
- JSON 分片檔案永遠是單一真實來源（Single Source of Truth）。
- `translation_kb/.index/kb_index.sqlite` 僅作為可隨時由 JSON 重建之高速檢索索引（已列入 .gitignore）。
- 支援依部別、經號、卷次與全文關鍵字跨經毫秒級查詢經句、AI 譯文與佛學名相。
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

TZ_TAIPEI = timezone(timedelta(hours=8))


def _now_iso() -> str:
    return datetime.now(TZ_TAIPEI).isoformat(timespec="seconds")


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class KnowledgeBaseIndex:
    """可隨時由 JSON 重建之 SQLite 知識庫索引。"""

    def __init__(self, kb_root: Path) -> None:
        self.kb_root = kb_root
        self.db_path = kb_root / ".index" / "kb_index.sqlite"
        self._lock = threading.Lock()

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        self._init_schema(conn)
        return conn

    def _init_schema(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS sentences (
                sentence_id TEXT PRIMARY KEY,
                sutra_id TEXT NOT NULL,
                sutra_title TEXT NOT NULL,
                fascicle INTEGER NOT NULL,
                para_index INTEGER NOT NULL,
                text TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS translations (
                sentence_id TEXT PRIMARY KEY,
                sutra_id TEXT NOT NULL,
                sutra_title TEXT NOT NULL,
                fascicle INTEGER NOT NULL,
                source_text TEXT NOT NULL,
                literal_translation TEXT NOT NULL,
                colloquial_translation TEXT NOT NULL,
                dharma_analysis TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS glossary (
                sutra_id TEXT NOT NULL,
                term TEXT NOT NULL,
                explanation TEXT NOT NULL,
                sutra_title TEXT NOT NULL,
                first_seen_fascicle INTEGER,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (sutra_id, term)
            );

            CREATE TABLE IF NOT EXISTS commentaries (
                sutra_id TEXT NOT NULL,
                master_id TEXT NOT NULL,
                commentary_id TEXT NOT NULL,
                fascicle INTEGER NOT NULL,
                section_heading TEXT NOT NULL,
                original_commentary TEXT NOT NULL,
                PRIMARY KEY (sutra_id, master_id, commentary_id)
            );

            CREATE INDEX IF NOT EXISTS idx_sent_sutra ON sentences (sutra_id, fascicle);
            CREATE INDEX IF NOT EXISTS idx_trans_sutra ON translations (sutra_id, fascicle);
            CREATE INDEX IF NOT EXISTS idx_gloss_term ON glossary (term);
            CREATE INDEX IF NOT EXISTS idx_comm_sutra ON commentaries (sutra_id, fascicle);
            """
        )

    def ensure_ready(self, kb: Any) -> None:
        """若索引檔尚未建立或缺少重建記錄，自動自 JSON 建立完整索引。"""
        if not self.db_path.exists():
            self.rebuild_from_json(kb)
            return
        with self._lock:
            with closing(self._connect()) as conn:
                row = conn.execute("SELECT value FROM meta WHERE key = 'rebuilt_at'").fetchone()
                has_meta = bool(row and row["value"])
        if not has_meta:
            self.rebuild_from_json(kb)

    def _resolve_active_version(self, entry: dict[str, Any]) -> dict[str, Any]:
        versions = entry.get("versions") or []
        if not versions:
            return {}
        active_id = entry.get("active_version_id")
        for ver in versions:
            if ver.get("version_id") == active_id:
                return ver
        return versions[-1]

    def rebuild_from_json(self, kb: Any) -> dict[str, Any]:
        """掃描所有 JSON 分片，原子重建完整 SQLite 索引。"""
        sentence_rows: list[tuple[Any, ...]] = []
        translation_rows: list[tuple[Any, ...]] = []
        glossary_rows: list[tuple[Any, ...]] = []
        commentary_rows: list[tuple[Any, ...]] = []

        for sutra_id in kb.iter_stored_sutra_ids():
            sutra_title = kb.get_sutra_title(sutra_id)

            for fascicle in kb.list_local_fascicles(sutra_id):
                try:
                    fdata = kb.get_sutra_fascicle(sutra_id, fascicle)
                except Exception:
                    continue
                ftitle = fdata.get("sutra_title") or sutra_title
                for para in fdata.get("paragraphs", []):
                    p_idx = int(para.get("index") or 0)
                    for sent in para.get("sentences", []):
                        sid = sent.get("sentence_id", "")
                        if not sid:
                            continue
                        sentence_rows.append((
                            sid,
                            sutra_id,
                            ftitle,
                            fascicle,
                            p_idx,
                            sent.get("text", ""),
                        ))

            for fascicle in kb.list_local_translation_fascicles(sutra_id):
                tdoc = kb.get_translation_doc(sutra_id, fascicle)
                if not tdoc:
                    continue
                doc_updated = tdoc.get("updated_at", "")
                for sid, entry in (tdoc.get("entries") or {}).items():
                    ver = self._resolve_active_version(entry)
                    content = ver.get("content") or {}
                    translation_rows.append((
                        sid,
                        sutra_id,
                        sutra_title,
                        fascicle,
                        entry.get("source_text", ""),
                        str(content.get("literal_translation", "")),
                        str(content.get("colloquial_translation", "")),
                        str(content.get("dharma_analysis", "")),
                        str(ver.get("provider", "")),
                        str(ver.get("model", "")),
                        str(ver.get("created_at") or doc_updated),
                    ))

            gdoc = kb.get_glossary(sutra_id)
            g_updated = gdoc.get("updated_at", "")
            g_title = gdoc.get("sutra_title") or sutra_title
            for term_name, tinfo in (gdoc.get("terms") or {}).items():
                first_fasc = tinfo.get("first_seen_fascicle")
                glossary_rows.append((
                    sutra_id,
                    tinfo.get("term") or term_name,
                    tinfo.get("explanation", ""),
                    g_title,
                    int(first_fasc) if isinstance(first_fasc, int) else None,
                    str(tinfo.get("updated_at") or g_updated),
                ))

            for master_id, fascicle, cdoc in kb.iter_commentary_files(sutra_id):
                for item in cdoc.get("entries") or []:
                    cid = item.get("commentary_id", "")
                    if not cid:
                        continue
                    commentary_rows.append((
                        sutra_id,
                        master_id,
                        cid,
                        fascicle,
                        str(item.get("section_heading", "")),
                        str(item.get("original_commentary", "")),
                    ))

        rebuilt_at = _now_iso()
        with self._lock:
            with closing(self._connect()) as conn:
                conn.execute("DELETE FROM sentences")
                conn.execute("DELETE FROM translations")
                conn.execute("DELETE FROM glossary")
                conn.execute("DELETE FROM commentaries")

                conn.executemany(
                    "INSERT OR REPLACE INTO sentences (sentence_id, sutra_id, sutra_title, fascicle, para_index, text) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    sentence_rows,
                )
                conn.executemany(
                    "INSERT OR REPLACE INTO translations "
                    "(sentence_id, sutra_id, sutra_title, fascicle, source_text, literal_translation, colloquial_translation, dharma_analysis, provider, model, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    translation_rows,
                )
                conn.executemany(
                    "INSERT OR REPLACE INTO glossary (sutra_id, term, explanation, sutra_title, first_seen_fascicle, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    glossary_rows,
                )
                conn.executemany(
                    "INSERT OR REPLACE INTO commentaries (sutra_id, master_id, commentary_id, fascicle, section_heading, original_commentary) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    commentary_rows,
                )
                conn.executemany(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                    [("schema_version", "2.0"), ("rebuilt_at", rebuilt_at)],
                )
                conn.commit()

        return self.get_stats()

    def upsert_fascicle(self, sutra_id: str, sutra_title: str, fascicle: int, data: dict[str, Any]) -> None:
        rows: list[tuple[Any, ...]] = []
        ftitle = data.get("sutra_title") or sutra_title
        for para in data.get("paragraphs", []):
            p_idx = int(para.get("index") or 0)
            for sent in para.get("sentences", []):
                sid = sent.get("sentence_id", "")
                if sid:
                    rows.append((sid, sutra_id, ftitle, fascicle, p_idx, sent.get("text", "")))
        with self._lock:
            with closing(self._connect()) as conn:
                conn.execute(
                    "DELETE FROM sentences WHERE sutra_id = ? AND fascicle = ?",
                    (sutra_id, fascicle),
                )
                conn.executemany(
                    "INSERT OR REPLACE INTO sentences (sentence_id, sutra_id, sutra_title, fascicle, para_index, text) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    rows,
                )
                conn.commit()

    def upsert_translation(
        self,
        sutra_id: str,
        sutra_title: str,
        fascicle: int,
        entry: dict[str, Any],
        updated_at: str,
    ) -> None:
        ver = self._resolve_active_version(entry)
        content = ver.get("content") or {}
        row = (
            entry.get("sentence_id", ""),
            sutra_id,
            sutra_title,
            fascicle,
            entry.get("source_text", ""),
            str(content.get("literal_translation", "")),
            str(content.get("colloquial_translation", "")),
            str(content.get("dharma_analysis", "")),
            str(ver.get("provider", "")),
            str(ver.get("model", "")),
            str(ver.get("created_at") or updated_at),
        )
        with self._lock:
            with closing(self._connect()) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO translations "
                    "(sentence_id, sutra_id, sutra_title, fascicle, source_text, literal_translation, colloquial_translation, dharma_analysis, provider, model, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    row,
                )
                conn.commit()

    def upsert_glossary_terms(
        self,
        sutra_id: str,
        sutra_title: str,
        terms: dict[str, dict[str, Any]] | list[dict[str, Any]],
        fascicle: int | None = None,
        updated_at: str | None = None,
    ) -> None:
        ts = updated_at or _now_iso()
        rows: list[tuple[Any, ...]] = []
        if isinstance(terms, dict):
            items = list(terms.values())
        else:
            items = list(terms)
        for item in items:
            tname = (item.get("term") or "").strip()
            expl = (item.get("explanation") or "").strip()
            if not tname or not expl:
                continue
            first_fasc = item.get("first_seen_fascicle")
            if first_fasc is None:
                first_fasc = fascicle
            rows.append((
                sutra_id,
                tname,
                expl,
                sutra_title,
                int(first_fasc) if isinstance(first_fasc, int) else None,
                str(item.get("updated_at") or ts),
            ))
        if not rows:
            return
        with self._lock:
            with closing(self._connect()) as conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO glossary (sutra_id, term, explanation, sutra_title, first_seen_fascicle, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    rows,
                )
                conn.commit()

    def upsert_commentaries(
        self,
        sutra_id: str,
        master_id: str,
        fascicle: int,
        entries: list[dict[str, Any]],
    ) -> None:
        rows = [
            (
                sutra_id,
                master_id,
                str(item.get("commentary_id", "")),
                fascicle,
                str(item.get("section_heading", "")),
                str(item.get("original_commentary", "")),
            )
            for item in entries
            if item.get("commentary_id")
        ]
        if not rows:
            return
        with self._lock:
            with closing(self._connect()) as conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO commentaries (sutra_id, master_id, commentary_id, fascicle, section_heading, original_commentary) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    rows,
                )
                conn.commit()

    def search(
        self,
        query: str,
        scope: str = "all",
        sutra_id: str | None = None,
        limit: int = 30,
    ) -> dict[str, Any]:
        q = (query or "").strip()
        if not q:
            return {"query": "", "glossary": [], "translations": [], "sentences": [], "total": 0}

        lim = max(1, min(100, int(limit)))
        pat = f"%{_escape_like(q)}%"
        valid_scope = scope if scope in {"all", "glossary", "translations", "sentences"} else "all"

        glossary_hits: list[dict[str, Any]] = []
        translation_hits: list[dict[str, Any]] = []
        sentence_hits: list[dict[str, Any]] = []

        with self._lock:
            with closing(self._connect()) as conn:
                sutra_clause = " AND sutra_id = ?" if sutra_id else ""
                sutra_param = (sutra_id,) if sutra_id else ()

                if valid_scope in ("all", "glossary"):
                    rows = conn.execute(
                        f"SELECT sutra_id, sutra_title, term, explanation, first_seen_fascicle, updated_at "
                        f"FROM glossary "
                        f"WHERE (term LIKE ? ESCAPE '\\' OR explanation LIKE ? ESCAPE '\\'){sutra_clause} "
                        f"ORDER BY (CASE WHEN term LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END), sutra_id, term "
                        f"LIMIT ?",
                        (pat, pat) + sutra_param + (pat, lim),
                    ).fetchall()
                    glossary_hits = [dict(r) for r in rows]

                if valid_scope in ("all", "translations"):
                    rows = conn.execute(
                        f"SELECT sentence_id, sutra_id, sutra_title, fascicle, source_text, "
                        f"literal_translation, colloquial_translation, dharma_analysis, provider, model, updated_at "
                        f"FROM translations "
                        f"WHERE (source_text LIKE ? ESCAPE '\\' "
                        f"OR literal_translation LIKE ? ESCAPE '\\' "
                        f"OR colloquial_translation LIKE ? ESCAPE '\\' "
                        f"OR dharma_analysis LIKE ? ESCAPE '\\'){sutra_clause} "
                        f"ORDER BY sutra_id, fascicle, sentence_id "
                        f"LIMIT ?",
                        (pat, pat, pat, pat) + sutra_param + (lim,),
                    ).fetchall()
                    translation_hits = [dict(r) for r in rows]

                if valid_scope in ("all", "sentences"):
                    rows = conn.execute(
                        f"SELECT sentence_id, sutra_id, sutra_title, fascicle, para_index, text "
                        f"FROM sentences "
                        f"WHERE text LIKE ? ESCAPE '\\'{sutra_clause} "
                        f"ORDER BY sutra_id, fascicle, para_index, sentence_id "
                        f"LIMIT ?",
                        (pat,) + sutra_param + (lim,),
                    ).fetchall()
                    sentence_hits = [dict(r) for r in rows]

        total = len(glossary_hits) + len(translation_hits) + len(sentence_hits)
        return {
            "query": q,
            "glossary": glossary_hits,
            "translations": translation_hits,
            "sentences": sentence_hits,
            "total": total,
        }

    def get_stats(self) -> dict[str, Any]:
        exists = self.db_path.exists()
        size_bytes = self.db_path.stat().st_size if exists else 0
        counts = {
            "sutras": 0,
            "fascicles": 0,
            "sentences": 0,
            "translations": 0,
            "glossary_terms": 0,
            "commentaries": 0,
        }
        rebuilt_at = None
        if exists:
            with self._lock:
                with closing(self._connect()) as conn:
                    row = conn.execute("SELECT value FROM meta WHERE key = 'rebuilt_at'").fetchone()
                    rebuilt_at = row["value"] if row else None
                    counts["sutras"] = conn.execute(
                        "SELECT COUNT(DISTINCT sutra_id) FROM sentences"
                    ).fetchone()[0]
                    counts["fascicles"] = conn.execute(
                        "SELECT COUNT(DISTINCT sutra_id || ':' || fascicle) FROM sentences"
                    ).fetchone()[0]
                    counts["sentences"] = conn.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]
                    counts["translations"] = conn.execute("SELECT COUNT(*) FROM translations").fetchone()[0]
                    counts["glossary_terms"] = conn.execute("SELECT COUNT(*) FROM glossary").fetchone()[0]
                    counts["commentaries"] = conn.execute("SELECT COUNT(*) FROM commentaries").fetchone()[0]

        return {
            "db_path": "translation_kb/.index/kb_index.sqlite",
            "exists": exists,
            "size_bytes": size_bytes,
            "size_kb": round(size_bytes / 1024, 1),
            "rebuilt_at": rebuilt_at,
            "counts": counts,
        }
