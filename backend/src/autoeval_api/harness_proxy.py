"""Local streaming recorder in front of CLIProxyAPI. Run with --help for setup."""

import argparse
import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
from time import perf_counter
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from autoeval_api.services.harness_data import REQUEST_FIELDS, RESPONSE_FIELDS, clean_payload

MAX_BYTES = 2_000_000
MAX_SPOOL_BYTES = 100_000_000
LOG = logging.getLogger("autoeval.recorder")
PATHS = {"/v1/chat/completions": "chat", "/v1/responses": "responses", "/v1/messages": "anthropic"}


def loopback_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not parsed.port
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("Use an HTTP loopback origin with an explicit port and no path")
    return value.rstrip("/")


def completed_response(data: bytes, protocol: str, streaming: bool) -> dict:
    if not streaming:
        result = json.loads(data)
        if not isinstance(result, dict):
            raise ValueError("Expected an object response")
        return result
    events = []
    for frame in data.decode("utf-8").replace("\r\n", "\n").split("\n\n"):
        body = "\n".join(
            line[5:].lstrip() for line in frame.splitlines() if line.startswith("data:")
        )
        if body and body != "[DONE]":
            events.append(json.loads(body))
    if protocol == "responses":
        for event in reversed(events):
            if event.get("type") == "response.completed":
                return event["response"]
        raise ValueError("Responses stream did not complete")
    if protocol == "anthropic":
        response, blocks, arguments = {}, {}, {}
        stopped = False
        for event in events:
            kind = event.get("type")
            if kind == "message_start":
                response = event["message"]
            elif kind == "content_block_start":
                blocks[event["index"]] = event["content_block"]
            elif kind == "content_block_delta":
                index, delta = event["index"], event["delta"]
                if delta["type"] == "text_delta":
                    blocks[index]["text"] = blocks[index].get("text", "") + delta["text"]
                elif delta["type"] == "input_json_delta":
                    arguments[index] = arguments.get(index, "") + delta["partial_json"]
            elif kind == "message_delta":
                response.update(event["delta"])
                response.setdefault("usage", {}).update(event.get("usage", {}))
            elif kind == "message_stop":
                stopped = True
        if not stopped:
            raise ValueError("Anthropic stream did not complete")
        for index, value in arguments.items():
            blocks[index]["input"] = json.loads(value)
        response["content"] = [blocks[index] for index in sorted(blocks)]
        return response
    message, calls, finish, usage, model = {"role": "assistant", "content": ""}, {}, None, {}, ""
    for event in events:
        model = event.get("model", model)
        usage = event.get("usage") or usage
        for choice in event.get("choices", []):
            if choice.get("index", 0) != 0:
                raise ValueError("Multi-choice capture is unsupported")
            delta = choice.get("delta", {})
            message["content"] += delta.get("content") or ""
            for call in delta.get("tool_calls", []):
                target = calls.setdefault(
                    call["index"],
                    {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
                )
                if call.get("id"):
                    target["id"] = call["id"]
                for field in ("name", "arguments"):
                    target["function"][field] += call.get("function", {}).get(field, "")
            finish = choice.get("finish_reason") or finish
    if finish is None:
        raise ValueError("Chat stream did not complete")
    if calls:
        message["tool_calls"] = [calls[index] for index in sorted(calls)]
    return {
        "model": model,
        "choices": [{"message": message, "finish_reason": finish}],
        "usage": usage,
    }


def append_capture(path: Path, document: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # No following symlinks and no world-readable captures, including existing files.
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        data = (json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        if os.fstat(descriptor).st_size + len(data) > MAX_SPOOL_BYTES:
            raise ValueError("Capture spool is full; sync and rotate it")
        with os.fdopen(descriptor, "ab", closefd=False) as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    finally:
        os.close(descriptor)


def create_recorder(
    upstream: str,
    output: Path,
    task: str,
    revision: str,
    configuration_hash: str,
    session_id: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    upstream = loopback_url(upstream)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    session_id = session_id or str(uuid4())
    writer = asyncio.Lock()

    @app.api_route("/{path:path}", methods=["POST", "GET"])
    async def forward(path: str, request: Request):
        route = "/" + path
        if (
            request.client is None
            or request.client.host not in {"127.0.0.1", "::1", "testclient"}
            or request.headers.get("origin")
            or request.headers.get("sec-fetch-site")
        ):
            raise HTTPException(403, "Recorder accepts local CLI traffic only")
        if (request.method == "GET" and route != "/v1/models") or (
            request.method == "POST" and route not in PATHS
        ):
            raise HTTPException(404, "Unsupported inference endpoint")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_BYTES:
                raise HTTPException(413, "Request exceeds capture limit")
        try:
            body = json.loads(raw) if raw else {}
            if not isinstance(body, dict):
                raise ValueError()
        except ValueError as error:
            raise HTTPException(400, "Expected a JSON object") from error
        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower()
            in {
                "content-type",
                "authorization",
                "x-api-key",
                "anthropic-version",
                "anthropic-beta",
                "accept",
            }
        }
        client = httpx.AsyncClient(
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=httpx.Timeout(300, connect=5),
        )
        started = perf_counter()
        try:
            response = await client.send(
                client.build_request(
                    request.method,
                    upstream + route,
                    content=bytes(raw),
                    headers=headers,
                ),
                stream=True,
            )
        except httpx.HTTPError as error:
            await client.aclose()
            raise HTTPException(502, "Local inference proxy is unavailable") from error
        if response.is_redirect:
            await response.aclose()
            await client.aclose()
            return Response(status_code=502, content="Proxy redirects are not supported")

        async def stream():
            captured = bytearray()
            oversize = False
            try:
                async for chunk in response.aiter_bytes():
                    if len(captured) + len(chunk) <= MAX_BYTES and not oversize:
                        captured.extend(chunk)
                    else:
                        oversize = True
                        captured.clear()
                    yield chunk
                if request.method != "POST" or response.status_code != 200:
                    return
                if oversize:
                    LOG.warning("Response forwarded but not captured: exceeds size limit")
                    return
                result = completed_response(bytes(captured), PATHS[route], bool(body.get("stream")))
                usage = result.get("usage") or {}
                document = {
                    "schema_version": 1,
                    "request_id": str(uuid4()),
                    "session_id": session_id,
                    "task_key": task,
                    "harness_revision": revision,
                    "configuration_hash": configuration_hash,
                    "model": result.get("model") or body.get("model", "unknown"),
                    "protocol": PATHS[route],
                    "request": clean_payload(body, REQUEST_FIELDS),
                    "response": clean_payload(result, RESPONSE_FIELDS),
                    "latency_ms": (perf_counter() - started) * 1000,
                    "input_tokens": usage.get("input_tokens", usage.get("prompt_tokens")),
                    "output_tokens": usage.get("output_tokens", usage.get("completion_tokens")),
                    "cost_usd": None,
                }
                async with writer:
                    await asyncio.to_thread(append_capture, output, document)
            except (ValueError, KeyError, TypeError, OSError):
                # Never log payloads or credentials. The client already received its answer.
                LOG.warning(
                    "Response forwarded but not captured: incomplete or unsupported payload/spool"
                )
            finally:
                await response.aclose()
                await client.aclose()

        return StreamingResponse(
            stream(),
            status_code=response.status_code,
            headers={"content-type": response.headers.get("content-type", "application/json")},
        )

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    record = sub.add_parser("record")
    record.add_argument("--upstream", default="http://127.0.0.1:8317")
    record.add_argument("--port", type=int, default=8318)
    record.add_argument("--task", required=True)
    record.add_argument("--revision", required=True)
    record.add_argument(
        "--config",
        type=Path,
        required=True,
        help="Non-secret harness settings file; only its SHA-256 is stored",
    )
    record.add_argument("--output", type=Path, default=Path(".autoeval/captures.jsonl"))
    record.add_argument(
        "--capture-content",
        action="store_true",
        required=True,
        help="Opt in to recording prompts, source snippets, and tool results locally",
    )
    sync = sub.add_parser("sync")
    sync.add_argument("--file", type=Path, required=True)
    sync.add_argument("--system", required=True)
    sync.add_argument("--api", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    if args.command == "record":
        digest = hashlib.sha256(args.config.read_bytes()).hexdigest()
        uvicorn.run(
            create_recorder(args.upstream, args.output, args.task, args.revision, digest),
            host="127.0.0.1",
            port=args.port,
            access_log=False,
        )
    else:
        import re

        if not re.fullmatch(r"[a-z][a-z0-9-]{1,99}", args.system):
            parser.error("Invalid system key")
        count = 0
        with (
            httpx.Client(base_url=loopback_url(args.api), trust_env=False, timeout=30) as client,
            args.file.open() as source,
        ):
            while line := source.readline(MAX_BYTES + 1):
                if len(line.encode()) > MAX_BYTES:
                    parser.error("Capture line exceeds the API size limit")
                response = client.post(
                    f"/api/harnesses/{args.system}/captures", json=json.loads(line)
                )
                if response.status_code != 201:
                    raise SystemExit(
                        f"Sync stopped at line {count + 1}: HTTP {response.status_code}. "
                        "Check the task and capture in AutoEval; retries are idempotent."
                    )
                count += 1
        print(f"Synced {count} captures. Review them in AutoEval before training.")


if __name__ == "__main__":
    main()
