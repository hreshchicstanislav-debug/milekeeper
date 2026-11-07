/**
 * Release of the service record form under test, read from the single source of truth
 * (`CREATABLE_SERVICE_EVENT_KINDS` in src/lib/service/serviceEventKinds.ts):
 *   A (compatible) — replacements only, the form has no kind choice;
 *   B (full)       — replacement, check and top-up, the user chooses the kind.
 * Browser scenarios assert the UI of the detected release, so a hidden or extra kind
 * switch fails instead of being skipped.
 */
const fs = require('fs'), path = require('path');
const ALL_KINDS = ['replacement', 'check', 'top_up'];

function creatableServiceEventKinds() {
  const source = fs.readFileSync(path.join(__dirname, '../../src/lib/service/serviceEventKinds.ts'), 'utf8');
  const match = source.match(/export const CREATABLE_SERVICE_EVENT_KINDS\b[^=]*=\s*([^;]+);/);
  if (!match) throw Error('CREATABLE_SERVICE_EVENT_KINDS not found in serviceEventKinds.ts');
  const value = match[1].trim();
  const kinds = value === 'SERVICE_EVENT_KINDS' ? ALL_KINDS
    : /^\[[^\]]*\]$/.test(value) ? [...value.matchAll(/'([a-z_]+)'/g)].map(m => m[1]) : null;
  if (!kinds || kinds.length === 0 || kinds.some(kind => !ALL_KINDS.includes(kind))) throw Error('Unrecognised CREATABLE_SERVICE_EVENT_KINDS: ' + value);
  return kinds;
}

const creatableKinds = creatableServiceEventKinds();
const release = ALL_KINDS.every(kind => creatableKinds.includes(kind)) ? 'B' : creatableKinds.join() === 'replacement' ? 'A' : null;
if (!release) throw Error('Creatable kinds match neither release A nor B: ' + creatableKinds.join());

/**
 * Brings an open record form to "replacement": in B the user picks it (nothing preselected);
 * in A it is the only kind and the form must show no choice at all.
 */
async function chooseReplacement(dialog, replacementName) {
  const assert = require('assert/strict');
  if (release === 'B') {
    assert.equal(await dialog.getByRole('radio', { checked: true }).count(), 0, 'Preselected record kind');
    await dialog.getByRole('radio', { name: replacementName }).check();
  } else {
    assert.equal(await dialog.getByRole('radio').count(), 0, 'Release A must not show a kind choice');
    assert.equal(await dialog.locator('fieldset.service-event-kinds').count(), 0, 'Release A must not show the kind fieldset');
  }
}

module.exports = { release, creatableKinds, chooseReplacement };
