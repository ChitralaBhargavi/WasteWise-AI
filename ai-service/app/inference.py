import json
import logging
from pathlib import Path

import numpy as np
import onnxruntime
from PIL import Image

from app.config import Settings, settings

LOGGER = logging.getLogger("wastewise.ai")
CATEGORIES = ("plastic", "paper", "metal", "glass", "organic", "other")
INPUT_SIZE = 224


class ModelNotReady(Exception):
    pass


class Classifier:
    def __init__(self, configuration: Settings = settings):
        self.configuration = configuration
        self.session = None
        self.input_name = None
        self.model_name = None
        self.model_version = None
        self.reason = "model_not_configured"

    @property
    def ready(self) -> bool:
        return self.session is not None

    def load(self) -> None:
        self.session = None
        self.input_name = None
        self.model_name = None
        self.model_version = None

        model_path = _model_file(self.configuration.model_dir, self.configuration.model_file)
        manifest_path = _model_file(self.configuration.model_dir, self.configuration.manifest_file)
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            _validate_manifest(manifest)
            session = onnxruntime.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
            if len(session.get_inputs()) != 1 or len(session.get_outputs()) != 1:
                raise ValueError("Expected exactly one model input and output.")
            model_input = session.get_inputs()[0]
            input_shape = model_input.shape
            if len(input_shape) != 4 or input_shape[1:] != [3, INPUT_SIZE, INPUT_SIZE]:
                raise ValueError("Expected NCHW input with 3x224x224 dimensions.")
            output_shape = session.get_outputs()[0].shape
            if len(output_shape) != 2 or output_shape[1] != len(CATEGORIES):
                raise ValueError("Expected six classification output values.")
            self.session = session
            self.input_name = model_input.name
            self.model_name = manifest["model_name"]
            self.model_version = manifest["model_version"]
            self.reason = None
        except FileNotFoundError:
            self.reason = "model_not_configured"
            LOGGER.info("AI classifier is not ready because its configured model files are missing.")
        except Exception:
            self.reason = "model_invalid"
            LOGGER.error("AI classifier model or manifest could not be loaded.")

    def classify(self, image: Image.Image) -> dict:
        if not self.ready:
            raise ModelNotReady

        resized = image.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
        pixels = np.asarray(resized, dtype=np.float32) / np.float32(255.0)
        tensor = np.transpose(pixels, (2, 0, 1))[np.newaxis, ...]
        try:
            outputs = self.session.run(None, {self.input_name: tensor})
            scores = np.asarray(outputs[0], dtype=np.float64)
        except Exception as error:
            LOGGER.error("AI classifier inference failed.")
            raise ModelNotReady from error

        if scores.shape != (1, len(CATEGORIES)) or not np.isfinite(scores).all():
            raise ModelNotReady

        logits = scores[0]
        shifted = logits - np.max(logits)
        exponentials = np.exp(shifted)
        probabilities = exponentials / exponentials.sum()
        if not np.isfinite(probabilities).all():
            raise ModelNotReady

        category_index = int(np.argmax(probabilities))
        return {
            "inference_success": True,
            "predicted_category": CATEGORIES[category_index],
            "confidence": float(probabilities[category_index]),
            "probabilities": {
                category: float(probabilities[index])
                for index, category in enumerate(CATEGORIES)
            },
            "model_name": self.model_name,
            "model_version": self.model_version,
            "confidence_note": "Softmax scores are not calibrated probabilities and do not guarantee correctness.",
        }


def _model_file(model_dir: Path, file_name: str) -> Path:
    if Path(file_name).name != file_name:
        raise ValueError("Model file names must not contain a path.")
    resolved_dir = model_dir.resolve()
    resolved_file = (resolved_dir / file_name).resolve()
    if resolved_file.parent != resolved_dir:
        raise ValueError("Model file must remain inside the configured model directory.")
    return resolved_file


def _validate_manifest(manifest: object) -> None:
    if not isinstance(manifest, dict):
        raise ValueError("Model manifest must be a JSON object.")
    if tuple(manifest.get("class_labels", ())) != CATEGORIES:
        raise ValueError("Model class labels do not match the supported category order.")
    if manifest.get("input_size") != INPUT_SIZE or manifest.get("input_layout") != "NCHW":
        raise ValueError("Model input preprocessing does not match the serving contract.")
    if manifest.get("input_range") != "0_1" or manifest.get("output_type") != "logits":
        raise ValueError("Model input or output contract is unsupported.")
    preprocessing = manifest.get("preprocessing", {})
    if not isinstance(preprocessing, dict):
        raise ValueError("Model preprocessing metadata must be an object.")
    normalization = preprocessing.get("normalization", "none")
    if normalization not in {"none", "imagenet_embedded"}:
        raise ValueError("Model normalization must be none or embedded ImageNet normalization.")
    if preprocessing and (
        preprocessing.get("channel_order") != "RGB"
        or preprocessing.get("resize") != "bilinear"
    ):
        raise ValueError("Model preprocessing does not match the serving contract.")
    for key in ("model_name", "model_version"):
        if not isinstance(manifest.get(key), str) or not manifest[key] or len(manifest[key]) > 100:
            raise ValueError(f"Manifest {key} is missing or invalid.")
