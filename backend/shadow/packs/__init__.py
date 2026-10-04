from shadow.packs.base import FieldSpec, Pack

_REGISTRY: dict[str, Pack] = {}


def register(pack: Pack) -> Pack:
    _REGISTRY[pack.id] = pack
    return pack


def get_pack(pack_id: str) -> Pack:
    if not _REGISTRY:
        from shadow.packs import ap_invoices  # noqa: F401  (registers itself)
    if pack_id not in _REGISTRY:  # workflows defined as data (packs/examples/<id>.json) load on demand
        from shadow.packs.generic import GenericPack
        from shadow.taskdef import load_example
        register(GenericPack(load_example(pack_id)))
    return _REGISTRY[pack_id]


__all__ = ["FieldSpec", "Pack", "get_pack", "register"]
