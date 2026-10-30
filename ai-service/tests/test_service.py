from dataclasses import replace
import asyncio
import io
import json

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app import main
from app.config import settings
from app.image_validation import ImageValidationError, decode_image
from app.inference import Classifier, CATEGORIES, _validate_manifest
from app.main import UploadBodyLimitMiddleware


def png_bytes(size=(8, 8), color="green"):
    buffer = io.BytesIO()
    Image.new("RGB", size, color=color).save(buffer, format="PNG")
    return buffer.getvalue()


def client_for(monkeypatch, tmp_path, *, max_bytes=None, max_pixels=None, classifier=None):
    config = replace(
        settings,
        model_dir=tmp_path,
        max_upload_bytes=max_bytes or settings.max_upload_bytes,
        max_image_pixels=max_pixels or settings.max_image_pixels,
    )
    monkeypatch.setattr(main, "settings", config)
    return TestClient(main.create_app(classifier or Classifier(config)), raise_server_exceptions=False)


def test_health_reports_service_up_but_missing_model_not_ready(monkeypatch, tmp_path):
    with client_for(monkeypatch, tmp_path) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "model": {
            "ready": False,
            "model_name": None,
            "model_version": None,
            "reason": "model_not_configured",
        },
    }


def test_valid_image_is_decoded_as_rgb():
    decoded = decode_image(png_bytes(), max_pixels=1024)
    assert decoded.mode == "RGB"
    assert decoded.size == (8, 8)


@pytest.mark.parametrize(
    ("payload", "status"),
    [
        (b"", 400),
        (b"not an image", 400),
    ],
)
def test_empty_and_corrupt_images_are_rejected(payload, status):
    with pytest.raises(ImageValidationError) as error:
        decode_image(payload, max_pixels=1024)
    assert error.value.status_code == status


def test_unsupported_format_and_mime_extension_spoof_are_rejected():
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buffer, format="GIF")
    with pytest.raises(ImageValidationError) as error:
        decode_image(buffer.getvalue(), max_pixels=1024)
    assert error.value.status_code == 415

    with pytest.raises(ImageValidationError) as spoofed:
        decode_image(b"not actually a png", max_pixels=1024)
    assert spoofed.value.status_code == 400


def test_upload_size_limit_is_enforced(monkeypatch, tmp_path):
    payload = png_bytes()
    limit = len(payload) - 1
    with client_for(monkeypatch, tmp_path, max_bytes=limit) as client:
        response = client.post(
            "/api/classify",
            files={"image": ("picture.png", payload, "image/png")},
        )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "upload_too_large"


def test_chunked_multipart_body_is_capped_without_content_length():
    chunks = [
        {"type": "http.request", "body": b"x" * 40_000, "more_body": True},
        {"type": "http.request", "body": b"x" * 40_000, "more_body": True},
    ]
    messages = []

    async def receive():
        return chunks.pop(0)

    async def send(message):
        messages.append(message)

    async def downstream(_scope, inner_receive, _send):
        await inner_receive()
        await inner_receive()

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/classify",
        "headers": [(b"content-type", b"multipart/form-data; boundary=test")],
    }
    middleware = UploadBodyLimitMiddleware(downstream, max_bytes=1024)
    asyncio.run(middleware(scope, receive, send))
    assert messages[0]["status"] == 413


def test_excessive_pixel_dimensions_are_rejected(monkeypatch, tmp_path):
    with client_for(monkeypatch, tmp_path, max_pixels=64) as client:
        response = client.post(
            "/api/classify",
            files={"image": ("picture.png", png_bytes((9, 9)), "image/png")},
        )
    assert response.status_code == 400
    assert "dimensions" in response.json()["error"]["message"]


def test_missing_multipart_file_returns_safe_400(monkeypatch, tmp_path):
    with client_for(monkeypatch, tmp_path) as client:
        response = client.post("/api/classify", data={"not_image": "value"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_valid_image_gets_model_not_ready_not_a_prediction(monkeypatch, tmp_path):
    with client_for(monkeypatch, tmp_path) as client:
        response = client.post(
            "/api/classify",
            files={"image": ("picture.png", png_bytes(), "text/plain")},
        )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "model_not_ready"
    assert "predicted_category" not in response.json()


def test_incompatible_manifest_keeps_model_not_ready(monkeypatch, tmp_path):
    manifest = {
        "class_labels": list(reversed(CATEGORIES)),
        "input_size": 224,
        "input_layout": "NCHW",
        "input_range": "0_1",
        "output_type": "logits",
        "model_name": "unverified",
        "model_version": "test",
    }
    (tmp_path / "model-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    classifier = Classifier(replace(settings, model_dir=tmp_path))
    with client_for(monkeypatch, tmp_path, classifier=classifier) as client:
        response = client.get("/health")
    assert response.json()["model"]["ready"] is False
    assert response.json()["model"]["reason"] == "model_invalid"


def test_inference_manifest_contract_accepts_transfer_learning_preprocessing():
    manifest = {
        "class_labels": list(CATEGORIES),
        "input_size": 224,
        "input_layout": "NCHW",
        "input_range": "0_1",
        "output_type": "logits",
        "preprocessing": {
            "channel_order": "RGB",
            "resize": "bilinear",
            "normalization": "imagenet_embedded",
        },
        "model_name": "ResNet18",
        "model_version": "1.0.0",
    }
    _validate_manifest(manifest)

    manifest["preprocessing"]["normalization"] = "performed_outside_the_graph"
    with pytest.raises(ValueError, match="normalization"):
        _validate_manifest(manifest)


def test_inference_manifest_remains_compatible_with_existing_scratch_model_metadata():
    _validate_manifest({
        "class_labels": list(CATEGORIES),
        "input_size": 224,
        "input_layout": "NCHW",
        "input_range": "0_1",
        "output_type": "logits",
        "model_name": "Existing scratch model",
        "model_version": "1.0",
    })


def test_unexpected_inference_errors_do_not_leak_details(monkeypatch, tmp_path):
    class BrokenClassifier:
        ready = True
        model_name = "test-model"
        model_version = "test"
        reason = None

        def load(self):
            pass

        def classify(self, _image):
            raise RuntimeError("private model path and exception detail")

    with client_for(monkeypatch, tmp_path, classifier=BrokenClassifier()) as client:
        response = client.post(
            "/api/classify",
            files={"image": ("picture.png", png_bytes(), "image/png")},
        )
    assert response.status_code == 500
    assert "private model path" not in response.text
    assert response.json()["error"]["message"] == "An unexpected AI service error occurred."
