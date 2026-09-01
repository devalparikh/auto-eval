"""ASGI entrypoint for hosted deployments.

Vercel loads `main:app` from the backend service root (see `vercel.json`).
The application itself lives in the installed `autoeval_api` package.
"""

from autoeval_api.main import app

__all__ = ["app"]
