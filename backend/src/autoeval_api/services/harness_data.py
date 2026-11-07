"""Normalize completed wire responses for reviewed supervised training."""

import json
import re
from typing import Any

# Headers, URLs, credentials, provider metadata and hidden reasoning are never retained.
REQUEST_FIELDS = {
    "model",
    "messages",
    "input",
    "instructions",
    "system",
    "tools",
    "tool_choice",
    "temperature",
    "top_p",
    "max_tokens",
    "max_output_tokens",
    "previous_response_id",
    "seed",
    "stop",
    "reasoning_effort",
    "response_format",
    "max_completion_tokens",
    "parallel_tool_calls",
}
RESPONSE_FIELDS = {"id", "model", "choices", "output", "content", "usage", "stop_reason", "status"}
SECRET = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9_.-]{12,})")


def scrub(value: Any) -> Any:
    if isinstance(value, str):
        return SECRET.sub("[REDACTED]", value)
    if isinstance(value, list):
        return [
            scrub(item)
            for item in value
            if not (
                isinstance(item, dict)
                and isinstance(item.get("type"), str)
                and item.get("type") in {"thinking", "redacted_thinking", "reasoning"}
            )
        ]
    if isinstance(value, dict):
        return {
            key: scrub(item)
            for key, item in value.items()
            if key.lower()
            not in {
                "authorization",
                "api_key",
                "api-key",
                "x-api-key",
                "access_token",
                "refresh_token",
                "reasoning",
                "reasoning_content",
                "thinking",
                "signature",
            }
        }
    return value


def clean_payload(payload: dict, fields: set[str]) -> dict:
    return scrub({key: value for key, value in payload.items() if key in fields})


def anthropic_messages(messages: list[dict]) -> list[dict]:
    result = []
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, str):
            result.append({"role": message["role"], "content": content})
            continue
        texts, calls = [], []
        for block in content:
            kind = block.get("type")
            if kind == "text":
                texts.append(block["text"])
            elif kind == "tool_use":
                calls.append(
                    {
                        "id": block["id"],
                        "type": "function",
                        "function": {
                            "name": block["name"],
                            "arguments": json.dumps(block["input"]),
                        },
                    }
                )
            elif kind == "tool_result":
                output = block["content"]
                if isinstance(output, list):
                    if any(part.get("type") != "text" for part in output):
                        raise ValueError("Only text tool results can be exported for training")
                    output = "\n".join(part["text"] for part in output)
                if block.get("is_error"):
                    output = "Tool error: " + str(output)
                result.append(
                    {"role": "tool", "tool_call_id": block["tool_use_id"], "content": output}
                )
            elif kind not in {None, "thinking", "redacted_thinking"}:
                raise ValueError("Only text and tool messages can be exported for training")
        if texts or calls:
            item = {"role": message["role"], "content": "\n".join(texts)}
            if calls:
                item["tool_calls"] = calls
            result.append(item)
    return result


def response_messages(items: list[dict]) -> list[dict]:
    result = []
    for item in items:
        kind = item.get("type", "message")
        if kind == "message":
            content = item.get("content", "")
            if isinstance(content, list):
                if any(block.get("type") not in {"input_text", "output_text"} for block in content):
                    raise ValueError("Only text Responses messages can be exported")
                content = "\n".join(block["text"] for block in content)
            result.append({"role": item["role"], "content": content})
        elif kind == "function_call":
            call = {
                "id": item["call_id"],
                "type": "function",
                "function": {
                    "name": item["name"],
                    "arguments": item["arguments"],
                },
            }
            if result and result[-1]["role"] == "assistant" and "tool_calls" in result[-1]:
                result[-1]["tool_calls"].append(call)
            else:
                result.append({"role": "assistant", "content": "", "tool_calls": [call]})
        elif kind == "function_call_output":
            result.append(
                {"role": "tool", "tool_call_id": item["call_id"], "content": item["output"]}
            )
        elif kind != "reasoning":
            raise ValueError("Unsupported Responses item; use a full text/tool conversation")
    return result


