import hashlib
import json
from copy import deepcopy
from typing import Any


def snapshot_content_hash(snapshot: dict[str, Any]) -> str:
    """Hash the supplied immutable document without trusting its claimed identity fields."""
    content = deepcopy(snapshot)
    content.pop("id", None)
    content.pop("content_hash", None)
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()
