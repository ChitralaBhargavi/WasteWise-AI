import { appendRequestLog } from '../utils/asyncFileLog.js'

export function requestLogger(req, res, next) {
  const startedAt = Date.now()
  const requestPath = req.path

  res.once('finish', () => {
    const entry = {
      method: req.method,
      path: requestPath,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    }

    console.info(`${entry.method} ${entry.path} ${entry.status} ${entry.durationMs}ms`)

    appendRequestLog(entry).catch((error) => {
      console.error('Unable to write the request log:', error)
    })
  })

  next()
}
