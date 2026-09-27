import json
from functools import cached_property
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """api configuration (TRD §12). Values come from api/.env."""

    model_config = SettingsConfigDict(env_file=API_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b-instruct"
    confidence_threshold: float = 0.7
    hedera_svc_url: str = "http://127.0.0.1:7000"
    internal_token: str
    mirror_url: str = "https://testnet.mirrornode.hedera.com"
    deployment_file: str = "../shared/deployment.json"
    demo_mode: bool = False

    @property
    def deployment_path(self) -> Path:
        p = Path(self.deployment_file)
        return p if p.is_absolute() else (API_DIR / p).resolve()

    @cached_property
    def deployment(self) -> dict:
        """shared/deployment.json: contract address, ABI, topic ID (single source of truth)."""
        return json.loads(self.deployment_path.read_text(encoding="utf-8"))


settings = Settings()
