import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { aiApi } from '../lib/api.js'

const maximumFileBytes = 5 * 1024 * 1024
const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default function AiClassificationPage() {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [readiness, setReadiness] = useState({ service: 'checking', model: 'unknown' })
  const [checkingReadiness, setCheckingReadiness] = useState(true)
  const classifyLock = useRef(false)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const refreshReadiness = useCallback(async () => {
    setCheckingReadiness(true)
    try {
      const response = await aiApi.health()
      setReadiness(response.ai ?? { service: 'unavailable', model: 'unknown' })
    } catch {
      setReadiness({ service: 'unavailable', model: 'unknown' })
    } finally {
      setCheckingReadiness(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    aiApi.health()
      .then((response) => {
        if (active) setReadiness(response.ai ?? { service: 'unavailable', model: 'unknown' })
      })
      .catch(() => {
        if (active) setReadiness({ service: 'unavailable', model: 'unknown' })
      })
      .finally(() => {
        if (active) setCheckingReadiness(false)
      })
    return () => { active = false }
  }, [])

  function handleFileChange(event) {
    const selected = event.target.files?.[0] ?? null
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setFile(null)
    setResult(null)
    setError('')
    if (!selected) return
    if (!supportedTypes.has(selected.type)) {
      setError('Choose a JPEG, PNG, or WebP image.')
      event.target.value = ''
      return
    }
    if (selected.size === 0 || selected.size > maximumFileBytes) {
      setError('Choose a non-empty image no larger than 5 MB.')
      event.target.value = ''
      return
    }
    setPreviewUrl(URL.createObjectURL(selected))
    setFile(selected)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!file || classifyLock.current) return
    setError('')
    setResult(null)
    classifyLock.current = true
    setSubmitting(true)
    try {
      const response = await aiApi.classify(file)
      setResult(response.data)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      classifyLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <div className="report-form-card mx-auto p-4 p-lg-5">
        <Link className="small text-success text-decoration-none" to="/dashboard">← Back to my reports</Link>
        <p className="eyebrow mt-4 mb-2">Image classification</p>
        <h1 className="h2 fw-bold">Identify a waste category</h1>
        <p className="text-secondary">
          Choose a clear image of one waste item. Images are processed in memory and are not saved.
          Check local waste rules before disposal.
        </p>
        {checkingReadiness ? (
          <p className="text-secondary" role="status">Checking classifier availability...</p>
        ) : readiness.model === 'ready' ? (
          <div className="alert alert-success" role="status">The classifier reports a loaded model.</div>
        ) : (
          <div className="alert alert-warning" role="status">
            {readiness.service === 'available'
              ? 'The AI service is running, but no compatible trained model is loaded. A real prediction is unavailable until one is configured.'
              : 'The AI classification service is unavailable. No category prediction will be fabricated.'}
            <button
              className="btn btn-sm btn-outline-warning ms-3"
              disabled={checkingReadiness}
              onClick={refreshReadiness}
              type="button"
            >
              Check again
            </button>
          </div>
        )}

        {error && <div className="alert alert-danger" id="classification-error" role="alert">{error}</div>}

        <form aria-describedby={error ? 'classification-error' : undefined} onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label" htmlFor="classification-image">Waste image</label>
            <input
              accept="image/jpeg,image/png,image/webp"
              className="form-control"
              id="classification-image"
              onChange={handleFileChange}
              type="file"
            />
            <div className="form-text">JPEG, PNG, or WebP · maximum 5 MB.</div>
          </div>
          {previewUrl && (
            <div className="mb-4">
              <img
                alt="Preview of the selected waste image"
                className="img-fluid rounded-3"
                src={previewUrl}
                style={{ maxHeight: '22rem', objectFit: 'contain' }}
              />
            </div>
          )}
          <button className="btn btn-success" disabled={!file || submitting} type="submit">
            {submitting ? 'Classifying image...' : 'Classify image'}
          </button>
        </form>

        {result && (
          <section className="mt-4 p-4 border rounded-3" aria-labelledby="classification-result" aria-live="polite" aria-atomic="true">
            <p className="eyebrow mb-2">Classification result</p>
            <h2 className="h4 fw-bold text-capitalize" id="classification-result">{result.predicted_category}</h2>
            <p className="mb-1">Confidence score: {(result.confidence * 100).toFixed(1)}%</p>
            <p className="small text-secondary">{result.confidence_note}</p>
            {result.probabilities && (
              <ul className="list-group list-group-flush mb-3" aria-label="Model scores by category">
                {Object.entries(result.probabilities).map(([category, probability]) => (
                  <li className="list-group-item d-flex justify-content-between px-0 text-capitalize" key={category}>
                    <span>{category}</span><span>{(probability * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            )}
            {result.disposal_guidance ? (
              <p className="mb-0">{result.disposal_guidance}</p>
            ) : (
              <p className="mb-0">Check your local waste-collection rules for disposal guidance.</p>
            )}
            <p className="small text-secondary mt-3 mb-0">
              Model: {result.model_name} ({result.model_version})
            </p>
          </section>
        )}
      </div>
    </main>
  )
}
