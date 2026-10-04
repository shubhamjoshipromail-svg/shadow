# T5 · RENAME — report

**Status:** done, dry-run only. `--apply` was **never** executed; the working tree
is unchanged by this task. No existing file was edited, nothing was committed.

**Files created (only these):**

- `scripts/rename_product.py` — the dry-run-first rename tool (stdlib only, `chmod +x`).
- `design/tasks/RENAME_PLAN.md` — every hit categorized rename / keep with reasoning.
- `design/tasks/T5_REPORT.md` — this report.

---

## 1. What I built

`scripts/rename_product.py` renames the **user-visible product name**
(`--from Shadow`, default `--to Tacet`) and refuses to touch anything technical.

Commands:

| Command | Behaviour |
|---|---|
| `python3 scripts/rename_product.py` | **Default = dry run.** Prints a unified diff, writes nothing. |
| `--apply` | The only write path (not run). |
| `--report` | Prints every hit categorized rename / keep as markdown (source of `RENAME_PLAN.md`). |
| `--stat` | Per-file rename counts. |
| `--check` | Exit 1 while a rename is pending (CI gate). |
| `--to NAME` | Try another candidate name. |
| `--context N` | Diff context. |

Safety model (three layers):

1. **Word boundaries** — only the standalone token `Shadow` matches, so
   `ShadowEvent`, `useShadow`, `installShadow`, `setShadowState`, `attachShadow`
   and `ShadowCore` can never be rewritten.
2. **Case sensitivity** — technical terms are lowercase (`window.shadowERP`,
   `data-shadow-*`, `[[shadow:ask]]`, `model_id: "shadow"`, `.shadow-*` classes,
   `backend/shadow/`) or UPPER_SNAKE (`SHADOW_NAME`, `SHADOW_SESSION`,
   `{{shadow_session}}`), so they are never even candidates.
3. **Python string scope** — inside `.py` files the name is rewritten only in
   string literals (`ast` + `tokenize`), never in docstrings or comments. This is
   why the ElevenLabs prompts and the `/api/data/inventory` copy change while
   `backend/shadow/**` documentation stays.

Rename scope: console UI (`console/src/**`, `console/index.html`), the in-app
companion (`capture.js`, including the `NAME` constant), ElevenLabs prompts
(`setup_elevenlabs.py`), the spoken Custom-LLM personas (`converse.py`),
API-returned copy and the exported Work Map by-line (`main.py`, `exports.py`),
page titles, and the product docs (`README.md`, `CLAUDE.md`, `AGENTS.md`,
`ELEVENLABS_SETUP.md`, `LOVABLE_PROMPT.md`, `SABINE_ROLE_CARD.md`,
`SHADOW_ARCHITECTURE.md`, `design/DESIGN.md`).

---

## 2. How to integrate (exact call sites)

The tool is a repo-root script; there is no import to wire in. Integration is:

1. **Decide the name**, then run from the repo root (adjacent to `package.json`,
   `backend/`, `console/`):
   ```bash
   python3 scripts/rename_product.py --report          # review the plan
   python3 scripts/rename_product.py                   # review the diff
   python3 scripts/rename_product.py --to Tacet        # (or the chosen name)
   python3 scripts/rename_product.py --apply           # only with approval
   ```
