"""
translation_kb 本地知識庫讀寫引擎（v2.0：依部別／經號／卷次分片 + 單經獨立名相庫 + SQLite 索引同步）。
嚴格遵守 docs/knowledge-base-schema.md 定義之資料結構。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.kb_index import KnowledgeBaseIndex

TZ_TAIPEI = timezone(timedelta(hours=8))


def now_iso() -> str:
    return datetime.now(TZ_TAIPEI).isoformat(timespec="seconds")


def compute_source_hash(text: str) -> str:
    normalized = "".join(text.split())
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    return f"sha256:{digest}"


def _sanitize_dirname(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", name).strip(" .")
    return cleaned or "unnamed"


def _make_division_dirname(division_id: str, division_name: str) -> str:
    m = re.match(r"^([A-Z]+_\d+)", division_id or "")
    safe_name = _sanitize_dirname(division_name or "其他部")
    if m:
        return f"{m.group(1)}_{safe_name}"
    return _sanitize_dirname(f"{division_id}_{safe_name}") if division_id else safe_name


def _make_sutra_dirname(sutra_id: str, title: str) -> str:
    clean_title = (title or "").strip()
    if not clean_title:
        return _sanitize_dirname(sutra_id)
    m = re.match(r"^(.+?)[（(]([^）)]+)[）)]$", clean_title)
    if m:
        base, paren = m.group(1).strip(), m.group(2).strip()
        if len(base) > 10 and len(paren) <= 10:
            label = paren
        else:
            label = clean_title[:24]
    else:
        label = clean_title[:24]
    return _sanitize_dirname(f"{sutra_id}_{label}")


class KnowledgeBaseStore:
    def __init__(self, kb_root: Path, enable_index: bool = True) -> None:
        self.kb_root = kb_root
        self._locks_guard = threading.Lock()
        self._file_locks: dict[str, threading.Lock] = {}
        self._sutra_dir_cache: dict[str, Path] = {}
        self._catalog_index_cache: dict[str, dict[str, str]] | None = None
        self.index: KnowledgeBaseIndex | None = KnowledgeBaseIndex(kb_root) if enable_index else None

    def clear_dir_cache(self) -> None:
        self._sutra_dir_cache.clear()
        self._catalog_index_cache = None

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

    def _resolve_read_path(self, new_path: Path, legacy_path: Path) -> Path:
        if new_path.exists():
            return new_path
        if legacy_path.exists():
            return legacy_path
        return new_path

    def to_rel_posix(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.kb_root.parent.resolve()).as_posix()
        except Exception:
            return path.as_posix()

    # ---------- 目錄與經別定位 ----------
    def get_catalog(self) -> dict[str, Any]:
        data = self._read_json(self.kb_root / "catalog" / "taisho_tree.json")
        if data is None:
            raise FileNotFoundError("找不到 translation_kb/catalog/taisho_tree.json")
        return data

    def _load_catalog_lookup(self) -> dict[str, dict[str, str]]:
        if self._catalog_index_cache is not None:
            return self._catalog_index_cache
        lookup: dict[str, dict[str, str]] = {}
        cat = self._read_json(self.kb_root / "catalog" / "taisho_tree.json") or {}
        for div in cat.get("divisions", []):
            div_id = div.get("division_id", "")
            div_name = div.get("name", "")
            for s in div.get("sutras", []):
                sid = s.get("sutra_id")
                if sid:
                    lookup[sid] = {
                        "division_id": div_id,
                        "division_name": div_name,
                        "title": s.get("title", ""),
                    }
        self._catalog_index_cache = lookup
        return lookup

    def get_sutra_title(self, sutra_id: str) -> str:
        info = self._load_catalog_lookup().get(sutra_id)
        if info and info.get("title"):
            return info["title"]
        meta = self.get_sutra_meta(sutra_id)
        if meta and meta.get("title"):
            return str(meta["title"])
        return sutra_id

    def get_sutra_dir(self, sutra_id: str) -> Path:
        cached = self._sutra_dir_cache.get(sutra_id)
        if cached is not None and cached.exists():
            return cached

        canons_root = self.kb_root / "canons"
        if canons_root.exists():
            for div_dir in sorted(canons_root.iterdir()):
                if not div_dir.is_dir():
                    continue
                for cand in sorted(div_dir.iterdir()):
                    if cand.is_dir() and (cand.name == sutra_id or cand.name.startswith(f"{sutra_id}_")):
                        self._sutra_dir_cache[sutra_id] = cand
                        return cand

        if cached is not None:
            return cached

        info = self._load_catalog_lookup().get(sutra_id)
        if info:
            div_dir_name = _make_division_dirname(info["division_id"], info["division_name"])
            sutra_dir_name = _make_sutra_dirname(sutra_id, info["title"])
            target = canons_root / div_dir_name / sutra_dir_name
            self._sutra_dir_cache[sutra_id] = target
            return target

        legacy_meta = self._read_json(self.kb_root / "sutras" / sutra_id / "meta.json")
        if legacy_meta:
            div_dir_name = _make_division_dirname(
                legacy_meta.get("division_id", "T_99"),
                legacy_meta.get("division_name", "其他部"),
            )
            sutra_dir_name = _make_sutra_dirname(sutra_id, legacy_meta.get("title", ""))
            target = canons_root / div_dir_name / sutra_dir_name
            self._sutra_dir_cache[sutra_id] = target
            return target

        target = canons_root / "T_99_其他部" / _sanitize_dirname(sutra_id)
        self._sutra_dir_cache[sutra_id] = target
        return target

    def iter_stored_sutra_ids(self) -> list[str]:
        ids: set[str] = set()
        canons_root = self.kb_root / "canons"
        if canons_root.exists():
            for div_dir in canons_root.iterdir():
                if not div_dir.is_dir():
                    continue
                for sdir in div_dir.iterdir():
                    if not sdir.is_dir():
                        continue
                    sid = sdir.name.split("_", 1)[0]
                    if sid:
                        ids.add(sid)

        for legacy_root in (self.kb_root / "sutras", self.kb_root / "translations"):
            if legacy_root.exists():
                for sub in legacy_root.iterdir():
                    if sub.is_dir():
                        ids.add(sub.name)
        return sorted(ids)

    def get_storage_paths(self, sutra_id: str, fascicle: int) -> dict[str, str]:
        sutra_dir = self.get_sutra_dir(sutra_id)
        fname = f"{fascicle:03d}.json"
        return {
            "sutra_dir": self.to_rel_posix(sutra_dir),
            "fascicle_file": self.to_rel_posix(sutra_dir / "fascicles" / fname),
            "translation_file": self.to_rel_posix(sutra_dir / "translations" / fname),
            "glossary_file": self.to_rel_posix(sutra_dir / "glossary.json"),
        }

    # ---------- 經文 ----------
    def get_sutra_meta(self, sutra_id: str) -> dict[str, Any] | None:
        sutra_dir = self.get_sutra_dir(sutra_id)
        path = self._resolve_read_path(
            sutra_dir / "meta.json",
            self.kb_root / "sutras" / sutra_id / "meta.json",
        )
        return self._read_json(path)

    def get_sutra_fascicle(self, sutra_id: str, fascicle: int) -> dict[str, Any]:
        fname = f"{fascicle:03d}.json"
        sutra_dir = self.get_sutra_dir(sutra_id)
        path = self._resolve_read_path(
            sutra_dir / "fascicles" / fname,
            self.kb_root / "sutras" / sutra_id / "fascicles" / fname,
        )
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
        path = self.get_sutra_dir(sutra_id) / "fascicles" / f"{fascicle:03d}.json"
        lock = self._get_lock(path)
        with lock:
            self._atomic_write_json(path, data)
        if self.index is not None:
            try:
                self.index.upsert_fascicle(sutra_id, self.get_sutra_title(sutra_id), fascicle, data)
            except Exception:
                pass
        return data

    def list_local_fascicles(self, sutra_id: str) -> list[int]:
        nums: set[int] = set()
        for fdir in (
            self.get_sutra_dir(sutra_id) / "fascicles",
            self.kb_root / "sutras" / sutra_id / "fascicles",
        ):
            if not fdir.exists():
                continue
            for p in fdir.glob("*.json"):
                if p.stem.isdigit():
                    nums.add(int(p.stem))
        return sorted(nums)

    def get_sutra_fascicle_count(self, sutra_id: str) -> int:
        meta = self.get_sutra_meta(sutra_id)
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
        sutra_dir = self.get_sutra_dir(sutra_id)
        masters = self.get_masters_for_sutra(sutra_id)
        result: dict[str, list[dict[str, Any]]] = {}
        for m in masters:
            mid = m["master_id"]
            cpath = self._resolve_read_path(
                sutra_dir / "commentaries" / mid / fname,
                self.kb_root / "commentaries" / sutra_id / mid / fname,
            )
            cdata = self._read_json(cpath)
            result[mid] = cdata.get("entries", []) if cdata else []
        return result

    def iter_commentary_files(self, sutra_id: str) -> list[tuple[str, int, dict[str, Any]]]:
        """列舉某經號下所有已存的逐句註疏檔案，供索引重建使用。"""
        items: list[tuple[str, int, dict[str, Any]]] = []
        seen: set[tuple[str, int]] = set()
        for comm_root in (
            self.get_sutra_dir(sutra_id) / "commentaries",
            self.kb_root / "commentaries" / sutra_id,
        ):
            if not comm_root.exists():
                continue
            for mdir in sorted(comm_root.iterdir()):
                if not mdir.is_dir():
                    continue
                mid = mdir.name
                for p in sorted(mdir.glob("*.json")):
                    if not p.stem.isdigit():
                        continue
                    fnum = int(p.stem)
                    if (mid, fnum) in seen:
                        continue
                    doc = self._read_json(p)
                    if doc:
                        seen.add((mid, fnum))
                        items.append((mid, fnum, doc))
        return items

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
        """將動態檢索到的古大德註疏條目原子寫入本地分經目錄之 commentaries/ 永久快取。"""
        if not new_entries:
            return []
        fname = f"{fascicle:03d}.json"
        path = self.get_sutra_dir(sutra_id) / "commentaries" / master_id / fname
        legacy_path = self.kb_root / "commentaries" / sutra_id / master_id / fname
        lock = self._get_lock(path)
        with lock:
            read_path = self._resolve_read_path(path, legacy_path)
            doc = self._read_json(read_path) or {
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
            if added or (read_path == legacy_path and legacy_path.exists() and not path.exists()):
                self._atomic_write_json(path, doc)
        if self.index is not None:
            try:
                self.index.upsert_commentaries(sutra_id, master_id, fascicle, new_entries)
            except Exception:
                pass
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
        return self.get_sutra_dir(sutra_id) / "translations" / f"{fascicle:03d}.json"

    def _legacy_translation_file_path(self, sutra_id: str, fascicle: int) -> Path:
        return self.kb_root / "translations" / sutra_id / f"{fascicle:03d}.json"

    def list_local_translation_fascicles(self, sutra_id: str) -> list[int]:
        nums: set[int] = set()
        for tdir in (
            self.get_sutra_dir(sutra_id) / "translations",
            self.kb_root / "translations" / sutra_id,
        ):
            if not tdir.exists():
                continue
            for p in tdir.glob("*.json"):
                if p.stem.isdigit():
                    nums.add(int(p.stem))
        return sorted(nums)

    def get_translation_doc(self, sutra_id: str, fascicle: int) -> dict[str, Any] | None:
        path = self._resolve_read_path(
            self._translation_file_path(sutra_id, fascicle),
            self._legacy_translation_file_path(sutra_id, fascicle),
        )
        return self._read_json(path)

    def get_all_translations_for_fascicle(self, sutra_id: str, fascicle: int) -> dict[str, Any]:
        data = self.get_translation_doc(sutra_id, fascicle)
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
        legacy_path = self._legacy_translation_file_path(sutra_id, fascicle)
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
            read_path = self._resolve_read_path(path, legacy_path)
            doc = self._read_json(read_path) or {
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

        sutra_title = self.get_sutra_title(sutra_id)
        if self.index is not None:
            try:
                self.index.upsert_translation(sutra_id, sutra_title, fascicle, entry, ts)
            except Exception:
                pass

        # 同步將新名相沉澱至本經專屬 glossary.json（不再寫入跨藏單一大檔）
        terms = content.get("terms") or []
        if terms:
            self._merge_glossary_terms(terms, sutra_id, fascicle=fascicle)

        return entry

    # ---------- 單經專屬佛學名相庫（方案 1 + 2） ----------
    def _glossary_file_path(self, sutra_id: str) -> Path:
        return self.get_sutra_dir(sutra_id) / "glossary.json"

    def get_glossary(self, sutra_id: str) -> dict[str, Any]:
        gpath = self._glossary_file_path(sutra_id)
        sutra_title = self.get_sutra_title(sutra_id)
        doc = self._read_json(gpath)
        if doc is not None:
            return doc

        # 若尚未遷移，退回過濾舊版 glossary/terms.json 中屬於本經的名相
        legacy_path = self.kb_root / "glossary" / "terms.json"
        legacy_doc = self._read_json(legacy_path)
        terms: dict[str, dict[str, Any]] = {}
        updated_at = ""
        if legacy_doc:
            updated_at = legacy_doc.get("updated_at", "")
            for tname, tinfo in (legacy_doc.get("terms") or {}).items():
                if sutra_id in (tinfo.get("seen_in") or []):
                    terms[tname] = {
                        "term": tinfo.get("term", tname),
                        "explanation": tinfo.get("explanation", ""),
                        "first_seen_fascicle": None,
                        "updated_at": updated_at,
                    }
        return {
            "schema_version": "2.0",
            "sutra_id": sutra_id,
            "sutra_title": sutra_title,
            "updated_at": updated_at,
            "terms": terms,
        }

    def _merge_glossary_terms(
        self,
        terms: list[dict[str, Any]],
        sutra_id: str,
        fascicle: int | None = None,
    ) -> None:
        gpath = self._glossary_file_path(sutra_id)
        sutra_title = self.get_sutra_title(sutra_id)
        lock = self._get_lock(gpath)
        ts = now_iso()
        merged_items: list[dict[str, Any]] = []

        with lock:
            gdoc = self._read_json(gpath)
            if gdoc is None:
                seeded = self.get_glossary(sutra_id)
                gdoc = {
                    "schema_version": "2.0",
                    "sutra_id": sutra_id,
                    "sutra_title": sutra_title,
                    "updated_at": seeded.get("updated_at") or ts,
                    "terms": seeded.get("terms") or {},
                }
            changed = False
            for item in terms:
                term_name = (item.get("term") or "").strip()
                explanation = (item.get("explanation") or "").strip()
                if not term_name or not explanation:
                    continue
                if term_name not in gdoc["terms"]:
                    rec = {
                        "term": term_name,
                        "explanation": explanation,
                        "first_seen_fascicle": fascicle,
                        "updated_at": ts,
                    }
                    gdoc["terms"][term_name] = rec
                    merged_items.append(rec)
                    changed = True
                elif gdoc["terms"][term_name].get("first_seen_fascicle") is None and fascicle is not None:
                    gdoc["terms"][term_name]["first_seen_fascicle"] = fascicle
                    gdoc["terms"][term_name]["updated_at"] = ts
                    merged_items.append(gdoc["terms"][term_name])
                    changed = True
            if changed:
                gdoc["updated_at"] = ts
                gdoc["sutra_title"] = sutra_title
                self._atomic_write_json(gpath, gdoc)

        if self.index is not None and merged_items:
            try:
                self.index.upsert_glossary_terms(
                    sutra_id, sutra_title, merged_items, fascicle=fascicle, updated_at=ts
                )
            except Exception:
                pass

    # ---------- 古大德註疏白話導讀快取 ----------
    def _commentary_trans_path(self, sutra_id: str, master_id: str, fascicle: int) -> Path:
        return self.get_sutra_dir(sutra_id) / "commentary_translations" / master_id / f"{fascicle:03d}.json"

    def _legacy_commentary_trans_path(self, sutra_id: str, master_id: str, fascicle: int) -> Path:
        return self.kb_root / "commentary_translations" / sutra_id / master_id / f"{fascicle:03d}.json"

    def get_commentary_translation(
        self, sutra_id: str, master_id: str, fascicle: int, commentary_id: str
    ) -> dict[str, Any] | None:
        path = self._resolve_read_path(
            self._commentary_trans_path(sutra_id, master_id, fascicle),
            self._legacy_commentary_trans_path(sutra_id, master_id, fascicle),
        )
        doc = self._read_json(path)
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
        legacy_path = self._legacy_commentary_trans_path(sutra_id, master_id, fascicle)
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
            read_path = self._resolve_read_path(path, legacy_path)
            doc = self._read_json(read_path) or {
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

    # ---------- 儲存摘要 ----------
    def get_storage_summary(self) -> dict[str, Any]:
        sutras_info: list[dict[str, Any]] = []
        for sid in self.iter_stored_sutra_ids():
            sdir = self.get_sutra_dir(sid)
            gdoc = self.get_glossary(sid)
            sutras_info.append({
                "sutra_id": sid,
                "sutra_title": self.get_sutra_title(sid),
                "sutra_dir": self.to_rel_posix(sdir),
                "local_fascicles_count": len(self.list_local_fascicles(sid)),
                "translated_fascicles_count": len(self.list_local_translation_fascicles(sid)),
                "glossary_terms_count": len(gdoc.get("terms") or {}),
            })
        return {
            "schema_version": "2.0",
            "layout": "canons_by_division_sutra",
            "sutras": sutras_info,
        }
