const CTCorners = require('../corners.js');

describe('CTCorners.lookaheadM()', () => {
  test('clamps to minimum distance (120m) for low speeds', () => {
    // Very slow speeds should all clamp to 120m
    expect(CTCorners.lookaheadM(10)).toBe(120);
    expect(CTCorners.lookaheadM(30)).toBe(120);
    expect(CTCorners.lookaheadM(71)).toBe(120); // 71 km/h / 3.6 * 6 = 118.33 < 120

    // Exactly at the 120m threshold: 72 km/h / 3.6 * 6 = 120
    expect(CTCorners.lookaheadM(72)).toBe(120);
  });

  test('clamps to minimum distance (120m) for zero, negative, and falsy speeds', () => {
    expect(CTCorners.lookaheadM(0)).toBe(120);
    expect(CTCorners.lookaheadM(-10)).toBe(120); // handles negative gracefully
    expect(CTCorners.lookaheadM(null)).toBe(120);
    expect(CTCorners.lookaheadM(undefined)).toBe(120);
  });

  test('scales proportionally for medium speeds (~6s of travel)', () => {
    // 108 km/h = 30 m/s. 6s travel = 180m
    expect(CTCorners.lookaheadM(108)).toBe(180);

    // 180 km/h = 50 m/s. 6s travel = 300m
    expect(CTCorners.lookaheadM(180)).toBe(300);

    // 216 km/h = 60 m/s. 6s travel = 360m
    expect(CTCorners.lookaheadM(216)).toBe(360);
  });

  test('clamps to maximum distance (450m) for high speeds', () => {
    // 270 km/h = 75 m/s. 6s travel = 450m (exact threshold)
    expect(CTCorners.lookaheadM(270)).toBe(450);

    // 300 km/h = 83.33 m/s. 6s travel = 500m (clamped to 450m)
    expect(CTCorners.lookaheadM(300)).toBe(450);

    // 400 km/h (extremely fast, definitely clamped)
    expect(CTCorners.lookaheadM(400)).toBe(450);
  });
});
