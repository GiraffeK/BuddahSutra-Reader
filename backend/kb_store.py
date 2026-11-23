"""
translation_kb 本地知識庫讀寫引擎（Cache-First + Atomic Write + Per-File Lock）。
嚴格遵守 docs/knowledge-base-schema.md 定義之資料結構。
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

TZ_TAIPEI = timezone(timedelta(hours=8))


def now_iso() -> str:
    return datetime.now(TZ_TAIPEI).isoformat(timespec="seconds")


def compute_source_hash(text: str) -> str:
    normalized = "".join(text.split())
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    return f"sha256:{digest}"


class KnowledgeBaseStore:
    def __init__(self, kb_root: Path) -> None:
        self.kb_root = kb_root
        self._locks_guard = threading.Lock()
        self._file_locks: dict[str, threading.Lock] = {}

    def _get_lock(self, path: Path) -> threading.Lock:
        key = str(path.resolve())
        with self._locks_guard:
            if key not in self._file_locks:
                self._file_locks[key] = threading.Lock()
            return self._file_locks[key]

    def _read_json(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def _atomic_write_json(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)

    # ---------- 目錄與經文 ----------
    def get_catalog(self) -> dict[str, Any]:
        data = self._read_json(self.kb_root / "catalog" / "taisho_tree.json")
        if data is None:
            raise FileNotFoundError("找不到 translation_kb/catalog/taisho_tree.json")
        return data

    def get_sutra_fascicle(self, sutra_id: str, fascicle: int) -> dict[str, Any]:
        fname = f"{fascicle:03d}.json"
        path = self.kb_root / "sutras" / sutra_id / "fascicles" / fname
        data = self._read_json(path)
        if data is None:
            raise FileNotFoundError(f"尚未匯入經文：{sutra_id} 卷 {fascicle}")
        # 補齊每句 source_hash
        for para in data.get("paragraphs", []):
            for sent in para.get("sentences", []):
                if not sent.get("source_hash"):
                    sent["source_hash"] = compute_source_hash(sent["text"])
        return data

    def save_sutra_fascicle(self, sutra_id: str, fascicle: int, data: dict[str, Any]) -> dict[str, Any]:
        path = self.kb_root / "sutras" / sutra_id / "fascicles" / f"{fascicle:03d}.json"
        lock = self._get_lock(path)
        with lock:
            self._atomic_write_json(path, data)
        return data

    def list_local_fascicles(self, sutra_id: str) -> list[int]:
        fdir = self.kb_root / "sutras" / sutra_id / "fascicles"
        if not fdir.exists():
            return []
        nums: list[int] = []
        for p in sorted(fdir.glob("*.json")):
            if p.stem.isdigit():
                nums.append(int(p.stem))
        return nums

    def get_sutra_fascicle_count(self, sutra_id: str) -> int:
        meta = self._read_json(self.kb_root / "sutras" / sutra_id / "meta.json")
        if meta and meta.get("fascicle_count"):
            return int(meta["fascicle_count"])
        cat = self._read_json(self.kb_root / "catalog" / "taisho_tree.json") or {}
        for div in cat.get("divisions", []):
            for s in div.get("sutras", []):
                if s.get("sutra_id") == sutra_id and s.get("fascicle_count"):
                    return int(s["fascicle_count"])
        return 1

    def get_sentence_with_context(
        self, sutra_id: str, fascicle: int, sentence_id: str, window: int = 2
    ) -> dict[str, Any]:
        fascicle_data = self.get_sutra_fascicle(sutra_id, fascicle)
        flat: list[dict[str, Any]] = []
        for para in fascicle_data.get("paragraphs", []):
            for sent in para.get("sentences", []):
                flat.append(sent)
        idx = next((i for i, s in enumerate(flat) if s["sentence_id"] == sentence_id), None)
        if idx is None:
            raise KeyError(f"找不到句子 ID：{sentence_id}")
        start = max(0, idx - window)
        end = min(len(flat), idx + window + 1)
        return {
            "sutra_title": fascicle_data.get("sutra_title", ""),
            "edition": fascicle_data.get("edition", ""),
            "fascicle_title": fascicle_data.get("fascicle_title", ""),
            "sentence": flat[idx],
            "prev_sentences": [s["text"] for s in flat[start:idx]],
            "next_sentences": [s["text"] for s in flat[idx + 1 : end]],
        }

    # ---------- 古大德註疏 ----------
    def get_masters_for_sutra(self, sutra_id: str) -> list[dict[str, Any]]:
        reg = self._read_json(self.kb_root / "commentaries" / "masters_registry.json") or {}
        return [m for m in reg.get("masters", []) if m.get("sutra_id") == sutra_id]

    def get_commentaries_for_fascicle(self, sutra_id: str, fascicle: int) -> dict[str, list[dict[str, Any]]]:
        """回傳以 master_id 為 key 的該卷古大德註疏列表。"""
        fname = f"{fascicle:03d}.json"
        masters = self.get_masters_for_sutra(sutra_id)
        result: dict[str, list[dict[str, Any]]] = {}
        for m in masters:
            mid = m["master_id"]
            cpath = self.kb_root / "commentaries" / sutra_id / mid / fname
            cdata = self._read_json(cpath)
            result[mid] = cdata.get("entries", []) if cdata else []
        return result

    def get_commentaries_for_sentence(
        self,
        sutra_id: str,
        fascicle: int,
        sentence_id: str,
        selected_masters: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        masters_meta = {m["master_id"]: m for m in self.get_masters_for_sutra(sutra_id)}
        all_comm = self.get_commentaries_for_fascicle(sutra_id, fascicle)
        matched: list[dict[str, Any]] = []
        for mid, entries in all_comm.items():
            if selected_masters is not None and mid not in selected_masters:
                continue
            meta = masters_meta.get(mid, {})
            for entry in entries:
                if sentence_id in entry.get("target_sentence_ids", []):
                    matched.append({
                        **entry,
                        "master_id": mid,
                        "master_name": meta.get("name", mid),
                        "work_title": meta.get("work_title", ""),
                        "dynasty": meta.get("dynasty", ""),
                    })
        return matched

    def save_commentary_entries(
        self,
        sutra_id: str,
        master_id: str,
        fascicle: int,
        new_entries: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """將動態檢索到的古大德註疏條目原子寫入本地 translation_kb/commentaries/ 永久快取。"""
        if not new_entries:
            return []
        path = self.kb_root / "commentaries" / sutra_id / master_id / f"{fascicle:03d}.json"
        lock = self._get_lock(path)
        with lock:
            doc = self._read_json(path) or {
                "master_id": master_id,
                "sutra_id": sutra_id,
                "fascicle": fascicle,
                "entries": [],
            }
            existing_ids = {e.get("commentary_id") for e in doc.get("entries", [])}
            added = False
            for item in new_entries:
                if item.get("commentary_id") not in existing_ids:
                    doc["entries"].append(item)
                    existing_ids.add(item.get("commentary_id"))
                    added = True
            if added:
                self._atomic_write_json(path, doc)
        return new_entries

    # ---------- 古大德註疏「整卷全文」本地快取 ----------
    def get_commentary_fulltext(self, master_id: str, juan: int) -> dict[str, Any] | None:
        path = self.kb_root / "commentary_fulltext" / master_id / f"{juan:03d}.json"
        return self._read_json(path)

    def save_commentary_fulltext(self, master_id: str, juan: int, data: dict[str, Any]) -> dict[str, Any]:
        path = self.kb_root / "commentary_fulltext" / master_id / f"{juan:03d}.json"
        lock = self._get_lock(path)
        with lock:
            self._atomic_write_json(path, data)
        return data

    def list_local_commentary_juans(self, master_id: str) -> list[int]:
        cdir = self.kb_root / "commentary_fulltext" / master_id
        if not cdir.exists():
            return []
        return [int(p.stem) for p in sorted(cdir.glob("*.json")) if p.stem.isdigit()]

    # ---------- 翻譯知識庫（Cache-First 核心） ----------
    def _translation_file_path(self, sutra_id: str, fascicle: int) -> Path:
        return self.kb_root / "translations" / sutra_id / f"{fascicle:03d}.json"

    def get_all_translations_for_fascicle(self, sutra_id: str, fascicle: int) -> dict[str, Any]:
        path = self._translation_file_path(sutra_id, fascicle)
        data = self._read_json(path)
        return data.get("entries", {}) if data else {}

    def get_sentence_translation(self, sutra_id: str, fascicle: int, sentence_id: str) -> dict[str, Any] | None:
        entries = self.get_all_translations_for_fascicle(sutra_id, fascicle)
        return entries.get(sentence_id)

    def save_sentence_translation(
        self,
        sutra_id: str,
        fascicle: int,
        sentence_id: str,
        source_text: str,
        provider: str,
        model: str,
        content: dict[str, Any],
        referenced_masters: list[str],
        prompt_version: str = "v1.0",
    ) -> dict[str, Any]:
        path = self._translation_file_path(sutra_id, fascicle)
        lock = self._get_lock(path)
        ts = now_iso()
        version_id = f"v_{datetime.now(TZ_TAIPEI).strftime('%Y%m%d_%H%M%S')}_{provider}"
        version_obj = {
            "version_id": version_id,
            "provider": provider,
            "model": model,
            "prompt_version": prompt_version,
            "referenced_masters": referenced_masters,
            "created_at": ts,
            "content": content,
        }

        with lock:
            doc = self._read_json(path) or {
                "schema_version": "1.0",
                "sutra_id": sutra_id,
                "fascicle": fascicle,
                "updated_at": ts,
                "entries": {},
            }
            existing = doc["entries"].get(sentence_id)
            if existing:
                existing.setdefault("versions", []).append(version_obj)
                if not existing.get("locked_by_human", False):
                    existing["active_version_id"] = version_id
                existing["source_text"] = source_text
                existing["source_hash"] = compute_source_hash(source_text)
                entry = existing
            else:
                entry = {
                    "sentence_id": sentence_id,
                    "source_text": source_text,
                    "source_hash": compute_source_hash(source_text),
                    "active_version_id": version_id,
                    "locked_by_human": False,
                    "versions": [version_obj],
                }
                doc["entries"][sentence_id] = entry
            doc["updated_at"] = ts
            self._atomic_write_json(path, doc)

        # 同步將新名相沉澱至 glossary/terms.json
        terms = content.get("terms") or []
        if terms:
            self._merge_glossary_terms(terms, sutra_id)

        return entry

    def _merge_glossary_terms(self, terms: list[dict[str, Any]], sutra_id: str) -> None:
        gpath = self.kb_root / "glossary" / "terms.json"
        lock = self._get_lock(gpath)
        with lock:
            gdoc = self._read_json(gpath) or {
                "schema_version": "1.0",
                "updated_at": now_iso(),
                "terms": {},
            }
            changed = False
            for item in terms:
                term_name = (item.get("term") or "").strip()
                explanation = (item.get("explanation") or "").strip()
                if not term_name or not explanation:
                    continue
                if term_name not in gdoc["terms"]:
                    gdoc["terms"][term_name] = {
                        "term": term_name,
                        "explanation": explanation,
                        "seen_in": [sutra_id],
                    }
                    changed = True
                else:
                    seen = gdoc["terms"][term_name].setdefault("seen_in", [])
                    if sutra_id not in seen:
                        seen.append(sutra_id)
                        changed = True
            if changed:
                gdoc["updated_at"] = now_iso()
                self._atomic_write_json(gpath, gdoc)

    # ---------- 古大德註疏白話導讀快取 ----------
    def _commentary_trans_path(self, sutra_id: str, master_id: str, fascicle: int) -> Path:
        return self.kb_root / "commentary_translations" / sutra_id / master_id / f"{fascicle:03d}.json"

    def get_commentary_translation(
        self, sutra_id: str, master_id: str, fascicle: int, commentary_id: str
    ) -> dict[str, Any] | None:
        doc = self._read_json(self._commentary_trans_path(sutra_id, master_id, fascicle))
        if not doc:
            return None
        return doc.get("entries", {}).get(commentary_id)

    def save_commentary_translation(
        self,
        sutra_id: str,
        master_id: str,
        fascicle: int,
        commentary_id: str,
        plain_guide: str,
        provider: str,
        model: str,
    ) -> dict[str, Any]:
        path = self._commentary_trans_path(sutra_id, master_id, fascicle)
        lock = self._get_lock(path)
        ts = now_iso()
        record = {
            "commentary_id": commentary_id,
            "plain_guide": plain_guide,
            "provider": provider,
            "model": model,
            "created_at": ts,
        }
        with lock:
            doc = self._read_json(path) or {
                "schema_version": "1.0",
                "sutra_id": sutra_id,
                "master_id": master_id,
                "fascicle": fascicle,
                "updated_at": ts,
                "entries": {},
            }
            doc["entries"][commentary_id] = record
            doc["updated_at"] = ts
            self._atomic_write_json(path, doc)
        return record
