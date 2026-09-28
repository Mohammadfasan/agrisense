"""Application settings, loaded from the environment and an optional .env."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[2]

MIN_KEY_LENGTH = 32


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

    models_dir: Path = SERVICE_ROOT / "artifacts"

    # Origins allowed to call this service directly; the Node API is the
    # normal caller, browsers only reach it through that.
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4000"]

    # Shared secret. The Node API sends it in the X-Internal-Key header on
    # every call. No default: the service refuses to start without it.
    internal_api_key: SecretStr

    # Largest photo /v1/diagnose accepts. Phone photos are usually 2-6 MB,
    # and the client compresses before upload (Day 23).
    max_upload_bytes: int = Field(default=8 * 1024 * 1024, gt=0, le=32 * 1024 * 1024)

    @field_validator("models_dir")
    @classmethod
    def _anchor_to_service_root(cls, value: Path) -> Path:
        """Resolve a relative ``MODELS_DIR`` against the service directory.

        Without this, ``MODELS_DIR=models`` would resolve against the current
        working directory, so the service would find its models when started
        from ``ml-service/`` but not from the repository root.
        """
        return value if value.is_absolute() else (SERVICE_ROOT / value).resolve()

    @field_validator("internal_api_key")
    @classmethod
    def _strong_real_key(cls, value: SecretStr) -> SecretStr:
        secret = value.get_secret_value()
        if secret.lower().startswith("change-me"):
            raise ValueError("INTERNAL_API_KEY is still the .env.example placeholder")
        if len(secret) < MIN_KEY_LENGTH:
            raise ValueError(f"INTERNAL_API_KEY must be at least {MIN_KEY_LENGTH} characters")
        return value


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance, so the .env is read once per process."""
    return Settings()
