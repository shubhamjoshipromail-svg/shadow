"""Language handling. The expert's language is never configured: it is read from what they say.

`detect` is a deliberately cheap stopword + character heuristic (no network, no model). It only has to be right
about the handful of languages we translate from; when it is unsure it says "en" and the compile step's own
`translation_en` still carries the meaning. The new hire's language is a real choice (`LEARNER_LANGS`).
"""

from __future__ import annotations

import re

NAMES = {"en": "English", "de": "German", "fr": "French", "es": "Spanish", "it": "Italian", "nl": "Dutch",
         "pt": "Portuguese", "pl": "Polish", "tr": "Turkish"}
# what the new hire can pick in the console (label shown in its own language)
LEARNER_LANGS = {"en": "English", "de": "Deutsch", "fr": "Français", "es": "Español"}

_STOP = {
    "de": "der die das und ist nicht ein eine einen mit für auf über immer wenn dann bei von zu den dem des im "
          "ich wir sie wird sind haben hat muss müssen wurde aber auch noch nur wie oder als nach vor kein "
          "keine ab brutto netto rechnung betrag liegt dass weil sonst aber".split(),
    "fr": "le la les des une est pas pour avec dans sur que qui et ou mais toujours quand je nous vous il elle "
          "ce cette sont avoir faut doit au aux du de ne plus".split(),
    "es": "el los las una es no para con en que y o pero siempre cuando yo nosotros usted ella esto esta son "
          "hay debe del al por se lo como más".split(),
    "it": "il lo gli una è non per con che sempre quando io noi lei questo questa sono deve della del nel".split(),
    "nl": "het een niet voor met dat dit altijd als ik wij zij zijn moet van de en of maar".split(),
    "en": "the a an is are not for with that this always when if then it we you they be must should of to and or "
          "but over under above below than have has was were on in at by".split(),
}
_SETS = {k: set(v) for k, v in _STOP.items()}
_WORD = re.compile(r"[a-zA-ZÀ-ÿ]+")


def detect(text: str | None, default: str = "en") -> str:
    """Best-guess language code for a spoken or typed answer."""
    words = [w.lower() for w in _WORD.findall(text or "")]
    if not words:
        return default
    scores = {k: sum(1 for w in words if w in s) for k, s in _SETS.items()}
    if re.search(r"[äöüß]", (text or "").lower()):
        scores["de"] += 2
    if re.search(r"[éèêàçùœ]", (text or "").lower()):
        scores["fr"] += 1
    if re.search(r"[ñ¿¡]", (text or "").lower()):
        scores["es"] += 2
    best = max(scores, key=lambda k: (scores[k], k == "en"))
    if scores[best] == 0 or (best != "en" and scores[best] <= scores["en"]):
        return "en" if scores["en"] >= scores[best] else default
    return best


def name(code: str | None) -> str:
    return NAMES.get((code or "en").split("-")[0], code or "English")


def is_english(code: str | None) -> bool:
    return (code or "en").split("-")[0] in ("en", "auto", "")
