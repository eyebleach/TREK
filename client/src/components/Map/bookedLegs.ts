import type { ReservationEndpoint } from '../../types';
import {
  getSpanPhase,
  getTransportForDay,
  getTransportRouteEndpoints,
  isSelfDrivenTransport,
} from '../../utils/dayMerge';
import { orderedEndpoints } from '../../utils/flightLegs';
import { haversineKm } from '../../utils/geo';
import { TRANSPORT_TYPES, type DayRouteInputs } from './dayRoutePlan';

/** A stretch of a day that a booking covers, and how long it is. */
export interface BookedLeg {
  /** `booking:<type>`, such as `booking:train`. Not a routing profile: no road is asked for. */
  mode: string;
  /** Metres between the stations of the booking. */
  distance: number;
}

type Coords = { lat: number; lng: number };

/** The fields of a booking that the measurement below reads. */
type DayBooking = {
  type?: string | null;
  day_id?: number | null;
  end_day_id?: number | null;
  endpoints?: ReservationEndpoint[];
  /** Set by the day plan when it splits a multi-leg booking into one entry per leg. */
  __leg?: { index: number; total: number };
};

const bookingMode = (type: string): string => `booking:${type}`;

/**
 * The coordinates of one endpoint, or null when it has none. Endpoints are typed with
 * coordinates but stored without them when the geocoder found nothing.
 */
const coordsOf = (e: { lat?: number | null; lng?: number | null } | undefined): Coords | null =>
  e && e.lat != null && e.lng != null ? { lat: e.lat, lng: e.lng } : null;

/**
 * The stations a booking runs through, in order. One leg of a multi-leg booking covers
 * its own pair of them, read the way `getTransportRouteEndpoints` reads it, so a
 * four-flight itinerary is measured leg by leg and not four times end to end.
 */
function bookingStations(r: DayBooking): Coords[] {
  const ordered = orderedEndpoints(r);
  const leg = r.__leg;
  if (leg && ordered.length === leg.total + 1) {
    const from = coordsOf(ordered[leg.index]);
    const to = coordsOf(ordered[leg.index + 1]);
    return from && to ? [from, to] : [];
  }
  return ordered
    .filter((e) => e.role === 'from' || e.role === 'to' || e.role === 'stop')
    .map(coordsOf)
    .filter((p): p is Coords => p != null);
}

/** The length of the path through these points, in metres. */
function pathMetres(points: readonly Coords[]): number {
  let km = 0;
  for (let i = 0; i < points.length - 1; i++) {
    km += haversineKm(points[i], points[i + 1]);
  }
  return km * 1000;
}

/**
 * How far one booking carries the traveller on this day, in metres.
 *
 * A car or a bike the traveller drives counts only the hop of this day. On the days a
 * rental is picked up or dropped off, both ends of that hop are the same point, so it
 * adds nothing: those days are the stops, and the roads between them are routed.
 *
 * Everything else is ridden and counts once, on the day it departs, through every
 * station on the way. Measured straight between the stations, which is short of the
 * rails or the road the vehicle really took.
 */
function bookingDistanceOnDay(r: DayBooking, dayId: number): number {
  if (isSelfDrivenTransport(r)) {
    const { from, to } = getTransportRouteEndpoints(r, dayId);
    return from && to ? pathMetres([from, to]) : 0;
  }
  const phase = getSpanPhase(r, dayId);
  if (phase !== 'single' && phase !== 'start') return 0;
  return pathMetres(bookingStations(r));
}

/**
 * The legs of this day that its bookings cover.
 *
 * The day route breaks at every booking, because nobody drives the flight, and the map
 * draws the booking's own line instead. These are the lengths of those lines.
 */
export function bookedLegsForDay(dayId: number, input: DayRouteInputs): BookedLeg[] {
  const { days: allDays, assignments, reservations } = input;
  if (!allDays.some((d) => d.id === dayId)) return [];
  const dayStops = assignments[String(dayId)] || [];
  const dayAssignmentIds = dayStops.filter((a) => a.accommodation_id == null).map((a) => a.id);
  const dayBookings = getTransportForDay({
    reservations: reservations.filter((r) => TRANSPORT_TYPES.includes(r.type)),
    dayId,
    dayAssignmentIds,
    days: allDays,
  });

  const legs: BookedLeg[] = [];
  for (const booking of dayBookings) {
    // A booking without stations, or with both of them on one spot, covers no ground.
    const distance = bookingDistanceOnDay(booking, dayId);
    if (distance <= 0) continue;
    legs.push({ mode: bookingMode(booking.type), distance });
  }
  return legs;
}
