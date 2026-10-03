"""Natural-pause detection (Apprentice Test 1).

The agent stays quiet while the expert types, reads (scrolls) or talks, and
only asks once all signals have been quiet for a moment. A task boundary
(decision just committed) shortens the required quiet period.
"""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class ActivityTracker:
    last_input: float = 0.0
    last_scroll: float = 0.0
    last_speech_end: float = 0.0
    last_screen_change: float = 0.0
    last_boundary: float = 0.0
    user_speaking: bool = False
    agent_speaking: bool = False

    INPUT_QUIET = 1.5
    SPEECH_QUIET = 1.2
    SCREEN_QUIET = 1.0
    BOUNDARY_WINDOW = 8.0

    def input(self, kind: str, now: float | None = None) -> None:
        now = now or time.time()
        if kind == "scroll":
            self.last_scroll = now
        self.last_input = now

    def speech(self, speaking: bool, who: str = "user", now: float | None = None) -> None:
        now = now or time.time()
        if who == "agent":
            self.agent_speaking = speaking
        else:
            self.user_speaking = speaking
        if not speaking:
            self.last_speech_end = now

    def screen_changed(self, now: float | None = None) -> None:
        self.last_screen_change = now or time.time()

    def boundary(self, now: float | None = None) -> None:
        self.last_boundary = now or time.time()

    def state(self, now: float | None = None) -> dict:
        now = now or time.time()
        near_boundary = now - self.last_boundary < self.BOUNDARY_WINDOW
        factor = 0.6 if near_boundary else 1.0
        reasons = []
        if self.user_speaking:
            reasons.append("expert is talking")
        if self.agent_speaking:
            reasons.append("agent is talking")
        if now - self.last_input < self.INPUT_QUIET * factor:
            reasons.append("expert is reading" if now - self.last_scroll < self.INPUT_QUIET else "expert is typing")
        if now - self.last_speech_end < self.SPEECH_QUIET * factor:
            reasons.append("just finished talking")
        if now - self.last_screen_change < self.SCREEN_QUIET * factor:
            reasons.append("screen is changing")
        return {"paused": not reasons, "near_boundary": near_boundary, "blocking": reasons}

    def paused(self, now: float | None = None) -> bool:
        return self.state(now)["paused"]
