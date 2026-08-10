from __future__ import annotations

from ipaddress import ip_address

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from autoeval_api.config import Settings

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
LOCAL_CLIENT_NAMES = {"localhost", "testclient"}


class RequestGuardMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.max_request_bytes = settings.max_request_bytes
        self.allowed_origins = frozenset(settings.web_origins)
        self.enforce_loopback_clients = settings.enforce_loopback_clients

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        length_error = self._content_length_error(headers.get("content-length"))
        if length_error is not None:
            await self._respond(scope, receive, send, length_error[0], length_error[1])
            return
        if not self._client_is_allowed(scope):
            await self._respond(scope, receive, send, 403, "Remote clients are not allowed")
            return
        if not self._origin_is_allowed(scope, headers):
            await self._respond(scope, receive, send, 403, "Cross-origin request is not allowed")
            return

        messages = await self._read_request_messages(receive)
        if messages is None:
            await self._respond(scope, receive, send, 413, "Request body is too large")
            return

        message_index = 0

        async def replay_receive() -> Message:
            nonlocal message_index
            if message_index < len(messages):
                message = messages[message_index]
                message_index += 1
                return message
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay_receive, send)

    def _content_length_error(self, raw_length: str | None) -> tuple[int, str] | None:
        if raw_length is None:
            return None
        try:
            content_length = int(raw_length)
        except ValueError:
            return 400, "Content-Length must be a non-negative integer"
        if content_length < 0:
            return 400, "Content-Length must be a non-negative integer"
        if content_length > self.max_request_bytes:
            return 413, "Request body is too large"
        return None

    def _client_is_allowed(self, scope: Scope) -> bool:
        if not self.enforce_loopback_clients:
            return True
        client = scope.get("client")
        if client is None:
            return True
        host = client[0].lower()
        if host in LOCAL_CLIENT_NAMES:
            return True
        try:
            return ip_address(host).is_loopback
        except ValueError:
            return False

    def _origin_is_allowed(self, scope: Scope, headers: Headers) -> bool:
        origin = headers.get("origin")
        if origin is not None and origin not in self.allowed_origins:
            return False
        fetch_site = headers.get("sec-fetch-site", "").lower()
        return not (scope["method"] in UNSAFE_METHODS and fetch_site == "cross-site")

    async def _read_request_messages(self, receive: Receive) -> list[Message] | None:
        messages: list[Message] = []
        received_bytes = 0
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                return messages
            received_bytes += len(message.get("body", b""))
            if received_bytes > self.max_request_bytes:
                return None
            if not message.get("more_body", False):
                return messages

    @staticmethod
    async def _respond(
        scope: Scope, receive: Receive, send: Send, status_code: int, detail: str
    ) -> None:
        await JSONResponse({"detail": detail}, status_code=status_code)(scope, receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def add_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
                headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, add_headers)
