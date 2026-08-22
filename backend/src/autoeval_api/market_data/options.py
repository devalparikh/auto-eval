from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

import httpx

from autoeval_api.coerce import optional_integer, optional_number
from autoeval_api.config import Settings
from autoeval_api.graph.runtime_inputs import RuntimeInputCapabilityRegistry

OPTIONS_CHAIN_SOURCE = "options_chain"
_SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9./-]{0,9}$")


@dataclass(frozen=True)
class OptionsChainRequest:
    symbols: tuple[str, ...]
    min_dte: int
    max_dte: int
    is_synthetic: bool
    requested_at: datetime


@dataclass(frozen=True)
class OptionsChainResult:
    provider_id: str
    source: str
    provider_ref: str | None
    as_of: datetime
    fetched_at: datetime
    quote_delay_minutes: int
    greeks_as_of: datetime | None
    contracts: tuple[dict[str, Any], ...]


class OptionsMarketDataError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class OptionsChainProvider(Protocol):
    provider_id: str

    async def fetch(self, request: OptionsChainRequest) -> OptionsChainResult: ...


class OptionsMarketDataRuntimeCapability:
    def __init__(
        self,
        configured_provider_id: str,
        providers: list[OptionsChainProvider],
    ) -> None:
        self.configured_provider_id = configured_provider_id
        self._providers = {provider.provider_id: provider for provider in providers}

    async def refresh(self, request: OptionsChainRequest) -> OptionsChainResult:
        provider_id = "synthetic" if request.is_synthetic else self.configured_provider_id
        if provider_id == "unconfigured":
            raise OptionsMarketDataError(
                "provider_unconfigured",
                "Live options market data is not configured",
            )
        provider = self._providers.get(provider_id)
        if provider is None:
            raise OptionsMarketDataError(
                "provider_unavailable",
                f"Options market-data provider is unavailable: {provider_id}",
            )
        return await provider.fetch(request)


class SyntheticOptionsChainProvider:
    provider_id = "synthetic"

    async def fetch(self, request: OptionsChainRequest) -> OptionsChainResult:
        fetched_at = request.requested_at.astimezone(UTC)
        expiry = fetched_at.date() + timedelta(days=35)
        contracts = (
            {
                "provider_contract_id": "NVDA_SYNTH_CALL_160",
                "symbol": "NVDA",
                "option_type": "call",
                "expiry": expiry.isoformat(),
                "dte": 35,
                "strike": 160.0,
                "underlying_price": 150.0,
                "bid": 3.2,
                "ask": 3.45,
                "delta": 0.22,
                "open_interest": 1800,
                "earnings_before_expiry": False,
                "event_data_known": True,
                "quote_timestamp_available": True,
                "underlying_timestamp_available": True,
                "greeks_age_hours": 0.0,
                "multiplier": 100,
            },
            {
                "provider_contract_id": "NVDA_SYNTH_CALL_165",
                "symbol": "NVDA",
                "option_type": "call",
                "expiry": expiry.isoformat(),
                "dte": 35,
                "strike": 165.0,
                "underlying_price": 150.0,
                "bid": 2.15,
                "ask": 2.55,
                "delta": 0.16,
                "open_interest": 900,
                "earnings_before_expiry": False,
                "event_data_known": True,
                "quote_timestamp_available": True,
                "underlying_timestamp_available": True,
                "greeks_age_hours": 0.0,
                "multiplier": 100,
            },
        )
        return OptionsChainResult(
            provider_id=self.provider_id,
            source="synthetic-generated-options-chain",
            provider_ref="synthetic-options-v1",
            as_of=fetched_at,
            fetched_at=fetched_at,
            quote_delay_minutes=0,
            greeks_as_of=fetched_at,
            contracts=contracts,
        )


