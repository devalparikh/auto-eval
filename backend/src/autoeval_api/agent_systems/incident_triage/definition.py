INCIDENT_GRAPH = {
    "entry_point": "normalize_input",
    "output_node": "draft_response",
    "nodes": [
        {
            "id": "normalize_input",
            "label": "Normalize input",
            "kind": "deterministic",
            "handler": "normalize_incident",
            "task": None,
        },
        {
            "id": "classify_incident",
            "label": "Classify incident",
            "kind": "llm",
            "handler": "classify_incident",
            "task": "classify_incident",
        },
        {
            "id": "apply_policy",
            "label": "Apply policy",
            "kind": "deterministic",
            "handler": "apply_triage_policy",
            "task": None,
        },
        {
            "id": "draft_response",
            "label": "Draft response",
            "kind": "llm",
            "handler": "draft_response",
            "task": "draft_response",
        },
    ],
    "edges": [
        {"source": "normalize_input", "target": "classify_incident"},
        {"source": "classify_incident", "target": "apply_policy"},
        {"source": "apply_policy", "target": "draft_response"},
    ],
}

INCIDENT_PROMPT = """You are the structured inference layer for an incident-triage graph.

For classify_incident, inspect the normalized incident and return:
{"classification":{
  "severity":"critical|high|medium|low",
  "route":"security|data|platform|payments|support",
  "confidence":0.0,
  "evidence":["short evidence"]
}}

For draft_response, use the classification and deterministic policy and return:
{"output":{
  "severity":"...",
  "route":"...",
  "requires_human":true,
  "response":"short operator-facing action"
}}

Return one JSON object only. Do not invent customer data.
Prefer human review for critical or high severity incidents."""
