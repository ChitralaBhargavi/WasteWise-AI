import argparse
import hashlib
import json
import random
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFile
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision.models import ResNet18_Weights, resnet18
from torchvision.transforms import Compose, InterpolationMode, Resize, ToTensor

CATEGORIES = ("plastic", "paper", "metal", "glass", "organic", "other")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
IMAGE_SIZE = 224
SEED = 42
ImageFile.LOAD_TRUNCATED_IMAGES = False


class WasteImageDataset(Dataset):
    def __init__(self, samples):
        self.samples = samples
        self.transform = Compose([
            Resize((IMAGE_SIZE, IMAGE_SIZE), interpolation=InterpolationMode.BILINEAR),
            ToTensor(),
        ])

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        path, label = self.samples[index]
        with Image.open(path) as image:
            return self.transform(image.convert("RGB")), label


class EmbeddedImageNetNormalization(nn.Module):
    def __init__(self, classifier):
        super().__init__()
        self.classifier = classifier
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(self, image):
        return self.classifier((image - self.mean) / self.std)

def _build_model():
    base = resnet18(weights=ResNet18_Weights.IMAGENET1K_V1)
    base.fc = nn.Linear(base.fc.in_features, len(CATEGORIES))
    return EmbeddedImageNetNormalization(base)


def _grouped_samples(dataset_dir: Path, seed: int):
    top_level = {path.name for path in dataset_dir.iterdir() if path.is_dir()}
    expected = set(CATEGORIES)
    missing = sorted(expected - top_level)
    extra = sorted(top_level - expected)
    if missing or extra:
        raise ValueError(f"Dataset classes must match exactly. Missing: {missing}; unsupported: {extra}.")

    rng = random.Random(seed)
    groups_seen = set()
    samples = {"train": [], "validation": [], "test": []}
    split_manifest = {}
    class_counts = {}
    for label, category in enumerate(CATEGORIES):
        category_dir = dataset_dir / category
        group_files = {}
        for group_dir in category_dir.iterdir():
            if not group_dir.is_dir():
                raise ValueError(
                    f"Images in '{category}' must be inside group subdirectories; found {group_dir.name}."
                )
            group_id = group_dir.name
            if group_id in groups_seen:
                raise ValueError("Group folder names must be globally unique across all categories.")
            groups_seen.add(group_id)
            images = sorted(
                path for path in group_dir.rglob("*")
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            )
            if images:
                group_files[group_id] = images

        image_count = sum(len(images) for images in group_files.values())
        if len(group_files) < 7 or image_count < 10:
            raise ValueError(
                f"Category '{category}' has {len(group_files)} non-empty groups and {image_count} images; "
                "at least 7 groups and 10 images are required."
            )

        group_ids = sorted(group_files)
        rng.shuffle(group_ids)
        train_end = max(1, int(len(group_ids) * 0.70))
        validation_end = max(train_end + 1, int(len(group_ids) * 0.85))
        if validation_end >= len(group_ids):
            raise ValueError(f"Category '{category}' has too few independent groups for all splits.")
        partitions = {
            "train": group_ids[:train_end],
            "validation": group_ids[train_end:validation_end],
            "test": group_ids[validation_end:],
        }
        split_manifest[category] = {}
        class_counts[category] = {}
        for split_name, group_ids_for_split in partitions.items():
            files = [path for group_id in group_ids_for_split for path in group_files[group_id]]
            samples[split_name].extend((path, label) for path in files)
            split_manifest[category][split_name] = {
                "groups": group_ids_for_split,
                "files": [str(path.relative_to(dataset_dir)) for path in files],
            }
            class_counts[category][split_name] = len(files)
            if not files:
                raise ValueError(f"Category '{category}' has no images in the {split_name} split.")

    return samples, split_manifest, class_counts


def _epoch(model, loader, criterion, device, optimizer=None, scaler=None):
    training = optimizer is not None
    model.train(training)
    losses, expected, predicted = [], [], []
    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        if training:
            optimizer.zero_grad(set_to_none=True)
        with torch.set_grad_enabled(training):
            with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
                logits = model(images)
                loss = criterion(logits, labels)
            if training:
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
        losses.append(float(loss.detach().cpu()))
        expected.extend(labels.detach().cpu().tolist())
        predicted.extend(logits.detach().argmax(dim=1).cpu().tolist())
    return float(np.mean(losses)), expected, predicted


