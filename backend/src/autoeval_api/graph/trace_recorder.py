"""Persistence for trace and span rows.

The runner decides *when* a trace or span should be persisted (a span row must
be visible before its node executes, and re-committed once it finishes, so
that partial traces stay visible mid-run); this module owns *how* that
persistence happens.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from autoeval_api.config import Settings, get_settings
from autoeval_api.graph.context import GraphRuntimeContext
from autoeval_api.models import TraceRecord, TraceSpanRecord
from autoeval_api.redaction import redact_payload, redact_text


class TraceRecorder:
    """Owns the session used to persist trace and span rows."""

    def __init__(self, session: Session, settings: Settings | None = None) -> None:
        self.session = session
        self.secrets = (settings or get_settings()).trace_secrets()

    def _redact(self, record: TraceRecord | TraceSpanRecord) -> None:
        for field in ("request_input", "input", "output", "snapshot_metadata"):
            if hasattr(record, field):
                setattr(record, field, redact_payload(getattr(record, field), self.secrets))
        for field in ("error", "system_prompt"):
            value = getattr(record, field, None)
            if value is not None:
                setattr(record, field, redact_text(value, self.secrets))

    def start_trace(self, trace: TraceRecord) -> None:
        self._redact(trace)
        self.session.add(trace)
        self.session.commit()

    def start_span(self, span: TraceSpanRecord) -> None:
        self._redact(span)
        self.session.add(span)
        self.session.commit()

    def finish_span(self, span: TraceSpanRecord) -> None:
        self._redact(span)
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
        self._redact(trace)
        self.session.add(trace)
        self.session.commit()
        self.session.refresh(trace)
