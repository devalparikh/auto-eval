"""Canonical immutable-content hashes shared by persistence and local tooling."""

import hashlib
import json
from typing import Any


def hash_json(value: dict[str, Any]) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def hash_text(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
