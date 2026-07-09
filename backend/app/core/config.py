import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    service_name: str
    environment: str
    api_prefix: str


@lru_cache
def get_settings() -> Settings:
    return Settings(
        service_name=os.getenv("SERVICE_NAME", "backend"),
        environment=os.getenv("ENVIRONMENT", "local"),
        api_prefix=os.getenv("API_PREFIX", "/api/v1"),
    )
