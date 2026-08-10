from autoeval_api.config import Settings


def test_settings_parse_csv_environment_values(monkeypatch) -> None:
    monkeypatch.setenv("AUTOEVAL_WEB_ORIGINS", "http://localhost:3000, http://127.0.0.1:3000")
    monkeypatch.setenv("AUTOEVAL_ALLOWED_HOSTS", "localhost,127.0.0.1")

    settings = Settings(_env_file=None)

    assert settings.web_origins == ["http://localhost:3000", "http://127.0.0.1:3000"]
    assert settings.allowed_hosts == ["localhost", "127.0.0.1"]
