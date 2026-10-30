import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision.transforms import Compose, Resize, ToTensor

CATEGORIES = ("plastic", "paper", "metal", "glass", "organic", "other")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
IMAGE_SIZE = 224


class WasteImageDataset(Dataset):
    def __init__(self, samples, transform):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        path, label = self.samples[index]
        with Image.open(path) as image:
            image = image.convert("RGB")
            return self.transform(image), label


class SmallWasteClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 16, kernel_size=3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, kernel_size=3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d((1, 1)),
            nn.Flatten(),
        )
        self.classifier = nn.Linear(32, len(CATEGORIES))

    def forward(self, images):
        return self.classifier(self.features(images))


def split_samples(dataset_dir: Path, seed: int):
    all_samples = {"train": [], "validation": [], "test": []}
    split_manifest = {}
    generator = random.Random(seed)
    seen_group_ids = set()

    existing_dirs = {path.name for path in dataset_dir.iterdir() if path.is_dir()}
    if existing_dirs != set(CATEGORIES):
        raise ValueError("Dataset must contain exactly one directory for each supported category.")

    class_counts = {}
    for label, category in enumerate(CATEGORIES):
        category_dir = dataset_dir / category
        groups = {
            group.name: sorted(
                path for path in group.rglob("*")
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            )
            for group in category_dir.iterdir()
            if group.is_dir()
        }
        groups = {group_id: files for group_id, files in groups.items() if files}
        if len(groups) < 7 or sum(map(len, groups.values())) < 10:
            raise ValueError(
                f"Category '{category}' needs at least 7 non-empty group directories and 10 supported images."
            )
        if seen_group_ids.intersection(groups):
            raise ValueError("Group directory names must be globally unique across categories.")
        seen_group_ids.update(groups)
        group_ids = sorted(groups)
        generator.shuffle(group_ids)
        train_end = int(len(group_ids) * 0.70)
        validation_end = int(len(group_ids) * 0.85)
        group_partitions = {
            "train": group_ids[:train_end],
            "validation": group_ids[train_end:validation_end],
            "test": group_ids[validation_end:],
        }
        partitions = {
            split_name: [path for group_id in selected for path in groups[group_id]]
            for split_name, selected in group_partitions.items()
        }
        for split_name, partition in partitions.items():
            all_samples[split_name].extend((path, label) for path in partition)
        split_manifest[category] = {
            split_name: {
                "groups": selected,
                "files": [str(path.relative_to(dataset_dir)) for path in partitions[split_name]],
            }
            for split_name, selected in group_partitions.items()
        }
        class_counts[category] = {split_name: len(partition) for split_name, partition in partitions.items()}

    return all_samples, split_manifest, class_counts


def run_epoch(model, loader, loss_function, optimizer=None):
    training = optimizer is not None
    model.train(training)
    losses = []
    predicted = []
    expected = []
    for images, labels in loader:
        if training:
            optimizer.zero_grad(set_to_none=True)
        with torch.set_grad_enabled(training):
            logits = model(images)
            loss = loss_function(logits, labels)
            if training:
                loss.backward()
                optimizer.step()
        losses.append(float(loss.detach()))
        predicted.extend(logits.detach().argmax(dim=1).tolist())
        expected.extend(labels.tolist())
    return float(np.mean(losses)), expected, predicted


def main():
    parser = argparse.ArgumentParser(description="Train a small six-category WasteWise image classifier.")
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--dataset-name", required=True)
    parser.add_argument("--dataset-license", required=True)
    parser.add_argument("--dataset-provenance", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("models"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    if args.epochs < 1 or args.batch_size < 1:
        parser.error("--epochs and --batch-size must be positive integers.")
    dataset_dir = args.dataset_dir.resolve()
    if not dataset_dir.is_dir():
        parser.error("--dataset-dir must point to the prepared dataset directory.")

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.use_deterministic_algorithms(True, warn_only=True)
    samples, split_manifest, class_counts = split_samples(dataset_dir, args.seed)
    transform = Compose([Resize((IMAGE_SIZE, IMAGE_SIZE)), ToTensor()])
    datasets = {
        split_name: WasteImageDataset(partition, transform)
        for split_name, partition in samples.items()
    }
    loaders = {
        split_name: DataLoader(dataset, batch_size=args.batch_size, shuffle=split_name == "train", num_workers=0)
        for split_name, dataset in datasets.items()
    }

    model = SmallWasteClassifier()
    training_counts = torch.tensor(
        [class_counts[category]["train"] for category in CATEGORIES],
        dtype=torch.float32,
    )
    class_weights = training_counts.sum() / (len(CATEGORIES) * training_counts)
    loss_function = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    best_weights = None
    best_validation_f1 = -1.0
    patience = 4
    epochs_without_improvement = 0

    for epoch in range(args.epochs):
        train_loss, _, _ = run_epoch(model, loaders["train"], loss_function, optimizer)
        validation_loss, expected, predicted = run_epoch(model, loaders["validation"], loss_function)
        validation_f1 = f1_score(expected, predicted, labels=range(len(CATEGORIES)), average="macro", zero_division=0)
        print(
            f"epoch={epoch + 1} train_loss={train_loss:.4f} "
            f"validation_loss={validation_loss:.4f} validation_macro_f1={validation_f1:.4f}"
        )
        if validation_f1 > best_validation_f1:
            best_validation_f1 = validation_f1
            best_weights = {key: value.detach().clone() for key, value in model.state_dict().items()}
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= patience:
                break

    if best_weights is None:
        raise RuntimeError("Training did not produce a usable validation checkpoint.")
    model.load_state_dict(best_weights)
    _, expected, predicted = run_epoch(model, loaders["test"], loss_function)
    metrics = classification_report(
        expected,
        predicted,
        labels=range(len(CATEGORIES)),
        target_names=CATEGORIES,
        output_dict=True,
        zero_division=0,
    )
    matrix = confusion_matrix(expected, predicted, labels=range(len(CATEGORIES))).tolist()

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "waste-classifier.onnx"
    torch.onnx.export(
        model.eval(),
        torch.zeros(1, 3, IMAGE_SIZE, IMAGE_SIZE),
        str(model_path),
        input_names=["images"],
        output_names=["logits"],
        dynamic_axes={"images": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    manifest = {
        "model_name": "WasteWise small six-category classifier",
        "model_version": "1.0.0",
        "class_labels": list(CATEGORIES),
        "input_size": IMAGE_SIZE,
        "input_layout": "NCHW",
        "input_range": "0_1",
        "output_type": "logits",
        "preprocessing": {
            "channel_order": "RGB",
            "resize": "bilinear",
            "normalization": "none",
        },
        "dataset_name": args.dataset_name,
        "dataset_license": args.dataset_license,
        "dataset_provenance": args.dataset_provenance,
        "split_seed": args.seed,
        "split_counts": class_counts,
    }
    (output_dir / "model-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    report = {
        "split": "held-out test",
        "dataset_name": args.dataset_name,
        "class_counts": {category: class_counts[category]["test"] for category in CATEGORIES},
        "metrics": metrics,
        "confusion_matrix": matrix,
        "confusion_matrix_labels": list(CATEGORIES),
    }
    (output_dir / "evaluation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (output_dir / "split-manifest.json").write_text(
        json.dumps({"seed": args.seed, "files": split_manifest}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))
    print(f"Exported ONNX model and metadata to {output_dir}")


if __name__ == "__main__":
    main()