class TradierOptionsChainProvider:
    """Tradier Brokerage or sandbox options-chain adapter.

    The sandbox feed is explicitly delayed and does not advertise Greeks. The
    production feed is real-time for brokerage account holders; supplied Greeks
    are hourly rather than quote-time observations.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.environment = (
            "production"
            if settings.options_market_data_provider == "tradier-production"
            else "sandbox"
        )
        self.provider_id = f"tradier-{self.environment}"
        self.token = settings.tradier_api_token
        self.base_url = (
            "https://api.tradier.com/v1"
            if self.environment == "production"
            else "https://sandbox.tradier.com/v1"
        )
        self.timeout_seconds = settings.market_data_timeout_seconds
        self.max_symbols = settings.market_data_max_symbols
        self.max_expirations = settings.market_data_max_expirations_per_symbol
        self.max_contracts = settings.market_data_max_contracts
        self.max_response_bytes = settings.market_data_max_response_bytes
        self.transport = transport

    async def fetch(self, request: OptionsChainRequest) -> OptionsChainResult:
        if not self.token:
            raise OptionsMarketDataError(
                "credentials_missing",
                "TRADIER_API_TOKEN is required for live options market data",
            )
        symbols = tuple(dict.fromkeys(_valid_symbol(item) for item in request.symbols))
        symbols = tuple(item for item in symbols if item)[: self.max_symbols]
        if not symbols:
            raise OptionsMarketDataError("symbols_missing", "No eligible symbols were supplied")

        timeout = httpx.Timeout(self.timeout_seconds, connect=min(5, self.timeout_seconds))
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "User-Agent": "AutoEval/0.1",
        }
        contracts: list[dict[str, Any]] = []
        provider_refs: list[str] = []
        quote_times: list[datetime] = []
        greeks_times: list[datetime] = []
        fetched_at = datetime.now(UTC)
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=headers,
                timeout=timeout,
                transport=self.transport,
                follow_redirects=False,
            ) as client:
                for symbol in symbols:
                    quote_body = await self._get_json(
                        client,
                        "/markets/quotes",
                        {"symbols": symbol, "greeks": "false"},
                    )
                    provider_refs.extend(_provider_refs(quote_body))
                    underlying = _underlying_quote(quote_body, symbol)
                    quote_time = _quote_time(underlying)
                    if quote_time is not None:
                        quote_times.append(quote_time)
                    underlying_price = _underlying_price(underlying)
                    if underlying_price <= 0:
                        continue

                    expiration_body = await self._get_json(
                        client,
                        "/markets/options/expirations",
                        {
                            "symbol": symbol,
                            "includeAllRoots": "true",
                            "strikes": "false",
                            "contractSize": "true",
                        },
                    )
                    provider_refs.extend(_provider_refs(expiration_body))
                    expirations = _selected_expirations(
                        expiration_body,
                        request.requested_at.date(),
                        request.min_dte,
                        request.max_dte,
                        self.max_expirations,
                    )
                    for expiration in expirations:
                        chain_body = await self._get_json(
                            client,
                            "/markets/options/chains",
                            {
                                "symbol": symbol,
                                "expiration": expiration.isoformat(),
                                "greeks": "true",
                            },
                        )
                        provider_refs.extend(_provider_refs(chain_body))
                        for option in _option_quotes(chain_body):
                            normalized = _tradier_contract(
                                option,
                                symbol,
                                underlying_price,
                                quote_time,
                                request.requested_at.date(),
                            )
                            if normalized is None:
                                continue
                            normalized["greeks_age_hours"] = (
                                max(0.0, (fetched_at - greeks_time).total_seconds()) / 3600
                                if (greeks_time := _greeks_time(option)) is not None
                                else None
                            )
                            contracts.append(normalized)
                            option_time = _quote_time(option)
                            if option_time is not None:
                                quote_times.append(option_time)
                            if greeks_time is not None:
                                greeks_times.append(greeks_time)
                            if len(contracts) >= self.max_contracts:
                                break
                        if len(contracts) >= self.max_contracts:
                            break
                    if len(contracts) >= self.max_contracts:
                        break
        except httpx.TimeoutException as error:
            raise OptionsMarketDataError(
                "provider_timeout", "Tradier options market-data request timed out"
            ) from error
        except httpx.RequestError as error:
            raise OptionsMarketDataError(
                "provider_network_error", "Tradier options market-data request failed"
            ) from error

        if not contracts:
            raise OptionsMarketDataError(
                "contracts_unavailable",
                "Tradier returned no option contracts in the configured DTE window",
            )
        contracts.sort(
            key=lambda item: (
                item["symbol"],
                item["expiry"],
                item["strike"],
                item["provider_contract_id"],
            )
        )
        return OptionsChainResult(
            provider_id=self.provider_id,
            source=(
                "tradier-brokerage-realtime"
                if self.environment == "production"
                else "tradier-sandbox-delayed"
            ),
            provider_ref=provider_refs[0] if provider_refs else None,
            as_of=min(quote_times) if quote_times else fetched_at,
            fetched_at=fetched_at,
            quote_delay_minutes=0 if self.environment == "production" else 15,
            greeks_as_of=max(greeks_times) if greeks_times else None,
            contracts=tuple(contracts),
        )

    async def _get_json(
        self,
        client: httpx.AsyncClient,
        path: str,
        params: dict[str, str],
    ) -> dict[str, Any]:
        response = await client.get(path, params=params)
        if len(response.content) > self.max_response_bytes:
            raise OptionsMarketDataError(
                "provider_response_too_large", "Tradier response exceeded the configured limit"
            )
        if response.status_code == 429:
            raise OptionsMarketDataError("provider_rate_limited", "Tradier rate limit exceeded")
        if response.status_code in {401, 403}:
            raise OptionsMarketDataError(
                "provider_authentication_failed", "Tradier rejected the configured credentials"
            )
        if response.status_code >= 400:
            raise OptionsMarketDataError(
                "provider_http_error", f"Tradier request failed with HTTP {response.status_code}"
            )
        try:
            body = response.json()
        except ValueError as error:
            raise OptionsMarketDataError(
                "provider_invalid_response", "Tradier returned invalid JSON"
            ) from error
        if not isinstance(body, dict):
            raise OptionsMarketDataError(
                "provider_invalid_response", "Tradier returned an invalid response shape"
            )
        return body


def default_runtime_input_registry(settings: Settings) -> RuntimeInputCapabilityRegistry:
    providers: list[OptionsChainProvider] = [SyntheticOptionsChainProvider()]
    if settings.options_market_data_provider.startswith("tradier-"):
        providers.append(TradierOptionsChainProvider(settings))
    capability = OptionsMarketDataRuntimeCapability(
        settings.options_market_data_provider,
        providers,
    )
    registry = RuntimeInputCapabilityRegistry()
    registry.register(OPTIONS_CHAIN_SOURCE, capability)
    return registry


def _valid_symbol(value: str) -> str:
    normalized = str(value).strip().upper()
    return normalized if _SYMBOL_PATTERN.fullmatch(normalized) else ""


def _provider_refs(body: dict[str, Any]) -> list[str]:
    request_id = body.get("request_id")
    return [str(request_id)] if request_id else []


def _quote_values(body: dict[str, Any]) -> list[dict[str, Any]]:
    quotes = body.get("quotes")
    quote = quotes.get("quote") if isinstance(quotes, dict) else None
    if isinstance(quote, dict):
        return [quote]
    return [item for item in quote if isinstance(item, dict)] if isinstance(quote, list) else []


def _underlying_quote(body: dict[str, Any], symbol: str) -> dict[str, Any]:
    return next(
        (item for item in _quote_values(body) if str(item.get("symbol", "")).upper() == symbol),
        {},
    )


def _underlying_price(quote: dict[str, Any]) -> float:
    last = optional_number(quote.get("last"))
    if last is not None and last > 0:
        return last
    bid = optional_number(quote.get("bid"))
    ask = optional_number(quote.get("ask"))
    if bid is not None and ask is not None and bid > 0 and ask >= bid:
        return (bid + ask) / 2
    return 0


def _selected_expirations(
    body: dict[str, Any],
    today: date,
    min_dte: int,
    max_dte: int,
    limit: int,
) -> list[date]:
    expirations = body.get("expirations")
    values = expirations.get("date") if isinstance(expirations, dict) else None
    if isinstance(values, str):
        values = [values]
    parsed = sorted(
        value
        for item in values or []
        if (value := _parse_date(item)) is not None and min_dte <= (value - today).days <= max_dte
    )
    return parsed[:limit]


def _option_quotes(body: dict[str, Any]) -> list[dict[str, Any]]:
    options = body.get("options")
    option = options.get("option") if isinstance(options, dict) else None
    if isinstance(option, dict):
        return [option]
    return [item for item in option if isinstance(item, dict)] if isinstance(option, list) else []


def _tradier_contract(
    option: dict[str, Any],
    symbol: str,
    underlying_price: float,
    underlying_quote_as_of: datetime | None,
    today: date,
) -> dict[str, Any] | None:
    expiration = _parse_date(option.get("expiration_date"))
    contract_id = str(option.get("symbol", "")).strip()
    if expiration is None or not contract_id:
        return None
    greeks = option.get("greeks") if isinstance(option.get("greeks"), dict) else {}
    quote_as_of = _quote_time(option)
    greeks_as_of = _greeks_time(option)
    return {
        "provider_contract_id": contract_id,
        "symbol": symbol,
        "option_type": str(option.get("option_type", "")).lower(),
        "expiry": expiration.isoformat(),
        "dte": (expiration - today).days,
        "strike": optional_number(option.get("strike")),
        "underlying_price": underlying_price,
        "bid": optional_number(option.get("bid")),
        "ask": optional_number(option.get("ask")),
        "delta": optional_number(greeks.get("delta")) if greeks_as_of is not None else None,
        "open_interest": optional_integer(option.get("open_interest")),
        "earnings_before_expiry": None,
        "event_data_known": False,
        "quote_timestamp_available": quote_as_of is not None,
        "underlying_timestamp_available": underlying_quote_as_of is not None,
        "quote_as_of": quote_as_of.isoformat() if quote_as_of is not None else None,
        "greeks_as_of": greeks_as_of.isoformat() if greeks_as_of is not None else None,
        "multiplier": optional_integer(option.get("contract_size")) or 100,
    }


def _quote_time(value: dict[str, Any]) -> datetime | None:
    times = [
        parsed
        for key in ("bid_date", "ask_date", "trade_date")
        if (parsed := _timestamp(value.get(key))) is not None
    ]
    return max(times) if times else None


def _greeks_time(value: dict[str, Any]) -> datetime | None:
    greeks = value.get("greeks")
    return _timestamp(greeks.get("updated_at")) if isinstance(greeks, dict) else None


def _timestamp(value: Any) -> datetime | None:
    if isinstance(value, (int, float)):
        seconds = float(value) / 1000 if value > 10_000_000_000 else float(value)
        try:
            return datetime.fromtimestamp(seconds, UTC)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or UTC).astimezone(UTC)


def _parse_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None
