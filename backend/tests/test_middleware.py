from fastapi.testclient import TestClient

from autoeval_api.app import create_application
from autoeval_api.config import Settings


def _guarded_client(
    session_factory,
    max_request_bytes: int = 2_000_000,
    client_address: tuple[str, int] = ("testclient", 50000),
) -> TestClient:
    settings = Settings(
        AUTOEVAL_ENV="test",
        database_url="sqlite://",
        web_origins=["http://localhost:3000"],
        allowed_hosts=["testserver"],
        max_request_bytes=max_request_bytes,
    )
    return TestClient(
        create_application(
            settings=settings,
            session_factory=session_factory,
            initialize_database=False,
            seed_on_start=False,
        ),
        client=client_address,
    )


def test_guard_rejects_invalid_content_length(session_factory) -> None:
    with _guarded_client(session_factory) as client:
        response = client.get("/api/health", headers={"Content-Length": "invalid"})

    assert response.status_code == 400


def test_guard_counts_received_body_bytes(session_factory) -> None:
    with _guarded_client(session_factory, max_request_bytes=32) as client:
        response = client.post(
            "/api/traces/run",
            content=b'{"input":{"text":"this body exceeds thirty-two bytes"}}',
            headers={"Content-Type": "application/json", "Content-Length": "1"},
        )

    assert response.status_code == 413


def test_guard_rejects_disallowed_origin(session_factory) -> None:
    with _guarded_client(session_factory) as client:
        response = client.get("/api/catalog", headers={"Origin": "https://example.com"})

    assert response.status_code == 403


def test_guard_rejects_cross_site_unsafe_method(session_factory) -> None:
    with _guarded_client(session_factory) as client:
        response = client.post(
            "/api/traces/run",
            json={"input": {"text": "test"}},
            headers={
                "Origin": "http://localhost:3000",
                "Sec-Fetch-Site": "cross-site",
            },
        )

    assert response.status_code == 403


def test_originless_local_request_is_allowed(session_factory) -> None:
    with _guarded_client(session_factory) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_guard_rejects_non_loopback_client(session_factory) -> None:
    with _guarded_client(session_factory, client_address=("203.0.113.10", 50000)) as client:
        response = client.get("/api/health")

    assert response.status_code == 403
