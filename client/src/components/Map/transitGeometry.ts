import { haversineKm } from '../../utils/geo'

/**
 * Real-path geometry for transit journeys on the map (#1065). MOTIS delivers
 * each leg's shape as a Google-encoded polyline; we store it on
 * metadata.transit.legs[].geometry and decode it here so the map can draw the
 * actual rail/bus alignment instead of a straight line.
 */

export interface TransitMapSegment {
  coords: [number, number][]
  color: string | null
  walk: boolean
}

/** Google polyline decoding with a configurable precision (MOTIS uses 6). */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = Math.pow(10, precision)
  const coords: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0
      let shift = 0
      let byte = 0x20
      while (byte >= 0x20) {
        if (index >= encoded.length) return coords
        byte = encoded.codePointAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      }
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lng += delta
    }
    coords.push([lat / factor, lng / factor])
  }
  return coords
}

type TransitBooking = { type?: string | null; metadata?: unknown }

/** The legs of a transit journey as they were stored, or [] for any other booking. */
function storedLegs(res: TransitBooking): any[] {
  if (res.type !== 'transit') return []
  let meta: any = res.metadata
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta) } catch { return [] }
  }
  const legs = meta?.transit?.legs
  return Array.isArray(legs) ? legs : []
}

/** The decoded shape of one stored leg, or [] when it was saved without one. */
function legShape(leg: any): [number, number][] {
  if (!leg?.geometry || typeof leg.geometry !== 'string') return []
  const coords = decodePolyline(leg.geometry, typeof leg.geometry_precision === 'number' ? leg.geometry_precision : 6)
  return coords.length >= 2 ? coords : []
}

/**
 * The decoded per-leg segments of a transit reservation, or [] when it has no
 * stored geometry (pre-geometry entries fall back to the straight line).
 */
export function getTransitMapSegments(res: TransitBooking): TransitMapSegment[] {
  const out: TransitMapSegment[] = []
  for (const leg of storedLegs(res)) {
    const coords = legShape(leg)
    if (!coords.length) continue
    out.push({ coords, color: leg.line_color || null, walk: leg.mode === 'WALK' })
  }
  return out
}

/** How far one leg of a journey runs, and whether it is walked. */
export interface TransitLegDistance {
  walk: boolean
  /** Metres: what the provider measured, else the length of the shape it drew, else null. */
  metres: number | null
}| null
}

/**
 * Every leg of a transit journey, in order, with how far it runs where that is known.
 *
 * The provider's own figure comes first, because it is the only one that follows the
 * track. A journey saved before that figure was stored falls back to the shape on the
 * map. A leg with neither returns null, and the caller falls back to the stations.
 */
export function transitLegDistances(res: TransitBooking): TransitLegDistance[] {
  return storedLegs(res).map(leg => {
    const reported = typeof leg?.distance === 'number' && leg.distance > 0 ? leg.distance : null
    const shape = reported === null ? legShape(leg) : []
    let metres = reported
    for (let i = 1; i < shape.length; i++) {
      metres = (metres ?? 0) + haversineKm({ lat: shape[i - 1][0], lng: shape[i - 1][1] }, { lat: shape[i][0], lng: shape[i][1] }) * 1000
    }
    return { walk: leg?.mode === 'WALK', metres }
  })
}
