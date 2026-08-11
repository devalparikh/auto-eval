#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
LEVELS = {"system": 0, "domain": 1, "capability": 2, "component": 3}
RELATIONS = {"depends_on", "calls", "produces", "consumes"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a .codemap logic manifest")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return fail(f"could not read valid JSON: {error}")

    errors: list[str] = []
    warnings: list[str] = []
    if payload.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    components = payload.get("components")
    if not isinstance(components, list) or not components:
        return fail("components must be a non-empty list")

    by_id: dict[str, dict] = {}
    for index, component in enumerate(components):
        if not isinstance(component, dict):
            errors.append(f"components[{index}] must be an object")
            continue
        component_id = component.get("id")
        if not isinstance(component_id, str) or not ID_PATTERN.fullmatch(component_id):
            errors.append(f"components[{index}].id is invalid")
            continue
        if component_id in by_id:
            errors.append(f"duplicate component id: {component_id}")
        by_id[component_id] = component

    for component_id, component in by_id.items():
        validate_component(component_id, component, by_id, args.repo_root, errors, warnings)

    relations = payload.get("relations", [])
    if not isinstance(relations, list):
        errors.append("relations must be a list")
    else:
        validate_relations(relations, by_id, errors)

    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1
    print(
        f"valid logic map: {len(by_id)} components, {len(relations)} relations, "
        f"{len(warnings)} warnings"
    )
    return 0


def validate_component(
    component_id: str,
    component: dict,
    by_id: dict[str, dict],
    repo_root: Path,
    errors: list[str],
    warnings: list[str],
) -> None:
    kind = component.get("kind")
    if kind not in LEVELS:
        errors.append(f"{component_id}: unsupported kind {kind!r}")
        return
    if not isinstance(component.get("label"), str) or not component["label"].strip():
        errors.append(f"{component_id}: label is required")
    if not isinstance(component.get("description"), str) or not component[
        "description"
    ].strip():
        errors.append(f"{component_id}: description is required")

    parent_id = component.get("parent_id")
    level = LEVELS[kind]
    if level == 0 and parent_id is not None:
        errors.append(f"{component_id}: systems cannot have a parent")
    if level > 0:
        parent = by_id.get(parent_id)
        if parent is None or LEVELS.get(parent.get("kind")) != level - 1:
            errors.append(f"{component_id}: parent must be the preceding semantic level")

    paths = component.get("paths", [])
    if not isinstance(paths, list) or not all(isinstance(path, str) for path in paths):
        errors.append(f"{component_id}: paths must be strings")
        return
    for pattern in paths:
        if not pattern or pattern.startswith("/") or ".." in pattern.split("/"):
            errors.append(f"{component_id}: unsafe path pattern {pattern!r}")
        elif not any(repo_root.glob(pattern)):
            warnings.append(f"{component_id}: path pattern matches nothing: {pattern}")


def validate_relations(
    relations: list,
    by_id: dict[str, dict],
    errors: list[str],
) -> None:
    seen: set[tuple[str, str, str]] = set()
    for index, relation in enumerate(relations):
        if not isinstance(relation, dict):
            errors.append(f"relations[{index}] must be an object")
            continue
        source = relation.get("source")
        target = relation.get("target")
        kind = relation.get("kind")
        key = (source, target, kind)
        if source not in by_id or target not in by_id:
            errors.append(f"relations[{index}] references an unknown component")
        if source == target:
            errors.append(f"relations[{index}] cannot point to itself")
        if kind not in RELATIONS:
            errors.append(f"relations[{index}] has unsupported kind {kind!r}")
        if key in seen:
            errors.append(f"relations[{index}] duplicates {key}")
        seen.add(key)


def fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
