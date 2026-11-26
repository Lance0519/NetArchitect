import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateId } from '../src/utils/id';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('produces valid RFC 4122 v4 UUIDs with standard global crypto', () => {
    const a = generateId();
    const b = generateId();
    expect(a).toMatch(UUID_V4_RE);
    expect(b).toMatch(UUID_V4_RE);
    expect(a).not.toBe(b);
  });

  it('falls back cleanly to getRandomValues when randomUUID is missing (Hermes)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i += 1) arr[i] = (i * 17 + 5) & 0xff;
        return arr;
      },
    });
    const id = generateId();
    expect(id).toMatch(UUID_V4_RE);
  });

  it('falls back cleanly when global crypto is completely absent', () => {
    vi.stubGlobal('crypto', undefined);
    const a = generateId();
    const b = generateId();
    expect(a).toMatch(UUID_V4_RE);
    expect(b).toMatch(UUID_V4_RE);
    expect(a).not.toBe(b);
  });
});
