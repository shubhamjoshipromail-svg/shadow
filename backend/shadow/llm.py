"""LLM access for Shadow: provider routing, failover and a spend meter.

LLMs translate between language and the model; they never *are* the model.
Every call returns validated structured output or plain text.

Calls name a *tier* (vision / fast / reason), not a model. Providers are
tried in order (Anthropic, then OpenAI); a provider that fails on auth,
billing or rate limits is benched for a few minutes, so one dead key never
stalls a live session.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal, TypeVar

import anthropic
from pydantic import BaseModel

from shadow import config

log = logging.getLogger("shadow.llm")
T = TypeVar("T", bound=BaseModel)
Tier = Literal["vision", "fast", "reason"]

# USD per million tokens (input, output). Estimates for the spend meter only.
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-5-5": (4.0, 20.0),
    "gpt-4.1-mini": (0.4, 1.6),
    "gpt-4.1": (2.0, 8.0),
    "gpt-6-luna": (0.10, 0.50),
    "gpt-6-sol": (1.25, 10.0),
}


@dataclass
class Meter:
    calls: int = 0
    usd: float = 0.0
    by_model: dict[str, dict[str, float]] = field(default_factory=dict)
    benched: dict[str, float] = field(default_factory=dict)  # provider -> until epoch
    last_error: dict[str, str] = field(default_factory=dict)

    def add(self, model: str, inp: int, out: int, cached: int = 0) -> None:
        pi, po = PRICES.get(model, (2.0, 10.0))
        cost = ((inp - cached) * pi + cached * pi * 0.1 + out * po) / 1e6
        self.calls += 1
        self.usd += cost
        m = self.by_model.setdefault(model, {"calls": 0, "in": 0, "out": 0, "cached": 0, "usd": 0.0})
        m["calls"] += 1
        m["in"] += inp
        m["out"] += out
        m["cached"] += cached
        m["usd"] = round(m["usd"] + cost, 5)

    def bench(self, provider: str, err: str, seconds: float = 300) -> None:
        self.benched[provider] = time.time() + seconds
        self.last_error[provider] = err[:300]
        log.warning("benching %s for %ss: %s", provider, seconds, err[:200])

    def summary(self) -> dict[str, Any]:
        now = time.time()
        return {"calls": self.calls, "usd": round(self.usd, 4), "by_model": self.by_model,
                "benched": {p: round(t - now) for p, t in self.benched.items() if t > now},
                "last_error": self.last_error}


meter = Meter()
last_model: str | None = None  # model behind the most recent structured call (provenance for receipts)


def _providers(tier: Tier | None = None) -> list[str]:
    keys = {"anthropic": config.ANTHROPIC_API_KEY, "openai": config.OPENAI_API_KEY}
    now = time.time()
    spec = config.TIER_PROVIDERS.get(tier, config.LLM_PROVIDERS) if tier else config.LLM_PROVIDERS
    order = [p.strip() for p in spec.split(",") if p.strip()]
    live = [p for p in order if keys.get(p) and meter.benched.get(p, 0) < now]
    # if everything is benched, try the benched ones anyway rather than fail outright
    return live or [p for p in order if keys.get(p)]


def available() -> bool:
    return bool(_providers())


def _model(provider: str, tier: Tier) -> str:
    if provider == "openai":
        return {"vision": config.OPENAI_VISION_MODEL, "fast": config.OPENAI_FAST_MODEL,
                "reason": config.OPENAI_REASON_MODEL}[tier]
    return {"vision": config.VISION_MODEL, "fast": config.FAST_MODEL, "reason": config.REASON_MODEL}[tier]


# ------------------------------------------------------------------ anthropic
_client: anthropic.AsyncAnthropic | None = None


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(max_retries=1, timeout=45.0)
    return _client


def _system(text: str) -> list[dict[str, Any]]:
    # stable system prompts are cached; volatile content goes in the user turn
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def _meter_anthropic(model: str, usage: Any) -> None:
    if usage is None:
        return
    cached = getattr(usage, "cache_read_input_tokens", 0) or 0
    created = getattr(usage, "cache_creation_input_tokens", 0) or 0
    meter.add(model, usage.input_tokens + cached + created, usage.output_tokens, cached)


def _fatal_for_provider(e: Exception) -> bool:
    """Errors that mean 'this provider is unusable right now' (bench it) vs. request problems."""
    if isinstance(e, (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.RateLimitError,
                      anthropic.APIConnectionError)):
        return True
    if isinstance(e, anthropic.BadRequestError) and "credit" in (e.message or "").lower():
        return True
    return isinstance(e, anthropic.APIStatusError) and e.status_code >= 500


async def _anthropic_parse(schema: type[T], system: str, content: Any, model: str, max_tokens: int) -> T | None:
    resp = await client().messages.parse(
        model=model, max_tokens=max_tokens, system=_system(system),
        messages=[{"role": "user", "content": content}], output_format=schema,
    )
    _meter_anthropic(model, resp.usage)
    if resp.stop_reason == "refusal":
        log.warning("refusal on %s: %s", model, resp.stop_details)
        return None
    return resp.parsed_output


# ------------------------------------------------------------------ public API
async def parse(schema: type[T], system: str, content: str | list[dict[str, Any]], *, tier: Tier = "reason",
                max_tokens: int = 4000) -> T:
    """Structured output, routed across providers."""
    errors = []
    for provider in _providers(tier):
        model = _model(provider, tier)
        try:
            if provider == "anthropic":
                out = await _anthropic_parse(schema, system, content, model, max_tokens)
                if out is None and tier != "fast":  # refusal: retry once on the fast model
                    out = await _anthropic_parse(schema, system, content, _model(provider, "fast"), max_tokens)
            else:
                from shadow import llm_openai
                out = await llm_openai.parse(schema, system, content, model, max_tokens)
            if out is not None:
                global last_model
                last_model = model
                return out
            errors.append(f"{provider}: empty")
        except Exception as e:  # noqa: BLE001 - route around a failing provider
            errors.append(f"{provider}: {e}")
            if provider == "anthropic" and _fatal_for_provider(e):
                meter.bench(provider, str(e))
            elif provider == "openai":
                from shadow import llm_openai
                if llm_openai.fatal(e):
                    meter.bench(provider, str(e))
            log.warning("parse via %s failed: %s", provider, e)
    raise RuntimeError(f"structured call failed for {schema.__name__}: {'; '.join(errors) or 'no provider'}")


async def text(system: str, content: str | list[dict[str, Any]], *, tier: Tier = "fast", max_tokens: int = 600) -> str:
    chunks = [c async for c in stream_text(system, [{"role": "user", "content": content}], tier=tier,
                                            max_tokens=max_tokens)]
    return "".join(chunks).strip()


async def stream_text(system: str, messages: list[dict[str, Any]], *, tier: Tier = "fast",
                      max_tokens: int = 400) -> AsyncIterator[str]:
    for provider in _providers(tier):
        model = _model(provider, tier)
        started = False
        try:
            if provider == "anthropic":
                async with client().messages.stream(model=model, max_tokens=max_tokens, system=_system(system),
                                                    messages=messages) as stream:
                    async for chunk in stream.text_stream:
                        started = True
                        yield chunk
                    _meter_anthropic(model, (await stream.get_final_message()).usage)
            else:
                from shadow import llm_openai
                async for chunk in llm_openai.stream_text(system, messages, model, max_tokens):
                    started = True
                    yield chunk
            return
        except Exception as e:  # noqa: BLE001
            log.warning("stream via %s failed: %s", provider, e)
            if provider == "anthropic" and _fatal_for_provider(e):
                meter.bench(provider, str(e))
            if started:
                return  # never splice two providers' half-answers together


async def check() -> dict[str, Any]:
    """Tiny live call per provider: is it actually usable (key, billing, model access)?"""
    out: dict[str, Any] = {}
    for provider, key in (("anthropic", config.ANTHROPIC_API_KEY), ("openai", config.OPENAI_API_KEY)):
        if not key:
            out[provider] = {"ok": False, "why": "no key"}
            continue
        model = _model(provider, "fast")
        try:
            if provider == "anthropic":
                r = await client().messages.create(model=model, max_tokens=5,
                                                   messages=[{"role": "user", "content": "Say OK."}])
                _meter_anthropic(model, r.usage)
            else:
                from shadow import llm_openai
                await llm_openai.ping(model)
            meter.benched.pop(provider, None)
            out[provider] = {"ok": True, "model": model}
        except Exception as e:  # noqa: BLE001
            meter.bench(provider, str(e), seconds=120)
            out[provider] = {"ok": False, "why": str(e)[:200]}
    return out


def image_block(b64: str, media_type: str = "image/jpeg") -> dict[str, Any]:
    return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}}