def training_example(document: dict) -> dict:
    request, response = document["request"], document["response"]
    protocol = document["protocol"]
    tools = request.get("tools", [])
    if protocol == "chat":
        choices = response.get("choices", [])
        if len(choices) != 1 or choices[0].get("finish_reason") not in {"stop", "tool_calls"}:
            raise ValueError("Training requires one complete, successful response")
        messages = request.get("messages", []) + [choices[0]["message"]]
    elif protocol == "anthropic":
        if response.get("stop_reason") not in {"end_turn", "tool_use", "stop_sequence"}:
            raise ValueError("Training requires a complete Anthropic response")
        messages = []
        system = request.get("system")
        if system:
            if isinstance(system, list):
                system = "\n".join(block["text"] for block in system if block.get("type") == "text")
            messages.append({"role": "system", "content": system})
        messages += anthropic_messages(request.get("messages", []))
        messages += anthropic_messages([{"role": "assistant", "content": response["content"]}])
        tools = [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool["input_schema"],
                },
            }
            for tool in tools
        ]
    else:
        if request.get("previous_response_id"):
            raise ValueError("Incremental Responses captures need full history before training")
        if response.get("status") != "completed":
            raise ValueError("Training requires a completed Responses response")
        inputs = request.get("input", [])
        if isinstance(inputs, str):
            inputs = [{"role": "user", "content": inputs}]
        messages = response_messages(inputs)
        if request.get("instructions"):
            messages.insert(0, {"role": "system", "content": request["instructions"]})
        messages += response_messages(response.get("output", []))
        if any(tool.get("type") != "function" for tool in tools):
            raise ValueError("Only function tools can be exported for training")
        tools = [
            {
                "type": "function",
                "function": {
                    key: tool[key] for key in ("name", "description", "parameters") if key in tool
                },
            }
            for tool in tools
        ]
    # Restrict exported message fields. Full context and tool schemas are retained,
    # but provider-specific hidden reasoning and response metadata are excluded.
    messages = [
        {
            key: message[key]
            for key in ("role", "content", "tool_calls", "tool_call_id")
            if key in message
        }
        for message in messages
    ]
    if not messages or messages[-1].get("role") != "assistant":
        raise ValueError("No assistant target found")
    pending: set[str] = set()
    for index, message in enumerate(messages):
        if message.get("role") not in {"system", "developer", "user", "assistant", "tool"}:
            raise ValueError("Unsupported message role")
        if message.get("content") is not None and not isinstance(message["content"], str):
            raise ValueError("Training currently supports text and function tools only")
        if message["role"] == "tool":
            call_id = message.get("tool_call_id")
            if call_id not in pending:
                raise ValueError("Tool result has no matching call in the captured context")
            pending.remove(call_id)
        elif pending:
            raise ValueError("Captured context is missing tool results")
        for call in message.get("tool_calls", []):
            if call.get("type") != "function" or not call.get("id"):
                raise ValueError("Invalid function call")
            if not isinstance(call.get("function", {}).get("arguments"), str):
                raise ValueError("Function arguments must be a JSON string")
            try:
                arguments = json.loads(call["function"]["arguments"])
            except ValueError as error:
                raise ValueError("Function arguments contain incomplete JSON") from error
            if not isinstance(arguments, dict) or not call["function"].get("name"):
                raise ValueError("Function calls need a name and JSON object arguments")
            pending.add(call["id"])
        if index == len(messages) - 1 and not message.get("content") and not pending:
            raise ValueError("Empty assistant target")
    if not any(message["role"] == "user" for message in messages[:-1]):
        raise ValueError("Captured context needs a user message")
    return {"messages": messages, **({"tools": tools} if tools else {})}


def capture_training_example(session, capture) -> dict:
    """Resolve Responses ancestry only within this recorded session and task."""
    from autoeval_api.models import HarnessCaptureRecord

    document = capture.document
    if document["protocol"] != "responses" or not document["request"].get("previous_response_id"):
        return training_example(document)
    chain = [capture]
    visited = {capture.id}
    current = capture
    while previous := current.document["request"].get("previous_response_id"):
        parents = (
            session.query(HarnessCaptureRecord)
            .filter_by(
                agent_system_id=capture.agent_system_id,
                task_id=capture.task_id,
                session_id=capture.session_id,
                provider_response_id=previous,
            )
            .limit(2)
            .all()
        )
        if len(parents) != 1 or parents[0].id in visited or len(chain) >= 1000:
            raise ValueError("Responses history is missing, ambiguous, cyclic, or too long")
        current = parents[0]
        if (
            current.document["protocol"] != "responses"
            or current.document["response"].get("status") != "completed"
        ):
            raise ValueError("Responses ancestry contains an incomplete response")
        chain.append(current)
        visited.add(current.id)
    inputs = []
    for ancestor in reversed(chain):
        supplied = ancestor.document["request"].get("input", [])
        if isinstance(supplied, str):
            supplied = [{"role": "user", "content": supplied}]
        inputs.extend(supplied)
        if ancestor.id != capture.id:
            inputs.extend(ancestor.document["response"].get("output", []))
        if len(json.dumps(inputs).encode()) > 2_000_000:
            raise ValueError("Resolved conversation exceeds the 2 MB training example limit")
    request = {
        key: value for key, value in document["request"].items() if key != "previous_response_id"
    }
    request["input"] = inputs
    return training_example({**document, "request": request})
