# RENAME_PLAN — product name `Shadow` → `Tacet`

**Status:** dry-run only. `--apply` was **not** executed (T5 rules). This plan and
`scripts/rename_product.py` are the deliverable; the repo is unchanged.

**Tool:** `scripts/rename_product.py` (stdlib only).
**Command that produced this plan:** `python3 scripts/rename_product.py --report`.
**Snapshot:** 2026-10-03, working tree at that moment:
**344 occurrences of `Shadow` in 74 files — 131 rename in 25 files, 213 keep in
56 files.** Other queue tasks (T1/T2/T3/T4) were writing new files concurrently;
re-run `--report` for the live list.

---

## 1. Why this is not `sed`

The name appears in three incompatible kinds of place:

| Kind | Examples | Action |
|---|---|---|
| **User-visible copy** | console strings, `<title>`, companion overlays, ElevenLabs prompts, spoken Custom-LLM personas, API-returned text, docs prose | **rename** |
| **Technical jargon** | `attachShadow`, `data-shadow-*`, `window.shadowERP`, `SHADOW_*`, `[[shadow:ask]]`, `model_id: "shadow"`, CSS classes, storage keys, API routes | **keep** |
| **Code identity** | `backend/shadow/` package, `src/lib/erp/shadow.ts`, `ShadowEvent`, `useShadow`, `installShadow`, `setShadowState` | **keep** |

Two mechanisms make the split safe:

1. **Word boundaries.** Only the standalone token `Shadow` is a candidate. A
   match is skipped when it touches an identifier character on either side, so
   `ShadowEvent`, `useShadow`, `installShadow`, `setShadowState`, `attachShadow`
   and `ShadowCore` can never be touched even if the file is on the rename list.
2. **Case sensitivity.** The rewrite only matches `Shadow`. Everything technical
   is lowercase (`shadow`, `data-shadow-*`, `window.shadowERP`, `[[shadow:ask]]`,
   `model_id: shadow`) or UPPER_SNAKE (`SHADOW_NAME`, `SHADOW_SESSION`,
   `SHADOW_PUBLIC_URL`, `{{shadow_session}}`), so it is never a match at all.
   Python package/module paths (`backend/shadow/`) are lowercase too.

An extra rule for Python: the name is only rewritten inside **string literals**,
never inside module/function/class **docstrings** or comments. `main.py:461`
(`# ... what Shadow is doing`) and `setup_elevenlabs.py:65` (a comment about
staying silent) are therefore kept, while the agent prompts and API strings
around them are renamed.

---

## 2. Decisions at a glance

| Surface | Decision | Hits | Files |
|---|---|---|---|
| Console UI (`console/src/**` + `console/index.html`) | rename | 34 | 12 |
| In-app companion (`capture.js`) | rename | 8 | 1 |
| ElevenLabs prompts (`setup_elevenlabs.py`) | rename | 4 | 1 |
| Spoken Custom-LLM personas (`converse.py`) | rename | 2 | 1 |
| API-returned copy / export by-line (`main.py`, `exports.py`) | rename | 5 | 2 |
| Product docs (root `*.md` + `design/DESIGN.md`) | rename | 78 | 8 |
| **Total rename** | | **131** | **25** |
| Code identifiers | keep | 33 | 11 |
| Python docstrings/comments/tests | keep | 40 | 18 |
| Benchmark tooling | keep | 4 | 1 |
| Independent reviews + historical design (frozen) | keep | 127 | 21 |
| Observer contract, infra, video, site | keep | 9 | 6 |
| **Total keep** | | **213** | **56** |

Some files contain both decisions (e.g. `capture.js`: 8 rename + `attachShadow`
kept; `Console.tsx`: 8 rename + 2 `useShadow` kept), so the union of rename and
keep files is 74, not 25 + 56.

---

## 3. Complete rename inventory (131 hits / 25 files)

Every line number below is rewritten by the dry run. A line with several
occurrences is listed once.

### 3.1 Console UI — 34 hits / 12 files

- `console/index.html` — 1 hit (page title): L6
- `console/src/components/Checklist.tsx` — 1: L24
- `console/src/components/Prediction.tsx` — 2: L4, L13
- `console/src/components/Receipts.tsx` — 1: L15
- `console/src/components/ui.tsx` — 2: L7, L9
- `console/src/index.css` — 2: L4, L8
- `console/src/lib/voice.tsx` — 3: L15, L16, L54
- `console/src/pages/Console.tsx` — 8: L88, L164, L173, L186, L190, L241, L269
- `console/src/pages/DataPage.tsx` — 3: L9, L149, L236
- `console/src/pages/Home.tsx` — 4: L87, L88, L130
- `console/src/pages/MapPage.tsx` — 2: L121, L124
- `console/src/pages/ProofPage.tsx` — 5: L12, L69, L73, L92, L155

