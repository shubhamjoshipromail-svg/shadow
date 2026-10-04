from shadow.packs.base import FieldSpec, Pack

_REGISTRY: dict[str, Pack] = {}
_LOADERS: list = []  # extra sources of task definitions (e.g. the database of learned workflows)


def add_loader(fn) -> None:
    """fn(pack_id) -> TaskDefinition dict | None; consulted after built-ins and examples."""
    _LOADERS.append(fn)


def register(pack: Pack) -> Pack:
    _REGISTRY[pack.id] = pack
    return pack


def get_pack(pack_id: str) -> Pack:
    if not _REGISTRY:
        from shadow.packs import ap_invoices  # noqa: F401  (registers itself)
    if pack_id not in _REGISTRY:  # workflows defined as data load on demand: examples, then learned ones
        from shadow.packs.generic import GenericPack
        from shadow.taskdef import load_example, parse_task_definition
        try:
            register(GenericPack(load_example(pack_id)))
        except (FileNotFoundError, OSError, ValueError):
            for load in _LOADERS:
                data = load(pack_id)
                if data:
                    register(GenericPack(parse_task_definition(data)))
                    break
    if pack_id not in _REGISTRY:
        raise KeyError(f"unknown workflow {pack_id}")
    return _REGISTRY[pack_id]


__all__ = ["FieldSpec", "Pack", "get_pack", "register"]
