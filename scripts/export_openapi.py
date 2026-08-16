"""Export the backend's OpenAPI schema to a JSON file.

The frontend's `src/lib/api-schema.ts` is generated from this document, so the
schema is the single source of truth for the HTTP contract. Run via
`make api-types` (or `npm run generate:api-types` inside `frontend/`).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "frontend" / "openapi.json"


def build_schema() -> dict[str, object]:
    from autoeval_api.app import create_application

    app = create_application(initialize_database=False, seed_on_start=False)
    return app.openapi()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Where to write the OpenAPI document (default: {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args()

    document = json.dumps(build_schema(), indent=2, sort_keys=True) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(document, encoding="utf-8")
    output = args.output.resolve()
    label = output.relative_to(REPO_ROOT) if output.is_relative_to(REPO_ROOT) else output
    print(f"Wrote {label}")


if __name__ == "__main__":
    main()