### 3.2 In-app companion — 8 hits / 1 file

`backend/shadow/static/capture.js` — L1, L5, L20, L150, L635, L636, L689, L783.
L20 is the single source of truth: `var NAME = window.SHADOW_NAME || "Shadow";`.
The `SHADOW_NAME` override is untouched; `attachShadow` (L455) is kept.

### 3.3 ElevenLabs agent prompts / spoken personas — 6 hits / 2 files

- `backend/scripts/setup_elevenlabs.py` — 4: L34 (system prompt), L40/L45 (agent names), L41 (first message)
- `backend/shadow/converse.py` — 2: L124 (interviewer system prompt), L157 (tutor system prompt)

### 3.4 Backend API-returned copy / exports — 5 hits / 2 files

- `backend/shadow/main.py` — 4: L57 (startup log), L62 (`FastAPI(title=...)`), L546 (skip-turn text), L584 (`/api/data/inventory` → `"where": "… server · db"`, rendered by `DataPage.tsx`)
- `backend/shadow/exports.py` — 1: L83 ("Captured and verified by …" by-line in the exported Work Map)

### 3.5 Product docs — 78 hits / 8 files

- `README.md` — 6: L1, L6, L16, L26, L39, L48
- `CLAUDE.md` — 8: L1, L3, L9, L17, L19, L35, L45
- `AGENTS.md` — 3: L13, L14, L16
- `ELEVENLABS_SETUP.md` — 16: L3, L5, L12, L15, L17, L20, L33, L40, L43, L44, L45, L46
- `LOVABLE_PROMPT.md` — 5: L4, L5, L78, L108
- `SABINE_ROLE_CARD.md` — 2: L3
- `SHADOW_ARCHITECTURE.md` — 36: L6, L14, L15, L18, L33, L35, L42, L54, L58, L108, L129, L133, L178, L191, L196, L197, L227, L249, L250, L251, L254, L257, L272, L305, L315, L316, L317, L328, L336, L346, L353, L405, L413, L428, L477
- `design/DESIGN.md` — 2: L1, L25

> `SHADOW_ARCHITECTURE.md` is a **file name** and is not renamed by this tool.
> Only its heading and prose change; a file rename is a separate `git mv` the
> repo owner should do deliberately.

---

## 4. Complete keep inventory (213 hits / 56 files)

Grouped by the reason the tool keeps them. `file: lines` for every hit.

### 4.1 Code identifiers (word-boundary rule) — 33 hits / 11 files

`ShadowEvent`, `useShadow`, `installShadow`, `setShadowState`, `attachShadow`,
`ShadowCompanion` — types, hooks, DOM API. Renaming them would break imports,
websocket payload types and the observer contract.

- `advisory/companion-design-2026-10-03/shadow-companion.js` — 3: L14, L17, L114
- `backend/shadow/static/capture.js` — 1: L455 (`host.attachShadow(...)`)
- `console/src/components/Feed.tsx` — 3: L1, L6, L26
- `console/src/lib/api.ts` — 10: L2, L18, L19, L20, L23, L29, L104, L108, L124, L142
- `console/src/lib/types.ts` — 1: L123
- `console/src/lib/voice.tsx` — 2: L3, L24
- `console/src/pages/Console.tsx` — 2: L4, L31
- `console/src/pages/ProofPage.tsx` — 2: L3, L16
- `src/components/erp/AppShell.tsx` — 5: L4, L11, L14, L15
- `src/lib/erp/shadow.ts` — 2: L29, L43
- `src/routes/invoice.$id.tsx` — 2: L5, L56

### 4.2 Python docstrings, comments and tests (developer-facing) — 40 hits / 18 files

The package is `shadow`, so module paths and imports are lowercase and never
match. The English prose inside docstrings/comments/tests is documentation, not
copy. (Regex only rewrites `.py` string literals, so these never change.)

