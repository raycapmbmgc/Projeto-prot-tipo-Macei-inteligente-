"""Load local configuration before importing database or providers."""
from pathlib import Path
import os

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env', override=False)

def valhalla_url():
    # Explicit empty value disables the shared demonstration server.
    return os.getenv('VALHALLA_URL', 'https://valhalla1.openstreetmap.de')
