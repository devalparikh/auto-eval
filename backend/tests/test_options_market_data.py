from datetime import UTC, datetime

import httpx
import pytest

from autoeval_api.agent_systems.portfolio_query.definition import PORTFOLIO_QUERY_GRAPH
from autoeval_api.config import Settings
from autoeval_api.graph.definition import RuntimeInputMode, parse_graph_definition
from autoeval_api.market_data.options import (
    OptionsChainRequest,
    OptionsMarketDataError,
    TradierOptionsChainProvider,
)


def _request() -> OptionsChainRequest:
    return OptionsChainRequest(
        symbols=("NVDA",),
        min_dte=21,
        max_dte=45,
        is_synthetic=False,
        requested_at=datetime(2026, 8, 10, 16, tzinfo=UTC),
    )


def test_portfolio_market_data_policy_refreshes_runtime_and_locks_evaluations() -> None:
    definition = parse_graph_definition(PORTFOLIO_QUERY_GRAPH)

    runtime_modes = definition.runtime_input_modes(evaluation=False)
    evaluation_modes = definition.runtime_input_modes(evaluation=True)

    assert runtime_modes["load_portfolio_market_data"] == RuntimeInputMode(
        "options_chain", "refresh", 1
    )
    assert evaluation_modes["load_portfolio_market_data"] == RuntimeInputMode(
        "options_chain", "locked", 1
    )


@pytest.mark.asyncio
async def test_tradier_sandbox_normalizes_delayed_chain_and_marks_unknown_events() -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/markets/quotes"):
            return httpx.Response(
                200,
                json={
                    "request_id": "quote-ref",
                    "quotes": {
                        "quote": {
                            "symbol": "NVDA",
                            "last": 150.0,
                            "trade_date": 1786377600000,
                        }
                    },
                },
            )
        if request.url.path.endswith("/markets/options/expirations"):
            return httpx.Response(
                200,
                json={
                    "request_id": "expiry-ref",
                    "expirations": {"date": ["2026-08-20", "2026-09-11", "2026-09-18"]},
                },
            )
        return httpx.Response(
            200,
            json={
                "request_id": "chain-ref",
                "options": {
                    "option": [
                        {
                            "symbol": "NVDA260911C00160000",
                            "option_type": "call",
                            "expiration_date": "2026-09-11",
                            "strike": 160.0,
                            "bid": 3.2,
                            "ask": 3.45,
                            "open_interest": 1800,
                            "contract_size": 100,
                            "bid_date": 1786376700000,
                            "ask_date": 1786376700000,
                        }
                    ]
                },
            },
        )

    settings = Settings(
        AUTOEVAL_ENV="test",
        OPTIONS_MARKET_DATA_PROVIDER="tradier-sandbox",
        TRADIER_API_TOKEN="test-token",
        market_data_max_expirations_per_symbol=1,
    )
    provider = TradierOptionsChainProvider(settings, transport=httpx.MockTransport(respond))

    result = await provider.fetch(_request())

    assert result.provider_id == "tradier-sandbox"
    assert result.source == "tradier-sandbox-delayed"
    assert result.quote_delay_minutes == 15
    assert result.greeks_as_of is None
    assert result.provider_ref == "quote-ref"
    assert result.as_of == datetime.fromtimestamp(1786376700, UTC)
    assert len(result.contracts) == 1
    contract = result.contracts[0]
    assert contract["provider_contract_id"] == "NVDA260911C00160000"
    assert contract["delta"] is None
    assert contract["event_data_known"] is False
    assert contract["earnings_before_expiry"] is None
    assert all(request.headers["Authorization"] == "Bearer test-token" for request in requests)


@pytest.mark.asyncio
async def test_tradier_provider_maps_timeout_to_a_safe_error_code() -> None:
    def timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("secret upstream details")

    settings = Settings(
        AUTOEVAL_ENV="test",
        OPTIONS_MARKET_DATA_PROVIDER="tradier-sandbox",
        TRADIER_API_TOKEN="test-token",
        market_data_timeout_seconds=1,
    )
    provider = TradierOptionsChainProvider(settings, transport=httpx.MockTransport(timeout))

    with pytest.raises(OptionsMarketDataError) as error:
        await provider.fetch(_request())

    assert error.value.code == "provider_timeout"
    assert "secret" not in str(error.value)


@pytest.mark.asyncio
async def test_tradier_provider_requires_credentials_without_making_a_request() -> None:
    calls = 0

    def respond(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    settings = Settings(
        AUTOEVAL_ENV="test",
        OPTIONS_MARKET_DATA_PROVIDER="tradier-sandbox",
    )
    provider = TradierOptionsChainProvider(settings, transport=httpx.MockTransport(respond))

    with pytest.raises(OptionsMarketDataError) as error:
        await provider.fetch(_request())

    assert error.value.code == "credentials_missing"
    assert calls == 0
