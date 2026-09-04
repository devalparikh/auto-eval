"""Persistence for trace and span rows.

The runner decides *when* a trace or span should be persisted (a span row must
be visible before its node executes, and re-committed once it finishes, so
that partial traces stay visible mid-run); this module owns *how* that
persistence happens.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.models import TraceRecord, TraceSpanRecord


class TraceRecorder:
    """Owns the session used to persist trace and span rows."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def start_trace(self, trace: TraceRecord) -> None:
        self.session.add(trace)
        self.session.commit()

    def start_span(self, span: TraceSpanRecord) -> None:
        self.session.add(span)
        self.session.commit()

    def finish_span(self, span: TraceSpanRecord) -> None:
        self.session.add(span)
        self.session.commit()

    def finish_trace(
        self,
        trace: TraceRecord,
        runtime_context: GraphRuntimeContext | None,
    ) -> None:
        spans = self.session.query(TraceSpanRecord).filter_by(trace_id=trace.id).all()
        trace.cost_usd = round(sum(span.cost_usd for span in spans), 8)
        trace.input_tokens = sum(span.input_tokens for span in spans)
        trace.output_tokens = sum(span.output_tokens for span in spans)
        if runtime_context is not None:
            trace.runtime_input_snapshot_ids = dict(runtime_context.runtime_input_snapshot_ids)
            trace.node_snapshot_ids = dict(runtime_context.node_snapshot_ids)
            trace.node_resource_selections = dict(runtime_context.node_resource_selections)
        self.session.add(trace)
        self.session.commit()
        self.session.refresh(trace)
