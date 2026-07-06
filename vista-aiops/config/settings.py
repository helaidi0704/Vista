import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

VISTA_PATH = "/mnt/c/Users/IbrahimRAHMANIA/Projets/vista"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

MODEL = "gemini-2.5-flash"

LOG_DIR = BASE_DIR / "logs"
REPORT_DIR = BASE_DIR / "reports"
WORKSPACE_DIR = BASE_DIR / "workspace"
