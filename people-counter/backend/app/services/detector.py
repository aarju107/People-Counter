import base64
import logging
from io import BytesIO
from threading import Lock
from time import perf_counter

from PIL import Image, ImageDraw, ImageFont

from app.schemas import CountResponse, Detection

logger = logging.getLogger(__name__)


class PeopleDetector:
    """One model per process; serialize calls because YOLO's predictor is mutable."""

    def __init__(self, model_path: str):
        # Lazy import lets isolated API tests substitute a detector without Torch.
        from ultralytics import YOLO

        logger.info("Loading people detector from %s", model_path)
        self.model = YOLO(model_path)
        self._lock = Lock()
        self.loaded = True

    def detect(self, image: Image.Image, confidence: float) -> CountResponse:
        with self._lock:
            started = perf_counter()
            result = self.model.predict(
                source=image, conf=confidence, classes=[0], verbose=False
            )[0]
            inference_ms = (perf_counter() - started) * 1000
            detections = []
            if result.boxes is not None:
                for box in result.boxes:
                    if int(box.cls.item()) != 0:
                        continue
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    detections.append(Detection(
                        x1=x1, y1=y1, x2=x2, y2=y2,
                        confidence=float(box.conf.item()),
                    ))

        annotated = image.copy()
        draw = ImageDraw.Draw(annotated)
        width = max(2, round(min(image.size) / 250))
        font = ImageFont.load_default(size=max(14, round(image.width / 45)))
        for detection in detections:
            draw.rectangle(
                (detection.x1, detection.y1, detection.x2, detection.y2),
                outline="#16e0ad", width=width,
            )
        label = f"People: {len(detections)}"
        bounds = draw.textbbox((0, 0), label, font=font)
        draw.rectangle((0, 0, bounds[2] + 20, bounds[3] + 20), fill="#102e2b")
        draw.text((10, 10), label, fill="white", font=font)
        output = BytesIO()
        annotated.save(output, format="JPEG", quality=85)
        return CountResponse(
            count=len(detections), detections=detections,
            image_width=image.width, image_height=image.height,
            annotated_image=base64.b64encode(output.getvalue()).decode("ascii"),
            inference_ms=round(inference_ms, 2),
        )
