import React, { useLayoutEffect, useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: the forms re-initialized their state in a `useEffect(..., [isOpen])`.
 * The first committed render of a reopened form therefore still showed the previous
 * opening's input (e.g. the old kind checked), and the reset arrived a moment later. A
 * tap in between was swallowed or undone: the browser suite failed in RU and EN until
 * an artificial 150 ms wait was added.
 *
 * The interaction is replayed deterministically: a probe's layout effect delivers the
 * user's input in the very commit that opens the form — the form is on screen, its
 * passive effects have not run yet. With the old reset effect the input was lost. No
 * timers, no waits.
 */
const mocks = vi.hoisted(() => ({ pathname: '/', addServiceEvent: vi.fn(), addOdometerEntry: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/serviceActions', () => ({ addServiceEvent: mocks.addServiceEvent }));
vi.mock('@/lib/actions/odometerActions', () => ({ addOdometerEntry: mocks.addOdometerEntry }));
vi.mock('../ModalSheet', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div data-sheet>{children}</div> }));

import AddServiceEventForm from '../AddServiceEventForm';
import AddMileageForm from '../AddMileageForm';

const ITEM = '00000000-0000-4000-8000-000000000010';
let tree: ReactTestRenderer;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const all = () => text(tree.root).replace(/[  ]/g, ' ');
const byId = (id: string) => tree.root.find((n) => (n.type === 'input' || n.type === 'textarea') && n.props.id === id);
const radio = (kind: string) => tree.root.find((n) => n.type === 'input' && n.props.type === 'radio' && n.props.value === kind);
const checkedKind = () => tree.root.findAll((n) => n.type === 'input' && n.props.type === 'radio' && n.props.checked).map((n) => n.props.value);
const button = (label: string) => tree.root.find((n) => n.type === 'button' && text(n) === label);
/** "Cancel" of the odometer form (the record form has one as well). */
const odometerCancel = () => tree.root.findAllByType('form')
  .find((form) => form.findAll((n) => n.props.id === 'mileageKm').length > 0)!
  .find((n) => n.type === 'button' && n.props.className === 'cancel-button');

/** Runs the queued interaction in the next commit, before that commit's passive effects. */
const probe: { interaction: (() => void) | null; rerender: () => void } = { interaction: null, rerender: () => {} };
function InteractionProbe() {
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    probe.rerender = () => setTick((tick) => tick + 1);
  }, []);
  useLayoutEffect(() => {
    const interact = probe.interaction;
    probe.interaction = null;
    interact?.();
  });
  return null;
}

/** `open()` opens a form; `interact()` acts on the form as first committed, before its effects. */
async function openThenInteract(open: () => void, interact: () => void) {
  await act(async () => {
    probe.interaction = interact;
    open();
    // Batched with the opening, so the probe commits together with the opened form.
    probe.rerender();
  });
  expect(probe.interaction).toBeNull();
}

function RecordForm({ open, mileage = 150205, onClose = () => {} }: { open: boolean; mileage?: number; onClose?: () => void }) {
  return (
    <>
      <AddServiceEventForm serviceItemId={ITEM} serviceItemTitle="Масло" defaultMileage={mileage}
        lastReadingAt="2026-10-05T08:00:00Z" isOpen={open} onClose={onClose} />
      <InteractionProbe />
    </>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pathname = '/';
  probe.interaction = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => tree?.unmount()); });

describe('record form: state is ready before the first interaction', () => {
  it('a kind chosen right after the first opening is kept', async () => {
    await act(async () => { tree = create(<RecordForm open={false} />); });
    await openThenInteract(() => tree.update(<RecordForm open />), () => radio('top_up').props.onChange());
    expect(checkedKind()).toEqual(['top_up']);
    expect(byId('serviceEventAmount')).toBeDefined();
  });

  for (const locale of ['/', '/en']) {
    it(`a kind chosen right after a quick reopen is kept, and the reopened form starts fresh (${locale})`, async () => {
      mocks.pathname = locale;
      await act(async () => { tree = create(<RecordForm open />); });
      await act(async () => { radio('check').props.onChange(); });
      await act(async () => { byId('serviceEventNote').props.onChange({ target: { value: 'old note' } }); });
      await act(async () => { tree.update(<RecordForm open={false} />); });
      await openThenInteract(() => tree.update(<RecordForm open />), () => {
        // Fresh form on its first paint: nothing selected, no leftovers.
        expect(checkedKind()).toEqual([]);
        radio('replacement').props.onChange();
      });
      expect(checkedKind()).toEqual(['replacement']);
      expect(byId('serviceEventNote').props.value).toBe('');
      expect(byId('serviceEventMileageKm').props.value).toBe(locale === '/en' ? '150,205' : '150 205');
    });
  }

  it('switching kinds keeps the entered mileage, comment and volume', async () => {
    await act(async () => { tree = create(<RecordForm open={false} />); });
    await openThenInteract(() => tree.update(<RecordForm open />), () => radio('top_up').props.onChange());
    await act(async () => { byId('serviceEventAmount').props.onChange({ target: { value: '0,5' } }); });
    await act(async () => { byId('serviceEventMileageKm').props.onChange({ target: { value: '150100' } }); });
    await act(async () => { byId('serviceEventNote').props.onChange({ target: { value: 'Долил' } }); });
    await act(async () => { radio('check').props.onChange(); });
    await act(async () => { radio('top_up').props.onChange(); });
    expect(byId('serviceEventMileageKm').props.value).toBe('150 100');
    expect(byId('serviceEventNote').props.value).toBe('Долил');
    expect(byId('serviceEventAmount').props.value).toBe('0,5');
  });

  it('a page refresh with a newer reading moves the baseline but keeps the input', async () => {
    await act(async () => { tree = create(<RecordForm open />); });
    await act(async () => { radio('replacement').props.onChange(); });
    await act(async () => { byId('serviceEventNote').props.onChange({ target: { value: 'Масло 5W-30' } }); });
    await act(async () => { tree.update(<RecordForm open mileage={152000} />); });
    expect(checkedKind()).toEqual(['replacement']);
    expect(byId('serviceEventNote').props.value).toBe('Масло 5W-30');
    expect(all()).toMatch(/Последнее показание одометра: 152\s000 км/u);
  });
});

