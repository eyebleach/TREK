import { describe, expect, it } from 'vitest';
import { buildAssignment, buildDay, buildPlace } from '../../../tests/helpers/factories';
import type { AssignmentsMap, Reservation } from '../../types';
import { bookedLegsForDay } from './bookedLegs';

// Every station below sits on one meridian, whole degrees of latitude apart, and a
// degree is 111 km. The expected distances can be checked by eye.
const km = (metres: number) => Math.round(metres / 1000);

const DAYS = [1, 2, 3].map((n) => buildDay({ id: n, day_number: n }));
const NO_ASSIGNMENTS: AssignmentsMap = {};

const station = (lat: number, role: 'from' | 'to' | 'stop', sequence: number) => ({
  role,
  sequence,
  name: `${role} ${sequence}`,
  code: null,
  lat,
  lng: 0,
  timezone: null,
  local_time: null,
  local_date: null,
});

/** A train on day 1, running from the equator to one degree north of it. */
const booking = (over: Record<string, unknown>): Reservation => {
  const base = {
    id: 1,
    trip_id: 1,
    type: 'train',
    title: 'Train',
    day_id: 1,
    end_day_id: 1,
    reservation_time: null,
    reservation_end_time: null,
    endpoints: [station(0, 'from', 0), station(1, 'to', 1)],
  };
  return { ...base, ...over } as unknown as Reservation;
};

const input = (reservations: Reservation[], assignments: AssignmentsMap = NO_ASSIGNMENTS) => ({
  days: DAYS,
  assignments,
  reservations,
  accommodations: [],
  optimizeFromAccommodation: false,
});

describe('bookedLegsForDay', () => {
  it('FE-MAP-BOOKED-001: counts a train, under a mode of its own', () => {
    const legs = bookedLegsForDay(1, input([booking({})]));

    expect(legs).toHaveLength(1);
    expect(legs[0].mode).toBe('booking:train');
    expect(km(legs[0].distance)).toBe(111);
  });

  it('FE-MAP-BOOKED-002: adds up every station on the way, not just the two ends', () => {
    const viaStop = booking({ endpoints: [station(0, 'from', 0), station(1, 'stop', 1), station(2, 'to', 2)] });

    expect(km(bookedLegsForDay(1, input([viaStop]))[0].distance)).toBe(222);
  });

  it('FE-MAP-BOOKED-003: counts an overnight train once, on the day it departs', () => {
    const sleeper = booking({ day_id: 1, end_day_id: 2 });

    expect(bookedLegsForDay(1, input([sleeper]))).toHaveLength(1);
    // Day 2 is the morning it arrives. Counting it there as well would make the trip
    // twice as long as it was.
    expect(bookedLegsForDay(2, input([sleeper]))).toEqual([]);
  });

  it('FE-MAP-BOOKED-004: puts each leg of a multi-leg booking on the day that leg leaves', () => {
    const twoLegs = booking({
      type: 'flight',
      day_id: 1,
      end_day_id: 2,
      endpoints: [station(0, 'from', 0), station(1, 'stop', 1), station(3, 'to', 2)],
      metadata: {
        legs: [
          { dep_day_id: 1, arr_day_id: 1, dep_time: '08:00', arr_time: '10:00' },
          { dep_day_id: 2, arr_day_id: 2, dep_time: '09:00', arr_time: '12:00' },
        ],
      },
    });

    expect(km(bookedLegsForDay(1, input([twoLegs]))[0].distance)).toBe(111);
    expect(km(bookedLegsForDay(2, input([twoLegs]))[0].distance)).toBe(222);
  });

  it('FE-MAP-BOOKED-005: counts a hire car over the hop it is booked for', () => {
    // The day route breaks at every booking, a driven one included, so nothing routes
    // the road from the rental desk to where the car goes back.
    const hired = bookedLegsForDay(1, input([booking({ type: 'car' })]));

    expect(hired).toHaveLength(1);
    expect(hired[0].mode).toBe('booking:car');
    expect(km(hired[0].distance)).toBe(111);
  });

  it('FE-MAP-BOOKED-006: ignores a rental on the days it is only held', () => {
    // The traveller drives it, so those days are their stops, and the roads between
    // the stops are routed and counted already.
    const rental = booking({ type: 'car', day_id: 1, end_day_id: 2 });

    expect(bookedLegsForDay(1, input([rental]))).toEqual([]);
    expect(bookedLegsForDay(2, input([rental]))).toEqual([]);
    // A train over the same two days is ridden, so it does count, on the first.
    expect(bookedLegsForDay(1, input([booking({ day_id: 1, end_day_id: 2 })]))).toHaveLength(1);
  });

  it('FE-MAP-BOOKED-007: ignores a booking without two stations to measure between', () => {
    expect(bookedLegsForDay(1, input([booking({ endpoints: [] })]))).toEqual([]);
    expect(bookedLegsForDay(1, input([booking({ endpoints: [station(0, 'from', 0)] })]))).toEqual([]);
    // Both ends on the same spot is no journey either.
    const onTheSpot = booking({ endpoints: [station(2, 'from', 0), station(2, 'to', 1)] });
    expect(bookedLegsForDay(1, input([onTheSpot]))).toEqual([]);
  });

  it('FE-MAP-BOOKED-008: ignores a booking that belongs to another day, or to no day', () => {
    expect(bookedLegsForDay(3, input([booking({})]))).toEqual([]);
    expect(bookedLegsForDay(1, input([booking({ day_id: null, end_day_id: null })]))).toEqual([]);
  });

  it('FE-MAP-BOOKED-009: ignores a booking pinned to a stop', () => {
    // The day plan shows such a booking at its stop instead of in the timeline, so
    // counting it here would add a leg the reader cannot see.
    const stop = buildAssignment({ id: 42, day_id: 1, order_index: 0, place: buildPlace({ lat: 0, lng: 0 }) });

    expect(bookedLegsForDay(1, input([booking({ assignment_id: 42 })], { '1': [stop] }))).toEqual([]);
  });
});
