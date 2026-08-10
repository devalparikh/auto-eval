from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_prefix="AUTOEVAL_",
        extra="ignore",
    )

    environment: str = Field(default="development", alias="AUTOEVAL_ENV")
    database_url: str = "sqlite:///./autoeval.db"
    web_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]
    allowed_hosts: Annotated[list[str], NoDecode] = ["localhost", "127.0.0.1", "testserver"]
    openrouter_api_key: str | None = Field(default=None, alias="OPENROUTER_API_KEY")
    openrouter_app_url: str = Field(default="http://localhost:3000", alias="OPENROUTER_APP_URL")
    openrouter_app_name: str = Field(default="AutoEval", alias="OPENROUTER_APP_NAME")
    enable_cli_providers: bool = Field(default=False, alias="ENABLE_CLI_PROVIDERS")
    cli_timeout_seconds: int = 90
    cli_output_limit_bytes: int = 1_000_000
    max_request_bytes: int = 2_000_000
    enforce_loopback_clients: bool = True

    @field_validator("web_origins", "allowed_hosts", mode="before")
    @classmethod
    def parse_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def production(self) -> bool:
        return self.environment == "production"

    @property
    def sqlite_path(self) -> Path | None:
        prefix = "sqlite:///"
        if not self.database_url.startswith(prefix):
            return None
        return Path(self.database_url.removeprefix(prefix)).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
