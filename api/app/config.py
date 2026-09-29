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
    ollama_num_ctx: int = 8192  # TRD §8.1
    ollama_criteria_num_predict: int = 512  # TRD §8.1 caps
    ollama_eval_num_predict: int = 1200
    ollama_warm_up: bool = True  # False while building UI: keeps the 7B model out of RAM (start-all -Dev)
    confidence_threshold: float = 0.7
    hedera_svc_url: str = "http://127.0.0.1:7000"
    internal_token: str
    mirror_url: str = "https://testnet.mirrornode.hedera.com"
    deployment_file: str = "../shared/deployment.json"
    demo_mode: bool = False
    demo_replay: bool = False  # FR-29: DEMO_REPLAY=1 replays recorded verdicts (app/replay/recordings.json), no Ollama

    @property
    def deployment_path(self) -> Path:
        p = Path(self.deployment_file)
        return p if p.is_absolute() else (API_DIR / p).resolve()

    @cached_property
    def deployment(self) -> dict:
        """shared/deployment.json: contract address, ABI, topic ID (single source of truth)."""
        return json.loads(self.deployment_path.read_text(encoding="utf-8"))

    @property
    def topic_id(self) -> str:
        """The demo topic. Deliberately never falls back to devTopicId (Day 1-2 experiments only)."""
        topic = json.loads(self.deployment_path.read_text(encoding="utf-8")).get("topicId")
        if not topic:
            raise RuntimeError("shared/deployment.json has no topicId; run contracts/scripts/deploy.ts (T2.3)")
        return topic


settings = Settings()
