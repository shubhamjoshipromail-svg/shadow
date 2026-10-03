import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
LLM_PROVIDERS = os.getenv("SHADOW_LLM_PROVIDERS", "anthropic,openai")  # tried in this order
OPENAI_VISION_MODEL = os.getenv("SHADOW_OPENAI_VISION_MODEL", "gpt-4.1-mini")
OPENAI_FAST_MODEL = os.getenv("SHADOW_OPENAI_FAST_MODEL", "gpt-4.1-mini")
OPENAI_REASON_MODEL = os.getenv("SHADOW_OPENAI_REASON_MODEL", "gpt-4.1-mini")

# Model roles (see SHADOW_ARCHITECTURE.md §12). Override via env.
VISION_MODEL = os.getenv("SHADOW_VISION_MODEL", "claude-haiku-4-5")
FAST_MODEL = os.getenv("SHADOW_FAST_MODEL", "claude-haiku-4-5")
REASON_MODEL = os.getenv("SHADOW_REASON_MODEL", "claude-sonnet-5-5")

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'shadow.db'}")
PUBLIC_URL = os.getenv("SHADOW_PUBLIC_URL", "http://localhost:8000")
DEFAULT_PACK = os.getenv("SHADOW_PACK", "ap_invoices")

# Inquiry planner knobs
LIVE_QUESTION_BUDGET_PER_10MIN = int(os.getenv("SHADOW_LIVE_BUDGET", "5"))
INTERRUPTION_LAMBDA = float(os.getenv("SHADOW_LAMBDA", "0.25"))
