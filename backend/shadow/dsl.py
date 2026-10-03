"""A tiny, safe expression language for rules and guardrails.

Rules learned from experts are stored as expressions such as
    inv.category == 'equipment' and inv.net > params.T_capex
and executed against a case context. Only a whitelisted subset of Python
expression syntax is allowed; there is no attribute access on real objects,
no imports, no lambdas, no comprehensions.
"""

from __future__ import annotations

import ast
import operator as op
from functools import lru_cache
from typing import Any, Callable

MAX_LEN = 600


class DSLError(ValueError):
    pass


_FUNCS: dict[str, Callable[..., Any]] = {
    "abs": abs,
    "min": min,
    "max": max,
    "len": len,
    "any": any,
    "all": all,
    "round": round,
    "lower": lambda s: s.lower() if isinstance(s, str) else s,
}

_BIN = {
    ast.Add: op.add,
    ast.Sub: op.sub,
    ast.Mult: op.mul,
    ast.Div: op.truediv,
    ast.Mod: op.mod,
}

_ORDERING = (ast.Lt, ast.LtE, ast.Gt, ast.GtE)
_CMP = {
    ast.Eq: op.eq,
    ast.NotEq: op.ne,
    ast.Lt: op.lt,
    ast.LtE: op.le,
    ast.Gt: op.gt,
    ast.GtE: op.ge,
    ast.In: lambda a, b: b is not None and a in b,
    ast.NotIn: lambda a, b: b is None or a not in b,
    ast.Is: op.is_,
    ast.IsNot: op.is_not,
}

_ALLOWED = (
    ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not, ast.USub,
    ast.BinOp, ast.Compare, ast.Name, ast.Load, ast.Constant, ast.Attribute,
    ast.Subscript, ast.List, ast.Tuple, ast.Call, ast.IfExp, *_BIN, *_CMP,
)


def _validate(node: ast.AST) -> None:
    for child in ast.walk(node):
        if not isinstance(child, _ALLOWED):
            raise DSLError(f"disallowed syntax: {type(child).__name__}")
        if isinstance(child, ast.Call):
            if not isinstance(child.func, ast.Name) or child.func.id not in _FUNCS:
                raise DSLError("only whitelisted functions may be called")
            if child.keywords:
                raise DSLError("keyword arguments not allowed")
        if isinstance(child, ast.Attribute) and child.attr.startswith("_"):
            raise DSLError("private attributes not allowed")


def _get(obj: Any, key: Any) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    if isinstance(obj, (list, tuple)) and isinstance(key, int):
        return obj[key] if -len(obj) <= key < len(obj) else None
    return None


def _eval(node: ast.AST, ctx: dict[str, Any]) -> Any:
    match node:
        case ast.Constant(value=v):
            return v
        case ast.Name(id=name):
            if name in ("true", "True"):
                return True
            if name in ("false", "False"):
                return False
            return ctx.get(name)
        case ast.Attribute(value=v, attr=attr):
            return _get(_eval(v, ctx), attr)
        case ast.Subscript(value=v, slice=s):
            return _get(_eval(v, ctx), _eval(s, ctx))
        case ast.List(elts=elts) | ast.Tuple(elts=elts):
            return [_eval(e, ctx) for e in elts]
        case ast.BoolOp(op=ast.And(), values=values):
            result: Any = True
            for v in values:
                result = _eval(v, ctx)
                if not result:
                    return result
            return result
        case ast.BoolOp(op=ast.Or(), values=values):
            result = False
            for v in values:
                result = _eval(v, ctx)
                if result:
                    return result
            return result
        case ast.UnaryOp(op=ast.Not(), operand=o):
            return not _eval(o, ctx)
        case ast.UnaryOp(op=ast.USub(), operand=o):
            val = _eval(o, ctx)
            return None if val is None else -val
        case ast.BinOp(left=l, op=o, right=r):
            a, b = _eval(l, ctx), _eval(r, ctx)
            if a is None or b is None:
                return None
            try:
                return _BIN[type(o)](a, b)
            except (TypeError, ZeroDivisionError):
                return None
        case ast.Compare(left=l, ops=ops, comparators=comps):
            left = _eval(l, ctx)
            for o, c in zip(ops, comps):
                right = _eval(c, ctx)
                if isinstance(o, _ORDERING) and (left is None or right is None):
                    return False
                try:
                    if not _CMP[type(o)](left, right):
                        return False
                except TypeError:
                    return False
                left = right
            return True
        case ast.IfExp(test=t, body=b, orelse=e):
            return _eval(b, ctx) if _eval(t, ctx) else _eval(e, ctx)
        case ast.Call(func=ast.Name(id=fname), args=args):
            try:
                return _FUNCS[fname](*[_eval(a, ctx) for a in args])
            except (TypeError, ValueError):
                return None
    raise DSLError(f"cannot evaluate {type(node).__name__}")


@lru_cache(maxsize=2048)
def _parse(src: str) -> ast.Expression:
    if len(src) > MAX_LEN:
        raise DSLError("expression too long")
    try:
        tree = ast.parse(src.strip(), mode="eval")
    except SyntaxError as e:
        raise DSLError(f"syntax error: {e.msg}") from e
    _validate(tree)
    return tree


def validate(src: str) -> None:
    _parse(src)


def evaluate(src: str, ctx: dict[str, Any]) -> Any:
    return _eval(_parse(src).body, ctx)


def holds(src: str, ctx: dict[str, Any]) -> bool:
    """Evaluate as a predicate; evaluation errors count as 'does not hold'."""
    try:
        return bool(evaluate(src, ctx))
    except DSLError:
        return False


def fields_referenced(src: str) -> set[str]:
    """Dotted names used by an expression, e.g. {'inv.net', 'params.T_capex'}."""
    out: set[str] = set()

    def dotted(node: ast.AST) -> str | None:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            base = dotted(node.value)
            return f"{base}.{node.attr}" if base else None
        return None

    for node in ast.walk(_parse(src)):
        if isinstance(node, ast.Attribute):
            name = dotted(node)
            if name:
                out.add(name)
    # keep only maximal paths
    return {n for n in out if not any(o != n and o.startswith(n + ".") for o in out)}
