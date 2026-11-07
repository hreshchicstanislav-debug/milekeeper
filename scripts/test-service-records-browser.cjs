/** Service records (replacement / check / top-up) end to end against the local synthetic fixture. No live data. */
const { chromium } = require(process.env.MILEKEEPER_PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), assert = require('assert/strict'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { createFixture, timeKey } = require('./fixtures/i18n-supabase.cjs');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'milekeeper-service-records-'));
let browser, app, fixture, page, context;

/** Database order, oldest first: occurred_at (microseconds), mileage_km, id. */
const compareOldestFirst = (a, b) => {
  const x = timeKey(a.occurred_at), y = timeKey(b.occurred_at);
  return x < y ? -1 : x > y ? 1 : a.mileage_km - b.mileage_km || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};
const newestFirstIds = events => [...events].sort((a, b) => compareOldestFirst(b, a)).map(e => e.id);

/** Expected "mileage between replacements" for every replacement, from the full fixture history. */
function expectedIntervals(events) {
  const oldestFirst = [...events].sort(compareOldestFirst);
  const result = new Map(); let previous = null;
  for (const event of oldestFirst) {
    if (event.kind !== 'replacement') { result.set(event.id, null); continue; }
    result.set(event.id, previous === null ? null : event.mileage_km - previous.mileage_km > 0 ? 'interval' : event.mileage_km === previous.mileage_km ? 'same-mileage' : 'decreased');
    previous = event;
  }
  return result;
}

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
  const errors = [];
  const AUTH_COOKIES = ['mk_sb_at', 'mk_sb_rt'];
  const authCookies = async ctx => (await ctx.cookies()).filter(c => AUTH_COOKIES.includes(c.name));
  const usedContexts = new Set();
  const localOnly = route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && ['3101', '54329'].includes(url.port) ? route.continue() : route.abort('blockedbyclient');
  };
  /** Every locale runs in its own browser context: cookies, storage and the in-memory Supabase SDK session
   * of one locale can never leak into the next (clearing storage under a live SDK lets it re-sync and restore cookies).
   * Scenarios inside one locale keep sharing this context and the fixture data on purpose. */
  const openIsolatedContext = async (options = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Almaty', ...options });
    await ctx.route('**/*', localOnly);
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(20000);
    pg.on('pageerror', error => errors.push(error.message));
    return { context: ctx, page: pg };
  };
  /** A /api/auth/sync response held by the test itself and released on demand — a promise gate, not a timer. */
  const holdSync = async (ctx, ownerPage) => {
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { arrived = resolve; });
    await ctx.route('**/api/auth/sync', async route => {
      arrived(); await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'set-cookie': 'mk_sb_at=restored-by-late-sync; Path=/' }, body: '{"ok":true}' }).catch(() => {});
    });
    const inFlight = ownerPage.evaluate(() => fetch('/api/auth/sync', { method: 'POST', credentials: 'same-origin' }).then(r => r.status, () => 'aborted')).catch(() => 'page-closed');
    await seen;
    return { release, inFlight };
  };
  /**
   * Deterministic regression for the isolation (no sleeps). 1) Negative control: in ONE reused context a
   * sync that is still in flight restores the cookies the test just cleared — the exact race, so the harness
   * can see it. 2) The fix: a sync in flight while its context is closed cannot reach the next context.
   */
  const verifyContextIsolation = async () => {
    const reused = await openIsolatedContext();
    await reused.page.goto('http://localhost:3101/login');
    assert.deepEqual(await authCookies(reused.context), [], 'Isolation check: fresh context already authenticated');
    const held = await holdSync(reused.context, reused.page);
    await reused.context.clearCookies();
    held.release();
    assert.equal(await held.inFlight, 200);
    assert.equal((await authCookies(reused.context)).length, 1, 'Negative control: a late sync must restore cookies cleared in a reused context');
    await reused.context.close();

    const first = await openIsolatedContext();
    await first.page.goto('http://localhost:3101/login');
    const pending = await holdSync(first.context, first.page);
    await first.context.close();
    assert.equal(browser.contexts().includes(first.context), false, 'Isolation check: closed context is still registered');
    assert.equal(first.page.isClosed(), true);
    const second = await openIsolatedContext();
    assert.notEqual(second.context, first.context);
    pending.release();
    assert.equal(await pending.inFlight, 'page-closed', 'The in-flight sync outlived its context');
    await second.page.goto('http://localhost:3101/login');
    assert.deepEqual(await authCookies(second.context), [], 'A sync in flight in a closed context reached the next one');
    assert.equal(await second.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await second.context.close();
    assert.equal(browser.contexts().length, 0, 'Isolation check left a context open');
    console.log('PASS isolation: a late auth sync restores cookies in a reused context, but cannot cross into a new one');
  };
  await verifyContextIsolation();
  const noOverflow = async (label) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal page overflow: ' + label);
    for (const dialog of await page.locator('dialog[open]').all()) assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Dialog overflow: ' + label);
  };
  const rows = () => page.locator('.item-history-row');
  const shot = name => page.screenshot({ path: path.join(artifacts, name + '.png') });
  /** The kind titles never wrap inside a word or onto a second line (e.g. "Replaceme/nt" at 320 px). */
  const assertKindTitlesIntact = async (label) => {
    const broken = await page.evaluate(() => [...document.querySelectorAll('dialog[open] .service-event-kinds.is-chosen .service-event-kind-title')].filter(el => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      return el.getBoundingClientRect().height > lineHeight * 1.2 || el.scrollWidth > el.clientWidth + 1;
    }).map(el => el.textContent));
    assert.deepEqual(broken, [], 'Kind title wrapped or clipped: ' + label);
  };
  /**
   * A fast user: the second tap (or keystroke) lands on the very first committed render
   * of a form, in the same task as the tap that opened it. That render must already show
   * the form's initial state (not the previous opening's), and nothing may re-initialize
   * the form afterwards. Returns what that first render showed. Microtask yields only
   * until the target exists; no timers.
   */
  const tapThenAct = (opener, action) => page.evaluate(async ({ opener, action }) => {
    document.querySelector(opener).click();
    for (let i = 0; i < 1000 && !document.querySelector(action.selector); i++) await Promise.resolve();
    const target = document.querySelector(action.selector);
    if (!target) return null;
    const dialog = target.closest('dialog');
    const firstRender = {
      checked: [...dialog.querySelectorAll('input[type="radio"]:checked')].map(radio => radio.value),
      fields: Object.fromEntries([...dialog.querySelectorAll('input[id], textarea[id]')].map(field => [field.id, field.value])),
    };
    if (action.value === undefined) target.click();
    else {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(target, action.value);
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return firstRender;
  }, { opener, action });
  /** The element is fully visible in the form without scrolling (above the action buttons). */
  const assertVisibleWithoutScrolling = async (selector, label) => {
    const result = await page.evaluate((sel) => {
      const el = document.querySelector(sel).getBoundingClientRect();
      const bar = document.querySelector('dialog[open] .form-actions').getBoundingClientRect();
      const dialog = document.querySelector('dialog[open]').getBoundingClientRect();
      return { top: el.top, bottom: el.bottom, barTop: bar.top, dialogTop: dialog.top };
    }, selector);
    assert(result.top >= result.dialogTop && result.bottom <= result.barTop, `${label} needs scrolling: ${JSON.stringify(result)}`);
  };

  for (const locale of ['ru', 'en']) {
    const en = locale === 'en', prefix = en ? '/en' : '';
    const L = en ? {
      google: 'Continue with Google', add: 'Add record', more: 'Show more', calc: 'Calculation', history: 'History',
      check: /^Check/, topUp: /^Top-up/, replacement: /^Replacement/, mileage: 'Odometer, km', volume: 'Volume, L (optional)', comment: 'Comment (optional)',
      saveCheck: 'Save check', saveTopUp: 'Save top-up', update: 'Update odometer', saveOdometer: 'Save', odometerTitle: 'Add odometer reading',
      deleteRecord: 'Delete record', cancel: 'Cancel', lastReplacement: 'Last replacement', above: 'is higher than the last recorded reading',
      updated: 'Odometer updated: 120,500 km', warning: 'This is the latest replacement', volumeText: '0.5 L', kindCheck: 'Check', kindTopUp: 'Top-up',
      changeDate: 'Change date', historical: 'The selected date is earlier than the last odometer reading', futureDate: 'The date cannot be later than today',
      replacementKind: 'Replacement', saveReplacement: 'Save replacement',
    } : {
      google: 'Войти через Google', add: 'Добавить запись', more: 'Показать ещё', calc: 'Расчёт', history: 'История',
      check: /^Проверка/, topUp: /^Долив/, replacement: /^Замена/, mileage: 'Пробег, км', volume: 'Объём, л (необязательно)', comment: 'Комментарий (необязательно)',
      saveCheck: 'Сохранить проверку', saveTopUp: 'Сохранить долив', update: 'Обновить пробег', saveOdometer: 'Сохранить', odometerTitle: 'Добавить пробег',
      deleteRecord: 'Удалить запись', cancel: 'Отмена', lastReplacement: 'Последняя замена', above: 'больше последнего показания одометра',
      updated: 'Пробег обновлён: 120 500 км', warning: 'Это последняя замена', volumeText: '0,5 л', kindCheck: 'Проверка', kindTopUp: 'Долив',
      changeDate: 'Изменить дату', historical: 'Выбранная дата раньше последнего показания одометра', futureDate: 'Дата не может быть позже сегодняшней',
      replacementKind: 'Замена', saveReplacement: 'Сохранить замену',
    };
    ({ context, page } = await openIsolatedContext());
    // Regression guards (deterministic): never reuse a context across locales, and the previous one must be gone.
    assert(!usedContexts.has(context), locale + ': browser context reused from a previous scenario');
    usedContexts.add(context);
    assert.equal(browser.contexts().length, 1, locale + ': previous scenario context is still alive');
    // A fresh context starts anonymous — no auth cookies, no persisted SDK session.
    assert.deepEqual(await authCookies(context), [], locale + ': previous scenario leaked auth cookies');
    fixture.setScenario('mixed');
    await page.goto('http://localhost:3101' + prefix + '/login');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, locale + ': previous scenario leaked browser storage');
    await page.getByRole('button', { name: L.google, exact: true }).click();
    await page.waitForURL('http://localhost:3101' + (prefix || '/'));
    const itemUrl = 'http://localhost:3101' + prefix + '/items/' + fixture.id;
    await page.goto(itemUrl);
    await rows().first().waitFor();

    // 1. Pagination: 10 → 20 → 23, each record exactly once, intervals from replacements only.
    const all = fixture.events.map(e => ({ ...e }));
    assert.equal(await rows().count(), 10);
    await page.getByRole('button', { name: L.more, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.item-history-row').length === 20);
    await page.getByRole('button', { name: L.more, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.item-history-row').length === 23);
    assert.equal(await page.getByRole('button', { name: L.more, exact: true }).count(), 0, 'Show more after the last page');
    const shown = await rows().evaluateAll(list => list.map(li => ({ id: li.dataset.eventId, kind: li.dataset.kind, interval: li.querySelector('[data-interval]')?.dataset.interval ?? null })));
    assert.equal(new Set(shown.map(r => r.id)).size, 23, 'Duplicated records');
    assert.deepEqual(new Set(shown.map(r => r.id)), new Set(all.map(e => e.id)), 'Lost records');
    // Exactly the database order, including the records microseconds apart at the page boundary.
    assert.deepEqual(shown.map(r => r.id), newestFirstIds(all), 'History order differs from the database order');
    const expected = expectedIntervals(all);
    for (const row of shown) assert.equal(row.interval, expected.get(row.id), 'Interval of ' + row.id);
    await noOverflow('history'); await shot(locale + '-history-390');
    console.log(`PASS ${locale}: 23 mixed records over 3 pages, none lost or repeated; intervals between replacements only`);

    // 2. Calculation baseline.
    const lastReplacementText = async () => {
      await page.getByRole('button', { name: L.calc, exact: true }).click();
      const text = await page.locator('.calc-row', { hasText: L.lastReplacement }).locator('.v').innerText();
      await page.getByRole('button', { name: L.history, exact: true }).click();
      await rows().first().waitFor();
      return text;
    };
    const baseline = await lastReplacementText();
    const odometerCount = fixture.odometer.length;

    // 3. Check: nothing preselected, actual reading prefilled with its date; forecast unchanged.
    await page.getByRole('button', { name: L.add, exact: true }).click();
    let dialog = page.getByRole('dialog').last();
    assert.equal(await dialog.getByRole('radio', { checked: true }).count(), 0, 'Preselected kind');
    await noOverflow('kind choice'); await shot(locale + '-choose-kind');
    await dialog.getByRole('radio', { name: L.check }).check();
    assert.equal((await dialog.getByLabel(L.mileage).inputValue()).replace(/\D/g, ''), '120000');
    assert.match(await dialog.getByTestId('service-event-last-reading').innerText(), /120.000/);
    await dialog.getByLabel(L.comment).fill('Осмотр перед поездкой');
    await shot(locale + '-check-form');
    await dialog.getByRole('button', { name: L.saveCheck, exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.item-history-row')?.dataset.kind === 'check');
    assert.match(await rows().first().innerText(), /Осмотр перед поездкой/);
    assert.equal(await lastReplacementText(), baseline, 'A check moved the last replacement');

    // 4. Top-up with a decimal comma; forecast unchanged.
    await page.getByRole('button', { name: L.add, exact: true }).click();
    dialog = page.getByRole('dialog').last();
    await dialog.getByRole('radio', { name: L.topUp }).check();
    await dialog.getByLabel(L.volume).fill('0,5');
    await dialog.getByRole('button', { name: L.saveTopUp, exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.item-history-row')?.dataset.kind === 'top_up');
    assert.match((await rows().first().innerText()).replace(/[  ]/g, ' '), new RegExp(L.volumeText.replace('.', '\\.')));
    assert.equal(await lastReplacementText(), baseline, 'A top-up moved the last replacement');
    assert.equal(fixture.odometer.length, odometerCount, 'Saving a record wrote the odometer');
    console.log(`PASS ${locale}: check and top-up (0,5) saved; last replacement and odometer unchanged`);

    // 5. Mileage above the recorded odometer: not saved, update the odometer separately, return with input kept.
    const eventsBefore = fixture.events.length;
    await page.getByRole('button', { name: L.add, exact: true }).click();
    dialog = page.getByRole('dialog').last();
    await dialog.getByRole('radio', { name: L.topUp }).check();
    await dialog.getByLabel(L.mileage).fill('120500');
    await dialog.getByLabel(L.volume).fill('1.25');
    await dialog.getByLabel(L.comment).fill('После трассы');
    await dialog.getByRole('button', { name: L.saveTopUp, exact: true }).click();
    await dialog.getByText(L.above).waitFor();
    assert.equal(fixture.events.length, eventsBefore, 'Saved above the odometer');
    await noOverflow('above odometer'); await shot(locale + '-above-odometer');
    await dialog.getByRole('button', { name: L.update, exact: true }).click();
    const odometerDialog = page.getByRole('dialog', { name: L.odometerTitle });
    await odometerDialog.waitFor();
    assert.equal((await odometerDialog.locator('#mileageKm').inputValue()).replace(/\D/g, ''), '120500', 'Odometer form not prefilled');
    await shot(locale + '-update-odometer');
    await odometerDialog.getByRole('button', { name: L.saveOdometer, exact: true }).click();
    await odometerDialog.waitFor({ state: 'detached' });
    await dialog.getByText(L.updated).waitFor();
    assert.equal(await dialog.getByRole('radio', { name: L.topUp }).isChecked(), true);
    assert.equal((await dialog.getByLabel(L.mileage).inputValue()).replace(/\D/g, ''), '120500');
    assert.equal(await dialog.getByLabel(L.volume).inputValue(), '1.25');
    assert.equal(await dialog.getByLabel(L.comment).inputValue(), 'После трассы');
    await shot(locale + '-back-to-record');
    await dialog.getByRole('button', { name: L.saveTopUp, exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(fixture.odometer.length, odometerCount + 1, 'Odometer must be written once, by the odometer form only');
    assert.equal(fixture.events.length, eventsBefore + 1);
    console.log(`PASS ${locale}: mileage above odometer rejected → "Update odometer" → returned with input kept → saved; one odometer entry`);

    // 5b. A date before the last odometer reading must not silently take the current mileage.
    await page.goto(itemUrl); await rows().first().waitFor();
    const eventsBeforeHistoric = fixture.events.length;
    await page.getByRole('button', { name: L.add, exact: true }).click();
    dialog = page.getByRole('dialog').last();
    await dialog.getByRole('radio', { name: L.check }).check();
    assert.match((await dialog.getByLabel(L.mileage).inputValue()).replace(/\D/g, ''), /^120500$/);
    await dialog.getByRole('button', { name: L.changeDate, exact: true }).click();
    await dialog.locator('#serviceEventDate').fill('2020-01-15');
    assert.equal(await dialog.getByLabel(L.mileage).inputValue(), '', 'Current mileage left in the field for an old date');
    await dialog.getByTestId('service-event-historical-reading').waitFor();
    assert.match(await dialog.getByTestId('service-event-historical-reading').innerText(), new RegExp(L.historical));
    assert.equal(await dialog.getByRole('button', { name: L.saveCheck, exact: true }).isDisabled(), true);
    await noOverflow('historical date'); await shot(locale + '-historical-date');
    await dialog.getByLabel(L.mileage).fill('90000');
    await dialog.getByLabel(L.comment).fill('Историческая проверка');
    await dialog.getByRole('button', { name: L.saveCheck, exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(fixture.events.length, eventsBeforeHistoric + 1);
    const historic = fixture.events.find(e => e.note === 'Историческая проверка');
    assert.equal(historic.mileage_km, 90000); assert.equal(historic.kind, 'check');
    assert.match(historic.occurred_at, /^2020-01-1[45]/);
    assert.equal(fixture.odometer.length, odometerCount + 1, 'Historical record wrote the odometer');
    // A typed mileage is never erased by changing the date.
    await page.getByRole('button', { name: L.add, exact: true }).click();
    dialog = page.getByRole('dialog').last();
    await dialog.getByRole('radio', { name: L.check }).check();
    await dialog.getByLabel(L.mileage).fill('110000');
    await dialog.getByRole('button', { name: L.changeDate, exact: true }).click();
    await dialog.locator('#serviceEventDate').fill('2020-02-01');
    assert.equal((await dialog.getByLabel(L.mileage).inputValue()).replace(/\D/g, ''), '110000', 'Typed mileage was erased');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    console.log(`PASS ${locale}: old date → empty mileage + explicit prompt; typed mileage kept; saved with the stated mileage`);

    // 5c. The server refuses a future date even if the form let it through (browser clock three days ahead).
    // A separate context: the clock belongs to the context and must not leak into the other checks.
    const { context: skewedContext, page: skewed } = await openIsolatedContext({ storageState: await context.storageState() });
    await skewed.clock.setFixedTime(new Date(Date.now() + 3 * 86400000));
    await skewed.goto(itemUrl); await skewed.locator('.item-history-row').first().waitFor();
    await skewed.getByRole('button', { name: L.add, exact: true }).click();
    const skewedDialog = skewed.getByRole('dialog').last();
    await skewedDialog.getByRole('radio', { name: L.check }).check();
    const eventsBeforeFuture = fixture.events.length;
    await skewedDialog.getByRole('button', { name: L.saveCheck, exact: true }).click();
    await skewedDialog.getByText(L.futureDate).waitFor();
    assert.equal(fixture.events.length, eventsBeforeFuture, 'A future-dated record was saved');
    await skewedContext.close();
    console.log(`PASS ${locale}: future date refused by the server with an understandable message`);

    // 6. Delete: a check (forecast unchanged), then the newest replacement (with a warning; recomputed).
    await page.goto(itemUrl); await rows().first().waitFor();
    const checkRow = rows().filter({ hasText: 'Осмотр перед поездкой' });
    await checkRow.locator('.item-history-delete').click();
    await checkRow.getByRole('alertdialog').waitFor();
    assert.equal(await checkRow.getByTestId('delete-replacement-warning').count(), 0);
    await checkRow.getByRole('button', { name: L.cancel, exact: true }).click();
    await checkRow.locator('.item-history-delete').click();
    await checkRow.getByRole('button', { name: L.deleteRecord, exact: true }).click();
    await checkRow.waitFor({ state: 'detached' });
    assert.equal(await lastReplacementText(), baseline, 'Deleting a check moved the last replacement');
    const replacementRow = rows().filter({ has: page.locator('.item-history-kind-replacement') }).first();
    const replacementId = await replacementRow.getAttribute('data-event-id');
    await replacementRow.locator('.item-history-delete').click();
    await replacementRow.getByTestId('delete-replacement-warning').getByText(L.warning).waitFor();
    await noOverflow('delete replacement'); await shot(locale + '-delete-replacement');
    await replacementRow.getByRole('button', { name: L.deleteRecord, exact: true }).click();
    await page.locator(`[data-event-id="${replacementId}"]`).waitFor({ state: 'detached' });
    assert(!fixture.events.some(e => e.id === replacementId));
    // The refreshed server data arrives right after the action; allow it a moment.
    let after = await lastReplacementText();
    for (let i = 0; i < 20 && after === baseline; i++) { await page.waitForTimeout(500); after = await lastReplacementText(); }
    assert.notEqual(after, baseline, 'Last replacement not recomputed after deleting it');
    assert.equal(fixture.odometer.length, odometerCount + 1, 'Deleting changed the odometer');
    console.log(`PASS ${locale}: deleted a check (forecast unchanged) and the last replacement (recomputed: ${after})`);

    // 6b. Fast taps: a kind chosen right after opening, a reopen, switching kinds, the odometer
    // form opened from the record and typed into at once, and the way back with the input kept.
    await page.goto(itemUrl); await rows().first().waitFor();
    let firstRender = await tapThenAct('[data-add-service-record]', { selector: 'dialog[open] input[value="top_up"]' });
    assert.deepEqual(firstRender?.checked, [], 'Record form did not open fresh');
    dialog = page.getByRole('dialog').last();
    await dialog.getByLabel(L.volume).waitFor();
    assert.equal(await dialog.getByRole('radio', { name: L.topUp }).isChecked(), true, 'Kind chosen right after opening was reset');
    await dialog.getByLabel(L.volume).fill('0,75');
    await dialog.getByLabel(L.mileage).fill('999999');
    await dialog.getByLabel(L.comment).fill('Быстрый ввод');
    await dialog.getByRole('radio', { name: L.check }).check();
    await dialog.getByRole('radio', { name: L.topUp }).check();
    assert.equal((await dialog.getByLabel(L.mileage).inputValue()).replace(/\D/g, ''), '999999', 'Switching kinds lost the mileage');
    assert.equal(await dialog.getByLabel(L.volume).inputValue(), '0,75', 'Switching kinds lost the volume');
    await dialog.getByRole('button', { name: L.saveTopUp, exact: true }).click();
    await dialog.getByText(L.above).waitFor();
    // The odometer form opens prefilled with 999 999; a reading typed at once must stay.
    firstRender = await tapThenAct('dialog[open] .service-event-update-odometer', { selector: 'dialog[open] #mileageKm', value: '100000' });
    assert.equal(firstRender?.fields.mileageKm.replace(/\D/g, ''), '999999', 'Odometer form not prefilled in its first render');
    const fastOdometer = page.getByRole('dialog', { name: L.odometerTitle });
    await fastOdometer.locator('#mileageGainPreview[data-gain="not-greater"]').waitFor();
    assert.equal((await fastOdometer.locator('#mileageKm').inputValue()).replace(/\D/g, ''), '100000', 'Odometer form overwrote the typed reading');
    await fastOdometer.locator('.cancel-button').click();
    await fastOdometer.waitFor({ state: 'detached' });
    assert.equal(await dialog.getByRole('radio', { name: L.topUp }).isChecked(), true);
    assert.equal((await dialog.getByLabel(L.mileage).inputValue()).replace(/\D/g, ''), '999999');
    assert.equal(await dialog.getByLabel(L.volume).inputValue(), '0,75');
    assert.equal(await dialog.getByLabel(L.comment).inputValue(), 'Быстрый ввод');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    // Quick reopen, choosing the same kind again: the first render must be fresh (the
    // previous choice still checked there would swallow the tap, and a later reset clear it).
    firstRender = await tapThenAct('[data-add-service-record]', { selector: 'dialog[open] input[value="top_up"]' });
    assert.deepEqual(firstRender, { checked: [], fields: {} }, 'Reopened form first rendered the previous input: ' + JSON.stringify(firstRender));
    dialog = page.getByRole('dialog').last();
    await dialog.getByLabel(L.volume).waitFor();
    assert.equal(await dialog.getByRole('radio', { name: L.topUp }).isChecked(), true, 'Kind chosen right after reopening was lost');
    assert.equal(await dialog.getByLabel(L.volume).inputValue(), '', 'Reopened form kept the old volume');
    assert.equal(await dialog.getByLabel(L.comment).inputValue(), '', 'Reopened form kept old input');
    assert.equal((await dialog.getByLabel(L.mileage).inputValue()).replace(/\D/g, ''), '120500', 'Reopened form not prefilled with the last reading');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.equal(fixture.odometer.length, odometerCount + 1, 'Cancelled odometer form wrote a reading');
    console.log(`PASS ${locale}: fast taps — kind kept after open and reopen, odometer input kept, record input kept on return`);

    // 7. Mobile widths: kind segments, volume position, delete confirmation.
    for (const [width, height] of [[320, 568], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(itemUrl); await rows().first().waitFor();
      await noOverflow('item page ' + width);
      await page.getByRole('button', { name: L.add, exact: true }).click();
      dialog = page.getByRole('dialog').last();
      for (const name of [L.replacement, L.check, L.topUp]) {
        await dialog.getByRole('radio', { name }).check();
        await assertKindTitlesIntact(`${locale} ${width} ${name}`);
      }
      assert.equal(await dialog.locator('.service-event-kind-title', { hasText: L.replacementKind }).count(), 1);
      await noOverflow('form ' + width); await shot(`${locale}-form-${width}`);
      await assertVisibleWithoutScrolling('#serviceEventAmount', `volume of a top-up (${locale} ${width}x${height})`);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });

      // Delete confirmation: reachable, fully visible, keyboard-accessible.
      const last = rows().last();
      await last.scrollIntoViewIfNeeded();
      const trigger = last.locator('.item-history-delete');
      await trigger.click();
      const confirm = last.locator('.item-history-confirm');
      await confirm.waitFor();
      // Focus moves to Cancel in the same effect that scrolls the confirmation into view.
      await page.waitForFunction((label) => document.activeElement?.textContent === label, L.cancel);
      const geometry = await page.evaluate(() => {
        const box = document.querySelector('.item-history-confirm').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.item-history-confirm-actions button')].map(b => b.getBoundingClientRect());
        const rail = document.querySelector('.item-details-page-footer, .item-details-actions')?.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, buttonBottom: Math.max(...buttons.map(b => b.bottom)), buttonTop: Math.min(...buttons.map(b => b.top)), railTop: rail ? rail.top : innerHeight, innerHeight };
      });
      const limit = Math.min(geometry.railTop, geometry.innerHeight);
      assert(geometry.buttonTop >= 0 && geometry.buttonBottom <= limit + 0.5, `Delete confirmation buttons not visible (${locale} ${width}): ${JSON.stringify(geometry)}`);
      // Nothing (sticky bar, header) covers the buttons: the element at their centre is the button itself.
      for (const name of [L.cancel, L.deleteRecord]) {
        const covered = await last.getByRole('button', { name, exact: true }).evaluate(el => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !(top === el || el.contains(top));
        });
        assert.equal(covered, false, `"${name}" is covered by another element (${locale} ${width})`);
      }
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), L.cancel, 'Focus must start on Cancel');
      await noOverflow('delete confirm ' + width); await shot(`${locale}-delete-confirm-${width}`);
      // Escape closes only the confirmation and returns to the delete button.
      await page.keyboard.press('Escape');
      await confirm.waitFor({ state: 'detached' });
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Focus not returned to the delete button');
      // Keyboard path: Tab reaches "Delete record" after "Cancel".
      await trigger.click(); await confirm.waitFor();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), L.deleteRecord, 'Tab does not reach the delete button');
      await last.getByRole('button', { name: L.cancel, exact: true }).click();
      await confirm.waitFor({ state: 'detached' });
    }
    // The items list opens the item page; the timeline there is fully localized.
    await page.goto('http://localhost:3101' + prefix + '/items');
    await page.getByText('Моё масло двигателя').first().click();
    await page.waitForURL('**' + prefix + '/items/' + fixture.id);
    await rows().first().waitFor();
    await noOverflow('items → item'); await shot(locale + '-item-from-list');
    if (en) {
      const text = (await page.locator('.item-details-page').innerText()).replace(/Моё масло двигателя|Уровень в норме|После трассы/g, '');
      assert(!/[А-Яа-яЁё]/.test(text), 'Untranslated item page text: ' + text.match(/[А-Яа-яЁё][^\n]*/)?.[0]);
    }
    // 8. Deleting every loaded record while older ones exist: the rest appears, never "empty".
    fixture.setScenario('mixed');
    await page.goto(itemUrl); await rows().first().waitFor();
    const order = newestFirstIds(fixture.events);
    assert.deepEqual(await rows().evaluateAll(list => list.map(li => li.dataset.eventId)), order.slice(0, 10));
    for (const id of order.slice(0, 10)) {
      const row = page.locator(`[data-event-id="${id}"]`);
      await row.locator('.item-history-delete').click();
      await row.getByRole('button', { name: L.deleteRecord, exact: true }).click();
      await row.waitFor({ state: 'detached' });
    }
    await page.waitForFunction(() => document.querySelectorAll('.item-history-row').length === 10);
    assert.equal(fixture.events.length, 13);
    assert.equal(await page.locator('.item-history-empty').count(), 0, 'History shown as empty while 13 records remain');
    assert.deepEqual(await rows().evaluateAll(list => list.map(li => li.dataset.eventId)), order.slice(10, 20));
    await page.getByRole('button', { name: L.more, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.item-history-row').length === 13);
    assert.deepEqual(await rows().evaluateAll(list => list.map(li => li.dataset.eventId)), order.slice(10));
    const remainingIntervals = expectedIntervals(fixture.events);
    for (const row of await rows().evaluateAll(list => list.map(li => ({ id: li.dataset.eventId, interval: li.querySelector('[data-interval]')?.dataset.interval ?? null })))) {
      assert.equal(row.interval, remainingIntervals.get(row.id), 'Interval after deleting a page: ' + row.id);
    }
    await noOverflow('history after deleting a page'); await shot(locale + '-history-after-page-deleted');
    // The last visible record of the second page, then "Show more": no gap, no duplicate.
    fixture.setScenario('mixed');
    await page.goto(itemUrl); await rows().first().waitFor();
    await page.getByRole('button', { name: L.more, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.item-history-row').length === 20);
    const lastOfSecond = page.locator(`[data-event-id="${order[19]}"]`);
    await lastOfSecond.locator('.item-history-delete').click();
    await lastOfSecond.getByRole('button', { name: L.deleteRecord, exact: true }).click();
    await lastOfSecond.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: L.more, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.item-history-row').length === 22);
    assert.deepEqual(await rows().evaluateAll(list => list.map(li => li.dataset.eventId)), order.filter(id => id !== order[19]));
    console.log(`PASS ${locale}: deleting the loaded page shows the remaining 13 records; deleting the last record of page 2 leaves no gap`);

    console.log(`PASS ${locale}: 320/390 layouts without overflow; items list → item timeline`);
    // This locale really held a session (otherwise the next locale's "no auth cookies" guard proves nothing).
    assert((await authCookies(context)).length > 0, locale + ': scenario never authenticated');
    // Dispose the whole context (cookies, storage, SDK timers, in-flight sync) before the next locale starts.
    await context.close();
  }
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  console.log('Artifacts: ' + artifacts);
})().catch(async e => {
  console.error(e); process.exitCode = 1;
  await page?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('URL: ' + page?.url()); console.error('Artifacts: ' + artifacts);
}).finally(async () => {
  await browser?.close(); app?.kill('SIGTERM');
  await new Promise(resolve => fixture ? fixture.server.close(resolve) : resolve());
});
