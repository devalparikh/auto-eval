"""Coercion helpers for untrusted JSON-shaped values.

Graph state, snapshot content, and provider payloads all arrive as plain
`dict[str, Any]`, so node handlers and projections constantly need "read this
as a number, or fall back". These are the one implementation of that; keep new
variants here rather than adding a private copy to a module.
"""

from __future__ import annotations

from typing import Any

AMOUNT_PRECISION = 6


def dict_list(value: Any) -> list[dict[str, Any]]:
    """Every mapping in `value`, or an empty list when it is not a list."""
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def string_list(value: Any) -> list[str]:
    """Every item in `value` as a string, or an empty list when it is not a list."""
    return [str(item) for item in value] if isinstance(value, list) else []


def number(value: Any, default: float = 0.0) -> float:
    """`value` as a float, or `default` when it cannot be read as one."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def optional_number(value: Any) -> float | None:
    """`value` as a finite float, or None when it cannot be read as one (NaN included)."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def integer(value: Any, default: int = 0) -> int:
    """`value` as an int, or `default` when it cannot be read as one."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def optional_integer(value: Any) -> int | None:
    """`value` as an int, or None when it cannot be read as one."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def round_amount(value: float) -> float:
    """Round to the precision every persisted money/ratio field shares."""
    return round(value, AMOUNT_PRECISION)