def _save_checkpoint(
    path,
    *,
    epoch,
    model,
    optimizer,
    scaler,
    best_state,
    best_f1,
    stale_epochs,
    run_signature,
):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save({
        "epoch": epoch,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "scaler_state": scaler.state_dict(),
        "best_state": best_state,
        "best_validation_macro_f1": best_f1,
        "stale_epochs": stale_epochs,
        "python_rng": random.getstate(),
        "numpy_rng": np.random.get_state(),
        "torch_rng": torch.get_rng_state(),
        "cuda_rng": torch.cuda.get_rng_state_all() if torch.cuda.is_available() else None,
        "categories": list(CATEGORIES),
        "seed": SEED,
        "run_signature": run_signature,
    }, temporary)
    temporary.replace(path)


def train(args):
    dataset_dir = args.dataset_dir.resolve()
    if not dataset_dir.is_dir():
        raise ValueError(f"Dataset directory does not exist: {dataset_dir}")
    if args.epochs < 1 or args.batch_size < 1:
        raise ValueError("--epochs and --batch-size must be positive.")

    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    torch.use_deterministic_algorithms(True, warn_only=True)
    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    print(f"Training device: {device}")

    try:
        source_label_mapping = json.loads(args.source_label_mapping_json)
    except json.JSONDecodeError as error:
        raise ValueError("--source-label-mapping-json must be a JSON object.") from error
    if (
        not isinstance(source_label_mapping, dict)
        or not source_label_mapping
        or any(not isinstance(source, str) or not source for source in source_label_mapping)
        or any(target not in CATEGORIES for target in source_label_mapping.values())
        or set(source_label_mapping.values()) != set(CATEGORIES)
    ):
        raise ValueError("Document an explicit source-label mapping covering all six target classes.")

    samples, split_manifest, class_counts = _grouped_samples(dataset_dir, SEED)
    run_configuration = {
        "seed": SEED,
        "dataset_name": args.dataset_name,
        "dataset_license": args.dataset_license,
        "dataset_provenance": args.dataset_provenance,
        "source_label_mapping": source_label_mapping,
        "split_manifest": split_manifest,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "patience": args.patience,
    }
    run_signature = hashlib.sha256(
        json.dumps(run_configuration, sort_keys=True).encode("utf-8")
    ).hexdigest()
    print("Image counts by category and split:")
    print(json.dumps(class_counts, indent=2))
    datasets = {name: WasteImageDataset(items) for name, items in samples.items()}
    loaders = {
        name: DataLoader(dataset, batch_size=args.batch_size, shuffle=name == "train", num_workers=2 if device.type == "cuda" else 0)
        for name, dataset in datasets.items()
    }

    model = _build_model().to(device)
    training_counts = torch.tensor(
        [class_counts[category]["train"] for category in CATEGORIES],
        dtype=torch.float32,
        device=device,
    )
    weights = training_counts.sum() / (len(CATEGORIES) * training_counts)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    start_epoch = 0
    best_f1 = -1.0
    best_state = None
    stale_epochs = 0
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    if args.resume_from:
        checkpoint = torch.load(args.resume_from, map_location=device, weights_only=False)
        if (
            checkpoint.get("categories") != list(CATEGORIES)
            or checkpoint.get("seed") != SEED
            or checkpoint.get("run_signature") != run_signature
        ):
            raise ValueError("Checkpoint dataset, split, labels, or training configuration does not match this run.")
        model.load_state_dict(checkpoint["model_state"])
        optimizer.load_state_dict(checkpoint["optimizer_state"])
        scaler.load_state_dict(checkpoint["scaler_state"])
        start_epoch = checkpoint["epoch"] + 1
        best_state = checkpoint["best_state"]
        best_f1 = checkpoint["best_validation_macro_f1"]
        stale_epochs = checkpoint["stale_epochs"]
        random.setstate(checkpoint["python_rng"])
        np.random.set_state(checkpoint["numpy_rng"])
        torch.set_rng_state(checkpoint["torch_rng"])
        if device.type == "cuda" and checkpoint.get("cuda_rng"):
            torch.cuda.set_rng_state_all(checkpoint["cuda_rng"])
        print(f"Resuming at epoch {start_epoch + 1}.")

    for epoch in range(start_epoch, args.epochs):
        train_loss, _, _ = _epoch(model, loaders["train"], criterion, device, optimizer, scaler)
        validation_loss, expected, predicted = _epoch(model, loaders["validation"], criterion, device)
        validation_f1 = f1_score(expected, predicted, labels=range(6), average="macro", zero_division=0)
        print(
            f"epoch={epoch + 1}/{args.epochs} train_loss={train_loss:.4f} "
            f"validation_loss={validation_loss:.4f} validation_macro_f1={validation_f1:.4f}"
        )
        if validation_f1 > best_f1:
            best_f1 = validation_f1
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1
        if args.checkpoint:
            _save_checkpoint(
                args.checkpoint,
                epoch=epoch,
                model=model,
                optimizer=optimizer,
                scaler=scaler,
                best_state=best_state,
                best_f1=best_f1,
                stale_epochs=stale_epochs,
                run_signature=run_signature,
            )
        if stale_epochs >= args.patience:
            print("Early stopping: validation macro-F1 did not improve.")
            break

    if best_state is None:
        raise RuntimeError("No validation checkpoint was produced.")
    model.load_state_dict(best_state)
    model.to(device)
    _, expected, predicted = _epoch(model, loaders["test"], criterion, device)
    report = classification_report(
        expected,
        predicted,
        labels=range(6),
        target_names=CATEGORIES,
        output_dict=True,
        zero_division=0,
    )
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "waste-classifier.onnx"
    model.eval()
    torch.onnx.export(
        model,
        torch.zeros(1, 3, IMAGE_SIZE, IMAGE_SIZE, device=device),
        str(model_path),
        input_names=["images"],
        output_names=["logits"],
        dynamic_axes={"images": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    manifest = {
        "model_name": "WasteWise ResNet18 waste classifier",
        "model_version": "1.0.0",
        "class_labels": list(CATEGORIES),
        "input_size": IMAGE_SIZE,
        "input_layout": "NCHW",
        "input_range": "0_1",
        "output_type": "logits",
        "preprocessing": {
            "channel_order": "RGB",
            "resize": "bilinear",
            "normalization": "imagenet_embedded",
        },
        "training": {
            "architecture": "torchvision ResNet18, ImageNet-1K V1 pretrained, six-class fine-tuning",
            "torchvision_weights": "ResNet18_Weights.IMAGENET1K_V1",
            "device": str(device),
            "seed": SEED,
            "epochs_requested": args.epochs,
            "batch_size": args.batch_size,
            "learning_rate": args.learning_rate,
            "dataset_name": args.dataset_name,
            "dataset_license": args.dataset_license,
            "dataset_provenance": args.dataset_provenance,
            "source_label_mapping": source_label_mapping,
            "split_counts": class_counts,
        },
    }
    (output_dir / "model-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (output_dir / "training-config.json").write_text(
        json.dumps(manifest["training"], indent=2),
        encoding="utf-8",
    )
    evaluation = {
        "split": "held-out test",
        "dataset_name": args.dataset_name,
        "sample_count": len(expected),
        "accuracy": accuracy_score(expected, predicted),
        "per_class": report,
        "confusion_matrix": confusion_matrix(expected, predicted, labels=range(6)).tolist(),
        "confusion_matrix_labels": list(CATEGORIES),
    }
    (output_dir / "evaluation.json").write_text(json.dumps(evaluation, indent=2), encoding="utf-8")
    (output_dir / "split-manifest.json").write_text(
        json.dumps({"seed": SEED, "files": split_manifest}, indent=2),
        encoding="utf-8",
    )
    _verify_export(model_path, model, device)
    print(json.dumps(evaluation, indent=2))
    print(f"ONNX contract smoke test passed. Artifacts saved to {output_dir}")


def _verify_export(model_path, model, device):
    import onnx
    import onnxruntime

    graph = onnx.load(str(model_path))
    onnx.checker.check_model(graph)
    session = onnxruntime.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_info = session.get_inputs()
    output_info = session.get_outputs()
    if (
        len(input_info) != 1
        or len(output_info) != 1
        or input_info[0].shape[1:] != [3, IMAGE_SIZE, IMAGE_SIZE]
        or output_info[0].shape[1] != len(CATEGORIES)
    ):
        raise RuntimeError("Exported ONNX model does not match the FastAPI input/output contract.")
    sample = torch.rand(1, 3, IMAGE_SIZE, IMAGE_SIZE, device=device)
    with torch.no_grad():
        torch_output = model(sample).detach().cpu().numpy()
    onnx_output = session.run(None, {"images": sample.detach().cpu().numpy()})[0]
    if torch_output.shape != (1, len(CATEGORIES)) or not np.allclose(torch_output, onnx_output, rtol=1e-3, atol=1e-4):
        raise RuntimeError("ONNX output does not match the trained PyTorch model.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--dataset-name", required=True)
    parser.add_argument("--dataset-license", required=True)
    parser.add_argument("--dataset-provenance", required=True)
    parser.add_argument("--source-label-mapping-json", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("models"))
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--resume-from", type=Path)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=0.0001)
    parser.add_argument("--patience", type=int, default=4)
    parser.add_argument("--cpu", action="store_true")
    train(parser.parse_args())


if __name__ == "__main__":
    main()
