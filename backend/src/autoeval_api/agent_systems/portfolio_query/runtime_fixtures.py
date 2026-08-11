from copy import deepcopy

ELIGIBLE_OPTIONS_PAYLOAD = {
    "schema_version": 1,
    "contracts": [
        {
            "provider_contract_id": "NVDA_SYNTH_CALL_160",
            "symbol": "NVDA",
            "option_type": "call",
            "expiry": "synthetic-35d",
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
            "greeks_age_hours": 1.0,
            "multiplier": 100,
        },
        {
            "provider_contract_id": "NVDA_SYNTH_CALL_165",
            "symbol": "NVDA",
            "option_type": "call",
            "expiry": "synthetic-35d",
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
            "greeks_age_hours": 1.0,
            "multiplier": 100,
        },
    ],
}

ELIGIBLE_OPTIONS_PROVENANCE = {
    "source": "supplied-synthetic-option-chain",
    "provider": "recorded-fixture",
    "provider_ref": "synthetic-options-v1",
    "as_of": "2026-08-10T15:00:00Z",
    "fetched_at": "2026-08-10T16:00:00Z",
    "freshness": {
        "status": "fresh",
        "age_seconds": 3600.0,
        "max_age_seconds": 86400.0,
        "quote_delay_minutes": 0,
    },
    "greeks": {
        "status": "available",
        "as_of": "2026-08-10T15:00:00Z",
        "age_seconds": 3600.0,
    },
    "contract_count": 2,
}

STALE_OPTIONS_PAYLOAD = deepcopy(ELIGIBLE_OPTIONS_PAYLOAD)
for _contract in STALE_OPTIONS_PAYLOAD["contracts"]:
    _contract["greeks_age_hours"] = 72.0
    _contract["quote_as_of"] = "2026-08-07T16:00:00Z"

STALE_OPTIONS_PROVENANCE = deepcopy(ELIGIBLE_OPTIONS_PROVENANCE)
STALE_OPTIONS_PROVENANCE.update(
    {
        "as_of": "2026-08-07T16:00:00Z",
        "freshness": {
            "status": "stale",
            "age_seconds": 259200.0,
            "max_age_seconds": 86400.0,
            "quote_delay_minutes": 0,
        },
        "greeks": {
            "status": "available",
            "as_of": "2026-08-07T16:00:00Z",
            "age_seconds": 259200.0,
        },
    }
)
