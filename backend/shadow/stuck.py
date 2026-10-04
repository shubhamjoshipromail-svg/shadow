"""Stuck detection — the learner-guide half of the companion (task S).

Pure, no I/O, no LLM, no engine dependency. :class:`StuckDetector` is fed the
same semantic events the capture loop already receives and answers one
question: *is this person stuck, and how much help should we offer?*

The answer is always behavioural. We never read the booking, we never grade an
answer, we never ask "are you confused?". We only look at what the hands did:
long pauses with no field change, a value flipped back and forth, the same
panel opened again and again, an undo, blocked saves, or an explicit "help".

Levels are the help ladder (``LEVELS``); the engine picks the words and the
place to look, this module only picks the rung::

    0  silent       nothing to do
    1  cue          a soft badge on the portrait
    2  question     a Socratic question (the card)
    3  highlight    point at the fields / panels worth looking at
    4  show_me      explain, or replay the expert's attention path

Engine hook (Claude implements; this module codes against it)
------------------------------------------------------------
Feed every capture event, e.g. inside ``Session.on_event``::

    self.stuck.observe(evt)                 # field_changed / panel_opened /
                                            # input / case_opened (add
                                            # save_blocked / help where those
                                            # are known)

Then, on the existing pause/idle cadence, ask::

    s = self.stuck.score(self.now())
    if s["stuck"] and s["level"] > self.stuck.last_nudged:
        await self.emit("nudge", {
            "case_id": s["case_id"],
            "level": s["level"],
            "text": <engine-authored, chosen from reasons + Work Map>,
            "look": <field / panel names, e.g. from the map's screen moments>,
        })
        self.stuck.last_nudged = s["level"]

``save_blocked`` costs nothing to add: ``before_save`` already knows when it
refused a booking, and ``help`` is the companion's "I'm stuck" link. When an
intervention carries ``show_me`` (the expert's attention trail, already stored
on the decision point as ``dp.trail``) the companion replays it in place.

Tuning
------
Every threshold is a named module constant and can be overridden per instance;
the defaults are deliberately conservative so a normal expert-speed run never
fires. ``test_stuck.py`` pins both halves: each signal fires, and a fast
expert does not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

__all__ = [
    "StuckDetector",
    "SILENT",
    "CUE",
    "QUESTION",
    "HIGHLIGHT",
    "SHOW_ME",
    "LEVELS",
    "HESITATION_SECONDS",
    "HESITATION_LONG_SECONDS",
    "HESITATION_CRITICAL_SECONDS",
    "INPUT_QUIET_SECONDS",
    "OSCILLATION_REVERSALS",
    "PANEL_REOPEN_COUNT",
    "BLOCKED_SAVE_COUNT",
    "BLOCKED_SAVE_MANY",
    "UNDO_COUNT",
    "DEFAULT_CASE",
]

# ------------------------------------------------------------------ ladder
SILENT, CUE, QUESTION, HIGHLIGHT, SHOW_ME = 0, 1, 2, 3, 4
LEVELS = {
    SILENT: "silent",
    CUE: "cue",
    QUESTION: "question",
    HIGHLIGHT: "highlight",
    SHOW_ME: "show_me",
}

# -------------------------------------------------------------- thresholds
# Hesitation is "no field change" for this long, and also no typing / scrolling
# for INPUT_QUIET_SECONDS, so a trainee who is actively working is never
# interrupted just because a commit event has not landed yet.
HESITATION_SECONDS = 20.0          # level 1: a subtle cue
HESITATION_LONG_SECONDS = 45.0     # level 2: a Socratic question
HESITATION_CRITICAL_SECONDS = 90.0  # level 4: stop and walk them through it
INPUT_QUIET_SECONDS = 8.0          # any key/scroll/mouse within this window means "working"
OSCILLATION_REVERSALS = 2          # A -> B -> A -> B (two returns) is oscillation
PANEL_REOPEN_COUNT = 3             # the same panel opened this many times
BLOCKED_SAVE_COUNT = 2             # level 3: highlight where to look
BLOCKED_SAVE_MANY = 4              # level 4: stop and explain
UNDO_COUNT = 1                     # one revert to an earlier value is already a signal
DEFAULT_CASE = ""

# The order reasons are reported in, regardless of the severity order.
_REASON_ORDER = ("help", "hesitation", "blocked_save", "oscillation", "panel_reopen", "undo")


def _num(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _get(event: Any, key: str, default: Any = None) -> Any:
    if isinstance(event, Mapping):
        return event.get(key, default)
    return getattr(event, key, default)


@dataclass
class _CaseState:
    """Behavioural memory for one case. Cumulative; reset by ``case_opened``."""

    case_id: str
    opened_at: float
    last_t: float
    last_field_t: float
    last_input_t: float
    values: dict[str, list[Any]] = field(default_factory=dict)
    befores: dict[str, set[Any]] = field(default_factory=dict)
    reversals: int = 0
    undoes: int = 0
    panels: dict[str, int] = field(default_factory=dict)
    blocked: int = 0
    help: bool = False

    def touch(self, t: float) -> None:
        self.last_t = t


class StuckDetector:
    """Turns behavioural events into a stuck score with a help level.

    Events are plain mappings (or objects) with a ``type`` and a ``t`` — the
    capture script's own vocabulary: ``case_opened``, ``field_changed``,
    ``panel_opened``, ``input``, plus ``save_blocked`` and ``help``. A missing
    ``t`` reuses the last event's clock.
    """

    def __init__(
        self,
        *,
        hesitation: float = HESITATION_SECONDS,
        hesitation_long: float = HESITATION_LONG_SECONDS,
        hesitation_critical: float = HESITATION_CRITICAL_SECONDS,
        input_quiet: float = INPUT_QUIET_SECONDS,
        oscillation: int = OSCILLATION_REVERSALS,
        panel_reopen: int = PANEL_REOPEN_COUNT,
        blocked: int = BLOCKED_SAVE_COUNT,
        blocked_many: int = BLOCKED_SAVE_MANY,
        undo: int = UNDO_COUNT,
    ) -> None:
        if not (hesitation <= hesitation_long <= hesitation_critical):
            raise ValueError("hesitation thresholds must be non-decreasing")
        self.hesitation = float(hesitation)
        self.hesitation_long = float(hesitation_long)
        self.hesitation_critical = float(hesitation_critical)
        self.input_quiet = float(input_quiet)
        self.oscillation = int(oscillation)
        self.panel_reopen = int(panel_reopen)
        self.blocked = int(blocked)
        self.blocked_many = int(blocked_many)
        self.undo = int(undo)
        self.cases: dict[str, _CaseState] = {}
        self.current: str | None = None
        self._now: float = 0.0
        # the engine stores the rung it already showed, to avoid repeats
        self.last_nudged: int = SILENT

    # ------------------------------------------------------------------ feed
    def observe(self, event: Any) -> None:
        """Record one event. Unknown types are ignored (never raises)."""
        kind = str(_get(event, "type", "") or _get(event, "kind", "") or "")
        if not kind:
            return
        t = _num(_get(event, "t"), self._now)
        if t is None:
            t = self._now
        self._now = t

        if kind == "case_opened":
            case_id = str(_get(event, "case_id", None) or _get(event, "id", None) or DEFAULT_CASE)
            self.current = case_id
            self.cases[case_id] = _CaseState(case_id=case_id, opened_at=t, last_t=t,
                                             last_field_t=t, last_input_t=t)
            self.last_nudged = SILENT
            return

        if kind not in ("field_changed", "panel_opened", "input", "save_blocked", "help"):
            return

        st = self._state_for(_get(event, "case_id", None), t)
        st.touch(t)

        if kind == "field_changed":
            self._field_changed(st, event, t)
        elif kind == "panel_opened":
            panel = str(_get(event, "panel", "") or "")
            if panel:
                st.panels[panel] = st.panels.get(panel, 0) + 1
        elif kind == "input":
            st.last_input_t = t
        elif kind == "save_blocked":
            st.blocked += 1
        elif kind == "help":
            st.help = True

    def _field_changed(self, st: _CaseState, event: Any, t: float) -> None:
        name = _get(event, "field")
        if not name:
            return
        name = str(name)
        before, after = _get(event, "before"), _get(event, "after")
        history = st.values.setdefault(name, [])
        befores = st.befores.setdefault(name, set())
        if not history and before is not None:
            history.append(before)
        # a return to the value two changes ago is a back-and-forth reversal
        if len(history) >= 2 and after == history[-2] and after != history[-1]:
            st.reversals += 1
        # after == an earlier before means the expert undid their own change
        if after is not None and after in befores and after != before:
            st.undoes += 1
        if after is not None:
            history.append(after)
        if before is not None:
            befores.add(before)
        st.last_field_t = t

    # ----------------------------------------------------------------- score
    def score(self, now: float | None = None, case_id: str | None = None) -> dict[str, Any]:
        """How stuck is the current (or named) case at ``now``?

        Returns ``{"stuck": bool, "level": 0..4, "reasons": [...], ...}``. The
        level is the strongest rung any single signal reached, so a test can
        drive one signal at a time. ``reasons`` names the signals that fired,
        in a fixed order, and never repeats.
        """
        when = _num(now, self._now)
        if when is None:
            when = self._now
        st = self._state_for(case_id, when, create=False)
        if st is None:
            return {"stuck": False, "level": SILENT, "reasons": [], "case_id": None,
                    "elapsed": 0.0, "since_field_change": None, "counts": self._empty_counts()}

        fires: dict[str, int] = {}

        # explicit help outranks everything: they asked, so walk them through it
        if st.help:
            fires["help"] = SHOW_ME

        # hesitation: no field change, and no active typing / scrolling
        since_field = when - st.last_field_t
        since_input = when - st.last_input_t
        if since_field >= self.hesitation and since_input >= self.input_quiet:
            rung = CUE
            if since_field >= self.hesitation_critical:
                rung = SHOW_ME
            elif since_field >= self.hesitation_long:
                rung = QUESTION
            fires["hesitation"] = rung

        # blocked saves: one is a nudge, two means show them where to look,
        # four means stop and explain
        if st.blocked >= self.blocked_many:
            fires["blocked_save"] = SHOW_ME
        elif st.blocked >= self.blocked:
            fires["blocked_save"] = HIGHLIGHT
        elif st.blocked >= 1:
            fires["blocked_save"] = CUE

        if st.reversals >= self.oscillation:
            fires["oscillation"] = QUESTION
        if any(n >= self.panel_reopen for n in st.panels.values()):
            fires["panel_reopen"] = QUESTION
        if st.undoes >= self.undo:
            fires["undo"] = CUE

        level = max(fires.values(), default=SILENT)
        reasons = [name for name in _REASON_ORDER if name in fires]
        return {
            "stuck": level > SILENT,
            "level": level,
            "level_name": LEVELS[level],
            "reasons": reasons,
            "case_id": st.case_id,
            "elapsed": round(when - st.opened_at, 3),
            "since_field_change": round(since_field, 3),
            "counts": {
                "field_changes": sum(len(v) for v in st.values.values()),
                "reversals": st.reversals,
                "undoes": st.undoes,
                "panel_reopens": dict(st.panels),
                "blocked_saves": st.blocked,
                "help": st.help,
            },
        }

    # ----------------------------------------------------------------- helpers
    def _state_for(self, case_id: Any, t: float, *, create: bool = True) -> _CaseState | None:
        cid = str(case_id) if case_id is not None else (self.current if self.current is not None else DEFAULT_CASE)
        self.current = cid
        st = self.cases.get(cid)
        if st is None and create:
            st = _CaseState(case_id=cid, opened_at=t, last_t=t, last_field_t=t, last_input_t=t)
            self.cases[cid] = st
        return st

    @staticmethod
    def _empty_counts() -> dict[str, Any]:
        return {"field_changes": 0, "reversals": 0, "undoes": 0, "panel_reopens": {},
                "blocked_saves": 0, "help": False}

    def reset(self, case_id: str | None = None) -> None:
        """Forget one case, or everything when ``case_id`` is None."""
        if case_id is None:
            self.cases.clear()
            self.current = None
        else:
            self.cases.pop(str(case_id), None)
        self.last_nudged = SILENT
