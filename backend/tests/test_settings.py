import pytest
from pydantic import ValidationError

from autoeval_api.config import Settings


def test_settings_parse_csv_environment_values(monkeypatch) -> None:
    monkeypatch.setenv("AUTOEVAL_WEB_ORIGINS", "http://localhost:3000, http://127.0.0.1:3000")
    monkeypatch.setenv("AUTOEVAL_ALLOWED_HOSTS", "localhost,127.0.0.1")

    settings = Settings(_env_file=None)

    assert settings.web_origins == ["http://localhost:3000", "http://127.0.0.1:3000"]
    assert settings.allowed_hosts == ["localhost", "127.0.0.1"]


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
        ({"enable_cli_providers": True}, "CLI providers"),
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
