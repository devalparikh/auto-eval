"""ASGI entrypoint for Vercel's service routing, which preserves request paths."""

from autoeval_api.api.middleware import HostedPrefixMiddleware
from autoeval_api.main import app as application

app = HostedPrefixMiddleware(application)

__all__ = ["app"]
