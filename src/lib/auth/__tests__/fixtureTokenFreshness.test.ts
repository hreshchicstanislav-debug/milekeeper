// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createFixture } = require('../../../../scripts/fixtures/i18n-supabase.cjs');

/**
 * Regression: the local synthetic Supabase fixture used to mint its JWT once at start-up.
 * A stand left running for more than the token lifetime (10 h) then answered every
 * /auth/v1/token refresh with an already expired access token, so the browser stayed on
 * "Восстанавливаем сессию…" forever (and a stored old session never recovered).
 */
describe('synthetic Supabase fixture token freshness', () => {
  let server: Server | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await new Promise(resolve => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  const start = async () => {
    const fixture = createFixture();
    server = fixture.server as Server;
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const refresh = async () => (await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })).json();
    return { fixture, refresh };
  };
  const jwtExp = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp as number;

  it('hands out a non-expired token after the fixture has run longer than the token lifetime', async () => {
    const { refresh } = await start();
    const initial = await refresh();
    expect(initial.expires_at).toBeGreaterThan(Date.now() / 1000);

    // Fixture started yesterday: advance the clock by 24 h without restarting it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 24 * 3600 * 1000);

    const renewed = await refresh();
    const now = Date.now() / 1000;
    expect(renewed.expires_at).toBeGreaterThan(now);
    expect(jwtExp(renewed.access_token)).toBeGreaterThan(now);
    expect(jwtExp(renewed.access_token)).toBe(renewed.expires_at);
    expect(renewed.expires_in).toBeGreaterThan(0);
  });

  it('keeps the token stable while it is still valid and exposes the live session object', async () => {
    const { fixture, refresh } = await start();
    const a = await refresh();
    const b = await refresh();
    expect(b.access_token).toBe(a.access_token);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 24 * 3600 * 1000);
    const c = await refresh();
    expect(c.access_token).not.toBe(a.access_token);
    // Browser tests compare Authorization headers against fixture.session.access_token.
    expect(fixture.session.access_token).toBe(c.access_token);
  });
});