2. **Re-run the ElevenLabs setup** after applying, because the agent names /
   first messages / system prompt live in `backend/scripts/setup_elevenlabs.py`:
   ```bash
   cd backend && .venv/bin/python scripts/setup_elevenlabs.py --public-url <core>
   ```
   (`converse.py`'s spoken persona strings change with the same apply.)
3. **Backend/console owners apply their own surfaces.** The diff touches
   Opus-owned files (`backend/shadow/main.py`, `converse.py`, `exports.py`) and
   the console; the reviewer should land those in the normal ownership flow.
   `scripts/rename_product.py --apply` is designed to be the single mechanical
   step, then `pytest -q` + the console build.
4. **Manual, deliberately not automated:**
   - File/dir names: `SHADOW_ARCHITECTURE.md`, `design/shadow-v3/`,
     `src/lib/erp/shadow.ts`, `backend/shadow/` (a separate `git mv` decision).
   - The GitHub repo name / remote (never rewrite pushed history — `AGENTS.md`).
   - The T3 landing page constant: add `("site/", "landing page", {".html"})` to
     `RENAME_PREFIXES` once `site/index.html` stores the name in one constant.
   - Railway/Docker env var names (`SHADOW_*`) stay.

Exact call sites in code that change (from `--stat`): 131 standalone tokens in
25 files; the highest-value ones are `capture.js:20`
(`var NAME = window.SHADOW_NAME || "Tacet"`), `console/index.html:6`
(`<title>`), `setup_elevenlabs.py:34,40,41,45`, `converse.py:124,157`,
`main.py:62` (`FastAPI(title=...)`), and `main.py:584` (the text the console
Data page renders).

---

## 3. Acceptance checks (pasted output)

### A. `python3 scripts/rename_product.py --stat`

```
Shadow -> Tacet
  rename: 131 occurrences in 25 files
      3  AGENTS.md
      8  CLAUDE.md
     16  ELEVENLABS_SETUP.md
      5  LOVABLE_PROMPT.md
      6  README.md
      2  SABINE_ROLE_CARD.md
     36  SHADOW_ARCHITECTURE.md
      4  backend/scripts/setup_elevenlabs.py
      2  backend/shadow/converse.py
      1  backend/shadow/exports.py
      4  backend/shadow/main.py
      8  backend/shadow/static/capture.js
      1  console/index.html
      1  console/src/components/Checklist.tsx
      2  console/src/components/Prediction.tsx
      1  console/src/components/Receipts.tsx
      2  console/src/components/ui.tsx
      2  console/src/index.css
      3  console/src/lib/voice.tsx
      8  console/src/pages/Console.tsx
      3  console/src/pages/DataPage.tsx
      4  console/src/pages/Home.tsx
      2  console/src/pages/MapPage.tsx
      5  console/src/pages/ProofPage.tsx
      2  design/DESIGN.md
```

(Counts above are the working tree at run time; T3/T4 were still writing new
files, so re-running `--stat` can shift by a hit or two. `RENAME_PLAN.md` lists
every hit with line numbers.)

### B. `--check` gate (work pending → exit 1)

```
$ python3 scripts/rename_product.py --check ; echo exit=$?
exit=1
```

### C. Default invocation = dry run (unified diff, no writes)

```
$ python3 scripts/rename_product.py
exit=0  (diff lines: 902)
--- head ---
# DRY RUN - `Shadow` -> `Tacet` (no files written)
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -10,10 +10,10 @@
 <!-- LOVABLE:END -->
 
 ## Architecture
-- AP case data lives in a React context (src/lib/erp/store.tsx), seeded from src/data/seed.json and replaced by the Shadow API when reachable — no backend/DB by spec.
-- Shadow observer contract (data-shadow-* attributes, window.shadowERP, beforeSave hook) is in src/lib/erp/shadow.ts; every action must await beforeSave before mutating state.
+- AP case data lives in a React context (src/lib/erp/store.tsx), seeded from src/data/seed.json and replaced by the Tacet API when reachable — no backend/DB by spec.
+- Tacet observer contract (data-shadow-* attributes, window.shadowERP, beforeSave hook) is in src/lib/erp/shadow.ts; every action must await beforeSave before mutating state.
 
-## Shadow multi-agent coordination
+## Tacet multi-agent coordination
 See `CLAUDE.md` (project context, run instructions, conventions). Summary:
 - Claude Code (Opus) owns `backend/shadow/**`, `console/**`, integration, commits and pushes. Lovable owns the ERP UI at the repo root.
--- tail ---
 3. Guardrails are structural: a plate with a 3px brick left rule, never a chip.
 4. Uncertainty is an interval or a curve drawn in hairline, never a shimmer.
 
# 131 replacements across 25 files. Re-run with --apply to write (T5 does not).
```

The diff shows the technical terms surviving verbatim in the changed lines
(`data-shadow-*`, `window.shadowERP`, `src/lib/erp/shadow.ts`,
`backend/shadow/**`). The full diff is 902 lines; `RENAME_PLAN.md` §3 lists every
rewritten line.

### D. Candidate-name flag

```
$ python3 scripts/rename_product.py --to Mira --stat | head -3
Shadow -> Mira
  rename: 131 occurrences in 25 files
      3  AGENTS.md
```

### E. Proof that the dry run wrote nothing

```
$ git status --porcelain > before; python3 scripts/rename_product.py >/dev/null; python3 scripts/rename_product.py --report >/dev/null; git status --porcelain > after
IDENTICAL - no file was written by --dry-run/--report
tracked-file modifications attributable to T5:
  (none expected)
```

### F. In-memory rewrite safety check (never calls `--apply`)

The tool's own `apply_plan` is exercised in memory: every rename decision must
produce exactly one replacement, protected tokens must survive, and no
standalone `Shadow` may be left behind except on lines the classifier kept.

```
files changed:            25
rename decisions:         131
replacements applied:     131
protected-token checks:   475
PROBLEMS:                 0
verify exit=0
```

Protected tokens checked (present before ⇒ present after):
`attachShadow`, `SHADOW_NAME`, `SHADOW_SESSION`, `{{shadow_session}}`,
`{{shadow_mode}}`, `window.shadowERP`, `window.shadow.beforeSave`,
`data-shadow-`, `/v1/chat/completions`, `/api/`, `ShadowEvent`, `useShadow`,
`installShadow`, `setShadowState`, `[[shadow:`, `"model_id": "shadow"`,
`backend/shadow/`, `src/lib/erp/shadow.ts`, `/capture.js`.

### G. Syntax check

```
$ python3 -m py_compile scripts/rename_product.py
compile OK
```

### H. `--report` (source of `RENAME_PLAN.md`)

```
Scanned the repo (excluding VCS, deps, build output and frozen `design/tasks/**`).
Found 344 occurrences of `Shadow` in 74 files: 131 rename in 25 files, 213 keep in 56 files.
```

Rerun with `python3 scripts/rename_product.py --report` for the live list.

---

## 4. Notes / open questions

1. **Product name still undecided.** Default is `Shadow → Tacet` per the queue;
   `--to` covers any choice. Nothing was applied.
2. **Backend copy included.** I put `main.py` / `converse.py` / `exports.py` on
   the rename list because they contain genuinely user-visible strings (spoken
   persona, OpenAPI title, Data-page "where" text, export by-line). Opus owns
   `backend/shadow/**`; that part should be landed through the normal flow.
3. **Docstrings/comments frozen.** Module/function docstrings and comments are
   never rewritten, which is why the keep count (211) is larger than the rename
   count. If a full-prose rename of backend docs is wanted later, pass explicit
   extra surfaces — I kept the default conservative.
4. **Frozen artifacts.** `advisory/**`, `design/shadow-v3/**` and
   `design/tasks/**` are kept as dated evidence/queue logs, per `CLAUDE.md`.
5. **File names are not renamed.** `SHADOW_ARCHITECTURE.md`, `backend/shadow/`,
   `src/lib/erp/shadow.ts`, `design/shadow-v3/` stay; a `git mv` is a separate,
   deliberate change that would also touch imports and deploy config.
6. **T3 site.** `site/index.html` is currently out of the rename set with a
   clear reason (the name should be one constant). Add `site/` to
   `RENAME_PREFIXES` when T3 is integrated.
7. **T5 did not run `--apply`.** Consequently no product behaviour changed and no
   server on `:8000` was touched (nor started).
