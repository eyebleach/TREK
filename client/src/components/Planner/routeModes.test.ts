import { Bike, Car, Footprints, Sailboat, Train, Zap } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { routeModeIcon } from './routeModes';

describe('routeModeIcon', () => {
  it('FE-COMP-ROUTEMODES-001: gives each routing profile its own icon', () => {
    expect(routeModeIcon('driving')).toBe(Car);
    expect(routeModeIcon('walking')).toBe(Footprints);
    expect(routeModeIcon('cycling')).toBe(Bike);
    expect(routeModeIcon('plugin:acme/scenic')).toBe(Zap);
    expect(routeModeIcon(null)).toBe(Car);
  });

  it('FE-COMP-ROUTEMODES-002: draws a booking with the icon it has on the map', () => {
    // A day names its train 'booking:train', which is no routing profile, so it used
    // to land on the car fallback like any unknown mode.
    expect(routeModeIcon('booking:train')).toBe(Train);
    expect(routeModeIcon('booking:ferry')).toBe(Sailboat);
    // A booking type the map has no icon for still gets one rather than none.
    expect(routeModeIcon('booking:hovercraft')).toBe(Car);
  });
});
