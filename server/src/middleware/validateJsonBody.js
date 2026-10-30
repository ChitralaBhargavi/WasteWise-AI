const writeMethods = new Set(['POST', 'PUT', 'PATCH'])

export function validateJsonBody(req, _res, next) {
  if (!writeMethods.has(req.method)) {
    next()
    return
  }

  if (
    req.is('multipart/form-data')
    && (
      ['/api/ai/classify', '/api/reports'].includes(req.path)
      || /^\/api\/collector\/reports\/[^/]+\/status$/.test(req.path)
    )
  ) {
    next()
    return
  }

  if (!req.is('application/json')) {
    next(createValidationError('Request body must use Content-Type: application/json.'))
    return
  }

  const body = req.body
  const isObject = body !== null && typeof body === 'object' && !Array.isArray(body)

  if (!isObject) {
    next(createValidationError('Request body must be a JSON object.'))
    return
  }

  next()
}

function createValidationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}
