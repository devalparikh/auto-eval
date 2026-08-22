import pytest
from pydantic import ValidationError

from autoeval_api.graph.definition import (
    AgentGraphDefinition,
    RuntimeInputMode,
    parse_graph_definition,
)

DEFINITION = {
    "entry_point": "load_context",
    "output_node": "answer",
    "nodes": [
        {
            "id": "load_context",
            "label": "Load context",
            "kind": "deterministic",
            "handler": "load_context",
            "runtime_input_policy": {
                "source": "options_chain",
                "schema_version": 2,
                "runtime_mode": "refresh",
                "evaluation_mode": "locked",
            },
        },
        {
            "id": "answer",
            "label": "Answer",
            "kind": "llm",
            "handler": "answer",
            "prompt_key": "answer-prompt",
        },
    ],
    "edges": [{"source": "load_context", "target": "answer"}],
}


def test_parse_is_idempotent() -> None:
    parsed = parse_graph_definition(DEFINITION)
    assert parse_graph_definition(parsed) is parsed


def test_unknown_keys_are_rejected_at_the_parse_boundary() -> None:
    with pytest.raises(ValidationError):
        parse_graph_definition({**DEFINITION, "unexpected": True})


def test_runtime_input_modes_follow_the_origin() -> None:
    definition = parse_graph_definition(DEFINITION)

    assert definition.runtime_input_modes(evaluation=False) == {
        "load_context": RuntimeInputMode("options_chain", "refresh", 2)
    }
    assert definition.runtime_input_modes(evaluation=True) == {
        "load_context": RuntimeInputMode("options_chain", "locked", 2)
    }


def test_lookups_expose_the_blueprint_without_dict_walking() -> None:
    definition = parse_graph_definition(DEFINITION)

    assert definition.prompt_keys() == {"answer-prompt"}
    assert definition.resource_policies() == {}
    assert definition.node("answer").kind == "llm"
    assert definition.node("missing") is None


def test_validate_references_rejects_a_prompt_key_on_a_deterministic_node() -> None:
    definition = AgentGraphDefinition.model_validate(
        {
            **DEFINITION,
            "nodes": [
                {**DEFINITION["nodes"][0], "prompt_key": "answer-prompt"},
                DEFINITION["nodes"][1],
            ],
        }
    )

    with pytest.raises(ValueError, match="Only LLM nodes"):
        definition.validate_references()
