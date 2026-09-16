import { describe, it, expect } from 'vitest';
import {
  ACCESS_TOKEN_REFRESH_MARGIN_SEC,
  isAccessTokenFresh,
  readAccessTokenExp,
} from '../accessToken';

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const NOW = 1_800_000_000_000; // fixed clock, ms

describe('readAccessTokenExp', () => {
  it('reads the exp claim', () => {
    expect(readAccessTokenExp(makeJwt({ exp: 1234, sub: 'user-1' }))).toBe(1234);
  });

  it('survives a payload containing non-ASCII characters', () => {
    const token = makeJwt({ exp: 99, user_metadata: { name: 'Станислав' } });
    expect(readAccessTokenExp(token)).toBe(99);
  });

  it('returns null for malformed input instead of throwing', () => {
    expect(readAccessTokenExp('not-a-jwt')).toBeNull();
    expect(readAccessTokenExp('a.b.c')).toBeNull();
    expect(readAccessTokenExp('')).toBeNull();
    expect(readAccessTokenExp(makeJwt({ sub: 'no-exp' }))).toBeNull();
  });
});

describe('isAccessTokenFresh', () => {
  it('is true well before expiry', () => {
    const token = makeJwt({ exp: NOW / 1000 + 3600 });
    expect(isAccessTokenFresh(token, NOW)).toBe(true);
  });

  it('is false once expired', () => {
    const token = makeJwt({ exp: NOW / 1000 - 1 });
    expect(isAccessTokenFresh(token, NOW)).toBe(false);
  });

  it('is false inside the margin, so the token cannot expire mid-render', () => {
    const insideMargin = makeJwt({ exp: NOW / 1000 + ACCESS_TOKEN_REFRESH_MARGIN_SEC - 1 });
    const outsideMargin = makeJwt({ exp: NOW / 1000 + ACCESS_TOKEN_REFRESH_MARGIN_SEC + 1 });
    expect(isAccessTokenFresh(insideMargin, NOW)).toBe(false);
    expect(isAccessTokenFresh(outsideMargin, NOW)).toBe(true);
  });

  it('refreshes rather than trusts an undecodable token', () => {
    expect(isAccessTokenFresh('garbage', NOW)).toBe(false);
  });

  it('stays below auth-js EXPIRY_MARGIN_MS so the browser refreshes first', () => {
    // auth-js refreshes at 90s remaining; the request boundary must be the
    // fallback, not the primary refresher.
    expect(ACCESS_TOKEN_REFRESH_MARGIN_SEC).toBeLessThan(90);
  });
});
