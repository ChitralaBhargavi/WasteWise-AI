import { env } from '../config/env.js'
import WasteReport from '../models/WasteReport.js'

const earthRadiusMeters = 6_371_008.8
let reportCreationQueue = Promise.resolve()

export async function findDuplicateReport({ category, location }) {
  if (!hasCoordinates(location)) {
    return null
  }

  const latitudeDelta = env.duplicateReportRadiusMeters / 110_574
  const longitudeScale = Math.cos(toRadians(location.latitude))
  const longitudeDelta = longitudeScale > 0.000001
    ? Math.min(180, env.duplicateReportRadiusMeters / (111_319.49 * longitudeScale))
    : 180
  const longitudeMinimum = location.longitude - longitudeDelta
  const longitudeMaximum = location.longitude + longitudeDelta
  const longitudeRange = longitudeMinimum < -180
    ? {
        $or: [
          { 'location.longitude': { $gte: longitudeMinimum + 360 } },
          { 'location.longitude': { $lte: longitudeMaximum } },
        ],
      }
    : longitudeMaximum > 180
      ? {
          $or: [
            { 'location.longitude': { $gte: longitudeMinimum } },
            { 'location.longitude': { $lte: longitudeMaximum - 360 } },
          ],
        }
      : {
          'location.longitude': {
            $gte: longitudeMinimum,
            $lte: longitudeMaximum,
          },
        }

  const candidates = await WasteReport.find({
    category,
    reviewStatus: { $ne: 'rejected' },
    status: { $nin: ['collected', 'verified'] },
    $and: [
      {
        $or: [
          { reviewStatus: { $in: ['pending_review', 'accepted'] } },
          { status: { $in: ['assigned', 'in_progress'] } },
        ],
      },
      longitudeRange,
    ],
    'location.latitude': {
      $gte: Math.max(-90, location.latitude - latitudeDelta),
      $lte: Math.min(90, location.latitude + latitudeDelta),
    },
  })
    .select('_id reportedBy status reviewStatus location')
    .lean()
    .exec()

  const matchingCandidates = candidates.filter((candidate) => (
    hasCoordinates(candidate.location)
    && distanceInMeters(location, candidate.location) <= env.duplicateReportRadiusMeters
  ))

  return matchingCandidates.find((candidate) => ['assigned', 'in_progress'].includes(candidate.status))
    ?? matchingCandidates[0]
    ?? null
}

export function withReportCreationLock(operation) {
  const result = reportCreationQueue.then(operation)
  reportCreationQueue = result.then(() => undefined, () => undefined)
  return result
}

export function isReportOwner(report, userId) {
  return report.reportedBy.toString() === userId.toString()
}

function hasCoordinates(location) {
  return Number.isFinite(location?.latitude)
    && location.latitude >= -90
    && location.latitude <= 90
    && Number.isFinite(location?.longitude)
    && location.longitude >= -180
    && location.longitude <= 180
}

function distanceInMeters(first, second) {
  const latitudeDifference = toRadians(second.latitude - first.latitude)
  const longitudeDifference = toRadians(second.longitude - first.longitude)
  const firstLatitude = toRadians(first.latitude)
  const secondLatitude = toRadians(second.latitude)
  const haversine = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDifference / 2) ** 2

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, haversine)))
}

function toRadians(degrees) {
  return degrees * Math.PI / 180
}
