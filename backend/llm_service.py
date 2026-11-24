"""
雙引擎 LLM 翻譯服務：
- 預設：Gemini API（使用 google-genai SDK）
- 本機備援/切換：Ollama Local AI Model（呼叫 /api/chat）
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()


def _extract_json_block(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    # 移除可能出現的 markdown code fence
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1)
    else:
        brace_start = text.find("{")
        brace_end = text.rfind("}")
        if brace_start != -1 and brace_end != -1 and brace_end > brace_start:
            text = text[brace_start : brace_end + 1]
    return json.loads(text)


class LLMTranslationService:
    def __init__(self) -> None:
        self.default_provider = os.getenv("DEFAULT_LLM_PROVIDER", "gemini").strip().lower()
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
        self.ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5:14b").strip()

    async def get_status(self) -> dict[str, Any]:
        ollama_ok = False
        ollama_models: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                r = await client.get(f"{self.ollama_base_url}/api/tags")
                if r.status_code == 200:
                    ollama_ok = True
                    ollama_models = [m.get("name", "") for m in r.json().get("models", [])]
        except Exception:
            ollama_ok = False

        return {
            "default_provider": self.default_provider,
            "gemini": {
                "configured": bool(self.gemini_api_key),
                "model": self.gemini_model,
            },
            "ollama": {
                "reachable": ollama_ok,
                "base_url": self.ollama_base_url,
                "default_model": self.ollama_model,
                "available_models": ollama_models,
            },
        }

    def _build_sentence_prompt(
        self,
        sutra_title: str,
        edition: str,
        target_text: str,
        prev_sentences: list[str],
        next_sentences: list[str],
        commentaries: list[dict[str, Any]],
    ) -> str:
        comm_block = "（本句目前無對應古大德註疏節錄，請依佛學正統義理謹慎翻譯）"
        if commentaries:
            lines = []
            for c in commentaries:
                lines.append(
                    f"- 【{c.get('dynasty', '')}・{c.get('master_name', '')} {c.get('work_title', '')}】"
                    f"（{c.get('section_heading', '')}）：{c.get('original_commentary', '')}"
                )
            comm_block = "\n".join(lines)

        prev_str = " ".join(prev_sentences) if prev_sentences else "（段首）"
        next_str = " ".join(next_sentences) if next_sentences else "（段末）"

        return f"""你是一位精通漢傳佛教典籍與歷代祖師註疏的佛學專家。請將以下《{sutra_title}》（{edition}）中的指定句子翻譯並解析，輸出為**繁體中文純 JSON**（不要加額外說明文字）。

【上文脈絡】
{prev_str}

【待翻譯目標句】
{target_text}

【下文脈絡】
{next_str}

【參考古大德註疏（請以此為法義核心依據，避免望文生義）】
{comm_block}

請嚴格輸出以下 JSON 結構：
{{
  "literal_translation": "緊貼原文逐字對照之白話直譯（繁體中文）",
  "colloquial_translation": "流暢自然、現代人易懂的白話口語化新譯（繁體中文）",
  "dharma_analysis": "結合上述古大德註疏的法義解析（2~4句，準確深刻）",
  "terms": [
    {{"term": "句中關鍵佛學名相", "explanation": "簡明精準的佛學解釋"}}
  ]
}}"""

    async def translate_sentence(
        self,
        sutra_title: str,
        edition: str,
        target_text: str,
        prev_sentences: list[str],
        next_sentences: list[str],
        commentaries: list[dict[str, Any]],
        provider: str | None = None,
        model_override: str | None = None,
    ) -> tuple[dict[str, Any], str, str]:
        chosen_provider = (provider or self.default_provider or "gemini").lower()
        prompt = self._build_sentence_prompt(
            sutra_title, edition, target_text, prev_sentences, next_sentences, commentaries
        )

        if chosen_provider == "gemini":
            model_name = model_override or self.gemini_model
            raw = await self._call_gemini(prompt, model_name, expect_json=True)
        elif chosen_provider == "ollama":
            model_name = model_override or self.ollama_model
            raw = await self._call_ollama(prompt, model_name, expect_json=True)
        else:
            raise ValueError(f"不支援的 LLM 引擎：{chosen_provider}")

        parsed = _extract_json_block(raw)
        content = {
            "literal_translation": str(parsed.get("literal_translation", "")).strip(),
            "colloquial_translation": str(parsed.get("colloquial_translation", "")).strip(),
            "dharma_analysis": str(parsed.get("dharma_analysis", "")).strip(),
            "terms": parsed.get("terms") if isinstance(parsed.get("terms"), list) else [],
        }
        return content, chosen_provider, model_name

    async def translate_commentary(
        self,
        master_name: str,
        work_title: str,
        original_commentary: str,
        provider: str | None = None,
        model_override: str | None = None,
    ) -> tuple[str, str, str]:
        chosen_provider = (provider or self.default_provider or "gemini").lower()
        prompt = f"""你是精通漢傳佛學的學者。請將以下古大德文言註疏翻譯為清晰易懂的繁體中文白話導讀（3~5句即可，保留佛學精義）：

【大德與出處】{master_name} {work_title}
【註疏原文】
{original_commentary}

請直接輸出白話導讀文字，不需額外標題。"""

        if chosen_provider == "gemini":
            model_name = model_override or self.gemini_model
            raw = await self._call_gemini(prompt, model_name, expect_json=False)
        elif chosen_provider == "ollama":
            model_name = model_override or self.ollama_model
            raw = await self._call_ollama(prompt, model_name, expect_json=False)
        else:
            raise ValueError(f"不支援的 LLM 引擎：{chosen_provider}")

        return raw.strip(), chosen_provider, model_name

    async def _call_gemini(self, prompt: str, model_name: str, expect_json: bool) -> str:
        # 每次呼叫重新讀取 .env 以支援使用者熱更新金鑰
        load_dotenv(override=True)
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError(
                "尚未設定 GEMINI_API_KEY。請在專案根目錄建立 .env 並填入 GEMINI_API_KEY，或切換至本機 Ollama 引擎。"
            )
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        config = types.GenerateContentConfig(
            temperature=0.2,
            max_output_tokens=8192,
            response_mime_type="application/json" if expect_json else "text/plain",
        )
        # google-genai client 呼叫為同步，以 asyncio.to_thread 避免阻塞事件迴圈
        import asyncio

        def _sync_call() -> str:
            resp = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config,
            )
            return resp.text or ""

        return await asyncio.to_thread(_sync_call)

    async def _call_ollama(self, prompt: str, model_name: str, expect_json: bool) -> str:
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {"temperature": 0.2},
        }
        if expect_json:
            payload["format"] = "json"
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(f"{self.ollama_base_url}/api/chat", json=payload)
                r.raise_for_status()
                data = r.json()
                return data.get("message", {}).get("content", "")
        except httpx.ConnectError as exc:
            raise RuntimeError(
                f"無法連線至本機 Ollama（{self.ollama_base_url}）。請先啟動 Ollama 服務並確認已下載模型 {model_name}。"
            ) from exc
