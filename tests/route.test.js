const CTRoute = require('../route.js');

describe('CTRoute.build()', () => {
  beforeEach(() => {
    // Reset state before each test by building with an empty route or just relying on subsequent overwrites
    // actually, CTRoute is a singleton. The easiest way to reset is to call build with minimum valid points,
    // or just let each test completely overwrite the state with its own valid build call.
    // We'll write tests that don't rely on the initial state being totally empty.
  });

  test('returns false when given less than 2 valid points', () => {
    expect(CTRoute.build([])).toBe(false);
    expect(CTRoute.build([{ lat: 10, lon: 10 }])).toBe(false);
  });

  test('filters out invalid points (null, undefined, NaN)', () => {
    const rawPoints = [
      { lat: 10, lon: 10 },
      { lat: null, lon: 10 },
      { lat: 10, lon: undefined },
      { lat: NaN, lon: 10 },
      { lat: 10, lon: "invalid" }, // isNaN("invalid") is true
      { lat: 20, lon: 20 }
    ];

    const result = CTRoute.build(rawPoints, 'test_route');
    expect(result).toBe(true);
    expect(CTRoute.points.length).toBe(2);
    expect(CTRoute.points[0]).toEqual(expect.objectContaining({ lat: 10, lon: 10 }));
    expect(CTRoute.points[1]).toEqual(expect.objectContaining({ lat: 20, lon: 20 }));
  });

  test('calculates distances correctly (distM and totalDistM)', () => {
    const rawPoints = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 }, // 1 degree longitude at equator is ~111km
      { lat: 0, lon: 2 }
    ];

    const result = CTRoute.build(rawPoints, 'distance_route');
    expect(result).toBe(true);

    const points = CTRoute.points;
    expect(points.length).toBe(3);
    expect(points[0].distM).toBe(0);

    // Check if the haversine distance is reasonably close to expected (111.32 km per degree at equator)
    expect(points[1].distM).toBeGreaterThan(111000);
    expect(points[1].distM).toBeLessThan(112000);

    expect(points[2].distM).toBeCloseTo(points[1].distM * 2, -1); // Approx double the distance
    expect(CTRoute.totalDistM).toBe(points[2].distM);
  });

  test('sets loop to true if start and end points are close (< 200m)', () => {
    const rawPoints = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0.001, lon: 0.001 } // Distance from 0,0 is approx 157m (< 200m)
    ];

    CTRoute.build(rawPoints);
    expect(CTRoute.loop).toBe(true);
  });

  test('sets loop to false if start and end points are far (>= 200m)', () => {
    const rawPoints = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0.01, lon: 0.01 } // Distance from 0,0 is approx 1.5km
    ];

    CTRoute.build(rawPoints);
    expect(CTRoute.loop).toBe(false);
  });

  test('sets label correctly, or defaults to "route"', () => {
    CTRoute.build([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], 'My Label');
    expect(CTRoute.name).toBe('My Label');

    CTRoute.build([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }]);
    expect(CTRoute.name).toBe('route');
  });
});
