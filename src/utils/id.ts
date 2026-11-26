/**
 * Cross-platform RFC 4122 v4 UUID generator.
 *
 * React Native Hermes does not guarantee `globalThis.crypto.randomUUID()`, so
 * calling it directly crashes on physical Android/iOS builds even though it
 * compiles and passes tests in Node. This helper uses `randomUUID` when
 * available, falls back to `getRandomValues`, and finally a pure-JS fallback.
 */

interface CryptoLike {
  readonly randomUUID?: () => string;
  readonly getRandomValues?: (array: Uint8Array) => Uint8Array;
}

export function generateId(): string {
  const cryptoApi = (globalThis as { readonly crypto?: CryptoLike }).crypto;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Stamp RFC 4122 version 4 (0100xxxx) and variant 1 (10xxxxxx) bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
