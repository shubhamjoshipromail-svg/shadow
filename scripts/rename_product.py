#!/usr/bin/env python3
"""rename_product.py - safe, dry-run-first rename of the user-visible product name.

The product name (today "Shadow", likely "Tacet") appears in three very different
kinds of places:

  1. user-visible copy  - console UI strings, the in-app companion, ElevenLabs
                          agent prompts, page titles, spoken Custom-LLM personas,
                          API-returned strings, docs headings/prose;
  2. technical jargon   - the shadow DOM, "shadow AI", `data-shadow-*`,
                          `window.shadowERP`, `attachShadow`, CSS classes,
                          storage keys, API routes, env vars (`SHADOW_*`);
  3. code identities    - Python packages/modules (`backend/shadow/`), TS types
                          and hooks (`ShadowEvent`, `useShadow`,
                          `installShadow`, `setShadowState`), file names.

A blind find/replace destroys (2) and (3). This tool only rewrites category 1.

What it guarantees
------------------
* Default is a DRY RUN: it prints a unified diff to stdout and writes nothing.
* `--apply` is the only way to write, and it is never invoked by the queue task.
* `Shadow` inside a larger identifier never matches (word boundaries).
* Env vars / routes / storage keys / CSS classes are lowercase or UPPER_SNAKE,
  so the case-sensitive `Shadow` token never touches them.
* In Python files only standalone `Shadow` tokens inside string literals (never
  comments, identifiers or module/function/class docstrings) are rewritten, so
  `backend/shadow/` documentation stays intact.

Usage
-----
  python3 scripts/rename_product.py                     # dry-run: Shadow -> Tacet
  python3 scripts/rename_product.py --to Mira           # try a different name
  python3 scripts/rename_product.py --stat              # counts, no diff
  python3 scripts/rename_product.py --report            # categorized hit list (md)
  python3 scripts/rename_product.py --check             # exit 1 if work is pending
  python3 scripts/rename_product.py --apply             # WRITE (do not run in T5)
"""

from __future__ import annotations

import argparse
import ast
import difflib
import io
import os
import re
import sys
import token
import tokenize
from dataclasses import dataclass, field
from fnmatch import fnmatch
from pathlib import Path

# --------------------------------------------------------------------------- #
# Defaults
# --------------------------------------------------------------------------- #

DEFAULT_FROM = "Shadow"
DEFAULT_TO = "Tacet"

# `Shadow` is only ever rewritten when it stands alone. This single rule protects
# ShadowEvent, useShadow, installShadow, setShadowState, attachShadow, etc.
IDENT_RE = re.compile(r"[A-Za-z0-9_$]")

# Directories we never descend into (VCS, deps, build output, frozen logs).
# Paths are relative to the repo root; bare names match at any depth.
PRUNE_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".pytest_cache",
    ".wrangler",
    ".claude",
    "design/tasks",  # frozen delegation queue + reports (see RENAME_PLAN.md)
    "backend/eval_out",  # generated benchmark artifacts
}

# The tool's own outputs (never list the report inside itself).
SKIP_FILES = {
    "scripts/rename_product.py",
    "design/tasks/RENAME_PLAN.md",
    "design/tasks/T5_REPORT.md",
}

TEXT_SUFFIXES = {
    ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".css",
    ".md", ".json", ".txt", ".svg", ".yml", ".yaml", ".toml", ".sh",
    ".dockerfile",
}
MAX_FILE_BYTES = 1_500_000

# --------------------------------------------------------------------------- #
# Rename surfaces (category 1)
# --------------------------------------------------------------------------- #

# Exact files that carry user-visible product copy.
RENAME_FILES: dict[str, str] = {
    "console/index.html": "console page title",
    "backend/shadow/static/capture.js": "in-app companion string (NAME constant + overlays)",
    "backend/scripts/setup_elevenlabs.py": "ElevenLabs agent prompt / first message",
    "backend/shadow/converse.py": "spoken Custom-LLM persona prompt",
    "backend/shadow/main.py": "API-returned copy and OpenAPI title",
    "backend/shadow/exports.py": "exported Work Map by-line",
    # Product docs (headings + prose).
    "README.md": "README heading/prose",
    "CLAUDE.md": "project doc heading/prose",
    "AGENTS.md": "project doc heading/prose",
    "ELEVENLABS_SETUP.md": "setup doc heading/prose",
    "LOVABLE_PROMPT.md": "ERP build prompt prose",
    "SABINE_ROLE_CARD.md": "demo role card prose",
    "SHADOW_ARCHITECTURE.md": "architecture doc heading/prose",
    "design/DESIGN.md": "design-system doc heading/prose",
}

