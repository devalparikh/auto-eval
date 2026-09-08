import pytest
from pydantic import ValidationError

from autoeval_api.config import Settings


def test_settings_parse_csv_environment_values(monkeypatch) -> None:
    monkeypatch.setenv("AUTOEVAL_WEB_ORIGINS", "http://localhost:3000, http://127.0.0.1:3000")
    monkeypatch.setenv("AUTOEVAL_ALLOWED_HOSTS", "localhost,127.0.0.1")
    monkeypatch.setenv(
        "LM_STUDIO_MODELS",
        "openai/gpt-oss-20b, lmstudio/custom-local, openai/gpt-oss-20b",
    )

    settings = Settings(_env_file=None)

    assert settings.web_origins == ["http://localhost:3000", "http://127.0.0.1:3000"]
    assert settings.allowed_hosts == ["localhost", "127.0.0.1"]
    assert settings.lm_studio_models == ["openai/gpt-oss-20b", "custom-local"]


@pytest.mark.parametrize(
    "base_url",
    [
        "https://127.0.0.1:1234/v1",
        "http://lmstudio.example:1234/v1",
        "http://127.0.0.1:1234/api/v1",
        "http://user:password@127.0.0.1:1234/v1",
        "http://127.0.0.1/v1",
    ],
)
def test_settings_reject_non_loopback_lmstudio_base_urls(base_url: str) -> None:
    with pytest.raises(ValidationError, match="LM_STUDIO_BASE_URL"):
        Settings(LM_STUDIO_BASE_URL=base_url, _env_file=None)


def test_settings_require_a_configured_model_when_lmstudio_is_enabled() -> None:
    with pytest.raises(ValidationError, match="LM_STUDIO_MODELS"):
        Settings(ENABLE_LM_STUDIO=True, _env_file=None)


def test_production_settings_fail_closed_without_hosted_controls() -> None:
    with pytest.raises(ValidationError, match="AUTOEVAL_HOSTED_PASSWORD"):
        Settings(AUTOEVAL_ENV="production", _env_file=None)


def test_production_settings_accept_durable_authenticated_profile() -> None:
    settings = Settings(
        AUTOEVAL_ENV="production",
        database_url="postgresql+psycopg://user:password@db.example/autoeval",
        enforce_loopback_clients=False,
        hosted_password="a-long-random-password-over-32-chars",
        allowed_hosts=["autoeval.example"],
        web_origins=["https://autoeval.example"],
        _env_file=None,
    )

    assert settings.production is True


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"database_url": "sqlite:///hosted.db"}, "non-SQLite"),
        ({"ENABLE_CLI_PROVIDERS": True}, "CLI providers"),
        (
            {"ENABLE_LM_STUDIO": True, "LM_STUDIO_MODELS": ["openai/gpt-oss-20b"]},
            "LM Studio",
        ),
        ({"enforce_loopback_clients": True}, "ENFORCE_LOOPBACK_CLIENTS"),
    ],
)
def test_production_settings_reject_unsafe_overrides(override, message) -> None:
    values = {
        "AUTOEVAL_ENV": "production",
        "database_url": "postgresql+psycopg://user:password@db.example/autoeval",
        "enforce_loopback_clients": False,
        "hosted_password": "a-long-random-password-over-32-chars",
        "allowed_hosts": ["autoeval.example"],
        "web_origins": ["https://autoeval.example"],
        "_env_file": None,
        **override,
    }
    with pytest.raises(ValidationError, match=message):
        Settings(**values)
