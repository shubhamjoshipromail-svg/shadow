"""Append-only event store. Episodes are the asset; everything else is a view."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import JSON, Boolean, Column, Float, Integer, MetaData, String, Table, Text, create_engine, func, insert, select

from shadow import config

metadata = MetaData()

events = Table(
    "events", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("session_id", String(64), index=True),
    Column("ts", Float),
    Column("type", String(64), index=True),
    Column("payload", JSON),
)

sessions = Table(
    "sessions", metadata,
    Column("id", String(64), primary_key=True),
    Column("mode", String(16)),
    Column("pack_id", String(64)),
    Column("expert", String(64)),
    Column("created", Float),
    Column("meta", JSON),
)

maps = Table(
    "maps", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("expert", String(64), index=True),
    Column("pack_id", String(64)),
    Column("session_id", String(64)),
    Column("version", Integer),
    Column("created", Float),
    Column("map", JSON),
)


# ---------------------------------------------------------------- the decision ledger
# Typed, labelled rows derived from the event log. Every row says whose knowledge it is (workspace, workflow,
# expert) and whether it came from a real person ("live") or the simulator ("rehearsal").
_owner = lambda: [Column("session_id", String(64), index=True), Column("workspace", String(64), index=True),  # noqa: E731
                  Column("workflow", String(64), index=True), Column("expert", String(64), index=True),
                  Column("source", String(16), index=True), Column("created", Float)]

decisions = Table(  # one expert decision on one case, scored against a guess written down beforehand
    "decisions", metadata, Column("id", Integer, primary_key=True, autoincrement=True), *_owner(),
    Column("episode_id", String(32)), Column("case_id", String(64)), Column("via", String(16)),
    Column("case_facts", JSON), Column("predicted", JSON), Column("predicted_map_version", Integer),
    Column("prospective", Boolean), Column("actual", JSON), Column("surprises", JSON),
)

explanations = Table(  # one question and the expert's answer, with what it changed
    "explanations", metadata, Column("id", Integer, primary_key=True, autoincrement=True), *_owner(),
    Column("inquiry_id", String(32)), Column("receipt_id", String(32)), Column("question_type", String(32)),
    Column("question", Text), Column("case_id", String(64)), Column("field", String(64)),
    Column("transcript", Text), Column("quote", Text), Column("redactions", JSON), Column("status", String(32)),
    Column("map_version_before", Integer), Column("map_version_after", Integer), Column("diff", JSON),
)

learner_attempts = Table(  # one new-hire save attempt on an unseen case
    "learner_attempts", metadata, Column("id", Integer, primary_key=True, autoincrement=True), *_owner(),
    Column("learner", String(64), index=True), Column("case_id", String(64)), Column("booking", JSON),
    Column("action", String(32)), Column("allowed", Boolean), Column("independent", Boolean),
    Column("violations", JSON),
)

mastery = Table(  # a learner's current mastery estimate per rule (BKT), so progress outlives a session
    "mastery", metadata, Column("id", Integer, primary_key=True, autoincrement=True),
    Column("workspace", String(64), index=True), Column("workflow", String(64), index=True),
    Column("learner", String(64), index=True), Column("node_id", String(32)), Column("state", JSON),
    Column("updated", Float),
)

policies = Table(  # learned interaction policy per (workspace, workflow, expert): question bandit, interruption cost
    "policies", metadata, Column("key", String(200), primary_key=True), Column("state", JSON),
    Column("updated", Float),
)

workflows = Table(  # learned workflows ("watch me do this"): definition + signature, durable across deploys
    "workflows", metadata, Column("id", String(80), primary_key=True), Column("workspace", String(64), index=True),
    Column("name", String(200)), Column("version", Integer), Column("definition", JSON), Column("signature", JSON),
    Column("created", Float), Column("updated", Float),
)

certifications = Table(  # an external agent's sealed exam on a Work Map and the per-rule permission slips it earned
    "certifications", metadata, Column("id", String(40), primary_key=True), Column("session_id", String(64), index=True),
    Column("pack_id", String(64), index=True), Column("expert", String(64)), Column("map_version", Integer),
    Column("commitment", String(80)), Column("provenance", String(16)), Column("created", Float),
    Column("updated", Float), Column("body", JSON),
)

LEDGER = {"decisions": decisions, "explanations": explanations, "learner_attempts": learner_attempts}


class Store:
    def __init__(self, url: str | None = None):
        url = url or config.DATABASE_URL
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                url = "postgresql+psycopg://" + url[len(prefix):]
        self.engine = create_engine(url, future=True)
        metadata.create_all(self.engine)

    def append(self, session_id: str, type_: str, payload: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            c.execute(insert(events).values(session_id=session_id, ts=time.time(), type=type_, payload=payload))

    def events(self, session_id: str, types: list[str] | None = None) -> list[dict[str, Any]]:
        q = select(events).where(events.c.session_id == session_id).order_by(events.c.id)
        if types:
            q = q.where(events.c.type.in_(types))
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(q)]

    def create_session(self, sid: str, mode: str, pack_id: str, expert: str, meta: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            c.execute(insert(sessions).values(id=sid, mode=mode, pack_id=pack_id, expert=expert, created=time.time(),
                                              meta=meta))

    def list_sessions(self) -> list[dict[str, Any]]:
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(select(sessions).order_by(sessions.c.created.desc()))]

    def save_map(self, expert: str, pack_id: str, session_id: str, version: int, wm: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            c.execute(insert(maps).values(expert=expert, pack_id=pack_id, session_id=session_id, version=version,
                                          created=time.time(), map=wm))

    def latest_map(self, expert: str, pack_id: str) -> dict[str, Any] | None:
        q = (select(maps.c.map).where(maps.c.expert == expert, maps.c.pack_id == pack_id)
             .order_by(maps.c.id.desc()).limit(1))
        with self.engine.connect() as c:
            row = c.execute(q).first()
        return row[0] if row else None

    def latest_map_row(self, expert: str, pack_id: str) -> dict[str, Any] | None:
        """Newest saved map for this expert, never one taught by the simulator."""
        rehearsal = [r["id"] for r in self.list_sessions() if (r["meta"] or {}).get("simulated")]
        q = (select(maps.c.map, maps.c.version, maps.c.session_id, maps.c.created)
             .where(maps.c.expert == expert, maps.c.pack_id == pack_id, maps.c.session_id.not_in(rehearsal))
             .order_by(maps.c.id.desc()).limit(1))
        with self.engine.connect() as c:
            row = c.execute(q).first()
        return dict(row._mapping) if row else None

    def events_for(self, session_ids: list[str], types: list[str]) -> list[dict[str, Any]]:
        q = (select(events).where(events.c.session_id.in_(session_ids), events.c.type.in_(types))
             .order_by(events.c.id))
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(q)]

    def ledger(self, table: str, row: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            c.execute(insert(LEDGER[table]).values(created=time.time(), **row))

    def save_workflow(self, wf_id: str, workspace: str, name: str, definition: dict[str, Any],
                      signature: dict[str, Any]) -> int:
        """Insert or bump the version of a learned workflow; returns the version."""
        now = time.time()
        with self.engine.begin() as c:
            row = c.execute(select(workflows.c.version, workflows.c.created).where(workflows.c.id == wf_id)).first()
            version = (row[0] + 1) if row else 1
            c.execute(workflows.delete().where(workflows.c.id == wf_id))
            c.execute(insert(workflows).values(id=wf_id, workspace=workspace, name=name, version=version,
                                               definition={**definition, "version": version}, signature=signature,
                                               created=row[1] if row else now, updated=now))
        return version

    def workflow(self, wf_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as c:
            row = c.execute(select(workflows).where(workflows.c.id == wf_id)).first()
        return dict(row._mapping) if row else None

    def list_workflows(self, workspace: str | None = None) -> list[dict[str, Any]]:
        q = select(workflows.c.id, workflows.c.workspace, workflows.c.name, workflows.c.version,
                   workflows.c.definition["goal"].as_string().label("goal"),
                   workflows.c.signature, workflows.c.updated).order_by(workflows.c.updated.desc())
        if workspace:
            q = q.where(workflows.c.workspace == workspace)
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(q)]

    def latest_map_any(self, pack_id: str) -> dict[str, Any] | None:
        """Most recent saved map for a workflow from any expert (live sessions only)."""
        rehearsal = [r["id"] for r in self.list_sessions() if (r["meta"] or {}).get("simulated")]
        q = (select(maps.c.map, maps.c.version, maps.c.session_id, maps.c.created, maps.c.expert)
             .where(maps.c.pack_id == pack_id, maps.c.session_id.not_in(rehearsal)).order_by(maps.c.id.desc()).limit(1))
        with self.engine.connect() as c:
            row = c.execute(q).first()
        return dict(row._mapping) if row else None

    def save_certification(self, cert: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            row = c.execute(select(certifications.c.created).where(certifications.c.id == cert["id"])).first()
            c.execute(certifications.delete().where(certifications.c.id == cert["id"]))
            c.execute(insert(certifications).values(
                id=cert["id"], session_id=cert["session"], pack_id=cert["pack"], expert=cert["expert"],
                map_version=cert["map_version"], commitment=cert["commitment"], provenance=cert["provenance"],
                created=row[0] if row else cert["created"], updated=time.time(), body=cert))

    def certification(self, cert_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as c:
            row = c.execute(select(certifications.c.body).where(certifications.c.id == cert_id)).first()
        return dict(row[0]) if row else None

    def certifications_for(self, session_id: str | None = None, pack_id: str | None = None,
                           live_only: bool = False) -> list[dict[str, Any]]:
        q = select(certifications.c.body).order_by(certifications.c.created.desc())
        if session_id:
            q = q.where(certifications.c.session_id == session_id)
        if pack_id:
            q = q.where(certifications.c.pack_id == pack_id)
        if live_only:
            q = q.where(certifications.c.provenance == "live")
        with self.engine.connect() as c:
            return [dict(r[0]) for r in c.execute(q)]

    def save_policy(self, key: str, state: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            c.execute(policies.delete().where(policies.c.key == key))
            c.execute(insert(policies).values(key=key, state=state, updated=time.time()))

    def load_policy(self, key: str) -> dict[str, Any] | None:
        with self.engine.connect() as c:
            row = c.execute(select(policies.c.state).where(policies.c.key == key)).first()
        return dict(row[0]) if row else None

    def save_mastery(self, workspace: str, workflow: str, learner: str, node_id: str, state: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            c.execute(mastery.delete().where(mastery.c.workspace == workspace, mastery.c.workflow == workflow,
                                             mastery.c.learner == learner, mastery.c.node_id == node_id))
            c.execute(insert(mastery).values(workspace=workspace, workflow=workflow, learner=learner,
                                             node_id=node_id, state=state, updated=time.time()))

    def load_mastery(self, workspace: str, workflow: str, learner: str) -> dict[str, dict[str, Any]]:
        q = select(mastery.c.node_id, mastery.c.state).where(
            mastery.c.workspace == workspace, mastery.c.workflow == workflow, mastery.c.learner == learner)
        with self.engine.connect() as c:
            return {n: dict(st) for n, st in c.execute(q)}

    def ledger_rows(self, table: str, session_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        t = LEDGER[table]
        q = select(t).order_by(t.c.id.desc()).limit(limit)
        if session_id:
            q = q.where(t.c.session_id == session_id)
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(q)]

    def ledger_counts(self, session_id: str | None = None) -> dict[str, dict[str, int]]:
        """Rows per ledger table, split by source (live / rehearsal)."""
        out: dict[str, dict[str, int]] = {}
        with self.engine.connect() as c:
            for name, t in LEDGER.items():
                q = select(t.c.source, func.count()).group_by(t.c.source)
                if session_id:
                    q = q.where(t.c.session_id == session_id)
                out[name] = {str(src): n for src, n in c.execute(q)}
            q = select(events.c.type, func.count()).group_by(events.c.type)
            if session_id:
                q = q.where(events.c.session_id == session_id)
            out["events"] = {str(k): n for k, n in c.execute(q)}
            out["maps"] = {"versions": c.execute(select(func.count()).select_from(maps)).scalar() or 0}
        return out

    def map_versions(self, expert: str, pack_id: str) -> list[dict[str, Any]]:
        q = (select(maps.c.version, maps.c.session_id, maps.c.created, maps.c.map)
             .where(maps.c.expert == expert, maps.c.pack_id == pack_id).order_by(maps.c.id))
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(q)]