# Whole trees of user-visible copy: (path prefix, surface label, allowed suffixes)
RENAME_PREFIXES: list[tuple[str, str, set[str]]] = [
    ("console/src/", "console UI string", {".ts", ".tsx", ".js", ".jsx", ".css", ".html"}),
]

# Python files on the rename list are rewritten only outside docstrings.
PY_RENAME_FILES = {
    "backend/scripts/setup_elevenlabs.py",
    "backend/shadow/converse.py",
    "backend/shadow/main.py",
    "backend/shadow/exports.py",
}

# --------------------------------------------------------------------------- #
# Keep rules (categories 2 + 3); checked in order when a hit is not on a surface
# --------------------------------------------------------------------------- #

KEEP_RULES: list[tuple[str, str]] = [
    ("src/*", "ERP observer contract: module/function names, window.shadowERP and data-shadow-* hooks"),
    ("backend/tests/*", "test code (developer-facing)"),
    ("backend/scripts/eval_curves.py", "benchmark tooling and its generated chart labels (developer-facing)"),
    ("backend/scripts/*", "developer tooling"),
    ("backend/shadow/*", "Shadow Core package/module path and docstrings (Python package name stays)"),
    ("advisory/*", "independent review artifact, dated and frozen"),
    ("design/shadow-v3/*", "historical design directions, frozen"),
    ("design/tasks/*", "delegation queue logs/reports, frozen"),
    ("design/video/*", "demo-film design artifact, frozen"),
    ("site/*", "landing page (T3): product name should be a single constant; wire into RENAME_PREFIXES on integration"),
    ("deploy/*", "deployment/infra comments (developer-facing)"),
    ("backend/*", "backend infrastructure (developer-facing)"),
    (".gitignore", "local ignore comment (repo path, not shipped copy)"),
]

# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #


@dataclass
class Hit:
    rel: str
    lineno: int
    col: int
    decision: str  # "rename" | "keep"
    surface: str
    text: str


@dataclass
class FilePlan:
    rel: str
    old: str
    hits: list[Hit] = field(default_factory=list)

    @property
    def renames(self) -> list[Hit]:
        return [h for h in self.hits if h.decision == "rename"]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def is_text_file(path: Path) -> bool:
    if path.suffix.lower() == ".dockerfile":
        return True
    if path.name in (".gitignore", "Dockerfile"):
        return True
    return path.suffix.lower() in TEXT_SUFFIXES


def iter_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
        kept = []
        for d in dirnames:
            child = f"{rel_dir}/{d}".lstrip("/")
            if child in PRUNE_DIRS or d in PRUNE_DIRS:
                continue
            kept.append(d)
        dirnames[:] = kept
        for name in filenames:
            path = Path(dirpath) / name
            rel = str(path.relative_to(root)).replace(os.sep, "/")
            if rel in SKIP_FILES or not is_text_file(path):
                continue
            try:
                if path.stat().st_size > MAX_FILE_BYTES:
                    continue
            except OSError:
                continue
            yield rel, path


