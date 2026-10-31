import logging
import warnings
from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from app.schemas import CountResponse, HealthResponse

router = APIRouter()
logger = logging.getLogger(__name__)
ALLOWED_TYPES = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


def decode_image(data: bytes, content_type: str, max_pixels: int) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format != ALLOWED_TYPES[content_type]:
                    raise HTTPException(400, "Image contents do not match the declared file type.")
                if source.width * source.height > max_pixels:
                    raise HTTPException(400, "Image dimensions are too large. Resize the photo first.")
                source.load()
                oriented = ImageOps.exif_transpose(source)
                # Flatten transparency onto white before converting to JPEG.
                rgba = oriented.convert("RGBA")
                image = Image.new("RGB", rgba.size, "white")
                image.paste(rgba, mask=rgba.getchannel("A"))
                return image
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise HTTPException(400, "Invalid or unsafe image. Upload a JPEG, PNG, or WebP photo.") from exc


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    return HealthResponse(status="ok", model_loaded=request.app.state.detector.loaded)


@router.post("/api/v1/count", response_model=CountResponse)
async def count_people(
    request: Request,
    file: Annotated[UploadFile, File()],
    conf: Annotated[float | None, Query(ge=0.1, le=0.9)] = None,
) -> CountResponse:
    settings = request.app.state.settings
    try:
        # Read at most limit + 1 bytes; never load an unbounded upload into memory.
        data = await file.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, "Photo exceeds the 10 MB upload limit.")
        if file.content_type not in ALLOWED_TYPES:
            raise HTTPException(400, "Unsupported file type. Use JPEG, PNG, or WebP.")
        image = await run_in_threadpool(
            decode_image, data, file.content_type, settings.max_image_pixels
        )
        try:
            return await run_in_threadpool(
                request.app.state.detector.detect, image,
                conf if conf is not None else settings.confidence_threshold,
            )
        finally:
            image.close()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("People detection failed")
        raise HTTPException(500, "Could not analyze this photo. Please try again.") from exc
    finally:
        await file.close()
