/** Service records (replacement / check / top-up) end to end against the local synthetic fixture. No live data. */
const { chromium } = require(process.env.MILEKEEPER_PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), assert = require('assert/strict'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { createFixture } = require('./fixtures/i18n-supabase.cjs');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'milekeeper-service-records-'));
let browser, app, fixture, page;

/** Expected "mileage between replacements" for every replacement, from the full fixture history. */
function expectedIntervals(events) {
  const oldestFirst = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.mileage_km - b.mileage_km || (a.id < b.id ? -1 : 1));
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Almaty' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && ['3101', '54329'].includes(url.port) ? route.continue() : route.abort('blockedbyclient');
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const noOverflow = async (label) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal page overflow: ' + label);
    for (const dialog of await page.locator('dialog[open]').all()) assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Dialog overflow: ' + label);
  };
  const rows = () => page.locator('.item-history-row');
  const shot = name => page.screenshot({ path: path.join(artifacts, name + '.png') });

  for (const locale of ['ru', 'en']) {
    const en = locale === 'en', prefix = en ? '/en' : '';
    const L = en ? {
      google: 'Continue with Google', add: 'Add record', more: 'Show more', calc: 'Calculation', history: 'History',
      check: /^Check/, topUp: /^Top-up/, replacement: /^Replacement/, mileage: 'Odometer, km', volume: 'Volume, L (optional)', comment: 'Comment (optional)',
      saveCheck: 'Save check', saveTopUp: 'Save top-up', update: 'Update odometer', saveOdometer: 'Save', odometerTitle: 'Add odometer reading',
      deleteRecord: 'Delete record', cancel: 'Cancel', lastReplacement: 'Last replacement', above: 'is higher than the last recorded reading',
      updated: 'Odometer updated: 120,500 km', warning: 'This is a replacement', volumeText: '0.5 L', kindCheck: 'Check', kindTopUp: 'Top-up',
    } : {
      google: 'Войти через Google', add: 'Добавить запись', more: 'Показать ещё', calc: 'Расчёт', history: 'История',
      check: /^Проверка/, topUp: /^Долив/, replacement: /^Замена/, mileage: 'Пробег, км', volume: 'Объём, л (необязательно)', comment: 'Комментарий (необязательно)',
      saveCheck: 'Сохранить проверку', saveTopUp: 'Сохранить долив', update: 'Обновить пробег', saveOdometer: 'Сохранить', odometerTitle: 'Добавить пробег',
      deleteRecord: 'Удалить запись', cancel: 'Отмена', lastReplacement: 'Последняя замена', above: 'больше последнего показания одометра',
      updated: 'Пробег обновлён: 120 500 км', warning: 'Это замена', volumeText: '0,5 л', kindCheck: 'Проверка', kindTopUp: 'Долив',
    };
    fixture.setScenario('mixed');
    await page.goto('http://localhost:3101' + prefix + '/login');
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

    // 7. Mobile widths and the /items sheet.
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 760 });
      await page.goto(itemUrl); await rows().first().waitFor();
      await noOverflow('item page ' + width);
      await page.getByRole('button', { name: L.add, exact: true }).click();
      dialog = page.getByRole('dialog').last();
      await dialog.getByRole('radio', { name: L.topUp }).check();
      await noOverflow('form ' + width); await shot(`${locale}-form-${width}`);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
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
    await page.setViewportSize({ width: 390, height: 844 });
    await context.clearCookies(); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    console.log(`PASS ${locale}: 320/390 layouts without overflow; items list → item timeline`);
  }
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  await context.close();
  console.log('Artifacts: ' + artifacts);
})().catch(async e => {
  console.error(e); process.exitCode = 1;
  await page?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('URL: ' + page?.url()); console.error('Artifacts: ' + artifacts);
}).finally(async () => {
  await browser?.close(); app?.kill('SIGTERM');
  await new Promise(resolve => fixture ? fixture.server.close(resolve) : resolve());
});
