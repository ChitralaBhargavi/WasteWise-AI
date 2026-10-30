from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class WasteCategory(StrEnum):
    plastic = "plastic"
    paper = "paper"
    metal = "metal"
    glass = "glass"
    organic = "organic"
    other = "other"


class ModelHealth(BaseModel):
    ready: bool
    model_name: str | None
    model_version: str | None
    reason: str | None = None


class HealthResponse(BaseModel):
    status: str
    model: ModelHealth


class ClassificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inference_success: bool = True
    predicted_category: WasteCategory
    confidence: float = Field(ge=0, le=1)
    probabilities: dict[WasteCategory, float]
    model_name: str
    model_version: str
    confidence_note: str
