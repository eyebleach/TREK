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
import { transitLegDistances } from './transitGeometry';

/** A stretch of a day that a booking covers, and how long it is. */
export interface BookedLeg {
  /** `booking:<type>`, such as `booking:train`. Not a routing profile: no road is asked for. */
  mode: string;
  /** Metres: what the provider measured, what the booking draws, or between its stations. */
  distance: number;
}

type Coords = { lat: number; lng: number };

/** The fields of a booking that the measurement below reads. */
type DayBooking = {
  type?: string | null;
  day_id?: number | null;
  end_day_id?: number | null;
  endpoints?: ReservationEndpoint[];
  metadata?: unknown;
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
 * How far a transit journey runs, leg by leg.
 *
 * A journey stores one station more than it has ridden legs: the origin, every
 * transfer, the destination. Leg `i` therefore runs from stop `i` to stop `i + 1` and
 * is at least the straight line between the two. Each leg is floored that way on its
 * own, because measured over the whole journey a leg without a figure of its own
 * disappeared behind the legs that have one.
 */
function transitJourneyMetres(r: DayBooking, stops: readonly Coords[]): number {
  const legs = transitLegDistances(r);
  const aligned = stops.length === legs.filter((leg) => !leg.walk).length + 1;
  let metres = 0;
  let i = 0;
  for (const leg of legs) {
    if (leg.walk) {
      metres += leg.metres ?? 0;
      continue;
    }
    metres += Math.max(leg.metres ?? 0, aligned ? pathMetres([stops[i], stops[i + 1]]) : 0);
    i++;
  }
  return metres;
}

/**
 * How far one booking carries the traveller on this day, in metres.
 *
 * A car or a bike the traveller drives counts only the hop of this day. On the days a
 * rental is picked up or dropped off, both ends of that hop are the same point, so it
 * adds nothing: those days are the stops, and the roads between them are routed.
 *
 * Everything else is ridden and counts once, on the day it departs. A transit journey
 * is measured by what its provider reported. Any other booking is measured straight
 * between its stations, which is all such a booking carries and is short of the track.
 */
function bookingDistanceOnDay(r: DayBooking, dayId: number): number {
  if (isSelfDrivenTransport(r)) {
    const { from, to } = getTransportRouteEndpoints(r, dayId);
    return from && to ? pathMetres([from, to]) : 0;
  }
  const phase = getSpanPhase(r, dayId);
  if (phase !== 'single' && phase !== 'start') return 0;
  const stops = bookingStations(r);
  return Math.max(pathMetres(stops), transitJourneyMetres(r, stops));
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
