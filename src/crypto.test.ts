import { describe, expect, it } from 'vitest';
import { secureRandomUuid } from './crypto';

describe('secureRandomUuid', () => {
  it('falls back to getRandomValues when randomUUID is unavailable on LAN HTTP', () => {
    const cryptoApi = {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => { bytes[index] = index; });
        return bytes;
      },
    } as unknown as Crypto;

    const uuid = secureRandomUuid(cryptoApi);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
});
