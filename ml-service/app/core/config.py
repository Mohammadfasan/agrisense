"""Application settings, loaded from the environment and an optional .env."""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Environment-driven configuration.

    Field names map to upper-case environment variables, so ``models_dir``
    is set with ``MODELS_DIR``.
    """

    model_config = SettingsConfigDict(
        env_file=SERVICE_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # ``model_`` is a protected prefix in pydantic v2; clearing it lets
        # fields like ``models_dir`` keep their natural name.
        protected_namespaces=(),
    )

    app_name: str = "agrisense-ml"
    environment: str = "development"
    log_level: str = "INFO"

    host: str = "0.0.0.0"
    port: int = 8000

    models_dir: Path = SERVICE_ROOT / "models"

    # Origins allowed to call this service directly; the Node API is the
    # normal caller, browsers only reach it through that.
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4000"]

    @field_validator("models_dir")
    @classmethod
    def _anchor_to_service_root(cls, value: Path) -> Path:
        """Resolve a relative ``MODELS_DIR`` against the service directory.

        Without this, ``MODELS_DIR=models`` would resolve against the current
        working directory, so the service would find its models when started
        from ``ml-service/`` but not from the repository root.
        """
        return value if value.is_absolute() else (SERVICE_ROOT / value).resolve()


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance, so the .env is read once per process."""
    return Settings()
