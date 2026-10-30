import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'

const defaultMapCenter = [20, 0]

export default function InteractiveLocationMap({ location, picker = false, onPick, onTileError }) {
  const [tileError, setTileError] = useState(false)
  const position = location.latitude !== undefined && location.longitude !== undefined
    ? [location.latitude, location.longitude]
    : null
  const center = position ?? defaultMapCenter

  return (
    <div className={picker ? 'report-location-map report-location-map-picker' : 'report-location-map'}>
      {tileError && <p className="alert alert-warning py-2" role="status">Map tiles could not be loaded. The saved coordinates are still available.</p>}
      <MapContainer center={center} zoom={position ? 15 : 2} scrollWheelZoom keyboard>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          eventHandlers={{ tileerror: () => { setTileError(true); onTileError?.() } }}
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {position && <CircleMarker center={position} radius={9} pathOptions={{ color: '#176b3a', fillOpacity: 0.8 }} />}
        {picker && <LocationClickHandler onPick={onPick} />}
        {picker && <MapRecenter position={position} />}
      </MapContainer>
      {!picker && location.address && <p className="small text-secondary mt-2 mb-0">{location.address}</p>}
    </div>
  )
}

function LocationClickHandler({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

function MapRecenter({ position }) {
  const map = useMap()
  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), 14))
  }, [map, position])
  return null
}
