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


def _strip_think_tags(raw_text: str) -> str:
    """移除推理模型（如 DeepSeek-R1 / Nemotron）可能輸出的 <think>...</think> 思考區塊。"""
    return re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL).strip()


def _extract_json_block(raw_text: str) -> dict[str, Any]:
    text = _strip_think_tags(raw_text)
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
        self.nvidia_api_key = os.getenv("NVIDIA_API_KEY", "").strip()
        self.nvidia_model = os.getenv("NVIDIA_MODEL", "nvidia/nemotron-3-ultra-550b-a55b").strip()
        self.nvidia_base_url = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
        self.ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5:14b").strip()

    async def get_status(self) -> dict[str, Any]:
        load_dotenv(override=True)
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.nvidia_api_key = os.getenv("NVIDIA_API_KEY", "").strip()

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
            "nvidia": {
                "configured": bool(self.nvidia_api_key),
                "model": self.nvidia_model,
                "base_url": self.nvidia_base_url,
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
        api_key_override: str | None = None,
    ) -> tuple[dict[str, Any], str, str]:
        chosen_provider = (provider or self.default_provider or "gemini").lower()
        prompt = self._build_sentence_prompt(
            sutra_title, edition, target_text, prev_sentences, next_sentences, commentaries
        )

        if chosen_provider == "gemini":
            model_name = model_override or self.gemini_model
            raw = await self._call_gemini(prompt, model_name, expect_json=True, api_key_override=api_key_override)
        elif chosen_provider == "nvidia":
            model_name = model_override or self.nvidia_model
            raw = await self._call_nvidia(prompt, model_name, expect_json=True, api_key_override=api_key_override)
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
        api_key_override: str | None = None,
    ) -> tuple[str, str, str]:
        chosen_provider = (provider or self.default_provider or "gemini").lower()
        prompt = f"""你是精通漢傳佛學的學者。請將以下古大德文言註疏翻譯為清晰易懂的繁體中文白話導讀（3~5句即可，保留佛學精義）：

【大德與出處】{master_name} {work_title}
【註疏原文】
{original_commentary}

請直接輸出白話導讀文字，不需額外標題。"""

        if chosen_provider == "gemini":
            model_name = model_override or self.gemini_model
            raw = await self._call_gemini(prompt, model_name, expect_json=False, api_key_override=api_key_override)
        elif chosen_provider == "nvidia":
            model_name = model_override or self.nvidia_model
            raw = await self._call_nvidia(prompt, model_name, expect_json=False, api_key_override=api_key_override)
        elif chosen_provider == "ollama":
            model_name = model_override or self.ollama_model
            raw = await self._call_ollama(prompt, model_name, expect_json=False)
        else:
            raise ValueError(f"不支援的 LLM 引擎：{chosen_provider}")

        return _strip_think_tags(raw), chosen_provider, model_name

    async def _call_gemini(
        self,
        prompt: str,
        model_name: str,
        expect_json: bool,
        api_key_override: str | None = None,
    ) -> str:
        # 每次呼叫重新讀取 .env 以支援使用者熱更新金鑰
        load_dotenv(override=True)
        api_key = (api_key_override or os.getenv("GEMINI_API_KEY", "")).strip()
        if not api_key:
            raise RuntimeError(
                "尚未設定 GEMINI_API_KEY。請在「🔑 API 設定」填入 Gemini API Key，或於 .env 設定 GEMINI_API_KEY。"
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

    async def probe_gemini_model(
        self,
        model_name: str,
        api_key_override: str | None = None,
    ) -> dict[str, Any]:
        """以極小 Token（maxOutputTokens=1）快速探測指定 Gemini 模型是否可連線。"""
        import time

        load_dotenv(override=True)
        api_key = (api_key_override or os.getenv("GEMINI_API_KEY", "")).strip()
        if not api_key:
            return {
                "model": model_name,
                "ok": False,
                "status": "no_key",
                "http_status": None,
                "latency_ms": 0,
                "message": "尚未設定 GEMINI_API_KEY",
            }

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent"
        )
        payload = {
            "contents": [{"parts": [{"text": "ok"}]}],
            "generationConfig": {"maxOutputTokens": 1, "temperature": 0},
        }
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.post(url, params={"key": api_key}, json=payload)
            latency_ms = int((time.perf_counter() - t0) * 1000)
            if r.status_code == 200:
                return {
                    "model": model_name,
                    "ok": True,
                    "status": "ok",
                    "http_status": 200,
                    "latency_ms": latency_ms,
                    "message": "可連線",
                }
            err_msg = ""
            try:
                err_msg = str(r.json().get("error", {}).get("message", ""))
            except Exception:
                err_msg = r.text[:160]
            low = err_msg.lower()
            if r.status_code == 429 or "quota" in low or "rate limit" in low:
                st = "quota"
            elif r.status_code == 404 or "not found" in low:
                st = "not_found"
            elif r.status_code in (400, 401) and ("api key" in low or "api_key_invalid" in low):
                st = "auth_error"
            elif r.status_code == 403:
                st = "auth_error" if "api key" in low else "forbidden"
            else:
                st = "error"
            return {
                "model": model_name,
                "ok": False,
                "status": st,
                "http_status": r.status_code,
                "latency_ms": latency_ms,
                "message": err_msg[:180] or f"HTTP {r.status_code}",
            }
        except httpx.TimeoutException:
            return {
                "model": model_name,
                "ok": False,
                "status": "timeout",
                "http_status": None,
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "message": "連線逾時",
            }
        except Exception as exc:
            return {
                "model": model_name,
                "ok": False,
                "status": "error",
                "http_status": None,
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "message": str(exc)[:180],
            }

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

    async def _call_nvidia(
        self,
        prompt: str,
        model_name: str,
        expect_json: bool,
        api_key_override: str | None = None,
    ) -> str:
        load_dotenv(override=True)
        api_key = (api_key_override or os.getenv("NVIDIA_API_KEY", "")).strip()
        if not api_key:
            raise RuntimeError(
                "尚未設定 NVIDIA API Key（nvapi-...）。請在「🔑 API 設定」的 NVIDIA 分頁填入個人金鑰，或於 .env 設定 NVIDIA_API_KEY。"
            )
        url = f"{self.nvidia_base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "top_p": 0.9,
            "max_tokens": 4096,
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(url, headers=headers, json=payload)
            if r.status_code != 200:
                detail = r.text[:240]
                try:
                    j = r.json()
                    detail = str(j.get("detail") or j.get("error", {}).get("message") or detail)
                except Exception:
                    pass
                raise RuntimeError(f"NVIDIA NIM API 錯誤（HTTP {r.status_code}）：{detail}")
            data = r.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("NVIDIA NIM 未回傳有效內容")
        msg = choices[0].get("message") or {}
        content = msg.get("content") or ""
        if not content.strip():
            raise RuntimeError("NVIDIA NIM 回傳空內容")
        return content

    async def probe_nvidia_model(
        self,
        model_name: str,
        api_key_override: str | None = None,
    ) -> dict[str, Any]:
        """以極小 Token（max_tokens=1）快速探測指定 NVIDIA NIM 模型是否可連線。"""
        import time

        load_dotenv(override=True)
        api_key = (api_key_override or os.getenv("NVIDIA_API_KEY", "")).strip()
        if not api_key:
            return {
                "model": model_name,
                "ok": False,
                "status": "no_key",
                "http_status": None,
                "latency_ms": 0,
                "message": "尚未設定 NVIDIA_API_KEY",
            }

        url = f"{self.nvidia_base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        payload = {
            "model": model_name,
            "messages": [{"role": "user", "content": "ok"}],
            "max_tokens": 1,
            "temperature": 0,
            "stream": False,
        }
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(url, headers=headers, json=payload)
            latency_ms = int((time.perf_counter() - t0) * 1000)
            if r.status_code == 200:
                return {
                    "model": model_name,
                    "ok": True,
                    "status": "ok",
                    "http_status": 200,
                    "latency_ms": latency_ms,
                    "message": "可連線",
                }
            err_msg = ""
            try:
                j = r.json()
                err_msg = str(j.get("detail") or j.get("error", {}).get("message") or r.text[:160])
            except Exception:
                err_msg = r.text[:160]
            low = err_msg.lower()
            if r.status_code == 429 or "rate limit" in low or "quota" in low:
                st = "quota"
            elif r.status_code == 404 or "not found" in low:
                st = "not_found"
            elif r.status_code == 401 or "unauthorized" in low or "invalid api key" in low:
                st = "auth_error"
            elif r.status_code == 403:
                st = "forbidden"
            else:
                st = "error"
            return {
                "model": model_name,
                "ok": False,
                "status": st,
                "http_status": r.status_code,
                "latency_ms": latency_ms,
                "message": err_msg[:180] or f"HTTP {r.status_code}",
            }
        except httpx.TimeoutException:
            return {
                "model": model_name,
                "ok": False,
                "status": "timeout",
                "http_status": None,
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "message": "連線逾時",
            }
        except Exception as exc:
            return {
                "model": model_name,
                "ok": False,
                "status": "error",
                "http_status": None,
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "message": str(exc)[:180],
            }