describe('odometer form opened from the record form', () => {
  it('opens prefilled, keeps what is typed right away, and returns to the record with everything kept', async () => {
    mocks.addOdometerEntry.mockResolvedValue({ ok: true, entry: { id: 'r', mileage_km: 151500, occurred_at: '2026-11-05T08:00:00Z' } });
    await act(async () => { tree = create(<RecordForm open />); });
    await act(async () => { radio('top_up').props.onChange(); });
    await act(async () => { byId('serviceEventMileageKm').props.onChange({ target: { value: '151000' } }); });
    await act(async () => { byId('serviceEventAmount').props.onChange({ target: { value: '0.5' } }); });
    await act(async () => { byId('serviceEventNote').props.onChange({ target: { value: 'Долил' } }); });
    await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(mocks.addServiceEvent).not.toHaveBeenCalled();

    await openThenInteract(() => button('Обновить пробег').props.onClick(), () => {
      // Prefilled from the record form on its first paint, then edited at once.
      expect(byId('mileageKm').props.value).toBe('151 000');
      byId('mileageKm').props.onChange({ target: { value: '151500' } });
    });
    expect(byId('mileageKm').props.value).toBe('151 500');

    const odometerForm = tree.root.findAllByType('form').find((f) => f.findAll((n) => n.props.id === 'mileageKm').length > 0)!;
    await act(async () => { await odometerForm.props.onSubmit({ preventDefault() {} }); });
    expect(mocks.addOdometerEntry).toHaveBeenCalledWith(expect.objectContaining({ mileageKm: 151500 }));
    expect(tree.root.findAll((n) => n.props.id === 'mileageKm')).toHaveLength(0);
    expect(checkedKind()).toEqual(['top_up']);
    expect(byId('serviceEventMileageKm').props.value).toBe('151 000');
    expect(byId('serviceEventAmount').props.value).toBe('0.5');
    expect(byId('serviceEventNote').props.value).toBe('Долил');
    expect(all()).toMatch(/Пробег обновлён: 151\s500 км\./u);
  });

  it('reopening the odometer form starts from the record form’s current mileage', async () => {
    await act(async () => { tree = create(<RecordForm open />); });
    await act(async () => { radio('check').props.onChange(); });
    await act(async () => { byId('serviceEventMileageKm').props.onChange({ target: { value: '151000' } }); });
    await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    await act(async () => { button('Обновить пробег').props.onClick(); });
    await act(async () => { byId('mileageKm').props.onChange({ target: { value: '999' } }); });
    await act(async () => { odometerCancel().props.onClick(); });
    expect(tree.root.findAll((n) => n.props.id === 'mileageKm')).toHaveLength(0);
    await act(async () => { byId('serviceEventMileageKm').props.onChange({ target: { value: '151200' } }); });
    await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    await act(async () => { button('Обновить пробег').props.onClick(); });
    expect(byId('mileageKm').props.value).toBe('151 200');
  });
});

describe('odometer form on its own (trigger button)', () => {
  it('keeps a reading typed right after opening; a reopen starts empty', async () => {
    await act(async () => { tree = create(<><AddMileageForm lastMileageKm={150000} /><InteractionProbe /></>); });
    const trigger = () => tree.root.find((n) => n.type === 'button' && n.props['data-add-mileage-trigger']);
    await openThenInteract(() => trigger().props.onClick(), () => byId('mileageKm').props.onChange({ target: { value: '150800' } }));
    expect(byId('mileageKm').props.value).toBe('150 800');
    expect(all()).toMatch(/\+800/);
    await act(async () => { odometerCancel().props.onClick(); });
    await openThenInteract(() => trigger().props.onClick(), () => expect(byId('mileageKm').props.value).toBe(''));
    expect(byId('mileageKm').props.value).toBe('');
  });
});
