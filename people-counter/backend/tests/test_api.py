import base64
from io import BytesIO
from threading import Lock
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app
from app.services.detector import PeopleDetector


def image_bytes(format="PNG", orientation=None):
    stream = BytesIO()
    with Image.new("RGB", (80, 40), "white") as image:
        if orientation is not None:
            exif = image.getexif()
            exif[274] = orientation
            image.save(stream, format=format, exif=exif)
        else:
            image.save(stream, format=format)
    return stream.getvalue()


@pytest.fixture
def client():
    # Exercise real annotation/serialization while isolating model inference.
    detector = PeopleDetector.__new__(PeopleDetector)
    detector.loaded = True
    detector._lock = Lock()
    detector.calls = []

    def predict(**kwargs):
        detector.calls.append(kwargs)
        return [SimpleNamespace(boxes=[])]

    detector.model = SimpleNamespace(predict=predict)
    app = create_app(Settings(_env_file=None), lambda _: detector)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        test_client.detector = detector
        yield test_client


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "model_loaded": True}


@pytest.mark.parametrize("format,mime", [("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")])
def test_valid_image(client, format, mime):
    response = client.post("/api/v1/count", files={"file": ("photo", image_bytes(format), mime)})
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["count"], int) and body["count"] >= 0
    assert body["count"] == len(body["detections"])
    assert (body["image_width"], body["image_height"]) == (80, 40)
    assert body["inference_ms"] >= 0
    with Image.open(BytesIO(base64.b64decode(body["annotated_image"]))) as annotated:
        assert annotated.format == "JPEG"
        assert annotated.size == (80, 40)
    assert client.detector.calls[-1]["classes"] == [0]
    assert client.detector.calls[-1]["conf"] == 0.4


@pytest.mark.parametrize("mime,data", [
    ("text/plain", b"hello"), ("image/jpeg", b"not an image"),
    ("image/gif", image_bytes("GIF")), ("image/jpeg", image_bytes("PNG")),
    ("image/png", b""), ("image/png", image_bytes()[:30]),
])
def test_non_image(client, mime, data):
    response = client.post("/api/v1/count", files={"file": ("photo", data, mime)})
    assert response.status_code == 400
    assert "detail" in response.json()


def test_oversized_file(client):
    response = client.post("/api/v1/count", files={
        "file": ("large.jpg", b"x" * (10 * 1024 * 1024 + 1), "image/jpeg")
    })
    assert response.status_code == 413


def test_exif_orientation(client):
    response = client.post("/api/v1/count", files={
        "file": ("rotated.jpg", image_bytes("JPEG", orientation=6), "image/jpeg")
    })
    assert response.status_code == 200
    assert (response.json()["image_width"], response.json()["image_height"]) == (40, 80)


@pytest.mark.parametrize("conf", [0.1, 0.7, 0.9])
def test_confidence_override(client, conf):
    response = client.post(f"/api/v1/count?conf={conf}", files={"file": ("p.png", image_bytes(), "image/png")})
    assert response.status_code == 200
    assert client.detector.calls[-1]["conf"] == conf


@pytest.mark.parametrize("conf", [0, 1, "bad", "nan", "inf"])
def test_invalid_confidence(client, conf):
    response = client.post(f"/api/v1/count?conf={conf}", files={"file": ("p.png", image_bytes(), "image/png")})
    assert response.status_code == 422


def test_missing_file(client):
    assert client.post("/api/v1/count").status_code == 422


def test_counts_people_and_filters_other_classes(client):
    class Scalar:
        def __init__(self, value):
            self.value = value
        def item(self):
            return self.value

    class Coordinates:
        def tolist(self):
            return [10, 5, 30, 35]

    person = SimpleNamespace(cls=Scalar(0), conf=Scalar(0.91), xyxy=[Coordinates()])
    car = SimpleNamespace(cls=Scalar(2), conf=Scalar(0.99), xyxy=[Coordinates()])
    client.detector.model.predict = lambda **_: [SimpleNamespace(boxes=[person, car])]
    response = client.post("/api/v1/count", files={"file": ("p.png", image_bytes(), "image/png")})
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["detections"] == [{
        "x1": 10, "y1": 5, "x2": 30, "y2": 35, "confidence": 0.91,
    }]


def test_large_dimensions(client):
    client.app.state.settings.max_image_pixels = 100
    response = client.post("/api/v1/count", files={"file": ("p.png", image_bytes(), "image/png")})
    assert response.status_code == 400


def test_inference_error_is_clean(client):
    def fail(**kwargs):
        raise RuntimeError("private internal error")
    client.detector.model.predict = fail
    response = client.post("/api/v1/count", files={"file": ("p.png", image_bytes(), "image/png")})
    assert response.status_code == 500
    assert response.json() == {"detail": "Could not analyze this photo. Please try again."}


def test_cors_preflight(client):
    response = client.options("/api/v1/count", headers={
        "Origin": "http://localhost:8081", "Access-Control-Request-Method": "POST"
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"


@pytest.mark.integration
def test_real_yolov8_end_to_end():
    # First run downloads yolov8n.pt. All input images are generated in memory.
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.get("/health").json()["model_loaded"] is True
        response = client.post("/api/v1/count", files={"file": ("blank.png", image_bytes(), "image/png")})
        assert response.status_code == 200
        body = response.json()
        assert isinstance(body["count"], int) and body["count"] == 0
        assert body["detections"] == []
        assert base64.b64decode(body["annotated_image"]).startswith(b"\xff\xd8")
