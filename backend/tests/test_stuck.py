"""Tests for the stuck detector (task S).

Pure-logic tests: no server, no LLM, no engine. Two halves, as the acceptance
asks — every behavioural signal fires, and a normal expert-speed run never
fires.
"""

from __future__ import annotations

from shadow import stuck
from shadow.stuck import (
    BLOCKED_SAVE_COUNT,
    BLOCKED_SAVE_MANY,
    HESITATION_CRITICAL_SECONDS,
    HESITATION_LONG_SECONDS,
    HESITATION_SECONDS,
    CUE,
    HIGHLIGHT,
    QUESTION,
    SHOW_ME,
    SILENT,
    StuckDetector,
)


def feed(det: StuckDetector, *events) -> None:
    for e in events:
        det.observe(e)


def fc(field, before, after, t):
    return {"type": "field_changed", "field": field, "before": before, "after": after, "t": t}


def open_case(case_id="inv-1", t=0):
    return {"type": "case_opened", "case_id": case_id, "t": t}


# --------------------------------------------------------------------- basics
def test_levels_and_thresholds_are_sane_constants():
    assert (SILENT, CUE, QUESTION, HIGHLIGHT, SHOW_ME) == (0, 1, 2, 3, 4)
    assert stuck.LEVELS[SHOW_ME] == "show_me"
    assert HESITATION_SECONDS <= HESITATION_LONG_SECONDS <= HESITATION_CRITICAL_SECONDS
    assert BLOCKED_SAVE_COUNT <= BLOCKED_SAVE_MANY


def test_no_events_is_silent():
    s = StuckDetector().score(0)
    assert s["stuck"] is False
    assert s["level"] == SILENT
    assert s["reasons"] == []
    assert s["case_id"] is None


def test_unknown_event_types_are_ignored():
    det = StuckDetector()
    feed(det, open_case(t=0), {"type": "something_new", "t": 1})
    assert det.score(1)["stuck"] is False


def test_a_fresh_case_with_one_change_is_not_stuck():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("cost_center", None, "4711", 2))
    assert det.score(3)["stuck"] is False


def test_missing_time_reuses_the_clock():
    det = StuckDetector()
    feed(det, open_case(t=5), {"type": "save_blocked"})  # no t -> clock stays at 5
    s = det.score()  # no now -> clock stays at 5
    assert s["level"] == CUE
    assert s["since_field_change"] == 0.0


# ---------------------------------------------------------------- hesitation
def test_hesitation_starts_as_a_subtle_cue():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("net", None, "120", 1))
    s = det.score(HESITATION_SECONDS + 1)
    assert s["level"] == CUE
    assert "hesitation" in s["reasons"]


def test_hesitation_long_becomes_a_question():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("net", None, "120", 1))
    s = det.score(HESITATION_LONG_SECONDS + 1)
    assert s["level"] == QUESTION


def test_hesitation_critical_offers_show_me():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("net", None, "120", 1))
    s = det.score(HESITATION_CRITICAL_SECONDS + 1)
    assert s["level"] == SHOW_ME


def test_hesitation_does_not_fire_while_typing():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("net", None, "120", 1))
    long_after = HESITATION_LONG_SECONDS + 5
    feed(det, {"type": "input", "kind": "key", "t": long_after - 1})
    assert det.score(long_after)["stuck"] is False


def test_hesitation_needs_no_field_change_even_if_other_input_is_stale():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("net", None, "120", 1))
    # a mouse move 30s ago does not stop the long-pause signal
    feed(det, {"type": "input", "kind": "mouse", "t": 30})
    s = det.score(60)
    assert s["level"] == QUESTION
    assert "hesitation" in s["reasons"]


# ---------------------------------------------------------------- oscillation
def test_oscillation_needs_two_back_and_forth_reversals():
    det = StuckDetector()
    feed(det,
         open_case(t=0),
         fc("cost_center", "4711", "0400", 1),
         fc("cost_center", "0400", "4711", 2),
         fc("cost_center", "4711", "0400", 3))
    s = det.score(4)
    assert s["level"] == QUESTION
    assert "oscillation" in s["reasons"]


def test_one_reversal_is_undo_not_oscillation():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("cost_center", "4711", "0400", 1), fc("cost_center", "0400", "4711", 2))
    s = det.score(3)
    assert s["level"] == CUE
    assert s["reasons"] == ["undo"]
    assert "oscillation" not in s["reasons"]


def test_a_single_change_is_neither():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("cost_center", "4711", "0400", 1))
    s = det.score(2)
    assert s["reasons"] == []


# ---------------------------------------------------------------- panel churn
def test_reopening_the_same_panel_three_times_asks_a_question():
    det = StuckDetector()
    feed(det, open_case(t=0),
         {"type": "panel_opened", "panel": "po", "t": 1},
         {"type": "panel_opened", "panel": "po", "t": 2},
         {"type": "panel_opened", "panel": "po", "t": 3})
    s = det.score(4)
    assert s["level"] == QUESTION
    assert "panel_reopen" in s["reasons"]


def test_two_panel_opens_are_not_enough():
    det = StuckDetector()
    feed(det, open_case(t=0),
         {"type": "panel_opened", "panel": "po", "t": 1},
         {"type": "panel_opened", "panel": "po", "t": 2})
    assert det.score(3)["stuck"] is False


def test_different_panels_do_not_accumulate_the_same_signal():
    det = StuckDetector()
    feed(det, open_case(t=0),
         {"type": "panel_opened", "panel": "po", "t": 1},
         {"type": "panel_opened", "panel": "history", "t": 2},
         {"type": "panel_opened", "panel": "po", "t": 3})
    assert det.score(4)["stuck"] is False


