"""
CBETA 組字式（Gaiji）科判符號正規化。

CBETA 對於無 Unicode 碼位的缺字以「組字式」表示，例如 `[□@(?╳)]`、`[△@○]`、`[?︽]`。
古大德註疏（尤其憨山《楞嚴經通議》等）大量以此類「幾何符號組字」標示科判層級，
直接顯示會變成難以閱讀的怪字。此模組將「純符號組字式」轉為字型普遍支援之近似 Unicode 符號，
並保留不同層級間的區別；含漢字部件的真正缺字（如 `[口*隸]`）則維持 CBETA 標準組字式不變。
"""
from __future__ import annotations

import re

# 已知科判符號組字式 -> 近似可顯示符號（皆在 U+25A0–25FF 幾何圖形區，常見中文字型均支援）
GAIJI_SYMBOL_MAP: dict[str, str] = {
    "[□@(?╳)]": "▩",
    "[□@○]": "▣",
    "[□@◇]": "◈",
    "[□@(?(○/(○*○)))]": "▦",
    "[○@◇]": "◉",
    "[△@○]": "▲",
    "[△@△]": "△",
    "[?(●/(○*○))]": "●",
    "[?(○/(○*○))]": "◎",
    "[?(◇*◇)]": "◇",
    "[?╳]": "╳",
    "[?︽]": "︽",
    "[??卍]": "卍",
}

# 組字式中允許出現的「符號」字元與運算子
_SYMBOL_CHARS = "□■○●◎◇◆△▲▽▼╳×︽︾卍卐☆★◯"
_OPERATORS = "@*/?()-+"
_SYMBOL_GAIJI_RE = re.compile(r"\[[" + re.escape(_SYMBOL_CHARS + _OPERATORS) + r"]{2,40}\]")


def _fallback_symbol(token: str) -> str:
    for ch in token:
        if ch in _SYMBOL_CHARS:
            return ch
    return "◆"


def normalize_gaiji(text: str) -> str:
    """將純符號組字式替換為近似可顯示符號；含漢字部件之組字式保持原樣。"""
    if not text or "[" not in text:
        return text

    def _repl(m: re.Match[str]) -> str:
        tok = m.group(0)
        if tok in GAIJI_SYMBOL_MAP:
            return GAIJI_SYMBOL_MAP[tok]
        # 必須至少含一個幾何符號，避免誤傷 [*]、[1] 等校勘記號
        if not any(ch in _SYMBOL_CHARS for ch in tok):
            return tok
        return _fallback_symbol(tok)

    return _SYMBOL_GAIJI_RE.sub(_repl, text)


def normalize_paragraphs(paragraphs: list[dict]) -> list[dict]:
    """就地正規化註疏全文段落（text 欄位）與經文段落（sentences[].text）。"""
    for p in paragraphs or []:
        if isinstance(p.get("text"), str):
            p["text"] = normalize_gaiji(p["text"])
        for s in p.get("sentences", []) or []:
            if isinstance(s.get("text"), str):
                s["text"] = normalize_gaiji(s["text"])
    return paragraphs
