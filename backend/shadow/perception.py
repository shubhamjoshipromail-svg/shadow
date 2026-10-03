"""Screen frames → semantic events (the brief's Module 1 pipeline).

The browser samples ~1 fps, drops frames whose perceptual hash didn't change,
blurs PII regions, and posts the rest here. A vision model turns each frame
(plus the previous screen summary) into events. When the sandbox ERP's DOM
capture is present, DOM events win and vision only adds context.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from shadow import llm


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


class FrameReading(BaseModel):
    app: str = Field(description="Application or page, e.g. 'Nordwerk ERP – invoice workspace'")
    entity: str | None = Field(None, description="The business object in focus, e.g. 'invoice 4471'")
    summary: str = Field(description="One sentence: what is on screen right now")
    visible_fields: list[VisibleField] = Field(default_factory=list, description="Key fields and values")
    changes: list[ScreenChange] = Field(default_factory=list, description="What changed since the previous summary")
    user_activity: Literal["typing", "reading", "navigating", "idle", "unknown"] = "unknown"


SYSTEM = """You watch an expert's shared screen for an AI apprentice. You receive one screenshot and a
summary of the previous screen. Report what is on screen and what CHANGED, as structured events.
Be literal and specific: name entities by their visible identifiers (invoice numbers, supplier names),
fields by their labels, and values exactly as shown. Never invent values you cannot read. Ignore
blurred regions (they are redacted personal data)."""


async def read_frame(image_b64: str, previous_summary: str | None, media_type: str = "image/jpeg") -> FrameReading:
    content = [
        llm.image_block(image_b64, media_type),
        {"type": "text", "text": f"Previous screen: {previous_summary or '(none — first frame)'}"},
    ]
    return await llm.parse(FrameReading, SYSTEM, content, tier="vision", max_tokens=1500)