- `backend/scripts/setup_elevenlabs.py` — 4: L1, L3, L65
- `backend/shadow/__init__.py` — 1: L1
- `backend/shadow/bayes.py` — 1: L3
- `backend/shadow/converse.py` — 2: L3, L4
- `backend/shadow/engine.py` — 7: L1, L4, L6, L241, L1234, L1478, L1524
- `backend/shadow/hypotheses.py` — 1: L1
- `backend/shadow/llm.py` — 1: L1
- `backend/shadow/llm_openai.py` — 1: L4
- `backend/shadow/main.py` — 5: L1, L3, L6, L268, L461
- `backend/shadow/novice.py` — 2: L3, L5
- `backend/shadow/packs/ap_invoices/__init__.py` — 3: L79, L247, L303
- `backend/shadow/packs/ap_invoices/oracle.py` — 1: L3
- `backend/shadow/proof.py` — 2: L3, L8
- `backend/shadow/receipts.py` — 2: L1, L3
- `backend/shadow/redact.py` — 1: L3
- `backend/shadow/sim.py` — 2: L4, L5
- `backend/shadow/workmap.py` — 2: L1, L5
- `backend/tests/test_engine.py` — 2: L18, L38

### 4.3 Benchmark tooling and generated labels (developer-facing) — 4 hits / 1 file

- `backend/scripts/eval_curves.py` — 4: L192, L238, L287, L316. Chart labels such
  as `"Shadow + debrief"` live here; the generated SVG (`backend/eval_out/`,
  pruned from the scan) would follow. Kept because it is internal evaluation
  tooling, not shipped UI. Flip to rename if the benchmark charts become public.

### 4.4 Independent reviews and historical design (frozen) — 127 hits / 21 files

Dated advice artifacts. Editing them would falsify the record and break the
"advice, not spec" convention in `CLAUDE.md`. (`shadow-companion.js` shows its 6
string hits here; its 3 identifier hits are in §4.1.)

- `advisory/codex-coordination/CODEX_STATUS.md` — 1: L7
- `advisory/codex-coordination/ERP_REPORT.md` — 2: L3
- `advisory/codex-coordination/OPUS_TASKS.md` — 5: L33, L35, L36, L44
- `advisory/companion-design-2026-10-03/index.html` — 1: L5
- `advisory/companion-design-2026-10-03/shadow-companion.js` — 6: L45, L46, L48, L51, L97, L106
- `advisory/product-engine-investigation-2026-10-03/BROWSER_COMPANION_PROPOSAL.md` — 6: L7, L22, L26, L28, L30, L41
- `advisory/product-engine-investigation-2026-10-03/EXTENSION_RELEASE_STRATEGY.md` — 2: L5, L11
- `advisory/product-engine-investigation-2026-10-03/NOVEL_TASK_LEARNING_PROPOSAL.md` — 5: L18, L62, L77, L111, L113
- `advisory/product-engine-investigation-2026-10-03/OPUS_HANDOFF.md` — 2: L7, L21
- `advisory/product-engine-investigation-2026-10-03/PRODUCT_AND_ENGINE_AUDIT.md` — 5: L10, L11, L85, L121
- `advisory/product-engine-investigation-2026-10-03/README.md` — 3: L1, L5, L7
- `advisory/v3-independent-review-2026-10-03/DEMO_AND_EXECUTION_PLAN.md` — 4: L3, L56, L74, L117
- `advisory/v3-independent-review-2026-10-03/IMPLEMENTATION_REVIEW.md` — 1: L12
- `advisory/v3-independent-review-2026-10-03/LEARNING_AND_EXTENSIONS.md` — 8: L3, L7, L74, L76, L95, L97, L99, L187
- `advisory/v3-independent-review-2026-10-03/README.md` — 5: L1, L5, L24, L43, L47
- `advisory/v3-independent-review-2026-10-03/RESEARCH_AND_SOURCES.md` — 6: L3, L8, L21, L31, L41, L43
- `design/shadow-v3/DIRECTIONS.md` — 40: L1, L14, L36, L39, L40, L76, L80, L81, L117, L128, L134, L158, L162, L164, L166, L168, L220, L227, L233, L238, L308, L320, L324, L326, L332, L336, L339, L356, L375, L473, L475, L566, L621, L637, L657, L674, L713
- `design/shadow-v3/README.md` — 3: L1, L12, L13
- `design/shadow-v3/mockups/a-instrument.html` — 7: L6, L125, L330, L478, L480, L485, L912
- `design/shadow-v3/mockups/b-codex.html` — 13: L6, L10, L363, L703, L708, L726, L805, L837, L882, L1172, L1400, L1633
- `design/shadow-v3/mockups/c-shift.html` — 2: L6, L903

### 4.5 Observer contract, infra, design/video and site — 9 hits / 6 files

- `src/lib/erp/store.tsx` — 2: L9, L143 (the `?shadow=` session pin is a storage/URL key; the comment describes it)
- `deploy/core.Dockerfile` — 1: L1 (build comment)
- `.gitignore` — 1: L34 (local ignore section comment)
- `design/video/STORYBOARD.md` — 2: L17, L90 (T4 demo-film plan, frozen)
- `design/video/record.mjs` — 2: L43, L581 (T4 recorder, frozen)
- `site/index.html` — 1: L510 (T3 landing page; product name should become a single constant — see §6)

