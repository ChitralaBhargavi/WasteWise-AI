# WasteWise AI service

The FastAPI service accepts citizen image classifications only through the authenticated Express proxy. It validates JPEG, PNG, and WebP image bytes, enforces upload/pixel limits, processes in memory, and requires a verified ONNX model before predicting. See the [root README](../README.md#phase-8-ai-image-classification-service) for application architecture and API details.

## Local setup

From this directory in Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m app.main
```

The service binds to `127.0.0.1:8000` by default. It is an internal application service, not a public API. `GET /health` reports service and model readiness separately. Until a compatible model and manifest are installed, `POST /api/classify` returns `503 model_not_ready` and never fabricates a category.

The serving contract is `images` NCHW float `[0,1]`, RGB resized to 224x224 with bilinear interpolation; one output named `logits` containing six values ordered `plastic`, `paper`, `metal`, `glass`, `organic`, `other`. Softmax confidence scores are not calibrated probabilities. For models using ImageNet transfer learning, the model graph must include ImageNet normalization and the manifest must say `preprocessing.normalization: imagenet_embedded`. The Colab workflow uses torchvision's published ResNet18 ImageNet weights; review their upstream terms before reuse.

## Model training

Use [training/WasteWiseAI_Colab_Training.ipynb](training/WasteWiseAI_Colab_Training.ipynb) in Google Colab. It audits a supplied dataset, rejects unsupported labels, duplicates across groups and unreadable images, then invokes the GPU-capable ResNet18 training script. No dataset or trained model is included. Do not map `trash` to `other` or invent an `organic` class; obtain and document appropriately licensed examples for all required categories. Training provenance, exact class mapping, preprocessing, group splits, and held-out metrics are packaged with the model.

Copy only the verified `waste-classifier.onnx` and `model-manifest.json` to the configured model directory (default `ai-service/models/`), then restart FastAPI. Model artifacts and datasets are git-ignored.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest .\tests
```

The tests do not need a trained model or network download.
