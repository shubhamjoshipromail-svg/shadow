"""OpenAI fallback provider (used when the Anthropic key is missing, out of credit or rate-limited).

Content arrives in Anthropic block format and is converted here, so the
rest of Shadow never knows which provider answered.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, TypeVar

import openai
from pydantic import BaseModel

from shadow import config

T = TypeVar("T", bound=BaseModel)
_client: openai.AsyncOpenAI | None = None


def client() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        _client = openai.AsyncOpenAI(api_key=config.OPENAI_API_KEY, max_retries=1, timeout=45.0)
    return _client


def fatal(e: Exception) -> bool:
    return isinstance(e, (openai.AuthenticationError, openai.PermissionDeniedError, openai.RateLimitError,
                          openai.APIConnectionError)) or (isinstance(e, openai.APIStatusError) and e.status_code >= 500)


def _convert(content: str | list[dict[str, Any]]) -> str | list[dict[str, Any]]:
    if isinstance(content, str):
        return content
    parts: list[dict[str, Any]] = []
    for block in content:
        if block.get("type") == "image":
            src = block["source"]
            parts.append({"type": "image_url", "image_url": {"url": f"data:{src['media_type']};base64,{src['data']}"}})
        elif block.get("type") == "text":
            parts.append({"type": "text", "text": block["text"]})
    return parts


def _meter(model: str, usage: Any) -> None:
    if usage is None:
        return
    from shadow.llm import meter
    cached = getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0
    meter.add(model, usage.prompt_tokens, usage.completion_tokens, cached)


async def parse(schema: type[T], system: str, content: Any, model: str, max_tokens: int) -> T | None:
    resp = await client().chat.completions.parse(
        model=model, max_completion_tokens=max_tokens, response_format=schema,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": _convert(content)}],
    )
    _meter(model, resp.usage)
    msg = resp.choices[0].message
    return None if msg.refusal else msg.parsed


async def stream_text(system: str, messages: list[dict[str, Any]], model: str, max_tokens: int) -> AsyncIterator[str]:
    msgs = [{"role": "system", "content": system}] + [{"role": m["role"], "content": _convert(m["content"])}
                                                       for m in messages]
    stream = await client().chat.completions.create(model=model, max_completion_tokens=max_tokens, messages=msgs,
                                                    stream=True, stream_options={"include_usage": True})
    async for chunk in stream:
        if chunk.usage:
            _meter(model, chunk.usage)
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def ping(model: str) -> None:
    r = await client().chat.completions.create(model=model, max_completion_tokens=5,
                                               messages=[{"role": "user", "content": "Say OK."}])
    _meter(model, r.usage)
