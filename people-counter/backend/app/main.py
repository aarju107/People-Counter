import logging
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.api.routes import router
from app.config import Settings
from app.services.detector import PeopleDetector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    detector_factory: Callable = PeopleDetector,
) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        # Fail startup on model errors rather than advertise a healthy broken service.
        application.state.detector = await run_in_threadpool(detector_factory, settings.model_path)
        logger.info("PeopleCounter ready")
        yield
        application.state.detector = None

    application = FastAPI(title="PeopleCounter", version="1.0.0", lifespan=lifespan)
    application.state.settings = settings
    application.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins,
        allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"],
    )
    application.include_router(router)

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        logger.error("Unhandled request error on %s", request.url.path, exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred."})

    return application


app = create_app()
