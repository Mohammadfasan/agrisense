from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

# Content-Length covers the whole multipart body: file + boundaries + headers.
MULTIPART_OVERHEAD = 64 * 1024


def add_body_size_limit(app: FastAPI, max_bytes: int, paths: frozenset[str]) -> None:
    limit = max_bytes + MULTIPART_OVERHEAD
    max_mb = max_bytes / (1024 * 1024)

    @app.middleware("http")
    async def _limit_body_size(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method == "POST" and request.url.path in paths:
            length = request.headers.get("content-length")
            if length is None:
                return JSONResponse(
                    status_code=411, content={"detail": "Content-Length header is required"}
                )
            if not length.isdigit() or int(length) > limit:
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"the upload is too large; maximum {max_mb:.0f} MB"},
                )
        return await call_next(request)
