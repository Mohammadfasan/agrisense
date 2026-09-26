"""FastAPI application factory and ASGI entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.config import Settings, get_settings
from app.core.inference_config import get_inference_config
from app.services.disease_model import load_model_state


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Runs once when the server starts, before any request is served.

    - An invalid inference.yaml raises here, so the service does not start
      (a wrong threshold must never serve).
    - A missing or altered model does NOT stop the service: it starts
      not-ready, and /ready returns 503 with the reason.
    """
    settings = get_settings()
    config = get_inference_config()
    app.state.model_state = load_model_state(settings, config)
    yield


def create_app() -> FastAPI:
    """Build the ASGI application. Model loading happens in `lifespan`, not here."""
    settings: Settings = get_settings()

    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    app = FastAPI(
        title="AgriSense ML Service",
        description="Disease classification and yield forecasting for AgriSense.",
        version="0.1.0",
        docs_url="/docs",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    return app


app = create_app()
