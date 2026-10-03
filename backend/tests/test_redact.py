"""Tests for shadow.redact -- transcript scrubbing.

Half the matrix is "must redact" (personal / payment data), half is
"must not redact" (the business numerals the product depends on).
"""

import time

import pytest

from shadow.redact import PLACEHOLDERS, redact

# ------------------------------------------------------------------ must redact
MUST_REDACT = [
    # IBANs -- checksum-valid, spaced and unspaced
    ("IBAN: DE89 3704 0044 0532 0130 00", "IBAN: [IBAN]"),
    ("CZ6508000000192000145399", "[IBAN]"),
    ("GB82 WEST 1234 5698 7654 32", "[IBAN]"),
    ("NO9386011117947", "[IBAN]"),
    ("paid to DE89370400440532013000 today", "paid to [IBAN] today"),
    # emails
    ("sabine.mueller@example.de", "[EMAIL]"),
    ("a+b@sub.domain.co.uk", "[EMAIL]"),
    ("Kontakt: jonas@firma.de.", "Kontakt: [EMAIL]."),
    # phones -- international and German national
    ("+49 30 123456", "[PHONE]"),
    ("+1 (415) 555-0100", "[PHONE]"),
    ("030 1234567", "[PHONE]"),
    ("0171 1234567", "[PHONE]"),
    ("+49 (0) 30 12345678", "[PHONE]"),
    ("erreichbar: 030/1234567", "erreichbar: [PHONE]"),
    ("0171-1234567", "[PHONE]"),
    # payment cards -- Luhn-valid, various groupings
    ("4111 1111 1111 1111", "[CARD]"),
    ("4111-1111-1111-1111", "[CARD]"),
    ("5500 0000 0000 0004", "[CARD]"),
    ("3782 822463 10005", "[CARD]"),
    ("Karte 4111111111111111 ok?", "Karte [CARD] ok?"),
    # tax ids
    ("USt-IdNr. DE123456789", "USt-IdNr. [TAX_ID]"),
    ("ATU12345678", "[TAX_ID]"),
    ("CZ12345678", "[TAX_ID]"),
    ("CZ1234567890", "[TAX_ID]"),
    ("Steuernummer 12/345/67890", "Steuernummer [TAX_ID]"),
    ("Steuernummer 02/345/67890", "Steuernummer [TAX_ID]"),  # beats the phone shape
    # URLs carrying a secret
    ("https://api.example.com/v1/cases?token=abc123&x=1", "[URL_SECRET]"),
    ("siehe https://example.com/?key=SECRET.", "siehe [URL_SECRET]."),
    ("https://x.io/cb?password=hunter2", "[URL_SECRET]"),
    ("https://x.io/cb#access_token=zzz", "[URL_SECRET]"),
    # a whole sentence
    (
        "IBAN DE89 3704 0044 0532 0130 00, Mail sabine@example.de, Tel +49 30 123456",
        "IBAN [IBAN], Mail [EMAIL], Tel [PHONE]",
    ),
]

# --------------------------------------------------------------- must not redact
MUST_KEEP = [
    "Rechnung 5,000 EUR",
    "Betrag 5.000",
    "3,600 net",
    "€7,616.00",
    "two thousand",
    "Kostenstelle 0400",
    "Kostenstelle 4711",
    "Kostenstelle 9100",
    "Rechnung 4471",
    "HM-2026-0412",
    "PO-26-9002",
    "2%",
    "2.5 %",
    "18.09.2026",
    "2026-12-29",
    "Datum 01.02.2026",
    "01-02-2026",
    "innerhalb 10 Tagen",
    "Jahr 2026",
    "V19",
    "RC",
    "AN-2026-0142",
    "Sabine",
    "Gib Jonas Bescheid",
    "Telefonnummer fehlt",
    "IBAN DE89 3704 0044 0532 0130 01",  # fails mod-97
    "random 1234 5678 9012 3456",  # fails Luhn
    "DE12345",  # too short for a VAT id
    "ATU1234567",  # too short for a VAT id
    "CZ1234567",  # too short for a VAT id
    "Netto 4.711,00",
]


@pytest.mark.parametrize("text,expected", MUST_REDACT)
def test_must_redact(text, expected):
    out, findings = redact(text)
    assert out == expected
    assert findings, "expected at least one finding"


@pytest.mark.parametrize("text", MUST_KEEP)
def test_must_not_redact(text):
    out, findings = redact(text)
    assert out == text
    assert findings == []


# ------------------------------------------------------------------- behaviour
def test_findings_index_the_original_text():
    text = "Mail sabine@example.de und IBAN DE89 3704 0044 0532 0130 00"
    out, findings = redact(text)
    assert out == "Mail [EMAIL] und IBAN [IBAN]"
    assert [(f["kind"], text[f["start"]:f["end"]]) for f in findings] == [
        ("email", "sabine@example.de"),
        ("iban", "DE89 3704 0044 0532 0130 00"),
    ]


def test_findings_sorted_and_non_overlapping():
    text = "karte 4111 1111 1111 1111 und tel +49 30 123456 und a@b.de"
    _, findings = redact(text)
    assert [f["start"] for f in findings] == sorted(f["start"] for f in findings)
    for left, right in zip(findings, findings[1:]):
        assert left["end"] <= right["start"]


def test_url_trailing_punctuation_is_trimmed():
    text = "see https://example.com/?key=SECRET."
    out, findings = redact(text)
    assert out == "see [URL_SECRET]."
    assert findings == [{"kind": "url_secret", "start": 4, "end": 35}]


def test_placeholder_vocabulary():
    assert set(PLACEHOLDERS.values()) == {
        "[IBAN]", "[EMAIL]", "[PHONE]", "[CARD]", "[TAX_ID]", "[URL_SECRET]"
    }


def test_empty_and_plain_text():
    assert redact("") == ("", [])
    assert redact("nothing sensitive here") == ("nothing sensitive here", [])


def test_long_input_is_fast_and_non_mutating():
    text = "Kostenstelle 0400 Betrag 5.000 net am 18.09.2026 " * 110
    assert len(text) >= 5000
    started = time.perf_counter()
    out, findings = redact(text)
    elapsed = time.perf_counter() - started
    assert out == text and findings == []
    assert elapsed < 1.0


def test_digit_and_email_heavy_input_no_catastrophic_backtracking():
    for text in ("9" * 5000, ("a.a" * 1250), "a" * 2500 + "@" + "b" * 2500 + ".de"):
        started = time.perf_counter()
        redact(text)
        assert time.perf_counter() - started < 1.0
