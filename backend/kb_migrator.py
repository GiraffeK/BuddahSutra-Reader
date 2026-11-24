"""
translation_kb v1 -> v2 無損遷移模組（方案 1 + 方案 2）。

遷移內容：
1. 將各經的原文（sutras/）、AI 譯文（translations/）、逐句註疏（commentaries/{sutra_id}/）、
   註疏導讀（commentary_translations/）統一收攏至
   `translation_kb/canons/{部別}/{經號_經名}/` 目錄下，維持按卷分片。
2. 將原本跨藏共用的單一檔 `glossary/terms.json`，依 `seen_in` 拆分為每部經專屬的
   `translation_kb/canons/{部別}/{經號_經名}/glossary.json`。
3. 保留 `catalog/taisho_tree.json`、`commentaries/masters_registry.json` 與 `commentary_fulltext/`
   於頂層位置。
4. 嚴格逐檔 JSON 解析比對驗證 100% 一致後，才清理舊路徑（可重複執行且具冪等性）。
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

from backend.kb_store import KnowledgeBaseStore, now_iso


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp_path, path)


def _remove_empty_dirs(root: Path) -> None:
    if not root.exists():
        return
    for dirpath, _, _ in os.walk(root, topdown=False):
        p = Path(dirpath)
        try:
            if not any(p.iterdir()):
                p.rmdir()
        except Exception:
            pass


def migrate_kb_v1_to_v2(kb_root: Path, cleanup_legacy: bool = True) -> dict[str, Any]:
    kb = KnowledgeBaseStore(kb_root, enable_index=False)
    copy_pairs: list[tuple[Path, Path]] = []

    # 1. sutras/{sutra_id}/meta.json 與 fascicles/*.json
    sutras_dir = kb_root / "sutras"
    if sutras_dir.exists():
        for sdir in sorted(sutras_dir.iterdir()):
            if not sdir.is_dir():
                continue
            sid = sdir.name
            target_sdir = kb.get_sutra_dir(sid)
            meta_src = sdir / "meta.json"
            if meta_src.is_file():
                copy_pairs.append((meta_src, target_sdir / "meta.json"))
            fdir = sdir / "fascicles"
            if fdir.is_dir():
                for ffile in sorted(fdir.glob("*.json")):
                    copy_pairs.append((ffile, target_sdir / "fascicles" / ffile.name))

    # 2. translations/{sutra_id}/*.json
    trans_dir = kb_root / "translations"
    if trans_dir.exists():
        for sdir in sorted(trans_dir.iterdir()):
            if not sdir.is_dir():
                continue
            sid = sdir.name
            target_sdir = kb.get_sutra_dir(sid)
            for tfile in sorted(sdir.glob("*.json")):
                copy_pairs.append((tfile, target_sdir / "translations" / tfile.name))

    # 3. commentaries/{sutra_id}/{master_id}/*.json（嚴禁動到 commentaries/masters_registry.json）
    comm_dir = kb_root / "commentaries"
    legacy_comm_sutra_dirs: list[Path] = []
    if comm_dir.exists():
        for sdir in sorted(comm_dir.iterdir()):
            if not sdir.is_dir():
                continue
            sid = sdir.name
            legacy_comm_sutra_dirs.append(sdir)
            target_sdir = kb.get_sutra_dir(sid)
            for mdir in sorted(sdir.iterdir()):
                if not mdir.is_dir():
                    continue
                for cfile in sorted(mdir.glob("*.json")):
                    copy_pairs.append((cfile, target_sdir / "commentaries" / mdir.name / cfile.name))

    # 4. commentary_translations/{sutra_id}/{master_id}/*.json
    ct_dir = kb_root / "commentary_translations"
    if ct_dir.exists():
        for sdir in sorted(ct_dir.iterdir()):
            if not sdir.is_dir():
                continue
            sid = sdir.name
            target_sdir = kb.get_sutra_dir(sid)
            for mdir in sorted(sdir.iterdir()):
                if not mdir.is_dir():
                    continue
                for ctfile in sorted(mdir.glob("*.json")):
                    copy_pairs.append((ctfile, target_sdir / "commentary_translations" / mdir.name / ctfile.name))

    # 寫入所有一對一檔案
    copied_count = 0
    for src, dst in copy_pairs:
        src_data = _read_json(src)
        _atomic_write_json(dst, src_data)
        copied_count += 1

    # 5. glossary/terms.json -> 依 seen_in 拆分為各經 glossary.json
    legacy_glossary_path = kb_root / "glossary" / "terms.json"
    glossary_targets: dict[str, dict[str, Any]] = {}
    shared_terms: dict[str, Any] = {}
    legacy_terms: dict[str, Any] = {}

    if legacy_glossary_path.is_file():
        gdoc = _read_json(legacy_glossary_path)
        g_updated = gdoc.get("updated_at") or now_iso()
        legacy_terms = gdoc.get("terms") or {}

        for tname, tinfo in legacy_terms.items():
            seen_in = [s for s in (tinfo.get("seen_in") or []) if s]
            term_record = {
                "term": tinfo.get("term") or tname,
                "explanation": tinfo.get("explanation", ""),
                "first_seen_fascicle": tinfo.get("first_seen_fascicle"),
                "updated_at": tinfo.get("updated_at") or g_updated,
            }
            if not seen_in:
                shared_terms[tname] = term_record
                continue
            for sid in seen_in:
                if sid not in glossary_targets:
                    target_gpath = kb.get_sutra_dir(sid) / "glossary.json"
                    existing_g = _read_json(target_gpath) if target_gpath.is_file() else None
                    glossary_targets[sid] = existing_g or {
                        "schema_version": "2.0",
                        "sutra_id": sid,
                        "sutra_title": kb.get_sutra_title(sid),
                        "updated_at": g_updated,
                        "terms": {},
                    }
                glossary_targets[sid]["terms"].setdefault(tname, term_record)

        for sid, target_doc in glossary_targets.items():
            target_doc["updated_at"] = g_updated
            target_doc["sutra_title"] = kb.get_sutra_title(sid)
            _atomic_write_json(kb.get_sutra_dir(sid) / "glossary.json", target_doc)

        if shared_terms:
            _atomic_write_json(
                kb_root / "glossary" / "shared_terms.json",
                {
                    "schema_version": "2.0",
                    "updated_at": g_updated,
                    "terms": shared_terms,
                },
            )

    # 6. 嚴格完整性驗證（未完全通過前絕不刪除任何舊檔）
    for src, dst in copy_pairs:
        if not dst.is_file():
            raise RuntimeError(f"遷移驗證失敗：目標檔案不存在 {dst}")
        if _read_json(src) != _read_json(dst):
            raise RuntimeError(f"遷移驗證失敗：內容比對不一致 {src} -> {dst}")

    if legacy_glossary_path.is_file():
        for tname, tinfo in legacy_terms.items():
            seen_in = [s for s in (tinfo.get("seen_in") or []) if s]
            for sid in seen_in:
                dst_g = _read_json(kb.get_sutra_dir(sid) / "glossary.json")
                dst_term = (dst_g.get("terms") or {}).get(tname)
                if not dst_term or dst_term.get("explanation") != tinfo.get("explanation", ""):
                    raise RuntimeError(f"名相遷移驗證失敗：{sid} 缺少或不一致的詞條 {tname}")

    # 7. 清理舊目錄（保留 commentaries/masters_registry.json 與 commentary_fulltext/）
    cleaned_paths: list[str] = []
    if cleanup_legacy:
        for legacy_dir in (sutras_dir, trans_dir, ct_dir):
            if legacy_dir.exists():
                shutil.rmtree(legacy_dir)
                cleaned_paths.append(legacy_dir.name)
        for sdir in legacy_comm_sutra_dirs:
            if sdir.exists():
                shutil.rmtree(sdir)
                cleaned_paths.append(f"commentaries/{sdir.name}")
        if legacy_glossary_path.is_file():
            legacy_glossary_path.unlink()
            cleaned_paths.append("glossary/terms.json")
            _remove_empty_dirs(kb_root / "glossary")

    # 8. 更新 schema_meta.json
    meta_path = kb_root / "schema_meta.json"
    schema_meta = _read_json(meta_path) if meta_path.is_file() else {}
    schema_meta.update({
        "schema_version": "2.0",
        "project": "BuddhaSutra-Reader",
        "layout": "canons_by_division_sutra",
        "index_file": ".index/kb_index.sqlite",
        "updated_at": now_iso(),
    })
    _atomic_write_json(meta_path, schema_meta)

    return {
        "status": "ok",
        "copied_files": copied_count,
        "glossary_sutras_split": {sid: len(doc["terms"]) for sid, doc in glossary_targets.items()},
        "shared_terms_count": len(shared_terms),
        "cleaned_legacy": cleaned_paths,
        "verified": True,
    }
