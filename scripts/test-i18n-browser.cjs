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
    const browserRequests = [], providerRequests = [], providerMethods = [], demoConsoleErrors = [];
    let inDemo = false, demoStage = 'outside demo';
    page.on('console', message => { if (inDemo && message.type() === 'error') demoConsoleErrors.push(message.text()); });
    page.on('request', request => browserRequests.push({ url: request.url(), method: request.method(), action: request.headers()['next-action'] }));
    fixture.server.on('request', request => {
        providerRequests.push(request.url);
        providerMethods.push({ path: new URL(request.url, 'http://localhost:54329').pathname, method: request.method });
    });
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR at ' + page.url() + ' (' + demoStage + '): ' + error.message); });
    const welcomeKey = 'milekeeper.demo.welcome.v1';
    const testWelcome = async () => {
        inDemo = true;
        const providerStart = providerRequests.length, browserStart = browserRequests.length;
        const beforeStorage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
        const beforeCookies = await context.cookies();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('heading', { name: 'Обслуживание автомобиля под контролем', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('milekeeper.demo.welcome.v1')), null, 'Marker written before dismissal');
        assert.equal(await page.evaluate(() => document.activeElement?.className), 'demo-welcome-close');
        assert.equal(await page.locator('body').evaluate(body => body.style.position), 'fixed');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        for (const locale of ['ru', 'en']) {
            if (locale === 'en') await dialog.getByRole('button', { name: 'EN', exact: true }).click();
            await dialog.getByRole('heading', { name: locale === 'en' ? 'Keep your car maintenance on track' : 'Обслуживание автомобиля под контролем', exact: true }).waitFor();
            await page.waitForLoadState('networkidle');
            assert.equal(await dialog.count(), 1);
            for (const [width, height] of [[320, 844], [360, 640], [390, 844], [430, 844], [1280, 900], [320, 360]]) {
                await page.setViewportSize({ width, height });
                await dialog.evaluate(element => { element.scrollTop = 0; });
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                const bounds = await dialog.boundingBox();
                assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, 'Welcome outside viewport');
                assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false, 'Welcome horizontal overflow');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Page horizontal overflow');
                await page.screenshot({ path: path.join(artifacts, `welcome-${locale}-${width}x${height}.png`) });
                const explore = dialog.getByRole('button', { name: locale === 'en' ? 'Explore demo' : 'Исследовать демо', exact: true });
                await explore.scrollIntoViewIfNeeded();
                const button = await explore.boundingBox();
                assert(button && button.y >= bounds.y && button.y + button.height <= bounds.y + bounds.height, 'Primary button unreachable');
                const ownData = dialog.getByRole('link', { name: locale === 'en' ? 'Use my own data' : 'Перейти к своим данным', exact: true });
                assert.equal(await ownData.getAttribute('href'), locale === 'en' ? '/en' : '/');
                await ownData.scrollIntoViewIfNeeded();
                const secondary = await ownData.boundingBox();
                assert(secondary && secondary.y >= bounds.y && secondary.y + secondary.height <= bounds.y + bounds.height, 'Secondary button unreachable');
                assert.equal(await ownData.evaluate(element => element.scrollWidth > element.clientWidth), false, 'Secondary label clipped');
                if (height === 360) await page.screenshot({ path: path.join(artifacts, `welcome-${locale}-320x360-bottom.png`) });
            }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        const close = dialog.getByRole('button', { name: 'Close welcome', exact: true });
        await close.focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Explore demo');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Use my own data');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'RU');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Use my own data');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Explore demo');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'About MileKeeper', 'Focus not returned');
        assert.equal(await page.locator('body').evaluate(body => body.style.position), '');
        assert.equal(await page.evaluate(() => localStorage.getItem('milekeeper.demo.welcome.v1')), 'seen');
        await page.reload(); await page.waitForLoadState('networkidle');
        assert.equal(await dialog.count(), 0, 'Refresh reopened welcome');
        await page.goto('http://localhost:3101/demo'); await page.waitForLoadState('networkidle');
        assert.equal(await dialog.count(), 0, 'RU revisit reopened welcome');
        await page.goto('http://localhost:3101/en/demo'); await page.waitForLoadState('networkidle');
        assert.equal(await dialog.count(), 0, 'EN revisit reopened welcome');
        await page.getByRole('button', { name: 'About MileKeeper', exact: true }).click();
        await dialog.waitFor();
        await dialog.getByRole('button', { name: 'RU', exact: true }).click();
        await dialog.getByRole('heading', { name: 'Обслуживание автомобиля под контролем', exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Закрыть приветствие', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'О MileKeeper', exact: true }).click();
        await dialog.getByRole('button', { name: 'Исследовать демо', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        assert((await page.locator('.demo-odometer').innerText()).includes('122\u00a0280'), 'Reopen changed demo data');
        assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: { ...beforeStorage.local, [welcomeKey]: 'seen' }, session: beforeStorage.session }, 'Welcome changed other storage');
        assert.deepEqual(await context.cookies(), beforeCookies, 'Welcome changed cookies');
        assert.deepEqual(providerRequests.slice(providerStart), [], 'Welcome requested provider');
        assert.deepEqual(browserRequests.slice(browserStart).filter(r => new URL(r.url).pathname.startsWith('/api/') || r.action || r.method !== 'GET'), [], 'Welcome requested API/action');
        assert.deepEqual(demoConsoleErrors, [], 'Welcome console errors');
        inDemo = false;
        console.log('PASS welcome first RU load, locale changes while open, Escape/cross/primary, focus/trap/scroll, shared marker, refresh/revisit/reopen, reduced motion, 320–1280px and short viewport, isolation');
    };
    const testFreshWelcome = async storageDenied => {
        const fresh = await browser.newContext({ viewport: { width: 320, height: 360 } });
        await fresh.route('**/*', route => {
            const url = new URL(route.request().url());
            return ['localhost', '127.0.0.1'].includes(url.hostname) && ['3101', '54329'].includes(url.port) ? route.continue() : route.abort();
        });
        if (storageDenied) await fresh.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage denied', 'SecurityError'); } }));
        const visitor = await fresh.newPage();
        const consoleErrors = [], requests = [];
        visitor.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        visitor.on('pageerror', error => errors.push(error.message));
        visitor.on('request', request => requests.push({ url: request.url(), method: request.method(), action: request.headers()['next-action'] }));
        const providerStart = providerRequests.length;
        await visitor.goto('http://localhost:3101/en/demo');
        await visitor.getByRole('dialog').getByRole('heading', { name: 'Keep your car maintenance on track', exact: true }).waitFor();
        await visitor.screenshot({ path: path.join(artifacts, `welcome-fresh-en-${storageDenied ? 'denied' : 'available'}-320x360.png`) });
        await visitor.getByRole('dialog').getByRole('button', { name: 'Explore demo', exact: true }).click();
        await visitor.getByRole('dialog').waitFor({ state: 'detached' });
        await visitor.reload(); await visitor.waitForLoadState('networkidle');
        assert.equal(await visitor.getByRole('dialog').count(), storageDenied ? 1 : 0);
        if (storageDenied) await visitor.keyboard.press('Escape');
        await visitor.goto('http://localhost:3101/demo'); await visitor.waitForLoadState('networkidle');
        assert.equal(await visitor.getByRole('dialog').count(), storageDenied ? 1 : 0);
        assert.deepEqual(providerRequests.slice(providerStart), []);
        assert.deepEqual(requests.filter(r => new URL(r.url).pathname.startsWith('/api/') || r.action || r.method !== 'GET'), []);
        assert.deepEqual(consoleErrors, []);
        await fresh.close();
        console.log('PASS fresh EN visitor and ' + (storageDenied ? 'denied storage fallback' : 'EN-to-RU dismissal persistence'));
    };
    const testDemo = async authenticated => {
        await page.waitForLoadState('networkidle');
        const stored = async () => ({
            cookies: (await context.cookies()).sort((a, b) => a.name.localeCompare(b.name)),
            storage: await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
        });
        const before = await stored();
        const providerStart = providerRequests.length, browserStart = browserRequests.length;
        inDemo = true;
        for (const locale of ['ru', 'en']) {
            const prefix = locale === 'en' ? '/en' : '';
            demoStage = `demo ${authenticated ? 'authenticated' : 'anonymous'} ${locale} goto`;
            await page.goto('http://localhost:3101' + prefix + '/demo');
            await page.getByText(locale === 'en' ? 'Demo · fictional data' : 'Демонстрация · вымышленные данные', { exact: true }).waitFor();
            demoStage = `demo ${authenticated ? 'authenticated' : 'anonymous'} ${locale} reload`;
            await page.reload();
            await page.waitForLoadState('networkidle');
            assert.equal(await page.getByRole('dialog').count(), 0, 'Welcome reopened for returning visitor');
            assert.equal(await page.locator('html').getAttribute('lang'), locale);
            assert.equal(await page.locator('nav').count(), 0, 'Demo mounted private navigation');
            const text = await page.locator('body').innerText();
            assert(text.includes(locale === 'en' ? '122,280' : '122\u00a0280'), 'Derived odometer absent');
            assert(text.includes(locale === 'en' ? 'Not enough data' : 'Недостаточно данных'));
            if (locale === 'en') assert(!/[А-Яа-яЁё]/.test(text), 'Russian demo copy');
            for (const width of [320, 360, 390, 430, 1280]) {
                await page.setViewportSize({ width, height: 844 });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Demo overflow ' + locale + ' ' + width);
                assert.deepEqual(await page.locator('.demo-rows .status-row-compact-title, .demo-rows .status-row-detail-title').evaluateAll(elements => elements.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)), [], 'Truncated demo titles');
                if (width === 320 || width === 1280) await page.screenshot({ path: path.join(artifacts, `demo-${authenticated ? 'authed' : 'guest'}-${locale}-${width}.png`), fullPage: true });
                if (width === 430) await page.screenshot({ path: path.join(artifacts, `demo-${authenticated ? 'authed' : 'guest'}-${locale}-430-viewport.png`) });
            }
            await page.locator('.demo-exit').scrollIntoViewIfNeeded();
            const banner = await page.locator('.demo-banner').boundingBox();
            assert(banner && banner.y >= 0 && banner.y + banner.height <= 844, 'Persistent demo label scrolled away');
            demoStage = `demo ${locale} switch`;
            await page.getByRole('button', { name: locale === 'en' ? 'RU' : 'EN', exact: true }).click();
            await page.waitForURL('http://localhost:3101' + (locale === 'en' ? '' : '/en') + '/demo');
            await page.waitForLoadState('networkidle');
            demoStage = `demo ${locale} Back`;
            await page.goBack(); await page.waitForLoadState('networkidle');
            await page.getByRole('heading', { name: locale === 'en' ? 'Mileage and maintenance' : 'Пробег и обслуживание', exact: true }).waitFor();
            assert.equal(await page.locator('html').getAttribute('lang'), locale);
            demoStage = `demo ${locale} Forward`;
            await page.goForward(); await page.waitForLoadState('networkidle');
            await page.getByRole('heading', { name: locale === 'en' ? 'Пробег и обслуживание' : 'Mileage and maintenance', exact: true }).waitFor();
            assert.equal(await page.locator('html').getAttribute('lang'), locale === 'en' ? 'ru' : 'en');
        }
        demoStage = 'demo final EN goto';
        await page.goto('http://localhost:3101/en/demo');
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', { name: 'About MileKeeper', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Explore demo', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.deepEqual(await stored(), before, 'Demo changed account cookies/storage/preferences');
        assert.deepEqual(providerRequests.slice(providerStart), [], 'Demo made server or browser provider requests');
        assert.deepEqual(browserRequests.slice(browserStart).filter(r => new URL(r.url).pathname.startsWith('/api/') || r.action || r.method !== 'GET'), [], 'Demo made personal API/server-action requests');
        assert.deepEqual(demoConsoleErrors, [], 'Demo browser console errors');
        inDemo = false;
        await page.setViewportSize({ width: 390, height: 844 });
        console.log('PASS ' + (authenticated ? 'authenticated' : 'anonymous') + ' demo RU/EN, reload, Back/Forward, 320–430/1280px, no provider/API/actions/storage changes');
    };
    const testWelcomeOwnData = async authenticated => {
        for (const locale of ['ru', 'en']) {
            const en = locale === 'en', home = en ? '/en' : '/', login = en ? '/en/login' : '/login';
            const providerStart = providerRequests.length, browserStart = browserRequests.length;
            const beforeCookies = await context.cookies();
            const beforeStorage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
            inDemo = true;
            demoStage = `welcome own data ${authenticated ? 'account' : 'guest'} ${locale}`;
            await page.goto('http://localhost:3101' + (en ? '/en/demo' : '/demo'));
            await page.waitForLoadState('networkidle');
            await page.getByRole('button', { name: en ? 'About MileKeeper' : 'О MileKeeper', exact: true }).click();
            const ownData = page.getByRole('dialog').getByRole('link', { name: en ? 'Use my own data' : 'Перейти к своим данным', exact: true });
            assert.equal(await ownData.getAttribute('href'), home);
            await ownData.focus();
            assert.deepEqual(providerRequests.slice(providerStart), [], 'Welcome contacted provider before leaving demo');
            assert.deepEqual(browserRequests.slice(browserStart).filter(r => new URL(r.url).pathname.startsWith('/api/') || r.action || r.method !== 'GET'), [], 'Welcome prefetched personal API/action');
            assert.deepEqual(await context.cookies(), beforeCookies, 'Welcome changed account cookies');
            assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), beforeStorage);
            assert.deepEqual(demoConsoleErrors, []);
            inDemo = false; // Account requests are allowed only after activating the exit.
            const methodsStart = providerMethods.length;
            const [navigation] = await Promise.all([
                page.waitForRequest(r => r.isNavigationRequest() && new URL(r.url()).pathname === home),
                page.keyboard.press('Enter'),
            ]);
            assert.equal(navigation.method(), 'GET');
            await page.waitForURL('http://localhost:3101' + (authenticated ? home : login));
            await page.getByRole('heading', { name: authenticated ? (en ? 'Home' : 'Главная') : (en ? 'Sign in' : 'Вход'), exact: true }).waitFor();
            await page.waitForLoadState('networkidle');
            assert.equal(await page.getByRole('dialog').count(), 0);
            assert.equal(await page.evaluate(key => localStorage.getItem(key), welcomeKey), 'seen');
            assert(!providerMethods.slice(methodsStart).some(r => r.path === '/auth/v1/logout' || (r.path.startsWith('/rest/v1/') && r.method !== 'GET')), 'Exit signed out or wrote demo data');
            if (authenticated) {
                await page.locator('.mileage-date').waitFor();
                assert.match(await page.locator('.mileage-date').innerText(), en ? /120,000 km/ : /120\s000 км/, 'Account must show its existing 120000 km measurement');
                const authCookies = cookies => cookies.filter(c => ['mk_sb_at', 'mk_sb_rt'].includes(c.name)).map(c => ({ name: c.name, value: c.value })).sort((a, b) => a.name.localeCompare(b.name));
                assert.equal(authCookies(beforeCookies).length, 2, 'Fixture account session absent');
                assert.deepEqual(authCookies(await context.cookies()), authCookies(beforeCookies), 'Exit replaced the existing account session');
            } else {
                await page.getByRole('button', { name: en ? 'Continue with Google' : 'Войти через Google', exact: true }).waitFor();
                assert.deepEqual(providerRequests.slice(providerStart), [], 'Guest exit called provider without Google sign-in');
            }
            await page.goto('http://localhost:3101' + (en ? '/en/demo' : '/demo'));
            await page.waitForLoadState('networkidle');
            assert.equal(await page.getByRole('dialog').count(), 0, 'Own data exit did not preserve welcome marker');
        }
        console.log('PASS welcome own data RU/EN keyboard exit: ' + (authenticated ? 'existing account/session, real fixture odometer, no writes or sign-out' : 'localized login guards, no provider calls') + ', no private prefetch, marker retained');
    };
    const checkEnglish = async () => {
        const copy = await page.locator('body').evaluate(body => {
            const attributes = [...body.querySelectorAll('[aria-label],[title],[placeholder],[alt]')]
                .filter(element => element.getClientRects().length)
                .flatMap(element => ['aria-label', 'title', 'placeholder', 'alt'].map(name => element.getAttribute(name) || ''));
            return body.innerText + '\n' + attributes.join('\n');
        });
        const systemCopy = ['Моё масло двигателя', 'Моя заметка — не переводить', 'Личная запись', 'Пользовательский комментарий']
            .reduce((text, personal) => text.replaceAll(personal, ''), copy);
        assert(!/[А-Яа-яЁё]/.test(systemCopy), 'Russian system copy remains: ' + systemCopy);
    };
    const checkLayout = async () => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow');
    };
    await page.goto('http://localhost:3101/en');
    await page.waitForURL('**/en/login');
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Login showed welcome');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('body').innerText().then(s => /[А-Яа-яЁё]/.test(s)), false);
    console.log('PASS English anonymous redirect + login + html lang');
    await page.getByRole('button', { name: 'RU', exact: true }).click();
    await page.waitForURL('**/login');
    await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
    console.log('PASS RU switch and reload');
    await page.screenshot({ path: path.join(artifacts, 'login-ru.png') });
    await page.getByRole('link', { name: 'Посмотреть демо', exact: true }).click();
    await page.waitForURL('http://localhost:3101/demo');
    await page.getByRole('heading', { name: 'Пробег и обслуживание', exact: true }).waitFor();
    await testWelcome();
    await testFreshWelcome(false);
    await testFreshWelcome(true);
    await testDemo(false);
    await testWelcomeOwnData(false);
    await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
    await page.waitForURL('http://localhost:3101/en/login');
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Explore demo', exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'login-en.png') });
    console.log('PASS both login choices and guest demo entry/exit');
    await page.goto('http://localhost:3101/login');
    await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.waitForURL('**/en/login');
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await page.waitForURL('http://localhost:3101/en');
    await page.goto('http://localhost:3101/en');
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Account showed welcome');
    await page.getByRole('button', { name: 'Add odometer reading', exact: true }).waitFor();
    console.log('PASS authenticated English home');
    await testDemo(true);
    await testWelcomeOwnData(true);
    await page.getByRole('link', { name: 'Go to my own data', exact: true }).click();
    await page.waitForURL('http://localhost:3101/en');
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    console.log('PASS demo exit reuses existing account and keeps its session');
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
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await page.waitForURL('http://localhost:3101/en');
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    console.log('PASS repeat mocked Google sign-in remains English');

    // Both locales: direct URLs, mobile layouts, validation and cancel-only dialogs.
    // Every submitted form below is invalid before any server write is attempted.
    for (const locale of ['en', 'ru']) {
        const en = locale === 'en', prefix = en ? '/en' : '';
        const labels = en ? {
            home: 'Home', items: 'Maintenance items', history: 'Odometer history',
            addMileage: 'Add odometer reading', mileage: 'Enter odometer reading', save: 'Save', cancel: 'Cancel',
            mileageError: 'Please enter a valid odometer reading', addItem: 'Add item', itemName: 'For example: Engine oil',
            intervalError: 'Mileage tracking requires an interval in km.', editReading: 'Edit latest reading', positiveError: 'The odometer reading must be a positive number',
            deleteReading: 'Delete latest reading', confirmDelete: 'Are you sure?', replacement: 'Record replacement', signOut: 'Sign out',
            signIn: 'Sign in', google: 'Continue with Google', calc: 'Calculation',
        } : {
            home: 'Главная', items: 'Элементы обслуживания', history: 'История пробега',
            addMileage: 'Добавить пробег', mileage: 'Введите пробег', save: 'Сохранить', cancel: 'Отмена',
            mileageError: 'Пожалуйста, введите корректный пробег', addItem: 'Добавить элемент', itemName: 'Например: Масло двигателя',
            intervalError: 'Для режима по пробегу нужен интервал в км.', editReading: 'Редактировать последнюю запись', positiveError: 'Пробег должен быть положительным числом',
            deleteReading: 'Удалить последнюю запись', confirmDelete: 'Вы уверены?', replacement: 'Отметить замену', signOut: 'Выйти',
            signIn: 'Вход', google: 'Войти через Google', calc: 'Расчёт',
        };
        for (const width of [320, 390, 1280]) {
            await page.setViewportSize({ width, height: 844 });
            for (const [route, heading] of [[prefix || '/', labels.home], [prefix + '/items', labels.items], [prefix + '/history', labels.history]]) {
                await page.goto('http://localhost:3101' + route);
                await page.getByRole('heading', { name: heading, exact: true }).waitFor();
                assert.equal(await page.locator('html').getAttribute('lang'), locale);
                await checkLayout();
                if (en) await checkEnglish();
            }
        }
        await page.setViewportSize({ width: 320, height: 844 });
        await page.goto('http://localhost:3101' + (prefix || '/'));
        await page.getByRole('button', { name: labels.addMileage, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByPlaceholder(labels.mileage).fill('0');
        await dialog.getByRole('button', { name: labels.save, exact: true }).click();
        await dialog.getByText(labels.mileageError, { exact: true }).waitFor();
        await checkLayout();
        if (en) await checkEnglish();
        await page.screenshot({ path: path.join(artifacts, locale + '-form-error.png'), fullPage: true });
        await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();

        await page.getByRole('link', { name: en ? '🔧 Items' : '🔧 Элементы', exact: false }).click();
        await page.waitForURL('**' + prefix + '/items');
        await page.getByRole('button', { name: labels.addItem, exact: true }).click();
        await dialog.getByPlaceholder(labels.itemName).fill('   ');
        assert.equal(await dialog.locator('button[type="submit"]').isDisabled(), true, 'Blank names cannot be saved');
        await dialog.getByPlaceholder(labels.itemName).fill('Fixture draft');
        await dialog.locator('form').evaluate(form => { form.noValidate = true; });
        await dialog.locator('button[type="submit"]').click();
        await dialog.getByText(labels.intervalError, { exact: true }).waitFor();
        await checkLayout();
        if (en) await checkEnglish();
        await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();

        await page.goto('http://localhost:3101' + prefix + '/items/' + fixture.id + '?tab=calc');
        await page.getByRole('button', { name: labels.calc, exact: true }).waitFor();
        await page.getByRole('button', { name: labels.replacement, exact: true }).click();
        await dialog.getByPlaceholder(labels.mileage).fill('0');
        await dialog.getByRole('button', { name: labels.save, exact: true }).click();
        await dialog.getByText(labels.positiveError, { exact: true }).waitFor();
        await checkLayout();
        if (en) await checkEnglish();
        await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();

        await page.getByRole('link', { name: en ? '📋 History' : '📋 История', exact: false }).click();
        await page.getByRole('button', { name: labels.editReading, exact: true }).click();
        await dialog.getByPlaceholder(labels.mileage).fill('0');
        await dialog.getByRole('button', { name: labels.save, exact: true }).click();
        await dialog.getByText(labels.positiveError, { exact: true }).waitFor();
        await checkLayout();
        if (en) await checkEnglish();
        await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();
        await page.getByRole('button', { name: labels.deleteReading, exact: true }).click();
        await dialog.getByRole('heading', { name: labels.confirmDelete, exact: true }).waitFor();
        await checkLayout();
        if (en) await checkEnglish();
        await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();
        await page.getByRole('button', { name: labels.signOut, exact: true }).click();
        await checkLayout();
        if (en) await checkEnglish();
        await dialog.getByRole('button', { name: labels.signOut, exact: true }).click();
        await page.waitForURL('**' + prefix + '/login');
        await page.getByRole('heading', { name: labels.signIn, exact: true }).waitFor();
        for (const route of [prefix || '/', prefix + '/items', prefix + '/history', prefix + '/items/' + fixture.id]) {
            await page.goto('http://localhost:3101' + route);
            await page.waitForURL('**' + prefix + '/login');
            await page.getByRole('heading', { name: labels.signIn, exact: true }).waitFor();
        }
        await page.getByRole('button', { name: labels.google, exact: true }).click();
        await page.waitForURL('http://localhost:3101' + (prefix || '/'));
        await page.getByRole('heading', { name: labels.home, exact: true }).waitFor();
        console.log('PASS ' + locale.toUpperCase() + ' direct routes, mobile layouts, form errors, dialogs, anonymous guards and mocked OAuth/logout');
    }
    // A known API error remains localized, while the shared endpoint stays unprefixed.
    await page.route('**/api/service-events?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Не удалось выполнить действие. Попробуйте ещё раз.' }) }));
    await page.goto('http://localhost:3101/en/items/' + fixture.id);
    await page.locator('.item-history-error').getByText('Could not complete the action. Please try again.', { exact: true }).waitFor();
    await checkEnglish();
    await page.unroute('**/api/service-events?*');
    console.log('PASS English API error message');
    for (const locale of ['ru', 'en']) {
        const anonymous = await browser.newContext({ viewport: { width: 320, height: 844 } });
        await anonymous.route('**/*', route => {
            const url = new URL(route.request().url());
            return ['localhost', '127.0.0.1'].includes(url.hostname) && ['3101', '54329'].includes(url.port) ? route.continue() : route.abort();
        });
        await anonymous.addCookies([{ name: 'mk_locale', value: locale, url: 'http://localhost:3101' }]);
        const callback = await anonymous.newPage();
        callback.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR at ' + callback.url() + ': ' + error.message); });
        await callback.goto('http://localhost:3101/auth/callback?error=access_denied');
        await callback.getByRole('alert').getByText(locale === 'en' ? 'Google did not confirm your sign-in. Please sign in again.' : 'Google не подтвердил вход. Повторите вход.', { exact: true }).waitFor();
        await callback.getByRole('link', { name: locale === 'en' ? 'Back to sign-in' : 'Вернуться ко входу', exact: true }).click();
        await callback.waitForURL('**' + (locale === 'en' ? '/en/login' : '/login'));
        await anonymous.close();
    }
    console.log('PASS shared callback denial returns to the originating locale');
    assert.deepEqual(errors, [], 'Browser page errors');
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