---

## 5. Technical terms explicitly protected

These appear in the tree and the dry run provably leaves them byte-identical
(verified in memory: 475 protected-token checks, 0 problems):

| Protected | Where | Why |
|---|---|---|
| `attachShadow` | `capture.js:455`, companion study | Shadow DOM API |
| `window.shadowERP` | `LOVABLE_PROMPT.md`, `src/**`, docs | observer contract |
| `data-shadow-*` | docs, ERP | screen-capture attributes |
| `window.shadow.beforeSave` | `capture.js`, docs | save-intercept hook |
| `SHADOW_NAME`, `SHADOW_CONSOLE`, `SHADOW_API`, `SHADOW_SESSION`, `SHADOW_PUBLIC_URL` | code, env, Railway | env/config names |
| `{{shadow_session}}`, `{{shadow_mode}}` | ElevenLabs prompt variables | template vars |
| `[[shadow:ask]]`, `[[shadow:debrief]]`, `[[shadow:intervene]]` | control tags | wire protocol |
| `"model_id": "shadow"` | `setup_elevenlabs.py` | Custom-LLM model id |
| `/v1/chat/completions`, `/api/...`, `/ws/panel/...`, `/capture.js` | routes | API surface |
| `backend/shadow/`, `src/lib/erp/shadow.ts`, `design/shadow-v3/` | package/module paths + file names | code identity |
| `ShadowEvent`, `useShadow`, `installShadow`, `setShadowState` | TS types/hooks | code identity |
| `shadow-intern`, `.shadow-*` | custom element / CSS | CSS + element names |
| `shadow` git remote / branch paths | `CLAUDE.md` | repo identity |

---

## 6. Out of scope (not rewritten, on purpose)

- **File and directory names.** `SHADOW_ARCHITECTURE.md`, `design/shadow-v3/`,
  `src/lib/erp/shadow.ts`, `backend/shadow/`, `shadow.db` keep their names. A
  filename rename is a separate, reviewable `git mv` (and the GitHub repo name is
  a further separate decision — do not rewrite pushed history per `AGENTS.md`).
- **`design/tasks/**`** — the delegation queue, logs and `*_REPORT.md`s. Pruned
  from the scan so this plan does not list itself.
- **VCS, deps, build output** — `.git`, `node_modules`, `.venv`, `dist`,
  `.pytest_cache`, `.wrangler`, `backend/eval_out/`, `*.db`, binary assets.
- **The T3 landing page constant.** `site/index.html` currently spells the name
  in prose at L510. When T3 lands, the name should live in one JS/CSS constant;
  add `("site/", "landing page", {".html"})` to `RENAME_PREFIXES` and the tool
  will cover it like the console.
- **Advisory artifacts** — kept as dated evidence by design.

---

## 7. How to run it (when the user decides the name)

```bash
# 1. see the whole categorized inventory
python3 scripts/rename_product.py --report

# 2. see the unified diff (default; writes nothing)
python3 scripts/rename_product.py
python3 scripts/rename_product.py --to Mira        # try another name
python3 scripts/rename_product.py --context 0      # compact diff

# 3. counts only / CI gate
python3 scripts/rename_product.py --stat
python3 scripts/rename_product.py --check          # exit 1 while work is pending

# 4. only after review and approval
python3 scripts/rename_product.py --apply
```

After `--apply`, run the checks that matter: `cd backend && .venv/bin/pytest -q`,
the `console` build/lint, then re-run `python3 scripts/rename_product.py --check`
(should exit 0). The ElevenLabs agents are renamed by re-running
`backend/scripts/setup_elevenlabs.py` against the new prompts.

## 8. Open questions

1. **Name.** This plan defaults `--to Tacet` because the queue points at it, but
   the product name was still undecided when T5 ran. `--to` is a flag.
2. **Repo/package names.** `backend/shadow/` and the GitHub repo stay. If the
   package must be renamed later, that is a separate refactor (imports, Docker
   paths, `railway.json`) — this tool deliberately refuses it.
3. **Is `eval_curves.py` output public?** Today kept; if benchmark charts ship,
   move it to the rename list.
4. **`main.py` ownership.** The backend API strings at L57/L62/L546/L584 are
   included so the user-facing `/docs` title, tutor text and Data page agree with
   the new name; Opus owns `backend/shadow/**` and should apply that part.
5. **New files.** Concurrent T1–T4 outputs are categorized above; re-run
   `--report` immediately before applying so nothing new is missed.
