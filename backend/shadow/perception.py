"""Screen frames → semantic events (the brief's Module 1 pipeline).

The browser samples ~1 fps, drops frames whose perceptual hash didn't change,
blurs PII regions, and posts the rest here. A vision model turns each frame
(plus the previous screen summary) into a *reading*: the business object in
focus and what the page shows as ``{label: value}``.

Two consecutive readings are then diffed into the engine's event vocabulary by
:func:`diff_events`:

    case_opened{case_id}                      the object in focus changed
    field_changed{field, before, after}       a visible value changed (or appeared)
    action{name, label, ...}                  a button/status outcome became visible

When a workflow pack is supplied, visible labels are mapped onto the pack's own
decision-field names by :func:`map_fields` (exact names, labels, option labels
and a small synonym table); otherwise they stay as normalised labels.

Privacy: every value that leaves this module is passed through
:func:`shadow.redact.redact`, so IBANs, cards, e-mails and other personal or
payment data never reach the engine as raw text. When the sandbox ERP's DOM
capture is present, DOM events win and vision only adds context.
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from shadow import llm
from shadow.redact import redact

__all__ = [
    "FrameReading",
    "Reading",
    "ScreenChange",
    "VisibleField",
    "diff_events",
    "entity_key",
    "map_fields",
    "normalise_label",
    "safe_value",
]


# --------------------------------------------------------------------- models
class VisibleField(BaseModel):
    name: str
    value: str


class ScreenChange(BaseModel):
    type: Literal["opened", "field_changed", "clicked", "panel_opened", "navigated", "scrolled", "other"]
    entity: str | None = Field(None, description="e.g. 'invoice 4471'")
    field: str | None = None
    before: str | None = None
    after: str | None = None
    description: str


def _as_text(value: Any) -> str:
    return "" if value is None else (value if isinstance(value, str) else str(value))


class FrameReading(BaseModel):
    app: str = Field(description="Application or page, e.g. 'Nordwerk ERP – invoice workspace'")
    entity: str | None = Field(None, description="The business object in focus, e.g. 'invoice 4471'")
    entity_id: str | None = Field(
        None, description="Stable identifier of the object as shown on the page, e.g. '4471' or 'inv-4471'")
    summary: str = Field(description="One sentence: what is on screen right now")
    visible_fields: list[VisibleField] = Field(default_factory=list, description="Key fields and values")
    fields: dict[str, str] = Field(
        default_factory=dict, description="What the page shows as {label: value}, exactly as displayed")
    changes: list[ScreenChange] = Field(default_factory=list, description="What changed since the previous summary")
    user_activity: Literal["typing", "reading", "navigating", "idle", "unknown"] = "unknown"

    @field_validator("entity_id", mode="before")
    @classmethod
    def _coerce_entity_id(cls, v: Any) -> Any:
        return None if v is None else _as_text(v)

    @field_validator("fields", mode="before")
    @classmethod
    def _coerce_fields(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return {str(k): _as_text(val) for k, val in v.items()}
        return v

    @field_validator("visible_fields", mode="before")
    @classmethod
    def _coerce_visible_fields(cls, v: Any) -> Any:
        if isinstance(v, list):
            return [{**item, "value": _as_text(item.get("value"))} if isinstance(item, dict) else item
                    for item in v]
        return v

    @model_validator(mode="after")
    def _mirror_field_views(self) -> "FrameReading":
        """Keep `fields` (the structured dict) and `visible_fields` consistent.

        The vision model may fill either one; downstream code can rely on both.
        """
        merged: dict[str, str] = dict(self.fields)
        for field in self.visible_fields:
            merged.setdefault(field.name, field.value)
        self.fields = merged
        self.visible_fields = [VisibleField(name=name, value=value) for name, value in merged.items()]
        return self


# `Reading` is the short name the event pipeline speaks; `FrameReading` remains
# the structured-output schema name.
Reading = FrameReading


# ------------------------------------------------------------------- privacy
def safe_value(value: Any) -> str:
    """Return `value` as text with personal/payment data replaced by placeholders."""
    scrubbed, _ = redact(_as_text(value))
    return scrubbed


# ------------------------------------------------------------- field mapping
# A tiny, deliberately conservative cross-spelling / cross-language table. It
# only widens a *token* to its known aliases; scoring still needs real overlap.
_TOKEN_SYNONYMS: dict[str, set[str]] = {
    "centre": {"center"},
    "centres": {"centers"},
    "vat": {"tax"},
    "ust": {"tax"},
    "steuer": {"tax"},
    "steuernummer": {"tax", "id"},
    "kostenstelle": {"cost", "center"},
    "kosten": {"cost"},
    "rechnung": {"invoice"},
    "zahlung": {"payment"},
    "zahlungsziel": {"payment", "terms"},
    "faelligkeit": {"due", "date"},
    "waehrung": {"currency"},
    "betrag": {"amount"},
    "nummer": {"number", "no"},
    "nr": {"number", "no"},
    "no": {"number"},
}

_MATCH_THRESHOLD = 0.6
_ACTION_FIELD_TOKENS = {"status", "action", "outcome", "result", "state", "decision"}
_ID_TOKEN = re.compile(r"(?<![\w])[A-Za-z]{0,6}[-_]?\d[\w-]*")


def normalise_label(label: Any) -> str:
    """A stable machine key for a human label: 'Cost centre' → 'cost_centre'."""
    text = unicodedata.normalize("NFKD", _as_text(label))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^0-9a-zA-Z]+", "_", text).strip("_").lower()
    return text


def _tokens(label: Any) -> set[str]:
    return {token for token in normalise_label(label).split("_") if token}


def _stem(token: str) -> str:
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _expand(tokens: set[str]) -> set[str]:
    out = set(tokens)
    for token in tokens:
        out |= _TOKEN_SYNONYMS.get(token, set())
    return out


def _token_sim(a: set[str], b: set[str]) -> float:
    a = {_stem(t) for t in a}
    b = {_stem(t) for t in b}
    if not a or not b:
        return 0.0
    if not (a & b):
        return 0.0
    if a <= b or b <= a:
        return 0.85
    return len(a & b) / len(a | b)


def _spec_get(spec: Any, key: str, default: Any = None) -> Any:
    if isinstance(spec, dict):
        return spec.get(key, default)
    return getattr(spec, key, default)


def _specs(pack: Any | None) -> list[Any]:
    if pack is None:
        return []
    fields = _spec_get(pack, "decision_fields")
    return list(fields or [])


def _candidates(spec: Any) -> set[str]:
    names = {normalise_label(_spec_get(spec, "name", "")), normalise_label(_spec_get(spec, "label", ""))}
    return {name for name in names if name}


def _score_field(label: Any, value: Any, spec: Any) -> float:
    """How well a visible (label, value) fits one decision field spec, 0..1."""
    label_key = normalise_label(label)
    label_tokens = _tokens(label)
    if not label_key:
        return 0.0
    best = 0.0
    for candidate in (_spec_get(spec, "name", ""), _spec_get(spec, "label", "")):
        cand_key = normalise_label(candidate)
        if not cand_key:
            continue
        if label_key == cand_key:
            return 1.0
        cand_tokens = _tokens(candidate)
        best = max(best, 0.9 * SequenceMatcher(None, label_key, cand_key).ratio())
        best = max(best, _token_sim(label_tokens, cand_tokens))
        best = max(best, _token_sim(_expand(label_tokens), _expand(cand_tokens)))
    # Value evidence: the shown value is one of this field's options / option labels.
    value_key = normalise_label(value)
    if value_key:
        for option in _spec_get(spec, "options", []) or []:
            if value_key == normalise_label(option):
                best = max(best, 0.9)
        for option_label in (_spec_get(spec, "option_labels", {}) or {}).values():
            if value_key == normalise_label(option_label):
                best = max(best, 0.85)
    return best


def _exact_spec(label: Any, specs: list[Any]) -> Any | None:
    label_key = normalise_label(label)
    if not label_key:
        return None
    for spec in specs:
        if label_key in _candidates(spec):
            return spec
    return None


def _best_spec(label: Any, value: Any, specs: list[Any]) -> Any | None:
    best, best_score = None, 0.0
    for spec in specs:
        score = _score_field(label, value, spec)
        if score > best_score:
            best, best_score = spec, score
    return best if best_score >= _MATCH_THRESHOLD else None


def _put(out: dict[str, str], key: str, value: str) -> None:
    key = key or "field"
    if key in out:
        index = 2
        while f"{key}_{index}" in out:
            index += 1
        key = f"{key}_{index}"
    out[key] = value


def map_fields(reading: Reading, pack: Any | None = None) -> dict[str, str]:
    """Map a reading's visible fields onto the workflow's own field names.

    With a pack: exact matches on the field name/label win, then the best
    similarity score across labels, option labels and the synonym table; below
    the threshold the normalised label is kept. Without a pack every key is the
    normalised label. All values are redacted before they leave.
    """
    source = dict(reading.fields) if reading.fields else {f.name: f.value for f in reading.visible_fields}
    specs = _specs(pack)
    out: dict[str, str] = {}
    if not specs:
        for label, value in source.items():
            _put(out, normalise_label(label), safe_value(value))
        return out

    pending: list[tuple[str, str]] = []
    for label, value in source.items():
        spec = _exact_spec(label, specs)
        if spec is None:
            pending.append((label, value))
        else:
            _put(out, _spec_get(spec, "name", "") or normalise_label(label), safe_value(value))
    for label, value in pending:
        spec = _best_spec(label, value, specs)
        key = (_spec_get(spec, "name", "") if spec is not None else "") or normalise_label(label)
        _put(out, key, safe_value(value))
    return out


# ------------------------------------------------------------------- events
def entity_key(reading: Reading | None) -> str | None:
    """The stable case key of a reading: `entity_id`, else an id-like token, else the entity name."""
    if reading is None:
        return None
    if reading.entity_id:
        return safe_value(reading.entity_id).strip() or None
    if not reading.entity:
        return None
    text = safe_value(reading.entity).strip()
    match = _ID_TOKEN.search(text)
    if match:
        return match.group(0).strip()
    return normalise_label(text) or None


def _is_action_field(field: str) -> bool:
    return bool(_tokens(field) & _ACTION_FIELD_TOKENS)


def _action_events(prev: Reading | None, cur: Reading, prev_fields: dict[str, str],
                   cur_fields: dict[str, str]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    case_id = entity_key(cur)
    for change in cur.changes:
        if change.type != "clicked":
            continue
        name = normalise_label(change.field or change.description) or "click"
        if name in seen:
            continue
        seen.add(name)
        out.append({"type": "action", "name": name, "label": change.description, "case_id": case_id})
    if prev is None:
        return out  # a status is an outcome only once it *changed*, not on first sight
    for field, after in cur_fields.items():
        if prev_fields.get(field) == after or not after or not _is_action_field(field):
            continue
        name = normalise_label(after)
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({"type": "action", "name": name, "label": after, "field": field,
                    "before": prev_fields.get(field), "after": after, "case_id": case_id})
    return out


def diff_events(prev: Reading | None, cur: Reading, pack: Any | None = None) -> list[dict]:
    """Turn two consecutive readings into engine events.

    Emits ``case_opened`` when the entity id changes, ``field_changed`` per
    changed (or appeared/vanished) visible value on the same case, and
    ``action`` for a click or a status/outcome field transition. Values are
    mapped through :func:`map_fields` (pack-aware) and redacted.
    """
    cur_fields = map_fields(cur, pack)
    prev_fields = map_fields(prev, pack) if prev is not None else {}
    cur_id = entity_key(cur)
    prev_id = entity_key(prev) if prev is not None else None
    events: list[dict] = []

    if cur_id is not None and (prev is None or cur_id != prev_id):
        event: dict[str, Any] = {"type": "case_opened", "case_id": cur_id}
        if cur_fields:
            event["fields"] = cur_fields
        events.append(event)
    elif prev is None:
        # No stable id on the first frame: report what became visible.
        for field, after in cur_fields.items():
            events.append({"type": "field_changed", "case_id": None, "field": field,
                           "before": None, "after": after})
    else:
        for field, after in cur_fields.items():
            before = prev_fields.get(field)
            if before == after:
                continue
            events.append({"type": "field_changed", "case_id": cur_id, "field": field,
                           "before": before, "after": after})
        for field, before in prev_fields.items():
            if field not in cur_fields:
                events.append({"type": "field_changed", "case_id": cur_id, "field": field,
                               "before": before, "after": None})

    events.extend(_action_events(prev, cur, prev_fields, cur_fields))
    return events


# ---------------------------------------------------------------------- read
SYSTEM = """You watch an expert's shared screen for an AI apprentice. You receive one screenshot and a
summary of the previous screen. Report what is on screen and what CHANGED, as structured events.
Identify the business object in focus by name (`entity`) and by its stable identifier exactly as shown
on the page (`entity_id`, e.g. the invoice, case or ticket number). Put everything the page shows that
could matter to the decision under `fields`, as {label: value}, using the label printed on the page and
the value exactly as displayed. Be literal and specific; never invent values you cannot read. Ignore
blurred regions (they are redacted personal data) and never transcribe IBANs, payment cards, e-mail
addresses or other personal data."""


def _prompt_context(previous_summary: str | None, pack: Any | None) -> str:
    lines = [f"Previous screen: {previous_summary or '(none — first frame)'}"]
    labels = [(_spec_get(spec, "label") or _spec_get(spec, "name") or "") for spec in _specs(pack)]
    labels = [label for label in labels if label]
    if labels:
        lines.append("This workflow's own fields are: " + ", ".join(labels) +
                     ". Prefer these labels when they describe what you see.")
    return "\n".join(lines)


async def read_frame(image_b64: str, previous_summary: str | None, media_type: str = "image/jpeg", *,
                     pack: Any | None = None) -> FrameReading:
    content = [
        llm.image_block(image_b64, media_type),
        {"type": "text", "text": _prompt_context(previous_summary, pack)},
    ]
    return await llm.parse(FrameReading, SYSTEM, content, tier="vision", max_tokens=1500)
