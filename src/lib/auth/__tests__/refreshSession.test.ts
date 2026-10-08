import { describe, expect, it, vi } from 'vitest';
import { refreshAccessToken } from '../refreshSession';
import { classifyAuthFailure } from '../authFailure';
const options = { url: 'https://auth.test', anonKey: 'public-key' };

describe('refresh error classification', () => {
  it.each([
    [400, 'refresh_token_not_found', 'invalid'], [401, 'session_not_found', 'invalid'],
    [400, 'refresh_token_already_used', 'invalid'], [400, 'session_expired', 'invalid'],
    [429, 'session_expired', 'rate-limit'], [503, 'session_expired', 'unavailable'],
    [500, undefined, 'unavailable'], [408, undefined, 'unavailable'],
    [401, undefined, 'unexpected'], [400, 'validation_failed', 'unexpected'],
  ])('classifies HTTP %s/code %s as %s', async (status, code, kind) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code }), { status: status as number }));
    const result = await refreshAccessToken('rt', { ...options, fetchImpl });
    expect(result).toEqual(kind === 'invalid' ? { status: 'invalid' } : { status: 'error', kind });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('classifies a transport failure separately', async () => {
    expect(await refreshAccessToken('rt', { ...options, fetchImpl: vi.fn().mockRejectedValue(new TypeError('offline')) }))
      .toEqual({ status: 'error', kind: 'network' });
  });
  it.each(['{', '{}', '{"access_token":"","refresh_token":"rt"}'])('does not accept a malformed successful response %s', async body => {
    expect(await refreshAccessToken('rt', { ...options, fetchImpl: vi.fn(async () => new Response(body)) }))
      .toEqual({ status: 'error', kind: 'unexpected' });
  });
  it('keeps malformed 4xx errors non-destructive', async () => {
    expect(await refreshAccessToken('rt', { ...options, fetchImpl: vi.fn(async () => new Response('{', { status: 400 })) }))
      .toEqual({ status: 'error', kind: 'unexpected' });
  });
  it('recognizes SDK transport errors without confusing rate limiting', () => {
    expect(classifyAuthFailure({ name: 'AuthRetryableFetchError', status: 0 })).toBe('network');
    expect(classifyAuthFailure({ name: 'AuthRetryableFetchError', status: 429 })).toBe('rate-limit');
  });
});
