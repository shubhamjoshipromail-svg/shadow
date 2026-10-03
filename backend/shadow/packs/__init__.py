from shadow.packs.base import FieldSpec, Pack

_REGISTRY: dict[str, Pack] = {}


def register(pack: Pack) -> Pack:
    _REGISTRY[pack.id] = pack
    return pack


def get_pack(pack_id: str) -> Pack:
    if not _REGISTRY:
        from shadow.packs import ap_invoices  # noqa: F401  (registers itself)
    return _REGISTRY[pack_id]


__all__ = ["FieldSpec", "Pack", "get_pack", "register"]