def docstring_lines(source: str) -> set[int]:
    """Line numbers that belong to a module/class/function docstring."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return set()
    lines: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        body = getattr(node, "body", [])
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            d = first.value
            end = getattr(d, "end_lineno", None) or d.lineno
            lines.update(range(d.lineno, end + 1))
    return lines


# A (row, col) span where a string literal lives, in character coordinates.
Span = tuple[int, int, int, int]


def py_string_spans(source: str) -> list[Span]:
    """Spans of every string literal (including f-string middles) in a Python file.

    Comments and code are not included, so Python copy is only rewritten where it
    is actually a string. Docstrings are filtered out by the caller.
    """
    spans: list[Span] = []
    fstring_middle = getattr(token, "FSTRING_MIDDLE", None)
    try:
        for tok in tokenize.generate_tokens(io.StringIO(source).readline):
            if tok.type == token.STRING or (fstring_middle is not None and tok.type == fstring_middle):
                spans.append((tok.start[0], tok.start[1], tok.end[0], tok.end[1]))
    except (tokenize.TokenError, IndentationError):
        pass
    return spans


def in_spans(spans: list[Span], row: int, col: int) -> bool:
    for r1, c1, r2, c2 in spans:
        if r1 == r2:
            if row == r1 and c1 <= col < c2:
                return True
        elif row == r1:
            if col >= c1:
                return True
        elif row == r2:
            if col < c2:
                return True
        elif r1 < row < r2:
            return True
    return False


def surface_for(rel: str) -> str | None:
    if rel in RENAME_FILES:
        return RENAME_FILES[rel]
    suffix = Path(rel).suffix.lower()
    for prefix, label, suffixes in RENAME_PREFIXES:
        if rel.startswith(prefix) and suffix in suffixes:
            return label
    return None


def keep_reason(rel: str) -> str:
    for pattern, reason in KEEP_RULES:
        if fnmatch(rel, pattern):
            return reason
    return "not a user-visible surface"


def classify(
    rel: str,
    lineno: int,
    line: str,
    col: int,
    old_name: str,
    doc_lines: set[int],
    str_spans: list[Span],
) -> tuple[str, str]:
    before = line[col - 1] if col > 0 else ""
    after = line[col + len(old_name)] if col + len(old_name) < len(line) else ""
    if IDENT_RE.match(before) or IDENT_RE.match(after):
        return "keep", "code identifier"

    surface = surface_for(rel)
    if surface is None:
        return "keep", keep_reason(rel)

    # Python copy must live inside a string literal, and docstrings are
    # developer-facing documentation rather than user-visible copy.
    if rel in PY_RENAME_FILES:
        if lineno in doc_lines:
            return "keep", "module/function docstring (developer-facing)"
        if not in_spans(str_spans, lineno, col):
            return "keep", "Python comment or identifier (developer-facing)"
        return "rename", surface

    return "rename", surface


def build_plans(root: Path, old_name: str) -> list[FilePlan]:
    plans: list[FilePlan] = []
    for rel, path in iter_files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if old_name not in text:
            continue
        doc_lines = docstring_lines(text) if rel in PY_RENAME_FILES else set()
        str_spans = py_string_spans(text) if rel in PY_RENAME_FILES else []
        plan = FilePlan(rel=rel, old=text)
        for i, line in enumerate(text.splitlines(), start=1):
            start = 0
            while True:
                col = line.find(old_name, start)
                if col < 0:
                    break
                decision, surface = classify(rel, i, line, col, old_name, doc_lines, str_spans)
                plan.hits.append(Hit(rel, i, col, decision, surface, line.strip()))
                start = col + len(old_name)
        if plan.hits:
            plans.append(plan)
    return plans


def apply_plan(plan: FilePlan, old_name: str, new_name: str) -> str:
    """Return rewritten text, replacing only rename-decided hits."""
    lines = plan.old.splitlines(keepends=True)
    by_line: dict[int, list[Hit]] = {}
    for hit in plan.renames:
        by_line.setdefault(hit.lineno, []).append(hit)
    for lineno, hits in by_line.items():
        line = lines[lineno - 1]
        # Replace right-to-left so earlier columns stay valid.
        for hit in sorted(hits, key=lambda h: h.col, reverse=True):
            line = line[: hit.col] + new_name + line[hit.col + len(old_name):]
        lines[lineno - 1] = line
    return "".join(lines)


def unified_diff(plan: FilePlan, new_text: str, context: int) -> str:
    return "".join(
        difflib.unified_diff(
            plan.old.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile=f"a/{plan.rel}",
            tofile=f"b/{plan.rel}",
            n=context,
        )
    )


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #


def print_report(plans: list[FilePlan], old_name: str, new_name: str) -> None:
    rename_hits = [h for p in plans for h in p.renames]
    keep_hits = [h for p in plans for h in p.hits if h.decision == "keep"]
    rename_files = sorted({h.rel for h in rename_hits})
    keep_files = sorted({h.rel for h in keep_hits})

    print(f"# Product rename report: `{old_name}` -> `{new_name}`\n")
    print(
        f"Scanned the repo (excluding VCS, deps, build output and frozen "
        f"`design/tasks/**`). Found {len(rename_hits) + len(keep_hits)} occurrences of "
        f"`{old_name}` in {len(set(rename_files) | set(keep_files))} files: "
        f"**{len(rename_hits)} rename** in {len(rename_files)} files, "
        f"**{len(keep_hits)} keep** in {len(keep_files)} files.\n"
    )

    print("## Rename\n")
    last = None
    for h in sorted(rename_hits, key=lambda h: (h.rel, h.lineno, h.col)):
        if h.rel != last:
            print(f"\n**`{h.rel}`** - {h.surface}")
            last = h.rel
        print(f"- L{h.lineno}: `{h.text}`")

    print("\n## Keep\n")
    last = None
    for h in sorted(keep_hits, key=lambda h: (h.rel, h.lineno, h.col)):
        if h.rel != last:
            print(f"\n**`{h.rel}`** - {h.surface}")
            last = h.rel
        print(f"- L{h.lineno}: `{h.text}`")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Dry-run-first rename of the user-visible product name.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--from", dest="old_name", default=DEFAULT_FROM, help="current name (default: Shadow)")
    ap.add_argument("--to", dest="new_name", default=DEFAULT_TO, help="new name (default: Tacet)")
    ap.add_argument("--root", default=None, help="repo root (default: parent of scripts/)")
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    ap.add_argument("--stat", action="store_true", help="print counts instead of a diff")
    ap.add_argument("--report", action="store_true", help="print the categorized hit list as markdown")
    ap.add_argument("--check", action="store_true", help="exit 1 when a rename is pending")
    ap.add_argument("--context", type=int, default=3, help="diff context lines (default: 3)")
    args = ap.parse_args(argv)
    if not (args.old_name and args.new_name):
        ap.error("--from and --to must be non-empty")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    root = Path(args.root).resolve() if args.root else repo_root()
    if not root.is_dir():
        print(f"error: root not found: {root}", file=sys.stderr)
        return 2

    plans = build_plans(root, args.old_name)
    rename_hits = [h for p in plans for h in p.renames]

    if args.report:
        print_report(plans, args.old_name, args.new_name)
        return 0

    if args.stat:
        files = sorted({h.rel for h in rename_hits})
        print(f"{args.old_name} -> {args.new_name}")
        print(f"  rename: {len(rename_hits)} occurrences in {len(files)} files")
        for rel in files:
            n = sum(1 for h in rename_hits if h.rel == rel)
            print(f"    {n:3d}  {rel}")
        return 1 if (args.check and rename_hits) else 0

    if not rename_hits:
        print(f"no `{args.old_name}` occurrences on user-visible surfaces; nothing to do.")
        return 0

    if args.apply:
        for plan in plans:
            if not plan.renames:
                continue
            new_text = apply_plan(plan, args.old_name, args.new_name)
            (root / plan.rel).write_text(new_text, encoding="utf-8")
            print(f"wrote {plan.rel} ({len(plan.renames)} replacements)")
        return 0

    # Default: dry run, unified diff, no writes.
    print(f"# DRY RUN - `{args.old_name}` -> `{args.new_name}` (no files written)")
    printed = 0
    for plan in sorted(plans, key=lambda p: p.rel):
        if not plan.renames:
            continue
        new_text = apply_plan(plan, args.old_name, args.new_name)
        print(unified_diff(plan, new_text, args.context), end="")
        printed += 1
    print(
        f"\n# {len(rename_hits)} replacements across {printed} files. "
        f"Re-run with --apply to write (T5 does not)."
    )
    return 1 if (args.check and rename_hits) else 0


if __name__ == "__main__":
    # `... | head` closes stdout early: die quietly on SIGPIPE instead of
    # printing a BrokenPipeError traceback during interpreter shutdown.
    import signal

    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, sys.stdout.fileno())
        raise SystemExit(0)
