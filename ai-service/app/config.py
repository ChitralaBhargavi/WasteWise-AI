import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _bounded_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    value = os.getenv(name, str(default))
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer.") from error
    if not minimum <= parsed <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return parsed


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    model_dir: Path
    model_file: str
    manifest_file: str
    max_upload_bytes: int
    max_image_pixels: int

    @classmethod
    def from_env(cls) -> "Settings":
        model_file = os.getenv("AI_MODEL_FILE", "waste-classifier.onnx")
        manifest_file = os.getenv("AI_MODEL_MANIFEST_FILE", "model-manifest.json")
        if Path(model_file).name != model_file or Path(manifest_file).name != manifest_file:
            raise ValueError("Model and manifest names must be simple file names.")
        return cls(
            host=os.getenv("AI_HOST", "127.0.0.1"),
            port=_bounded_integer("AI_PORT", 8000, 1, 65535),
            model_dir=Path(os.getenv("AI_MODEL_DIR", "models")).resolve(),
            model_file=model_file,
            manifest_file=manifest_file,
            max_upload_bytes=_bounded_integer("AI_MAX_UPLOAD_BYTES", 5 * 1024 * 1024, 1024, 20 * 1024 * 1024),
            max_image_pixels=_bounded_integer("AI_MAX_IMAGE_PIXELS", 40_000_000, 1_000_000, 100_000_000),
        )


settings = Settings.from_env()
