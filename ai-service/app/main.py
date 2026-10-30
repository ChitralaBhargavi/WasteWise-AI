import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.image_validation import ImageValidationError, decode_image
from app.inference import Classifier, ModelNotReady
from app.schemas import ClassificationResponse, HealthResponse

LOGGER = logging.getLogger("wastewise.ai")


class UploadBodyLimitMiddleware:
    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_body_bytes = max_bytes + 64 * 1024

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("path") != "/api/classify"
            or scope.get("method") != "POST"
        ):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                if int(content_length) > self.max_body_bytes:
                    await _send_payload_too_large(send)
                    return
            except ValueError:
                await _send_bad_request(send)
                return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise _RequestBodyTooLarge
            return message

        messages = []

        async def buffered_send(message):
            messages.append(message)

        try:
            await self.app(scope, limited_receive, buffered_send)
        except _RequestBodyTooLarge:
            await _send_payload_too_large(send)
            return

        for message in messages:
            await send(message)


class _RequestBodyTooLarge(Exception):
    pass


async def _send_payload_too_large(send):
    await _send_json(send, 413, "upload_too_large", "The uploaded image exceeds the configured size limit.")


async def _send_bad_request(send):
    await _send_json(send, 400, "invalid_request", "The request body could not be processed.")


async def _send_json(send, status_code: int, code: str, message: str):
    import json

    body = json.dumps({"error": {"code": code, "message": message}}).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": status_code,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})


def create_app(classifier: Classifier | None = None) -> FastAPI:
    model = classifier or Classifier()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        model.load()
        yield

    application = FastAPI(title="WasteWise AI Classification Service", lifespan=lifespan)
    application.state.classifier = model
    application.add_middleware(UploadBodyLimitMiddleware, max_bytes=settings.max_upload_bytes)

    @application.exception_handler(RequestValidationError)
    async def request_validation_error(_request: Request, _error: RequestValidationError):
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "invalid_request", "message": "A multipart image file is required."}},
        )

    @application.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, error: StarletteHTTPException):
        status_code = error.status_code
        message = str(error.detail) if isinstance(error.detail, str) else "The request could not be processed."
        code = "invalid_request" if status_code < 500 else "service_unavailable"
        return JSONResponse(
            status_code=status_code,
            content={"error": {"code": code, "message": message}},
        )

    @application.exception_handler(ImageValidationError)
    async def image_validation_error(_request: Request, error: ImageValidationError):
        code = "unsupported_image" if error.status_code == 415 else "invalid_image"
        return JSONResponse(
            status_code=error.status_code,
            content={"error": {"code": code, "message": str(error)}},
        )

    @application.exception_handler(Exception)
    async def unexpected_error(_request: Request, _error: Exception):
        LOGGER.error("Unhandled AI service request failure.")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": "An unexpected AI service error occurred."}},
        )

    @application.get("/health", response_model=HealthResponse)
    async def health():
        return {
            "status": "ok",
            "model": {
                "ready": model.ready,
                "model_name": model.model_name,
                "model_version": model.model_version,
                "reason": model.reason,
            },
        }

    @application.post("/api/classify", response_model=ClassificationResponse)
    async def classify(image: UploadFile = File(...)):
        data = await image.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            return JSONResponse(
                status_code=413,
                content={"error": {"code": "upload_too_large", "message": "The uploaded image exceeds the configured size limit."}},
            )
        decoded = decode_image(data, settings.max_image_pixels)
        try:
            return model.classify(decoded)
        except ModelNotReady:
            return JSONResponse(
                status_code=503,
                content={"error": {"code": "model_not_ready", "message": "The AI classification model is not ready."}},
            )

    return application


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)
