import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserTabCoordination } from '../sessionTabCoordination';
const tokens = { access_token: 'secret-access', refresh_token: 'secret-refresh' };
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('window', { crypto: webcrypto, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  vi.stubGlobal('navigator', {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('shares only a fingerprint and expires deduplication after ten seconds', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100000);
  const tabs = browserTabCoordination();
  await tabs.confirm(tokens);
  const stored = Array.from(storage.values()).join('');
  expect(stored).not.toContain(tokens.access_token);
  expect(stored).not.toContain(tokens.refresh_token);
  expect(await tabs.isConfirmed(tokens)).toBe(true);
  expect(await tabs.isConfirmed({ ...tokens, refresh_token: 'other' })).toBe(false);
  now.mockReturnValue(110000);
  expect(await tabs.isConfirmed(tokens)).toBe(false);
  await tabs.confirm(null);
  expect(storage.size).toBe(0);
});
it('uses a separate cross-tab Web Lock when available', async () => {
  const request = vi.fn(async (_name: string, options: { signal: AbortSignal }, work: () => Promise<boolean>) => work());
  vi.stubGlobal('navigator', { locks: { request } });
  const tabs = browserTabCoordination();
  expect(await tabs.exclusive(async () => true)).toBe(true);
  expect(request.mock.calls[0][0]).toBe('milekeeper-auth-cookie-sync');
  expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it('falls back to bounded marker deduplication when Web Locks are absent', async () => {
  expect(await browserTabCoordination().exclusive(async () => true)).toBe(true);
});
