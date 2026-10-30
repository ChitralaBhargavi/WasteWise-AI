import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ReportLocationMap } from '../components/ReportMedia.jsx'
import { reportsApi } from '../lib/api.js'

const categories = ['plastic', 'paper', 'metal', 'glass', 'organic', 'other']
const maximumImageBytes = 5 * 1024 * 1024
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default function CreateReportPage() {
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [locationConfirmed, setLocationConfirmed] = useState(false)
  const [selectedImage, setSelectedImage] = useState(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [duplicateReport, setDuplicateReport] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [locationError, setLocationError] = useState('')
  const [mapError, setMapError] = useState('')
  const submitLock = useRef(false)
  const navigate = useNavigate()

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function updateSelectedImage(file) {
    if (preview) URL.revokeObjectURL(preview)
    setSelectedImage(file)
    setPreview(file ? URL.createObjectURL(file) : '')
  }

  function setCoordinates(nextLatitude, nextLongitude, nextAddress = address) {
    setLatitude(String(nextLatitude))
    setLongitude(String(nextLongitude))
    setAddress(nextAddress)
    setLocationConfirmed(false)
    setLocationError('')
  }

  function handleImageChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!allowedImageTypes.has(file.type)) {
      setFieldErrors((current) => ({ ...current, image: 'Choose a JPEG, PNG, or WebP image.' }))
      updateSelectedImage(null)
      event.target.value = ''
      return
    }
    if (file.size > maximumImageBytes) {
      setFieldErrors((current) => ({ ...current, image: 'Image must be 5 MB or smaller.' }))
      updateSelectedImage(null)
      event.target.value = ''
      return
    }
    setFieldErrors((current) => ({ ...current, image: '' }))
    updateSelectedImage(file)
  }

  async function searchAddress(event) {
    event.preventDefault()
    if (!address.trim()) {
      setLocationError('Enter an address or place name to search.')
      return
    }
    setSearching(true)
    setLocationError('')
    setLocationMessage('')
    try {
      const query = new URLSearchParams({ format: 'jsonv2', limit: '1', q: address.trim() })
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error('Address search is temporarily unavailable. You can still place a pin manually.')
      const results = await response.json()
      if (!results.length) {
        setLocationError('No matching place was found. Try a nearby address or place a map pin.')
        return
      }
      const resultLatitude = Number(results[0].lat)
      const resultLongitude = Number(results[0].lon)
      if (!Number.isFinite(resultLatitude) || !Number.isFinite(resultLongitude) || !results[0].display_name) {
        setLocationError('The address service returned an invalid location. Place a pin on the map instead.')
        return
      }
      setCoordinates(resultLatitude, resultLongitude, results[0].display_name.slice(0, 300))
      setLocationMessage('Place found. Confirm the pin before submitting.')
    } catch (requestError) {
      setLocationError(requestError.message || 'Address search failed. You can still place a map pin manually.')
    } finally {
      setSearching(false)
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError('Location is not available in this browser. Place a pin on the map instead.')
      return
    }
    setLocating(true)
    setLocationError('')
    setLocationMessage('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCoordinates(coords.latitude, coords.longitude)
        setLocationMessage('Your device location was selected. Confirm the pin before submitting.')
        setLocating(false)
      },
      (geoError) => {
        const message = geoError.code === geoError.PERMISSION_DENIED
          ? 'Location permission was denied. Place a pin on the map or enter an address.'
          : 'Your current location could not be determined. Place a pin on the map instead.'
        setLocationError(message)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitLock.current) return
    setError('')
    setDuplicateReport(null)
    const nextFieldErrors = {}
    if (!categories.includes(category)) nextFieldErrors.category = 'Choose a waste category.'
    if (description.length > 500) nextFieldErrors.description = 'Description must be 500 characters or fewer.'
    if (address.trim().length > 300) nextFieldErrors.address = 'Address must be 300 characters or fewer.'

    const hasLatitude = latitude !== ''
    const hasLongitude = longitude !== ''
    const location = {}
    if (address.trim()) location.address = address.trim()
    if (hasLatitude !== hasLongitude) {
      nextFieldErrors.location = 'Select a map location with both coordinates.'
    } else if (hasLatitude) {
      const parsedLatitude = Number(latitude)
      const parsedLongitude = Number(longitude)
      if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90
        || !Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
        nextFieldErrors.location = 'Choose a valid map location.'
      } else if (!locationConfirmed) {
        nextFieldErrors.location = 'Confirm the selected map location before submitting.'
      } else {
        location.latitude = parsedLatitude
        location.longitude = parsedLongitude
      }
    }
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length) return

    const report = {
      category,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(Object.keys(location).length ? { location } : {}),
    }
    submitLock.current = true
    setSubmitting(true)
    try {
      const response = await reportsApi.create(report, selectedImage)
      navigate(`/reports/${response.data.report.id}`, { replace: true, state: { created: true } })
    } catch (requestError) {
      setError(requestError.message)
      setDuplicateReport(requestError.status === 409 ? requestError.duplicate?.existingReport ?? {} : null)
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <div className="report-form-card mx-auto p-4 p-lg-5">
        <Link className="small text-success text-decoration-none" to="/dashboard">← Back to my reports</Link>
        <p className="eyebrow mt-4 mb-2">Citizen report</p>
        <h1 className="h2 fw-bold">Report waste accumulation</h1>
        <p className="text-secondary mb-4">
          Provide the details you know. You may add a photo and location; avoid sharing private information.
        </p>

        {error && (
          <div className={`alert ${duplicateReport ? 'alert-warning' : 'alert-danger'}`} id="report-form-error" role="alert">
            {error}
            {duplicateReport?.id && (
              <div className="mt-2">
                <Link to={`/reports/${encodeURIComponent(duplicateReport.id)}`}>View your existing report</Link>
              </div>
            )}
          </div>
        )}

        <form aria-describedby={error ? 'report-form-error' : undefined} onSubmit={handleSubmit} noValidate>
          <div className="mb-3">
            <label className="form-label" htmlFor="report-category">Waste category <span aria-hidden="true">*</span></label>
            <select
              className="form-select form-select-lg"
              id="report-category"
              aria-describedby={fieldErrors.category ? 'report-category-error' : undefined}
              aria-invalid={fieldErrors.category ? 'true' : undefined}
              onChange={(event) => {
                setCategory(event.target.value)
                setFieldErrors((current) => ({ ...current, category: '' }))
              }}
              required
              value={category}
            >
              <option value="">Select a category</option>
              {categories.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
            </select>
            {fieldErrors.category && <div className="invalid-feedback d-block" id="report-category-error">{fieldErrors.category}</div>}
          </div>
          <div className="mb-3">
            <label className="form-label" htmlFor="report-description">Description (optional)</label>
            <textarea
              className="form-control"
              id="report-description"
              aria-describedby={fieldErrors.description ? 'report-description-error' : undefined}
              aria-invalid={fieldErrors.description ? 'true' : undefined}
              maxLength={500}
              onChange={(event) => {
                setDescription(event.target.value)
                setFieldErrors((current) => ({ ...current, description: '' }))
              }}
              rows="4"
              value={description}
            />
            {fieldErrors.description && <div className="invalid-feedback d-block" id="report-description-error">{fieldErrors.description}</div>}
            <div className="form-text">{description.length}/500 characters</div>
          </div>
          <div className="mb-4">
            <label className="form-label" htmlFor="report-image">Waste photo (optional)</label>
            <input
              accept="image/jpeg,image/png,image/webp"
              className="form-control"
              id="report-image"
              aria-describedby={fieldErrors.image ? 'report-image-error' : 'report-image-help'}
              aria-invalid={fieldErrors.image ? 'true' : undefined}
              onChange={handleImageChange}
              type="file"
            />
            <div className="form-text" id="report-image-help">JPEG, PNG, or WebP · maximum 5 MB.</div>
            {fieldErrors.image && <div className="invalid-feedback d-block" id="report-image-error">{fieldErrors.image}</div>}
            {preview && (
              <div className="mt-3">
                <img className="report-photo report-photo-preview" src={preview} alt="Preview of the selected waste photo" />
                <div className="d-flex gap-2 mt-2">
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => updateSelectedImage(null)} type="button">Remove photo</button>
                  <label className="btn btn-sm btn-outline-success mb-0" htmlFor="report-image">Replace photo</label>
                </div>
              </div>
            )}
          </div>

          <fieldset className="border rounded-3 p-3 mb-4">
            <legend className="float-none w-auto px-2 fs-6 fw-semibold">Location (optional)</legend>
            <div className="mb-3">
              <label className="form-label" htmlFor="report-address">Address or landmark</label>
              <p className="form-text">Address search sends the text you enter to OpenStreetMap's public Nominatim service.</p>
              <div className="input-group">
                <input
                  className="form-control"
                  id="report-address"
                  aria-describedby={fieldErrors.address ? 'report-address-error' : undefined}
                  aria-invalid={fieldErrors.address ? 'true' : undefined}
                  maxLength={300}
                  onChange={(event) => {
                    setAddress(event.target.value)
                    setLocationConfirmed(false)
                    setFieldErrors((current) => ({ ...current, address: '' }))
                  }}
                  value={address}
                />
                <button className="btn btn-outline-success" disabled={searching} onClick={searchAddress} type="button">
                  {searching ? 'Searching...' : 'Search address'}
                </button>
              </div>
              {fieldErrors.address && <div className="invalid-feedback d-block" id="report-address-error">{fieldErrors.address}</div>}
            </div>
            <div className="d-flex flex-wrap gap-2 mb-3">
              <button className="btn btn-outline-secondary" disabled={locating} onClick={useCurrentLocation} type="button">
                {locating ? 'Finding location...' : 'Use my current location'}
              </button>
              <span className="form-text align-self-center">Your browser asks permission when you choose this option.</span>
            </div>
            {locationError && <p className="alert alert-warning py-2" role="alert">{locationError}</p>}
            {locationMessage && <p className="small text-success" role="status">{locationMessage}</p>}
            {mapError && <p className="alert alert-warning py-2" role="status">{mapError} You can still select a pin.</p>}
            <p className="small text-secondary">Click the map to place or move the pin. Map data © OpenStreetMap contributors.</p>
            <ReportLocationMap
              location={{ latitude: latitude === '' ? undefined : Number(latitude), longitude: longitude === '' ? undefined : Number(longitude) }}
              onPick={(lat, lon) => setCoordinates(lat, lon, '')}
              onTileError={() => setMapError('Map tiles could not be loaded.')}
              picker
            />
            <div className="row g-3 mt-1">
              <div className="col-sm-6">
                <label className="form-label" htmlFor="report-latitude">Latitude</label>
                <input className="form-control" id="report-latitude" max="90" min="-90" onChange={(event) => {
                  setLatitude(event.target.value)
                  setLocationConfirmed(false)
                  setFieldErrors((current) => ({ ...current, location: '' }))
                }} step="any" type="number" value={latitude} />
              </div>
              <div className="col-sm-6">
                <label className="form-label" htmlFor="report-longitude">Longitude</label>
                <input className="form-control" id="report-longitude" max="180" min="-180" onChange={(event) => {
                  setLongitude(event.target.value)
                  setLocationConfirmed(false)
                  setFieldErrors((current) => ({ ...current, location: '' }))
                }} step="any" type="number" value={longitude} />
              </div>
            </div>
            {fieldErrors.location && <div className="invalid-feedback d-block" id="report-location-error">{fieldErrors.location}</div>}
            {latitude !== '' && longitude !== '' && (
              <div className="form-check mt-3">
                <input className="form-check-input" id="confirm-report-location" checked={locationConfirmed} onChange={(event) => setLocationConfirmed(event.target.checked)} type="checkbox" />
                <label className="form-check-label" htmlFor="confirm-report-location">I confirm this pin marks the report location.</label>
              </div>
            )}
          </fieldset>
          <div className="d-flex flex-wrap gap-3">
            <button className="btn btn-success btn-lg" disabled={submitting} type="submit">
              {submitting ? 'Submitting report...' : 'Submit report'}
            </button>
            <Link className="btn btn-outline-secondary btn-lg" to="/dashboard">Cancel</Link>
          </div>
        </form>
      </div>
    </main>
  )
}
