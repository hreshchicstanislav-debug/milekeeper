/** Full locale flow with a local mock provider. Requires Playwright + Chrome, no live data. */
const { chromium } = require(process.env.MILEKEEPER_PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), assert = require('assert/strict'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { createFixture } = require('./fixtures/i18n-supabase.cjs');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'milekeeper-i18n-'));
let browser, dev, fixture;
(async () => {
    fixture = createFixture();
    await new Promise((resolve, reject) => { fixture.server.once('error', reject); fixture.server.listen(54329, '127.0.0.1', resolve); });
    const root = path.resolve(__dirname, '..');
    const log = fs.openSync(path.join(artifacts, 'server.log'), 'w');
    dev = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), ...(process.env.MILEKEEPER_I18N_PRODUCTION === '1' ? ['start'] : ['dev']), '-p', '3101'], { cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NEXT_PUBLIC_DEV_GUEST_MODE: '0', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key', SUPABASE_URL: 'http://127.0.0.1:54329', SUPABASE_ANON_KEY: 'fixture-anon-key' } });
    let ready = false;
    for (let i = 0; i < 100; i++) {
        if (dev.exitCode !== null)
            throw new Error('Local Next server exited; see ' + artifacts);
        try {
            const response = await fetch('http://localhost:3101/en/login');
            if (response.ok) {
                ready = true;
                break;
            }
        }
        catch { }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready)
        throw new Error('Local server did not become ready');
    browser = await chromium.launch({ ...(process.env.MILEKEEPER_CHROME_PATH ? { executablePath: process.env.MILEKEEPER_CHROME_PATH } : { channel: 'chrome' }), headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
    // Refuse external traffic even if a production build used real public env values.
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return ['localhost', '127.0.0.1'].includes(url.hostname) && ['3101', '54329'].includes(url.port)
            ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const errors = [];
    await page.goto('http://localhost:3101/en');
    await page.waitForURL('**/en/login');
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('body').innerText().then(s => /[А-Яа-яЁё]/.test(s)), false);
    console.log('PASS English anonymous redirect + login + html lang');
    await page.getByRole('button', { name: 'RU', exact: true }).click();
    await page.waitForURL('**/login');
    await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
    console.log('PASS RU switch and reload');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.waitForURL('**/en/login');
    await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
    await page.waitForURL('http://localhost:3101/en');
    await page.goto('http://localhost:3101/en');
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add odometer reading', exact: true }).waitFor();
    console.log('PASS authenticated English home');
    await page.getByRole('button', { name: 'RU', exact: true }).click();
    await page.waitForURL('http://localhost:3101/');
    await page.getByRole('heading', { name: 'Главная', exact: true }).waitFor();
    await page.goBack();
    await page.waitForURL('http://localhost:3101/en');
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    await page.goForward();
    await page.waitForURL('http://localhost:3101/');
    await page.getByRole('heading', { name: 'Главная', exact: true }).waitFor();
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.waitForURL('http://localhost:3101/en');
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    console.log('PASS browser Back/Forward restores locale and server copy');
    await page.getByRole('button', { name: 'Add odometer reading', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByPlaceholder('Enter odometer reading').fill('123456');
    assert.equal(await page.getByPlaceholder('Enter odometer reading').evaluate(input => input.checkValidity()), true);
    await page.getByRole('button', { name: 'Add a note (optional)', exact: false }).click();
    await page.getByPlaceholder('Optional note').fill('Мой черновик');
    await page.getByRole('dialog').getByRole('button', { name: 'RU', exact: true }).click();
    await page.waitForURL('http://localhost:3101/');
    await page.getByRole('dialog').getByRole('heading', { name: 'Добавить пробег', exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('Введите пробег').inputValue(), '123 456');
    assert.equal(await page.getByPlaceholder('Необязательная заметка').inputValue(), 'Мой черновик');
    await page.getByRole('dialog').getByRole('button', { name: 'EN', exact: true }).click();
    await page.waitForURL('**/en');
    await page.getByRole('dialog').getByRole('heading', { name: 'Add odometer reading', exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('Optional note').inputValue(), 'Мой черновик');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    console.log('PASS open modal, odometer and draft survive RU/EN with no logout');
    await page.getByRole('link', { name: '🔧 Items', exact: false }).click();
    await page.waitForURL('**/en/items');
    await page.getByRole('heading', { name: 'Maintenance items', exact: true }).waitFor();
    await page.getByText('Моё масло двигателя', { exact: true }).click();
    await page.waitForURL('**/en/items/' + fixture.id);
    await page.getByRole('button', { name: 'Calculation', exact: true }).click();
    await page.waitForURL('**?tab=calc');
    assert(page.url().includes('/en/items/'));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByPlaceholder('For example: Engine oil').fill('Моё новое имя');
    await page.getByRole('dialog').getByRole('button', { name: 'RU', exact: true }).click();
    await page.waitForURL('**/items/' + fixture.id + '?tab=calc');
    await page.getByPlaceholder('Например: Масло двигателя').waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.getByPlaceholder('Например: Масло двигателя').inputValue(), 'Моё новое имя');
    console.log('PASS item settings draft survives RSC refresh');
    await page.getByRole('dialog').getByRole('button', { name: 'EN', exact: true }).click();
    await page.getByPlaceholder('For example: Engine oil').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('link', { name: '📋 History', exact: false }).click();
    await page.waitForURL('**/en/history');
    await page.getByRole('heading', { name: 'Odometer history', exact: true }).waitFor();
    await page.getByText('120,000 km', { exact: true }).first().waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Odometer history', exact: true }).waitFor();
    console.log('PASS English history + refresh + session');
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const route of ['/en', '/en/items', '/en/history', '/en/items/' + fixture.id + '?tab=calc']) {
            await page.goto('http://localhost:3101' + route);
            await page.waitForLoadState('networkidle');
            const text = (await page.locator('body').innerText()).replaceAll('Моё масло двигателя', '').replaceAll('Моя заметка — не переводить', '').replaceAll('Личная запись', '').replaceAll('Пользовательский комментарий', '');
            assert(!/[А-Яа-яЁё]/.test(text), route + ' Russian system copy remains: ' + text);
            assert.equal(await page.locator('html').getAttribute('lang'), 'en');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    console.log('PASS all English screens contain no Russian system copy and fit 320/390/1280px');
    assert.deepEqual(errors, [], 'Browser errors');
    await page.screenshot({ path: path.join(artifacts, 'en-details.png'), fullPage: true });
    const manifest = await context.request.get('http://localhost:3101/manifest.webmanifest?lang=en');
    const data = await manifest.json();
    assert.equal(data.start_url, '/en');
    assert.equal(data.id, '/');
    console.log('PASS shared English PWA manifest');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
    await page.waitForURL('**/en/login');
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    console.log('PASS logout to English login');
    // Repeat the same OAuth path after logout.
    await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
    await page.waitForURL('http://localhost:3101/en');
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    console.log('PASS repeat mocked Google sign-in remains English');
    await context.close();
    console.log('Artifacts: ' + artifacts);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (browser)
        await browser.close();
    if (dev)
        dev.kill('SIGTERM');
    if (fixture)
        await new Promise(resolve => fixture.server.close(resolve));
});
