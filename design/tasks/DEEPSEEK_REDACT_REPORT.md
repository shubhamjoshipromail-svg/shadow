# Report: transcript scrubbing module (redaction)

Task: `design/tasks/DEEPSEEK_REDACT.md` · Owner: DeepSeek (headless) · Status: done, not committed.

## Deliverables
- `backend/shadow/redact.py` (143 lines, pure stdlib, no imports outside `re`).
- `backend/tests/test_redact.py` (62 data-driven cases: 31 must-redact + 31 must-not; 7 behaviour/perf tests).
- Result: `cd backend && .venv/bin/pytest -q tests/test_redact.py` → **69 passed in 0.06s**; full backend suite → **90 passed**.

## API
```python
redact(text: str) -> tuple[str, list[dict]]
```
Findings are `{"kind", "start", "end"}` on the **original** text, sorted by `start` and non-overlapping.
Kinds/placeholders: `url_secret→[URL_SECRET]`, `iban→[IBAN]`, `email→[EMAIL]`, `tax_id→[TAX_ID]`, `card→[CARD]`, `phone→[PHONE]`.
Nothing is imported anywhere yet (per task) — Claude integrates it.

## What is covered
- **IBAN** — any country, spaced or unspaced (`DE89 3704 0044 0532 0130 00`, `CZ6508000000192000145399`, GB/NO examples). Strips spaces, requires length 15–34, then the **mod-97 == 1** check, so plain digit runs and bad checksums (`...0130 01`) are not hit.
- **Email** — standard local@domain with multi-label domains and `+` tags; trailing sentence punctuation is preserved.
- **Phone** — international (`+49 30 123456`, `+1 (415) 555-0100`, `+49 (0) 30 …`) and German national (`030 1234567`, `0171 1234567`, `030/1234567`, `0171-1234567`). Requires a leading `+`/`0`, 7–15 digits, and rejects dashed date shapes.
- **Card** — 13–19 digits with spaces or dashes, filtered by **Luhn** (`4111…`, `5500…`, Amex 4-6-5 grouping, unspaced).
- **Tax ids** — `DE`+9, `ATU`+8, `CZ`+8–10, and Steuernummer `12/345/67890` (incl. 0-leading `02/345/67890`).
- **URL secret** — the whole `http(s)` URL is replaced when it carries `token|key|secret|password=` (query, fragment, or `access_token`-style), trailing punctuation trimmed.
- **Overlap resolution** — candidates are ranked (URL > IBAN > email > tax id > card > phone); higher-rank wins. A checksum-failing IBAN-shaped run is reserved so card/phone detectors cannot redact a slice of it (but a real `CZ` VAT id inside that shape still fires).
- **Must-not** — amounts, cost centres, invoice/asset numbers, percentages, dates, day counts, years, tax codes and first names are all asserted unchanged.
- **Performance** — bounded regexes only; a 5,000+ char business-text test and digit/email-heavy 5,000-char inputs each complete well under 1 s (no catastrophic backtracking).

## Known gaps / judgment calls
- **Names are out of scope by design** (documented in the module docstring): "Sabine", "Jonas" are left alone.
- **0-leading numeric identifiers ≥ 7 digits** (e.g. a purely numeric `0123456789` invoice) look phone-like and are redacted as `[PHONE]`. The specified must-not numbers (`0400`, `4711`, `9100`, `4471`) are 4 digits, so they are safe.
- **Letters + digits** invoice/asset formats (`HM-2026-0412`, `PO-26-9002`, `AN-2026-0142`) are never touched.
- Phone written with dots (`030.1234567`) is **not** detected — dots are excluded from the phone class to avoid eating dates (`18.09.2026`, `01.02.2026`).
- IBAN matching allows a single space or none between groups; multiple spaces, tabs/newlines, or lowercase IBANs are not matched.
- A 13–19 digit phone that happens to pass Luhn would be labelled `[CARD]` (rare; Luhn false-pass ≈ 1/10 among long digit runs).
- URL detection is `http(s)://` only and is conservative: any `key=`-like parameter triggers it, including a substring such as `?monkey=1`; bare `www.` links are not matched.
- Full-width/non-Latin digits, obfuscated secrets (`t o k e n`), and JSON/HTML escaping are not handled.
- No de-duplication of adjacent findings and no redaction of names embedded in free text (see above).

## Integration note for Claude
Call `redact()` at the transcript/answer boundary (before persistence and before any LLM provider call); replace with `scrubbed` and store/log `findings` using the original-text offsets. The module holds no state and is safe to import lazily. File ownership respected: only the two code files plus this report were created; no commits, pushes, servers, or other edits.
