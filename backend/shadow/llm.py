"""Thin wrappers around the Anthropic SDK.

LLMs translate between language and the model; they never *are* the model.
Every call here returns validated structured output or plain text.
"""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator, TypeVar

import anthropic
from pydantic import BaseModel

from shadow import config

log = logging.getLogger("shadow.llm")
T = TypeVar("T", bound=BaseModel)

_client: anthropic.AsyncAnthropic | None = None


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(max_retries=2, timeout=60.0)
    return _client


def available() -> bool:
    return bool(config.ANTHROPIC_API_KEY)


def _system(text: str) -> list[dict[str, Any]]:
    # stable system prompts are cached; volatile content goes in the user turn
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


async def parse(schema: type[T], system: str, content: str | list[dict[str, Any]], *, model: str | None = None,
                max_tokens: int = 4000) -> T:
    """Structured output call. Falls back to the fast model on a refusal."""
    model = model or config.REASON_MODEL
    for attempt_model in dict.fromkeys([model, config.FAST_MODEL]):
        try:
            resp = await client().messages.parse(
                model=attempt_model,
                max_tokens=max_tokens,
                system=_system(system),
                messages=[{"role": "user", "content": content}],
                output_format=schema,
            )
        except anthropic.BadRequestError as e:
            log.warning("parse bad request on %s: %s", attempt_model, e.message)
            continue
        if resp.stop_reason == "refusal":
            log.warning("refusal on %s: %s", attempt_model, resp.stop_details)
            continue
        if resp.parsed_output is not None:
            return resp.parsed_output
    raise RuntimeError(f"structured call failed for {schema.__name__}")


async def text(system: str, content: str | list[dict[str, Any]], *, model: str | None = None,
               max_tokens: int = 600) -> str:
    resp = await client().messages.create(
        model=model or config.FAST_MODEL,
        max_tokens=max_tokens,
        system=_system(system),
        messages=[{"role": "user", "content": content}],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


async def stream_text(system: str, messages: list[dict[str, Any]], *, model: str | None = None,
                      max_tokens: int = 400) -> AsyncIterator[str]:
    async with client().messages.stream(
        model=model or config.FAST_MODEL,
        max_tokens=max_tokens,
        system=_system(system),
        messages=messages,
    ) as stream:
        async for chunk in stream.text_stream:
            yield chunk


def image_block(b64: str, media_type: str = "image/jpeg") -> dict[str, Any]:
    return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}}
