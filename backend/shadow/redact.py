"""Transcript scrubbing for expert answers.

Expert answers arrive as transcribed speech or typed text. Before Shadow stores
them or ships them to an LLM provider, personal and payment data is replaced
with typed placeholders so downstream systems never see the raw values.

Scope
-----
Redacted: IBANs (any country, validated by mod-97), emails, phone numbers,
payment card numbers (Luhn-validated), EU VAT / German Steuernummer tax ids,
and URLs that carry a ``token``/``key``/``secret``/``password`` parameter.

Out of scope: **personal names**. We deliberately do not attempt name
detection. First names (e.g. "Sabine", "Jonas") are left untouched: a name
list is noisy, locale-bound, and would eat the words the product needs.

Also intentionally left intact: business numerals -- amounts, cost centres,
invoice numbers, percentages, dates, day counts, years, tax codes and asset
numbers. They look numeric but carry the workflow meaning, so the detectors
are shape- and checksum-gated rather than "any digit run".

Pure stdlib, linear-time regexes. Only :func:`redact` is public.
"""

from __future__ import annotations

import re

__all__ = ["redact"]

PLACEHOLDERS = {
    "url_secret": "[URL_SECRET]",
    "iban": "[IBAN]",
    "email": "[EMAIL]",
    "tax_id": "[TAX_ID]",
    "card": "[CARD]",
    "phone": "[PHONE]",
}

# --- detector patterns (compiled once; all bounded, no nested quantifiers) ---
_IBAN = re.compile(r"(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?(?![A-Z0-9])")
_EMAIL = re.compile(r"(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
_CARD = re.compile(r"(?<![\d\-])(?:\d[ \-]?){12,18}\d(?!\d)")
_PHONE = re.compile(r"(?<![\w+])(?:\+\d[\d\s()\-/]{4,20}\d|0[\d\s()\-/]{4,20}\d)(?!\d)")
_TAX_ID = re.compile(r"\b(?:DE\d{9}|ATU\d{8}|CZ\d{8,10}|\d{2,3}/\d{3}/\d{4,5})\b")
_URL = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_URL_SECRET_PARAM = re.compile(r"[?&#][^=&#\s]*(?:token|key|secret|password)=", re.IGNORECASE)

_DATE_LIKE = re.compile(r"0?\d{0,4}[.\-]\d{1,2}[.\-]\d{2,4}")


def _iban_ok(raw: str) -> bool:
    """ISO 13616 IBAN check: strip spaces, length 15-34, mod-97 == 1."""
    s = raw.replace(" ", "").upper()
    if not 15 <= len(s) <= 34 or not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]+", s):
        return False
    rearranged = s[4:] + s[:4]
    numeric = "".join(str(ord(c) - 55) if c.isalpha() else c for c in rearranged)
    return int(numeric) % 97 == 1


def _luhn_ok(raw: str) -> bool:
    digits = [int(c) for c in raw if c.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _phone_ok(raw: str) -> bool:
    """Phone-like shape: leading +/0, 7-15 digits, not a dashed date."""
    if raw[0] not in "+0":
        return False
    digits = re.sub(r"\D", "", raw)
    if not 7 <= len(digits) <= 15:
        return False
    return not _DATE_LIKE.fullmatch(raw)


def _url_secret(raw: str) -> str | None:
    url = raw.rstrip(".,;:!?)]}\"'")
    return url if _URL_SECRET_PARAM.search(url) else None


# Priority order: first detector wins an overlap (URL beats all; IBAN beats the
# phone/card runs inside a spaced IBAN; tax id beats a 0-leading Steuernummer
# that also looks like a phone number).
_DETECTORS = (
    ("url_secret", _URL, _url_secret),
    ("iban", _IBAN, lambda s: s if _iban_ok(s) else None),
    ("email", _EMAIL, lambda s: s),
    ("tax_id", _TAX_ID, lambda s: s),
    ("card", _CARD, lambda s: s if _luhn_ok(s) else None),
    ("phone", _PHONE, lambda s: s if _phone_ok(s) else None),
)


def redact(text: str) -> tuple[str, list[dict]]:
    """Return (scrubbed_text, findings).

    ``findings`` is ``[{"kind": "iban", "start": i, "end": j}]`` where the
    offsets index the *original* text, sorted by start and non-overlapping.
    """
    candidates: list[tuple[int, int, int, str]] = []
    blockers: list[tuple[int, int]] = []  # reserved spans that must not be carved up
    for rank, (kind, pattern, valid) in enumerate(_DETECTORS):
        for match in pattern.finditer(text):
            kept = valid(match.group(0))
            if kept:
                candidates.append((rank, match.start(), match.start() + len(kept), kind))
            elif kind == "iban":
                # An IBAN-shaped run that fails mod-97 is still one token: don't
                # let the card/phone detectors redact a slice of it. (A tax id
                # such as CZ1234567890 may legitimately sit inside that shape.)
                blockers.append((match.start(), match.end()))

    candidates.sort(key=lambda c: (c[0], c[1]))
    accepted: list[tuple[int, int, int, str]] = []
    for cand in candidates:
        start, end = cand[1], cand[2]
        if cand[3] in ("card", "phone") and any(start < b[1] and b[0] < end for b in blockers):
            continue
        if any(start < a[2] and a[1] < end for a in accepted):
            continue
        accepted.append(cand)

    accepted.sort(key=lambda c: c[1])
    out: list[str] = []
    findings: list[dict] = []
    pos = 0
    for _, start, end, kind in accepted:
        out.append(text[pos:start])
        out.append(PLACEHOLDERS[kind])
        findings.append({"kind": kind, "start": start, "end": end})
        pos = end
    out.append(text[pos:])
    return "".join(out), findings
