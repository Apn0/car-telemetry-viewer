/**
 * @jest-environment jsdom
 */

const CT = require('../storage.js');

describe('storage.js uuid()', () => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('should generate a valid RFC4122 v4 UUID format', () => {
    const id = CT.uuid();
    expect(id).toMatch(uuidRegex);
  });

  it('should generate unique UUIDs', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = CT.uuid();
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  it('should generate a valid UUID when crypto.randomUUID is not available', () => {
    // Store original crypto.randomUUID
    const originalRandomUUID = global.crypto.randomUUID;

    // Mock crypto.randomUUID to be undefined
    Object.defineProperty(global.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true
    });

    const id = CT.uuid();
    expect(id).toMatch(uuidRegex);

    // Check randomness/uniqueness of the fallback method
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const fallbackId = CT.uuid();
      expect(ids.has(fallbackId)).toBe(false);
      ids.add(fallbackId);
    }

    // Restore original crypto.randomUUID
    Object.defineProperty(global.crypto, 'randomUUID', {
      value: originalRandomUUID,
      configurable: true,
      writable: true
    });
  });
});
