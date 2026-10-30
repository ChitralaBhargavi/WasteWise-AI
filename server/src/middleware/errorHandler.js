export function errorHandler(error, _req, res, _next) {
  let status = Number.isInteger(error.status) ? error.status : 500
  let message = status >= 500 ? 'An unexpected server error occurred.' : error.message

  if (error.code === 'LIMIT_FILE_SIZE') {
    status = 413
    message = 'The uploaded image exceeds the configured size limit.'
  } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    status = 400
    message = 'Upload one image using the image field.'
  } else if (error.code === 'LIMIT_PART_COUNT' || error.code === 'LIMIT_FIELD_COUNT') {
    status = 400
    message = 'The multipart request contains too many fields.'
  } else if (error.code === 'LIMIT_FILE_COUNT') {
    status = 400
    message = 'Upload one image using the image field.'
  } else if (error.type === 'entity.parse.failed') {
    status = 400
    message = 'Request body contains invalid JSON.'
  } else if (error.name === 'ValidationError') {
    status = 400
    message = Object.values(error.errors).map((validationError) => validationError.message).join(' ')
  } else if (error.name === 'CastError') {
    status = 400
    message = 'A request field has an invalid value.'
  } else if (error.code === 11000) {
    status = 409
    message = error.keyPattern?.email
      ? 'An account with this email already exists.'
      : 'A record with one of the unique values already exists.'
  }

  if (status >= 500) {
    console.error(`Unhandled request error (${error.name ?? 'Error'}).`)
  }

  res.status(status).json({
    error: {
      message,
      ...(status === 409 && error.duplicate ? { duplicate: error.duplicate } : {}),
    },
  })
}
