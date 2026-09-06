"""`EvaluationService._require_locked_runtime_inputs` and the plugin exemption hook.

Constructs `AgentSystemVersionRecord`/`DatasetItemRecord` directly (unattached
to a session) since the method under test only reads their attributes.
"""

import pytest

from autoeval_api.agent_systems.portfolio_query.market_observation import MARKET_DATA_NODE_ID
from autoeval_api.market_data import OPTIONS_CHAIN_SOURCE
from autoeval_api.models import AgentSystemVersionRecord, DatasetItemRecord
from autoeval_api.services.evaluations import EvaluationService

_LOCKED_DEFINITION = {
    "entry_point": "load_context",
    "output_node": "load_context",
    "nodes": [
        {
            "id": MARKET_DATA_NODE_ID,
            "label": "Load market data",
            "kind": "deterministic",
            "handler": "load_context",
            "runtime_input_policy": {
                "source": OPTIONS_CHAIN_SOURCE,
                "schema_version": 1,
                "runtime_mode": "refresh",
                "evaluation_mode": "locked",
            },
        },
    ],
    "edges": [],
}


def _graph_version(definition: dict) -> AgentSystemVersionRecord:
    return AgentSystemVersionRecord(
        id="version-1",
        agent_system_id="system-1",
        version=1,
        definition=definition,
        content_hash="hash",
    )


def _item(*, market_context: dict | None, snapshot_ids: dict | None = None) -> DatasetItemRecord:
    item_input = {"market_context": market_context} if market_context is not None else {}
    return DatasetItemRecord(
        id="item-1",
        dataset_version_id="dataset-version-1",
        input=item_input,
        expected={},
        runtime_input_snapshot_ids=snapshot_ids or {},
    )


def test_portfolio_query_exempts_legacy_items_with_inline_market_context() -> None:
    graph_version = _graph_version(_LOCKED_DEFINITION)
    item = _item(market_context={"source": "polygon", "contracts": [{"symbol": "AAPL"}]})

    # Does not raise: the Portfolio Query plugin's legacy exemption hook waives
    # the missing snapshot for this one legacy node.
    EvaluationService._require_locked_runtime_inputs(graph_version, item, "portfolio-query")


def test_system_without_the_exemption_hook_fails_closed() -> None:
    graph_version = _graph_version(_LOCKED_DEFINITION)
    item = _item(market_context={"source": "polygon", "contracts": [{"symbol": "AAPL"}]})

    # incident-triage has no `legacy_locked_input_exemptions_module`, so the
    # default (empty set) applies and the missing snapshot is fatal even
    # though the item happens to carry the same inline shape.
    with pytest.raises(RuntimeError, match="missing locked runtime-input snapshots"):
        EvaluationService._require_locked_runtime_inputs(graph_version, item, "incident-triage")


def test_unknown_agent_system_key_also_fails_closed() -> None:
    graph_version = _graph_version(_LOCKED_DEFINITION)
    item = _item(market_context=None)

    with pytest.raises(RuntimeError, match="missing locked runtime-input snapshots"):
        EvaluationService._require_locked_runtime_inputs(graph_version, item, "does-not-exist")
