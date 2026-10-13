/** Mobile auth recovery with synthetic sessions/provider only. No production requests or data writes. */
const { chromium } = require(process.env.MILEKEEPER_PLAYWRIGHT_PATH || 'playwright');
const { createFixture } = require('./fixtures/i18n-supabase.cjs');
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const out = path.resolve(root, process.env.MILEKEEPER_AUTH_ARTIFACTS || 'artifacts/mobile-auth-recovery');
fs.mkdirSync(out, { recursive: true });
let browser, dev, fixture;
const results = [], errors = [];
const expired = session => ({ ...session, access_token: 'e30.' + Buffer.from(JSON.stringify({
  exp: 1, sub: session.user.id, session_id: '00000000-0000-4000-8000-000000000002',
})).toString('base64url') + '.c2ln', expires_at: 1, expires_in: 1 });
(async () => {
  fixture = createFixture({ rotateAuth: true });
  let exchanges = 0, rlsRequests = 0, rlsHeaderMismatches = 0;
  fixture.server.on('request', req => {
    if (req.url.startsWith('/auth/v1/token')) exchanges++;
    if (req.url.startsWith('/rest/v1/')) {
      rlsRequests++;
      if (req.headers.authorization !== 'Bearer ' + fixture.session.access_token) rlsHeaderMismatches++;
    }
  });
  await new Promise(resolve => fixture.server.listen(54329, '127.0.0.1', resolve));
  const log = fs.openSync(path.join(out, 'browser-server.txt'), 'w');
  dev = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'),
    process.env.MILEKEEPER_AUTH_PRODUCTION === '1' ? 'start' : 'dev', '-p', '3101'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NEXT_PUBLIC_DEV_GUEST_MODE: '0',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key',
      SUPABASE_URL: 'http://127.0.0.1:54329', SUPABASE_ANON_KEY: 'fixture-anon-key' },
  });
  for (let i = 0; i < 100; i++) {
    if (dev.exitCode !== null) throw Error('Next server exited');
    try { if ((await fetch('http://localhost:3101/login')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const run = async (name, test) => {
    if (process.env.MILEKEEPER_AUTH_CASE && !name.includes(process.env.MILEKEEPER_AUTH_CASE)) return;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
      hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      return ['localhost', '127.0.0.1'].includes(u.hostname) && ['3101', '54329'].includes(u.port)
        ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const authResponses = [];
    const routeRequests = [];
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (['/', '/en', '/en/history', '/auth/recover'].includes(pathname)) {
        routeRequests.push({ pathname, rsc: request.headers().rsc === '1', navigation: request.isNavigationRequest() });
      }
    });
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/api/auth/') || pathname.startsWith('/auth/v1/')) authResponses.push({ pathname, status: response.status() });
    });
    page.on('pageerror', error => errors.push({ test: name, message: error.message }));
    fixture.setAuthScenario('ok');
    try { await test(page, context); results.push({ name, passed: true }); console.log('PASS', name); }
    catch (error) {
      const jar = await context.cookies();
      const sdk = await page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token') || 'null'));
      const pairStatus = { cookieAccessFresh: jar.find(c => c.name === 'mk_sb_at')?.value === fixture.session.access_token,
        refreshCopiesMatch: !!sdk && sdk.refresh_token === jar.find(c => c.name === 'mk_sb_rt')?.value };
      results.push({ name, passed: false, page: new URL(page.url()).pathname, authResponses, routeRequests, pairStatus });
      await page.screenshot({ path: path.join(out, 'mobile-failed.png'), fullPage: true });
      throw error;
    } finally { await context.close(); }
  };
  const storage = async (page, session) => {
    await page.goto('http://localhost:3101/login?reauth=1');
    await page.waitForLoadState('networkidle');
    await page.evaluate(value => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), session);
  };
  const cookies = async (context, session) => context.addCookies([
    { name: 'mk_sb_at', value: session.access_token, url: 'http://localhost:3101', httpOnly: true },
    { name: 'mk_sb_rt', value: session.refresh_token, url: 'http://localhost:3101', httpOnly: true },
  ]);
  const home = page => page.locator('[data-add-mileage-trigger]').waitFor();
  for (const locale of ['ru', 'en']) for (const entry of ['direct', 'reload', 'bookmark-new-tab', 'manifest-start-url']) {
    for (const state of ['valid', 'absent', 'invalid']) {
      await run(`${locale} root ${entry}, ${state} session`, async (initialPage, context) => {
        let page = initialPage;
        const rootPath = locale === 'en' ? '/en' : '/';
        const loginPath = locale === 'en' ? '/en/login' : '/login';
        const documents = [];
        context.on('response', response => {
          if (response.request().isNavigationRequest() && response.request().frame().parentFrame() === null) {
            const pathname = new URL(response.url()).pathname;
            documents.push({ pathname, status: response.status(), cache: response.headers()['cache-control'] });
          }
        });
        if (state === 'valid' || entry === 'reload') {
          await storage(page, fixture.session); await cookies(context, fixture.session);
        } else {
          await page.goto('http://localhost:3101/login?reauth=1');
        }
        if (entry === 'reload') {
          await page.goto(`http://localhost:3101${rootPath}`); await home(page);
          await page.waitForLoadState('networkidle');
        }
        if (state !== 'valid') {
          await context.clearCookies();
          await page.evaluate(() => localStorage.removeItem('sb-127-auth-token'));
          if (state === 'invalid') await cookies(context, expired(fixture.session));
          fixture.setAuthScenario(state === 'invalid' ? 'invalid' : 'ok');
        }
        const count = exchanges;
        documents.length = 0;
        let destination = rootPath;
        if (entry === 'manifest-start-url') {
          const manifest = await (await context.request.get(`http://localhost:3101/manifest.webmanifest?lang=${locale}`)).json();
          assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/');
          assert.equal(manifest.start_url, rootPath); destination = manifest.start_url;
        }
        if (entry === 'bookmark-new-tab') {
          page = await context.newPage();
          page.on('pageerror', error => errors.push({ test: `bookmark-${locale}-${state}`, message: error.message }));
        }
        if (entry === 'reload') await page.reload();
        else await page.goto(`http://localhost:3101${destination}`);
        if (state === 'valid') {
          await home(page); assert.equal(new URL(page.url()).pathname, rootPath);
          assert(!documents.some(d => d.pathname === '/auth/recover' || d.pathname.endsWith('/login')));
        } else if (state === 'absent') {
          await page.waitForURL(`http://localhost:3101${loginPath}`);
          await page.getByRole('button', { name: /Войти через Google|Continue with Google/ }).waitFor();
          assert.equal(exchanges, count, 'absent session never calls the token endpoint');
        } else {
          await page.getByRole('button', { name: locale === 'en' ? 'Try again' : 'Повторить', exact: true }).waitFor();
          assert.equal(new URL(page.url()).pathname, '/auth/recover');
          const link = page.getByRole('link', { name: locale === 'en' ? 'Sign in with Google' : 'Войти через Google', exact: true });
          assert.equal(await link.getAttribute('href'), `${loginPath}?reauth=1`);
          assert.equal(exchanges - count, 1, 'invalid token exchanged once');
        }
        await page.waitForLoadState('networkidle');
        const before = documents.length;
        await page.waitForTimeout(300);
        assert.equal(documents.length, before, 'no redirect loop');
        assert(documents.length <= 3, 'bounded root/recovery/login navigation');
        assert(documents.every(d => d.status < 400 && d.cache?.includes('no-store')));
        assert(!await page.getByText('Could not refresh your session. Please reload the page later.', { exact: true }).count());
        assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
      });
    }
  }
  await run('public RU/EN demo remains isolated with rejected cookies', async (page, context) => {
    await cookies(context, expired(fixture.session)); fixture.setAuthScenario('invalid');
    const count = exchanges;
    for (const pathname of ['/demo', '/en/demo']) {
      const response = await page.goto(`http://localhost:3101${pathname}`);
      await page.waitForLoadState('networkidle');
      assert.equal(response.status(), 200); assert.equal(new URL(page.url()).pathname, pathname);
      assert.equal(exchanges, count); assert.equal((await context.cookies()).find(c => c.name === 'mk_sb_rt').value, fixture.session.refresh_token);
    }
  });
  await run('manual /login remains usable after the root recovery encounters an outage', async (page, context) => {
    await cookies(context, expired(fixture.session)); fixture.setAuthScenario('unavailable');
    await page.goto('http://localhost:3101/');
    await page.getByRole('button', { name: 'Повторить', exact: true }).waitFor();
    await page.goto('http://localhost:3101/login'); await page.waitForLoadState('networkidle');
    fixture.setAuthScenario('ok');
    await page.getByRole('button', { name: 'Войти через Google', exact: true }).click(); await home(page);
  });
  await run('expired phone session restores automatically; SDK and cookies agree', async (page, context) => {
    const old = expired(fixture.session);
    await storage(page, old); await cookies(context, old);
    await page.goto('http://localhost:3101/'); await home(page);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token')));
    const jar = await context.cookies();
    assert.equal(saved.refresh_token, jar.find(c => c.name === 'mk_sb_rt').value);
    await page.screenshot({ path: path.join(out, 'mobile-restored.png'), fullPage: true });
    const count = exchanges;
    await page.waitForTimeout(1500);
    assert.equal(exchanges, count, 'no repeated exchange loop');
  });
  await run('stale server cookies recover from the valid SDK copy', async (page, context) => {
    await storage(page, fixture.session); await cookies(context, expired(fixture.session));
    await page.goto('http://localhost:3101/en/history');
    await page.waitForURL('**/en/history');
    await page.waitForLoadState('networkidle');
    assert(!page.url().includes('recover'));
    const jar = await context.cookies();
    const rt = await page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token')).refresh_token);
    assert.equal(rt, jar.find(c => c.name === 'mk_sb_rt').value);
  });
  await run('missing browser storage restores valid cookie-only session', async (page, context) => {
    await cookies(context, expired(fixture.session));
    await page.goto('http://localhost:3101/'); await home(page);
    assert(await page.evaluate(() => !!localStorage.getItem('sb-127-auth-token')));
  });
  await run('provider outage preserves cookies; manual retry recovers', async (page, context) => {
    await cookies(context, expired(fixture.session)); fixture.setAuthScenario('unavailable');
    const count = exchanges;
    await page.goto('http://localhost:3101/');
    await page.getByRole('button', { name: 'Повторить', exact: true }).waitFor();
    assert.equal(exchanges - count, 2, 'bounded transport retry');
    const before = (await context.cookies()).find(c => c.name === 'mk_sb_rt').value;
    await page.waitForTimeout(1200); assert.equal(exchanges - count, 2);
    assert.equal((await context.cookies()).find(c => c.name === 'mk_sb_rt').value, before);
    await page.screenshot({ path: path.join(out, 'mobile-retry.png'), fullPage: true });
    fixture.setAuthScenario('ok');
    await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await home(page);
  });
  await run('network failure offers retry without clearing the session', async (page, context) => {
    await cookies(context, expired(fixture.session));
    await page.route('**/api/auth/recover', route => route.abort('failed'));
    await page.goto('http://localhost:3101/');
    await page.getByRole('button', { name: 'Повторить', exact: true }).waitFor();
    assert((await context.cookies()).some(c => c.name === 'mk_sb_rt'));
    await page.unroute('**/api/auth/recover');
    await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await home(page);
  });
  await run('invalid token offers Google re-login without automatic loops', async (page, context) => {
    await cookies(context, expired(fixture.session)); fixture.setAuthScenario('invalid');
    const count = exchanges;
    await page.goto('http://localhost:3101/');
    const link = page.getByRole('link', { name: 'Войти через Google', exact: true }); await link.waitFor();
    await page.waitForTimeout(1200); assert.equal(exchanges - count, 1);
    await page.screenshot({ path: path.join(out, 'mobile-login-required.png'), fullPage: true });
    fixture.setAuthScenario('ok');
    await link.click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Войти через Google/ }).click(); await home(page);
  });
  await run('invalid session during editing preserves draft through re-login in a new tab', async (page, context) => {
    await storage(page, fixture.session); await cookies(context, fixture.session);
    await page.goto('http://localhost:3101/'); await home(page);
    await page.locator('[data-add-mileage-trigger]').click();
    await page.locator('#mileageKm').fill('123456');
    fixture.setAuthScenario('invalid');
    await page.evaluate(value => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(value));
      document.dispatchEvent(new Event('visibilitychange'));
    }, expired(fixture.session));
    const login = page.getByRole('link', { name: 'Войти через Google', exact: true }); await login.waitFor();
    assert.equal(await page.locator('#mileageKm').inputValue(), '123 456');
    assert.equal(await login.getAttribute('target'), '_blank');
    fixture.setAuthScenario('ok');
    const popupPromise = page.waitForEvent('popup'); await login.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('networkidle');
    await popup.getByRole('button', { name: /Войти через Google/ }).click(); await home(popup);
    // SDK cross-tab broadcast adopts the new login; original form stays mounted.
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#mileageKm').inputValue(), '123 456');
    assert.equal(new URL(page.url()).pathname, '/');
    await page.screenshot({ path: path.join(out, 'mobile-draft-preserved.png'), fullPage: true });
    await popup.close();
  });
  assert(rlsRequests > 0, 'server data requests verified');
  assert.equal(rlsHeaderMismatches, 0, 'every data request carries the validated user JWT');
  assert.deepEqual(errors, [], 'no browser runtime errors');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ results, errors }, null, 2));
  if (browser) await browser.close(); if (dev) dev.kill('SIGTERM'); if (fixture) fixture.server.close();
});
