/** Own-data UI against local synthetic REST/auth. No live account or external network. */
const { chromium } = require(process.env.MILEKEEPER_PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), assert = require('assert/strict'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { createFixture } = require('./fixtures/i18n-supabase.cjs');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'milekeeper-own-data-'));
let browser, app, fixture;
(async () => {
  fixture = createFixture({ mutable: true });
  await new Promise((resolve, reject) => { fixture.server.once('error', reject); fixture.server.listen(54329, '127.0.0.1', resolve); });
  const root = path.resolve(__dirname, '..');
  const log = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  app = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), process.env.MILEKEEPER_I18N_PRODUCTION === '1' ? 'start' : 'dev', '-p', '3101'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NEXT_PUBLIC_DEV_GUEST_MODE: '0', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key', SUPABASE_URL: 'http://127.0.0.1:54329', SUPABASE_ANON_KEY: 'fixture-anon-key' },
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (app.exitCode !== null) throw Error('Next exited: ' + artifacts);
    try { if ((await fetch('http://localhost:3101/login')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'Next did not start');
  browser = await chromium.launch({ ...(process.env.MILEKEEPER_CHROME_PATH ? { executablePath: process.env.MILEKEEPER_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  const context = await browser.newContext({ viewport: { width: 320, height: 844 }, timezoneId: 'Asia/Almaty' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && ['3101', '54329'].includes(url.port) ? route.continue() : route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], requests = [];
  let expectedLoadError = false;
  page.on('pageerror', error => { if (!expectedLoadError) errors.push(error.message); });
  fixture.server.on('request', req => requests.push({ path: req.url, method: req.method }));
  const home = locale => 'http://localhost:3101' + (locale === 'en' ? '/en' : '/');
  const checkLayout = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow');
    assert.equal(await page.locator('.getting-started').evaluate(el => el.scrollWidth > el.clientWidth), false, 'Card overflow');
    for (const action of await page.locator('.getting-started-actions > a, .getting-started-actions > button').all()) {
      await action.scrollIntoViewIfNeeded();
      const bounds = await action.boundingBox();
      const viewport = page.viewportSize();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'Action unreachable');
      assert.equal(await action.evaluate(el => el.scrollWidth > el.clientWidth), false, 'Action label clipped');
    }
  };
  for (const locale of ['ru', 'en']) {
    const en = locale === 'en';
    fixture.setScenario('empty');
    await page.goto(home(locale));
    await page.getByRole('button', { name: en ? 'Continue with Google' : 'Войти через Google', exact: true }).click();
    await page.waitForURL(home(locale));
    for (const [scenario, step] of [['empty', 'odometer'], ['odometer', 'item'], ['item', 'replacement'], ['history', 'history'], ['calendar', 'history']]) {
      fixture.setScenario(scenario);
      await page.goto(home(locale));
      await page.locator(`.getting-started[data-step="${step}"]`).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0, 'Automatic modal');
      assert.equal(await page.locator('.getting-started').count(), 1);
      if (en) {
        const text = (await page.locator('.getting-started').innerText()).replaceAll('Моё масло двигателя', '');
        assert(!/[А-Яа-яЁё]/.test(text), 'Untranslated onboarding');
      }
      for (const [width, height] of [[320, 360], [390, 844], [430, 844], [1280, 900]]) {
        await page.setViewportSize({ width, height }); await checkLayout();
        await page.locator('.home-content').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: path.join(artifacts, `${locale}-${scenario}-${width}.png`) });
      }
      await page.setViewportSize({ width: 320, height: 844 });
      if (scenario === 'odometer') {
        await page.locator('[data-add-mileage-trigger]').click();
        await page.getByRole('dialog').getByRole('button', { name: en ? 'Cancel' : 'Отмена', exact: true }).click();
        assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-add-mileage-trigger')), true, 'Mileage focus returned to another form');
      }
    }
    // Complete the actual form/action/read-back chain using only the local fixture.
    fixture.setScenario('empty'); await page.goto(home(locale));
    await page.getByRole('button', { name: en ? 'Add first reading' : 'Добавить первое показание', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(en ? 'Enter odometer reading' : 'Введите пробег').fill('120000');
    await dialog.getByRole('button', { name: en ? 'Save' : 'Сохранить', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.locator('.getting-started[data-step="item"]').waitFor();
    await page.locator('.getting-started').getByRole('button', { name: en ? 'Add item' : 'Добавить элемент', exact: true }).click();
    await dialog.getByPlaceholder(en ? 'For example: Engine oil' : 'Например: Масло двигателя').fill('Own fixture item');
    await dialog.getByPlaceholder(en ? 'For example: 10,000' : 'Например: 10 000').fill('10000');
    await dialog.locator('button[type="submit"]').click();
    await dialog.waitFor({ state: 'detached' });
    await page.goto(home(locale));
    await page.locator('.getting-started[data-step="replacement"]').waitFor();
    await page.getByRole('link', { name: en ? 'Record last replacement' : 'Указать последнюю замену', exact: true }).click();
    await page.getByRole('button', { name: en ? 'Record replacement' : 'Отметить замену', exact: true }).click();
    await dialog.getByPlaceholder(en ? 'Enter odometer reading' : 'Введите пробег').fill('115000');
    await dialog.getByRole('button', { name: en ? 'Save' : 'Сохранить', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.goto(home(locale)); await page.locator('.getting-started[data-step="history"]').waitFor();
    assert(requests.some(r => r.path.startsWith('/rest/v1/service_events') && r.method === 'POST'));
    console.log(`PASS ${locale}: real forms → local server actions → read-back and next step`);
    // Demo isolation, exit and session continuity.
    const cookiesBefore = (await context.cookies()).filter(c => ['mk_sb_at', 'mk_sb_rt'].includes(c.name));
    await page.waitForLoadState('networkidle');
    const requestStart = requests.length;
    await page.getByRole('link', { name: en ? 'Explore demo' : 'Посмотреть демо', exact: true }).click();
    await page.waitForURL('**' + (en ? '/en/demo' : '/demo'));
    await page.waitForLoadState('networkidle');
    assert.deepEqual(requests.slice(requestStart), [], 'Demo contacted provider');
    if (!await page.getByRole('dialog').count()) await page.getByRole('button', { name: en ? 'About MileKeeper' : 'О MileKeeper', exact: true }).click();
    await page.getByRole('dialog').getByRole('link', { name: en ? 'Use my own data' : 'Перейти к своим данным', exact: true }).click();
    await page.waitForURL(home(locale)); await page.locator('.getting-started[data-step="history"]').waitFor();
    const authValues = cookies => cookies.map(c => [c.name, c.value]).sort();
    assert.deepEqual(authValues((await context.cookies()).filter(c => ['mk_sb_at', 'mk_sb_rt'].includes(c.name))), authValues(cookiesBefore));
    fixture.setScenario('ready'); await page.goto(home(locale)); await page.locator('.mileage-date').waitFor();
    assert.equal(await page.locator('.getting-started').count(), 0, 'Ready account onboarding');
    for (const table of ['odometer_entries', 'service_items', 'service_events']) {
      expectedLoadError = true; fixture.setScenario('error-' + table); await page.goto(home(locale));
      await page.locator('.page-content[role="alert"]').waitFor();
      assert.equal(await page.locator('.getting-started').count(), 0, 'Error rendered empty-account guidance');
      fixture.setScenario('ready'); await page.reload();
      await page.locator('.mileage-date').waitFor(); expectedLoadError = false;
    }
    // Sign out for next locale's mocked Google flow.
    await context.clearCookies(); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    console.log(`PASS ${locale}: 5 states × 4 viewports, demo round-trip, ready account, three load failures + recovery on reload`);
  }
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  await context.close();
  console.log('Artifacts: ' + artifacts);
})().catch(e => { console.error(e); console.error('Artifacts: ' + artifacts); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); app?.kill('SIGTERM');
  await new Promise(resolve => fixture ? fixture.server.close(resolve) : resolve());
});
