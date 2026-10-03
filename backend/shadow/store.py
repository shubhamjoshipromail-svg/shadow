"""Append-only event store. Episodes are the asset; everything else is a view."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import JSON, Column, Float, Integer, MetaData, String, Table, create_engine, insert, select

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

    def map_versions(self, expert: str, pack_id: str) -> list[dict[str, Any]]:
        q = (select(maps.c.version, maps.c.session_id, maps.c.created, maps.c.map)
             .where(maps.c.expert == expert, maps.c.pack_id == pack_id).order_by(maps.c.id))
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(q)]
