# Task: transcript scrubbing module (redaction)

Owner: DeepSeek (headless). Reviewer/integrator: Claude. Do not commit or push.

## Goal
Expert answers are transcribed speech or typed text, stored on our server and sent to LLM providers. Before that,
personal and payment data must be replaced with typed placeholders. Write a small, dependency-free module.

## Files you may create/edit
- `backend/shadow/redact.py` (new)
- `backend/tests/test_redact.py` (new)
Nothing else. Do not import it anywhere; Claude integrates it.

## API
```python
def redact(text: str) -> tuple[str, list[dict]]:
    """Return (scrubbed_text, findings). findings: [{"kind": "iban", "start": i, "end": j}] on the ORIGINAL text."""
```
Placeholders: `[IBAN]`, `[EMAIL]`, `[PHONE]`, `[CARD]`, `[TAX_ID]`, `[URL_SECRET]`.

## Must redact
- IBANs, any country, with or without spaces (`DE89 3704 0044 0532 0130 00`, `CZ6508000000192000145399`); validate
  with the mod-97 checksum when the string is ≥ 15 chars, so random digit runs are not hit.
- Emails.
- Phone numbers: international (`+49 30 123456`, `+1 (415) 555-0100`), German national (`030 1234567`,
  `0171 1234567`). Require ≥ 7 digits and a phone-like shape.
- Payment card numbers (13–19 digits, spaces/dashes allowed) that pass Luhn.
- EU VAT / tax ids: `DE` + 9 digits, `ATU` + 8 digits, `CZ` + 8–10 digits, and German Steuernummer `12/345/67890`.
- URLs containing `token=`, `key=`, `secret=`, `password=` (replace the whole URL with `[URL_SECRET]`).

## Must NOT redact (the product depends on these)
Amounts (`5,000`, `5.000`, `3,600 net`, `€7,616.00`, `two thousand`), cost centres (`0400`, `4711`, `9100`), invoice
numbers (`4471`, `HM-2026-0412`, `PO-26-9002`), percentages (`2%`, `2.5 %`), dates (`18.09.2026`, `2026-12-29`),
day counts (`within 10 days`), years, tax codes (`V19`, `RC`), asset numbers (`AN-2026-0142`), people's first names
(we don't attempt names — out of scope; say so in a docstring).

## Acceptance
- `cd backend && .venv/bin/pytest -q tests/test_redact.py` passes; ≥ 30 test cases split between must/must-not.
- Pure Python stdlib, < 200 lines, fast (no catastrophic regex backtracking; include a 5,000-char test).
- Write `design/tasks/DEEPSEEK_REDACT_REPORT.md` (what's covered, known gaps).
