"""
CBETA Online Data API 自動抓取與結構化斷句模組。
當使用者切換至本地 translation_kb/sutras/ 尚未匯入的卷次（如八十華嚴卷二～卷八十、楞嚴經卷二～卷十）時，
自動從 CBETA 公開 API（cbdata.dila.edu.tw）下載標準標點經文，解析段落並切分為句級 JSON 永久入庫。
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any

import httpx

from backend.gaiji import normalize_gaiji
from backend.kb_store import compute_source_hash

CBETA_API_BASE = "https://cbdata.dila.edu.tw/stable/juans"
CBETA_GITHUB_RAW_BASE = "https://raw.githubusercontent.com/cbeta-git/xml-p5a/master"
CBETA_HEADERS = {
    "User-Agent": "BuddhaSutraReader/1.0 (Local Personal Study Tool; Cache-First)",
    "Accept": "application/json",
}


def sutra_id_to_cbeta_work(sutra_id: str) -> str:
    """將 T10n0279 轉為 CBETA API work 代碼 T0279；T19n0945 轉為 T0945。"""
    m = re.match(r"^([A-Z]+)\d+n(\d+[A-Za-z]?)$", sutra_id)
    if m:
        return f"{m.group(1)}{m.group(2)}"
    return sutra_id


def split_sentences_zh(text: str) -> list[str]:
    """將漢文佛經段落依句號、分號、問號、驚嘆號切分為句子，移除 [*] 校勘記號並保留引號。"""
    cleaned = re.sub(r"\[\*\]|\[＊\]", "", text)
    cleaned = re.sub(r"\s+", "", cleaned).strip()
    if not cleaned:
        return []
    # 以句末標點切分，並把緊跟的右引號/括號歸在前一句
    parts = re.split(r"(?<=[。；？！])(?![」』）])", cleaned)
    result: list[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # 若單純只剩標點，併回前一句
        if result and re.fullmatch(r"[」』）”。；？！，、：]+", p):
            result[-1] += p
        else:
            result.append(p)
    return result


class _CBETAHtmlParser(HTMLParser):
    """解析 CBETA 回傳的單卷 HTML，抽出正文段落與品名，排除頁碼行號與校勘註腳。"""

    def __init__(self) -> None:
        super().__init__()
        self.in_body = False
        self.body_depth = 0
        self.skip_depth = 0
        self.in_block = False
        self.block_type = "prose"
        self.block_tag = ""
        self.block_depth = 0
        self.current_buf: list[str] = []
        self.blocks: list[tuple[str, str]] = []  # (type, text)
        self.pin_titles: list[str] = []

    def _has_class(self, attrs_dict: dict[str, str], names: set[str]) -> bool:
        cls_val = attrs_dict.get("class", "")
        tokens = set(cls_val.split())
        return bool(tokens & names)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k: (v or "") for k, v in attrs}

        if tag == "div" and ad.get("id") == "body":
            self.in_body = True
            self.body_depth = 1
            return

        if not self.in_body:
            return

        if tag == "div":
            self.body_depth += 1

        # 抓取品名 <mulu class='pin' s='1 世主妙嚴品'/>
        if tag == "mulu" and "pin" in ad.get("class", "").split():
            s_val = ad.get("s", "").strip()
            if s_val and s_val not in self.pin_titles:
                self.pin_titles.append(s_val)
            return

        # 跳過行號、校勘註腳、圖片連結、附錄區、異文 rdg
        if self.skip_depth > 0:
            self.skip_depth += 1
            return

        if (
            ad.get("id") == "back"
            or self._has_class(ad, {"lb", "note", "noteAnchor", "rdg", "facsimile", "linehead", "doube-line-note"})
            or tag in {"style", "script"}
        ):
            self.skip_depth = 1
            return

        # 區塊開始：<p> 或 <div class="lg">（偈頌）
        if not self.in_block:
            if tag == "p":
                self.in_block = True
                self.block_tag = "p"
                self.block_depth = 1
                self.current_buf = []
                if self._has_class(ad, {"juan", "byline", "head", "juan-open", "juan-close"}):
                    self.block_type = "heading"
                else:
                    self.block_type = "prose"
            elif tag == "div" and self._has_class(ad, {"lg"}):
                self.in_block = True
                self.block_tag = "div"
                self.block_depth = 1
                self.current_buf = []
                self.block_type = "prose"
        else:
            if tag == self.block_tag:
                self.block_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if not self.in_body:
            return

        if self.skip_depth > 0:
            self.skip_depth -= 1
            return

        if self.in_block and tag == self.block_tag:
            self.block_depth -= 1
            if self.block_depth == 0:
                text = "".join(self.current_buf).strip()
                if text:
                    self.blocks.append((self.block_type, text))
                self.in_block = False
                self.current_buf = []

        if tag == "div":
            self.body_depth -= 1
            if self.body_depth <= 0:
                self.in_body = False

    def handle_data(self, data: str) -> None:
        if self.in_body and self.in_block and self.skip_depth == 0:
            self.current_buf.append(normalize_gaiji(data))


async def fetch_cbeta_fascicle(sutra_id: str, fascicle: int) -> dict[str, Any]:
    """從 CBETA Data API 下載指定經典卷次，轉換為專案標準 Fascicle JSON 格式。"""
    work_code = sutra_id_to_cbeta_work(sutra_id)
    params = {"work": work_code, "juan": str(fascicle), "work_info": "1"}

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        resp = await client.get(CBETA_API_BASE, params=params)
        if resp.status_code != 200:
            raise RuntimeError(f"CBETA API 回應失敗（HTTP {resp.status_code}）")
        payload = resp.json()

    results = payload.get("results") or []
    if not results or not isinstance(results[0], str):
        raise FileNotFoundError(f"CBETA 查無此經卷：{sutra_id}（{work_code}）第 {fascicle} 卷")

    html_str = results[0]
    work_info = payload.get("work_info") or {}

    parser = _CBETAHtmlParser()
    parser.feed(html_str)

    sutra_title = work_info.get("title") or sutra_id
    translator = work_info.get("byline") or ""
    total_juans = int(work_info.get("juan") or 1)
    pin_label = "・".join(parser.pin_titles[:2]) if parser.pin_titles else f"卷第{fascicle}"
    fascicle_title = f"卷第{fascicle}・{pin_label}" if parser.pin_titles else f"卷第{fascicle}"

    edition_label = f"{total_juans}卷本"
    if sutra_id == "T10n0279":
        edition_label = "八十華嚴（唐・實叉難陀譯）"
    elif sutra_id == "T19n0945":
        edition_label = "十卷楞嚴（唐・般剌蜜帝譯）"

    paragraphs: list[dict[str, Any]] = []
    for p_idx, (b_type, raw_text) in enumerate(parser.blocks, start=1):
        para_id = f"{sutra_id}_{fascicle:03d}_p{p_idx:04d}"
        if b_type == "heading":
            clean_h = re.sub(r"\[\*\]|\[＊\]|\s+", "", raw_text)
            sents = [clean_h] if clean_h else []
        else:
            sents = split_sentences_zh(raw_text)

        if not sents:
            continue

        sentence_objs = []
        for s_idx, s_text in enumerate(sents, start=1):
            sentence_objs.append({
                "sentence_id": f"{para_id}_s{s_idx:03d}",
                "index": s_idx,
                "text": s_text,
                "source_hash": compute_source_hash(s_text),
            })

        paragraphs.append({
            "paragraph_id": para_id,
            "index": len(paragraphs) + 1,
            "type": b_type,
            "sentences": sentence_objs,
        })

    if not paragraphs:
        raise RuntimeError(f"解析 CBETA 經文內容為空：{sutra_id} 第 {fascicle} 卷")

    return {
        "schema_version": "1.0",
        "source": "CBETA Online Data API (cbdata.dila.edu.tw)",
        "sutra_id": sutra_id,
        "sutra_title": sutra_title,
        "edition": edition_label,
        "translator": translator,
        "fascicle": fascicle,
        "fascicle_count": total_juans,
        "fascicle_title": fascicle_title,
        "paragraphs": paragraphs,
    }


# ---------- CBETA 古大德註疏動態檢索 ----------
CBETA_SEARCH_URL = "https://cbdata.dila.edu.tw/stable/search"
CBETA_KWIC_URL = "https://cbdata.dila.edu.tw/stable/search/kwic"

_GENERIC_PHRASES = {"爾時", "如是我聞", "一時", "復次", "佛言", "白佛言", "所謂", "何以故", "阿難"}


def parse_master_cbeta_works(cbeta_id_str: str) -> list[str]:
    """將 'T35n1735 / T36n1736' 或 'X08n0240' 解析為 CBETA work 代碼清單 ['T1735', 'T1736']。"""
    works: list[str] = []
    for token in re.findall(r"[A-Z]+\d+n\d+[A-Za-z]?", cbeta_id_str or ""):
        works.append(sutra_id_to_cbeta_work(token))
    return works


def extract_commentary_queries(sentence_text: str) -> list[str]:
    """從漢文經句抽出 2~4 組最具辨識度的 4~6 字關鍵片語，用於檢索古大德註疏引文。"""
    clean = re.sub(r"\[\*\]|\[＊\]|\s+", "", sentence_text)
    clauses = [c.strip() for c in re.split(r"[，。；？！：「」『』、（）]", clean) if len(c.strip()) >= 4]
    candidates: list[str] = []
    for clause in clauses:
        if clause in _GENERIC_PHRASES:
            continue
        if 4 <= len(clause) <= 6:
            candidates.append(clause)
        elif len(clause) > 6:
            # 取前 4 字、中後 4 字作為候選
            candidates.append(clause[:4])
            candidates.append(clause[-4:])
    # 去重並保留前 4 個最具辨識度的片語
    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        if c not in seen and c not in _GENERIC_PHRASES:
            seen.add(c)
            unique.append(c)
    if not unique and len(clean) >= 4:
        unique.append(clean[:4])
    return unique[:4]


async def search_cbeta_commentaries_for_sentence(
    sutra_id: str,
    fascicle: int,
    sentence_id: str,
    sentence_text: str,
    masters: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """針對指定經句，向 CBETA 檢索各古大德註疏中之真實對照段落，回傳 {master_id: [entry, ...]}。"""
    import asyncio

    work_to_master: dict[str, dict[str, Any]] = {}
    all_works: list[str] = []
    for m in masters:
        wlist = parse_master_cbeta_works(m.get("cbeta_id", ""))
        for w in wlist:
            work_to_master[w] = m
            if w not in all_works:
                all_works.append(w)

    if not all_works:
        return {}

    queries = extract_commentary_queries(sentence_text)
    if not queries:
        return {}

    works_param = ",".join(all_works)
    # master_id -> (work, juan, matched_query, title)
    best_hit_per_master: dict[str, tuple[str, int, str, str]] = {}

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for q in queries:
            try:
                r = await client.get(
                    CBETA_SEARCH_URL,
                    params={"q": q, "works": works_param, "rows": 20},
                )
                if r.status_code != 200:
                    continue
                data = r.json()
                for hit in data.get("results") or []:
                    w = hit.get("work", "")
                    m = work_to_master.get(w)
                    if not m:
                        continue
                    mid = m["master_id"]
                    if mid not in best_hit_per_master:
                        best_hit_per_master[mid] = (
                            w,
                            int(hit.get("juan") or 1),
                            q,
                            hit.get("title") or m.get("work_title", ""),
                        )
            except Exception:
                continue
            if len(best_hit_per_master) >= len(masters):
                break

        if not best_hit_per_master:
            return {}

        async def _fetch_kwic(mid: str, w: str, juan: int, q: str, title: str):
            try:
                kr = await client.get(
                    CBETA_KWIC_URL,
                    params={"work": w, "juan": juan, "q": q, "around": 150},
                )
                if kr.status_code != 200:
                    return mid, None
                kdata = kr.json()
                kresults = kdata.get("results") or []
                if not kresults:
                    return mid, None
                first = kresults[0]
                snippet = normalize_gaiji(re.sub(r"\s+", "", first.get("kwic", ""))).strip()
                if not snippet:
                    return mid, None
                m = work_to_master[w]
                is_cross = m.get("target_edition") not in (None, "", sutra_id)
                vol = first.get("vol", "")
                lb = first.get("lb", "")
                entry = {
                    "commentary_id": f"{mid}_{sentence_id}_{w}_j{juan}_{lb}",
                    "target_sentence_ids": [sentence_id],
                    "alignment_type": "cross_edition" if is_cross else "exact",
                    "section_heading": f"CBETA 檢索對照（關鍵詞「{q}」・{title} 卷{juan} {vol} p.{lb}）",
                    "original_commentary": f"……{snippet}……",
                    "cross_edition_note": (
                        f"此註疏原針對{m.get('target_edition_label', '他譯本')}，係以關鍵詞「{q}」跨譯本對照檢索自 CBETA。"
                        if is_cross
                        else None
                    ),
                }
                return mid, entry
            except Exception:
                return mid, None

        tasks = [
            _fetch_kwic(mid, w, juan, q, title)
            for mid, (w, juan, q, title) in best_hit_per_master.items()
        ]
        fetched = await asyncio.gather(*tasks)

    grouped: dict[str, list[dict[str, Any]]] = {}
    for mid, entry in fetched:
        if entry:
            grouped.setdefault(mid, []).append(entry)
    return grouped


# ---------- 古大德註疏「整卷全文」自動定位與下載 ----------
async def resolve_commentary_juan(
    work_code: str,
    total_commentary_juans: int,
    sutra_fascicle: int,
    sutra_fascicle_count: int,
    sample_sentences: list[str],
) -> int:
    """依原經卷次比例與卷首關鍵句，自動定位該古大德註疏最對應的卷號（1-based）。"""
    ratio = (sutra_fascicle - 0.5) / max(1, sutra_fascicle_count)
    expected_juan = max(1, min(total_commentary_juans, round(ratio * total_commentary_juans + 0.5)))

    # 收集卷首 3 句的辨識度片語
    queries: list[str] = []
    for s in sample_sentences[:5]:
        for q in extract_commentary_queries(s):
            if q not in queries:
                queries.append(q)
        if len(queries) >= 4:
            break

    if not queries:
        return expected_juan

    candidate_juans: list[int] = []
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
        for q in queries:
            try:
                r = await client.get(
                    CBETA_SEARCH_URL,
                    params={"q": q, "works": work_code, "rows": 15},
                )
                if r.status_code != 200:
                    continue
                for hit in r.json().get("results") or []:
                    j = int(hit.get("juan") or 0)
                    if j >= 1:
                        candidate_juans.append(j)
            except Exception:
                continue
            if candidate_juans:
                break

    if not candidate_juans:
        return expected_juan

    # 挑選最接近預期進度比例的卷號，避免重複片語誤跳到很後面
    return min(candidate_juans, key=lambda j: abs(j - expected_juan))


def _extract_juan_from_xml_p5a(xml_text: str, target_juan: int) -> list[dict[str, Any]]:
    """從 CBETA xml-p5a 原始 TEI XML 中擷取指定卷次的正文段落（作為 cbdata API 逾時之高速備援）。"""
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml_text)
    body = None
    for elem in root.iter():
        if elem.tag.endswith("}body") or elem.tag == "body":
            body = elem
            break
    if body is None:
        return []

    def _local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    def _collect_text(node: ET.Element) -> str:
        parts: list[str] = []
        if node.text:
            parts.append(node.text)
        for child in node:
            lt = _local(child.tag)
            if lt in {"note", "rdg", "figDesc", "lb", "pb", "milestone", "mulu"}:
                if child.tail:
                    parts.append(child.tail)
                continue
            parts.append(_collect_text(child))
            if child.tail:
                parts.append(child.tail)
        return "".join(parts)

    current_juan = 0
    paragraphs: list[dict[str, Any]] = []

    def _walk(node: ET.Element) -> None:
        nonlocal current_juan
        lt = _local(node.tag)
        if lt == "milestone" and node.attrib.get("unit") == "juan":
            n_val = node.attrib.get("n", "")
            if n_val.isdigit():
                current_juan = int(n_val)
            return

        if current_juan > target_juan:
            return

        if current_juan == target_juan and lt in {"p", "lg", "head", "byline", "juan"}:
            raw = _collect_text(node)
            clean = re.sub(r"\[\*\]|\[＊\]|\s+", "", normalize_gaiji(raw)).strip()
            if clean:
                idx = len(paragraphs) + 1
                b_type = "heading" if lt in {"head", "byline", "juan"} else "prose"
                paragraphs.append({
                    "index": idx,
                    "para_id": f"xml_{target_juan:03d}_p{idx:04d}",
                    "type": b_type,
                    "text": clean,
                })
            return

        for child in node:
            _walk(child)

    _walk(body)
    return paragraphs


async def _fetch_commentary_from_github(master_meta: dict[str, Any], juan: int) -> dict[str, Any]:
    """高速備援：從 CBETA 官方 GitHub (cbeta-git/xml-p5a) 下載並擷取指定卷次。"""
    cbeta_id = (master_meta.get("cbeta_id") or "").strip()
    m = re.match(r"^([A-Z]+)(\d+)n\d+[A-Za-z]?$", cbeta_id)
    if not m:
        raise FileNotFoundError(f"無法推導 GitHub xml-p5a 路徑：{cbeta_id}")
    canon, vol = m.group(1), f"{m.group(1)}{m.group(2)}"
    url = f"{CBETA_GITHUB_RAW_BASE}/{canon}/{vol}/{cbeta_id}.xml"

    async with httpx.AsyncClient(timeout=25.0, headers=CBETA_HEADERS, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        xml_text = r.text

    paragraphs = _extract_juan_from_xml_p5a(xml_text, juan)
    if not paragraphs:
        raise FileNotFoundError(f"GitHub xml-p5a ({cbeta_id}) 查無第 {juan} 卷內容")

    work_code = master_meta.get("primary_work") or sutra_id_to_cbeta_work(cbeta_id)
    for p in paragraphs:
        p["para_id"] = f"{work_code}_{juan:03d}_p{p['index']:04d}"

    return {
        "schema_version": "1.0",
        "source": f"CBETA GitHub xml-p5a ({cbeta_id}.xml)",
        "master_id": master_meta["master_id"],
        "work": work_code,
        "title": master_meta.get("work_title", ""),
        "juan": juan,
        "total_juans": int(master_meta.get("total_juans") or 1),
        "paragraphs": paragraphs,
    }


async def fetch_commentary_fulltext_juan(master_meta: dict[str, Any], juan: int) -> dict[str, Any]:
    """從 CBETA 下載指定古大德註疏的完整單卷全文；若 cbdata API 逾時或異常，自動切換至 GitHub xml-p5a 高速備援。"""
    work_code = master_meta.get("primary_work")
    if not work_code:
        works = parse_master_cbeta_works(master_meta.get("cbeta_id", ""))
        work_code = works[0] if works else None
    if not work_code:
        raise FileNotFoundError(
            f"{master_meta.get('name')} {master_meta.get('work_title')} 目前無 CBETA 線上典籍編號，僅支援本地精選註疏。"
        )

    params = {"work": work_code, "juan": str(juan), "work_info": "1"}
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=CBETA_HEADERS, follow_redirects=True) as client:
            resp = await client.get(CBETA_API_BASE, params=params)
            resp.raise_for_status()
            payload = resp.json()
        results = payload.get("results") or []
        if not results or not isinstance(results[0], str):
            raise FileNotFoundError(f"CBETA 查無 {work_code} 第 {juan} 卷")
    except Exception:
        # 自動切換至 CBETA 官方 GitHub xml-p5a 高速鏡像
        return await _fetch_commentary_from_github(master_meta, juan)

    parser = _CBETAHtmlParser()
    parser.feed(results[0])
    work_info = payload.get("work_info") or {}
    total_juans = int(work_info.get("juan") or master_meta.get("total_juans") or 1)

    paragraphs: list[dict[str, Any]] = []
    for b_type, raw_text in parser.blocks:
        clean_text = re.sub(r"\[\*\]|\[＊\]", "", raw_text)
        clean_text = re.sub(r"\s+", "", clean_text).strip()
        if not clean_text:
            continue
        idx = len(paragraphs) + 1
        paragraphs.append({
            "index": idx,
            "para_id": f"{work_code}_{juan:03d}_p{idx:04d}",
            "type": b_type,
            "text": clean_text,
        })

    return {
        "schema_version": "1.0",
        "source": "CBETA Online Data API",
        "master_id": master_meta["master_id"],
        "work": work_code,
        "title": work_info.get("title") or master_meta.get("work_title", ""),
        "juan": juan,
        "total_juans": total_juans,
        "paragraphs": paragraphs,
    }
