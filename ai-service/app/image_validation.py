from io import BytesIO
import warnings

from PIL import Image, UnidentifiedImageError


SUPPORTED_FORMATS = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}


class ImageValidationError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def decode_image(data: bytes, max_pixels: int) -> Image.Image:
    if not data:
        raise ImageValidationError("The uploaded image is empty.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in SUPPORTED_FORMATS:
                    raise ImageValidationError("Upload a JPEG, PNG, or WebP image.", 415)
                width, height = image.size
                if width < 1 or height < 1 or width * height > max_pixels:
                    raise ImageValidationError("The image dimensions are unsupported or too large.")
                image.verify()

            with Image.open(BytesIO(data)) as image:
                image.load()
                return image.convert("RGB")
    except ImageValidationError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ImageValidationError("The uploaded image is corrupt or could not be decoded.") from error
