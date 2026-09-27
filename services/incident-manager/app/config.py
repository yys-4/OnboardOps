from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Server
    PORT: int = 5000
    LOG_LEVEL: str = "info"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://onboardops:password@localhost:5432/onboardops"

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # AI (OpenAI & Fireworks AI support)
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    FIREWORKS_API_KEY: str = ""
    FIREWORKS_BASE_URL: str = "https://api.fireworks.ai/inference/v1"
    FIREWORKS_MODEL: str = "accounts/fireworks/models/glm-5p3-flash"
    POSTMORTEM_AUTO_DRAFT: bool = True

    # Backend service
    BACKEND_URL: str = "http://localhost:4000"

    # OTEL
    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://localhost:4317"
    OTEL_SERVICE_NAME: str = "onboardops-incident-manager"

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Incident webhook
    INCIDENT_WEBHOOK_SECRET: str = "dev-webhook-secret"


settings = Settings()