# ---------------------------------------------------------------------- undo
def test_undo_to_an_earlier_value_is_a_cue():
    det = StuckDetector()
    feed(det, open_case(t=0), fc("net", "120", "240", 1), fc("net", "240", "120", 2))
    s = det.score(3)
    assert s["level"] == CUE
    assert "undo" in s["reasons"]


# ---------------------------------------------------------------- blocked saves
def test_one_blocked_save_is_a_cue():
    det = StuckDetector()
    feed(det, open_case(t=0), {"type": "save_blocked", "t": 1})
    assert det.score(2)["level"] == CUE


def test_two_blocked_saves_highlight_where_to_look():
    det = StuckDetector()
    feed(det, open_case(t=0), {"type": "save_blocked", "t": 1}, {"type": "save_blocked", "t": 2})
    s = det.score(3)
    assert s["level"] == HIGHLIGHT
    assert "blocked_save" in s["reasons"]


def test_many_blocked_saves_stop_and_explain():
    det = StuckDetector()
    feed(det, open_case(t=0), *[{"type": "save_blocked", "t": t} for t in range(1, BLOCKED_SAVE_MANY + 1)])
    assert det.score(BLOCKED_SAVE_MANY + 1)["level"] == SHOW_ME


# ---------------------------------------------------------------------- help
def test_explicit_help_is_show_me():
    det = StuckDetector()
    feed(det, open_case(t=0), {"type": "help", "t": 1})
    s = det.score(2)
    assert s["level"] == SHOW_ME
    assert "help" in s["reasons"]


def test_help_outranks_everything_and_does_not_repeat_reasons():
    det = StuckDetector()
    feed(det, open_case(t=0),
         {"type": "save_blocked", "t": 1}, {"type": "save_blocked", "t": 2},
         {"type": "panel_opened", "panel": "po", "t": 3},
         {"type": "panel_opened", "panel": "po", "t": 4},
         {"type": "panel_opened", "panel": "po", "t": 5},
         {"type": "help", "t": 6})
    s = det.score(7)
    assert s["level"] == SHOW_ME
    assert len(s["reasons"]) == len(set(s["reasons"]))


def test_reasons_use_a_fixed_order():
    det = StuckDetector()
    feed(det, open_case(t=0),
         {"type": "save_blocked", "t": 1},
         fc("cc", "A", "B", 2), fc("cc", "B", "A", 3), fc("cc", "A", "B", 4),
         {"type": "panel_opened", "panel": "po", "t": 5},
         {"type": "panel_opened", "panel": "po", "t": 6},
         {"type": "panel_opened", "panel": "po", "t": 7})
    assert det.score(8)["reasons"] == ["blocked_save", "oscillation", "panel_reopen", "undo"]


# ------------------------------------------------------------------- per case
def test_case_opened_resets_the_score():
    det = StuckDetector()
    feed(det, open_case("A", t=0), {"type": "save_blocked", "t": 1}, {"type": "save_blocked", "t": 2})
    assert det.score(3, "A")["level"] == HIGHLIGHT
    feed(det, open_case("B", t=3))
    assert det.score(3)["level"] == SILENT
    assert det.score(3, "B")["reasons"] == []


def test_cases_are_isolated():
    det = StuckDetector()
    feed(det, open_case("A", t=0), {"type": "save_blocked", "t": 1}, {"type": "save_blocked", "t": 2},
         open_case("B", t=3), {"type": "help", "t": 4})
    assert det.score(5, "A")["level"] == HIGHLIGHT
    assert det.score(5, "B")["level"] == SHOW_ME
    assert det.score(5, "B")["reasons"] == ["help"]


def test_reset_forgets_a_case_or_everything():
    det = StuckDetector()
    feed(det, open_case("A", t=0), {"type": "help", "t": 1})
    det.reset("A")
    assert det.cases == {}
    feed(det, open_case("B", t=2), {"type": "save_blocked", "t": 3}, {"type": "save_blocked", "t": 4})
    det.reset()
    assert det.cases == {} and det.current is None
    assert det.score(5)["stuck"] is False


# ----------------------------------------------------- not over-triggering
def test_normal_expert_speed_run_never_fires():
    """A fast, confident run: frequent commits, one panel, no blocked save."""
    det = StuckDetector()
    feed(det, open_case(t=0))
    for i in range(1, 61):
        t = i * 2.0
        det.observe({"type": "input", "kind": "key", "t": t})
        if i % 3 == 0:
            det.observe(fc("cost_center", None, "cc-%d" % i, t))
    det.observe({"type": "panel_opened", "panel": "po", "t": 121})
    for probe in (30, 60, 90, 120, 124):
        s = det.score(probe)
        assert s["stuck"] is False, (probe, s)
        assert s["reasons"] == []


def test_typing_pauses_do_not_fire_during_a_slow_but_working_run():
    """Even a slow worker is silent while keys keep landing."""
    det = StuckDetector()
    feed(det, open_case(t=0))
    t = 0.0
    for _ in range(20):
        t += 6.0  # 6s of thought between keystrokes
        det.observe({"type": "input", "kind": "key", "t": t})
        assert det.score(t + 1)["stuck"] is False


def test_two_save_blocks_only_highlight_never_scold():
    """The ladder exists so we never jump straight to 'explain' on two misses."""
    det = StuckDetector()
    feed(det, open_case(t=0), {"type": "save_blocked", "t": 1}, {"type": "save_blocked", "t": 2})
    assert det.score(3)["level"] == HIGHLIGHT
    assert det.score(3)["level"] < SHOW_ME
