export function notFound(_req, res) {
  res.status(404).json({
    error: {
      message: 'The requested endpoint was not found.',
    },
  })
}
