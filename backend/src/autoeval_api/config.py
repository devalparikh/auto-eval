from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
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
    openrouter_max_output_tokens: int = Field(default=4096, ge=256, le=32_768)
    enable_cli_providers: bool = Field(default=False, alias="ENABLE_CLI_PROVIDERS")
    cli_timeout_seconds: int = 90
    cli_output_limit_bytes: int = 1_000_000
    options_market_data_provider: Literal[
        "unconfigured", "tradier-sandbox", "tradier-production"
    ] = Field(default="unconfigured", alias="OPTIONS_MARKET_DATA_PROVIDER")
    tradier_api_token: str | None = Field(default=None, alias="TRADIER_API_TOKEN")
    market_data_timeout_seconds: float = Field(default=8, ge=1, le=30)
    market_data_max_symbols: int = Field(default=8, ge=1, le=25)
    market_data_max_expirations_per_symbol: int = Field(default=2, ge=1, le=8)
    market_data_max_contracts: int = Field(default=500, ge=10, le=2_000)
    market_data_max_response_bytes: int = Field(default=5_000_000, ge=100_000, le=20_000_000)
    max_request_bytes: int = 2_000_000
    enforce_loopback_clients: bool = True
    hosted_password: SecretStr | None = None

    @field_validator("web_origins", "allowed_hosts", mode="before")
    @classmethod
    def parse_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if not self.production:
            return self
        if self.hosted_password is None or len(self.hosted_password.get_secret_value()) < 32:
            raise ValueError(
                "AUTOEVAL_HOSTED_PASSWORD must contain at least 32 characters in production"
            )
        if self.enable_cli_providers:
            raise ValueError("CLI providers cannot be enabled in production")
        if self.database_url.startswith("sqlite"):
            raise ValueError("Production requires a durable non-SQLite database")
        if self.enforce_loopback_clients:
            raise ValueError(
                "Production requires AUTOEVAL_ENFORCE_LOOPBACK_CLIENTS=false; "
                "HTTP Basic authentication remains mandatory"
            )
        if not self.allowed_hosts or any(
            host == "*" or host in {"localhost", "127.0.0.1", "testserver"}
            for host in self.allowed_hosts
        ):
            raise ValueError("Production requires explicit non-local AUTOEVAL_ALLOWED_HOSTS")
        if not self.web_origins or any(
            not origin.startswith("https://") for origin in self.web_origins
        ):
            raise ValueError("Production requires explicit HTTPS AUTOEVAL_WEB_ORIGINS")
        return self

    @property
    def sqlite_path(self) -> Path | None:
        prefix = "sqlite:///"
        if not self.database_url.startswith(prefix):
            return None
        return Path(self.database_url.removeprefix(prefix)).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
