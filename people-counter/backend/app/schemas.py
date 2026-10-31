from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool


class Detection(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float = Field(ge=0, le=1)


class CountResponse(BaseModel):
    count: int = Field(ge=0)
    detections: list[Detection]
    image_width: int
    image_height: int
    annotated_image: str
    inference_ms: float = Field(ge=0)
