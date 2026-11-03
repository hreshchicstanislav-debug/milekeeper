import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/',
  addServiceEvent: vi.fn(),
  mileageForm: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/serviceActions', () => ({ addServiceEvent: mocks.addServiceEvent }));
vi.mock('../ModalSheet', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
// The odometer form is a separate operation; record how the record form drives it.
vi.mock('../AddMileageForm', () => ({ default: (props: Record<string, unknown>) => { mocks.mileageForm(props); return null; } }));

import AddServiceEventForm from '../AddServiceEventForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ITEM = '00000000-0000-4000-8000-000000000010';
let tree: ReactTestRenderer;
const onSuccess = vi.fn();
const onClose = vi.fn();

const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('');
const all = () => text(tree.root).replace(/[  ]/g, ' ');
const input = (id: string) => tree.root.find((n) => n.type === (id === 'serviceEventNote' ? 'textarea' : 'input') && n.props.id === id);
const radios = () => tree.root.findAll((n) => n.type === 'input' && n.props.type === 'radio');
const type = async (id: string, value: string) => { await act(async () => { input(id).props.onChange({ target: { value } }); }); };
const choose = async (kind: string) => { await act(async () => { radios().find((r) => r.props.value === kind)!.props.onChange(); }); };
const submit = async () => { await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); }); };
const button = (label: string) => tree.root.find((n) => n.type === 'button' && text(n) === label);
const lastMileageFormProps = () => mocks.mileageForm.mock.calls.at(-1)![0] as {
  open: boolean; initialMileageKm: number | null; onSaved: (entry: object) => void; onClose: () => void;
};

async function mount() {
  await act(async () => {
    tree = create(
      <AddServiceEventForm serviceItemId={ITEM} serviceItemTitle="Масло" defaultMileage={150205}
        lastReadingAt="2026-10-05T08:00:00Z" isOpen onClose={onClose} onSuccess={onSuccess} />
    );
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pathname = '/';
  mocks.addServiceEvent.mockResolvedValue({ ok: true, event: { id: 'e' } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => tree?.unmount()); });

describe('record form', () => {
  it('starts without a kind; choosing one shows that kind’s fields and button', async () => {
    await mount();
    expect(radios().map((r) => r.props.checked)).toEqual([false, false, false]);
    expect(tree.root.findAll((n) => n.props.id === 'serviceEventMileageKm')).toHaveLength(0);

    await choose('check');
    expect(input('serviceEventMileageKm').props.value).toBe('150 205');
    expect(input('serviceEventDate').props.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tree.root.findAll((n) => n.props.id === 'serviceEventAmount')).toHaveLength(0);
    expect(all()).toContain('Сохранить проверку');
    expect(all()).toContain('Не меняет интервал замены и прогноз.');
    // The prefilled value is the last actual reading, with its date next to it.
    expect(all()).toMatch(/Последнее показание одометра: 150 205 км от \S+/);

    await choose('top_up');
    expect(input('serviceEventAmount').props.inputMode).toBe('decimal');
    expect(all()).toContain('Сохранить долив');
    await choose('replacement');
    expect(all()).toContain('Начнёт новый интервал обслуживания');
  });

  it('rejects an invalid volume before sending', async () => {
    await mount();
    await choose('top_up');
    for (const value of ['0', '1,234', '100', 'abc']) {
      await type('serviceEventAmount', value);
      await submit();
      expect(all()).toContain('Объём — положительное число не больше 99,99 л');
    }
    expect(mocks.addServiceEvent).not.toHaveBeenCalled();
  });

  it('saves a top-up with a decimal comma and comment, without touching the odometer', async () => {
    await mount();
    await choose('top_up');
    await type('serviceEventAmount', '0,5');
    await type('serviceEventNote', '  Долил до max  ');
    await submit();
    expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({
      serviceItemId: ITEM, kind: 'top_up', mileageKm: 150205, amountLiters: 0.5, note: 'Долил до max',
    }));
    expect(onSuccess).toHaveBeenCalledWith('top_up');
    expect(onClose).toHaveBeenCalled();
    expect(lastMileageFormProps().open).toBe(false);
  });

  it('mileage above the last reading: not saved, offers "Update odometer", returns with the input kept', async () => {
    await mount();
    await choose('top_up');
    await type('serviceEventMileageKm', '151000');
    await type('serviceEventAmount', '0.5');
    await type('serviceEventNote', 'Долил');
    await submit();
    expect(mocks.addServiceEvent).not.toHaveBeenCalled();
    expect(all()).toContain('Пробег 151 000 км больше последнего показания одометра (150 205 км). Запись не сохранена — сначала обновите пробег.');

    await act(async () => { button('Обновить пробег').props.onClick(); });
    expect(lastMileageFormProps()).toMatchObject({ open: true, initialMileageKm: 151000 });

    // The odometer form saves the reading separately and closes.
    await act(async () => {
      lastMileageFormProps().onSaved({ id: 'r', mileage_km: 151000, occurred_at: '2026-10-09T10:00:00Z' });
      lastMileageFormProps().onClose();
    });
    expect(lastMileageFormProps().open).toBe(false);
    expect(all()).not.toContain('Запись не сохранена');
    expect(all()).toContain('Пробег обновлён: 151 000 км. Проверьте данные и сохраните запись.');
    expect(radios().find((r) => r.props.checked)?.props.value).toBe('top_up');
    expect(input('serviceEventMileageKm').props.value).toBe('151 000');
    expect(input('serviceEventAmount').props.value).toBe('0.5');
    expect(input('serviceEventNote').props.value).toBe('Долил');
    expect(all()).toMatch(/Последнее показание одометра: 151 000 км/);

    await submit();
    expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'top_up', mileageKm: 151000, amountLiters: 0.5, note: 'Долил' }));
  });

  it('shows the server rejection with the freshest odometer value', async () => {
    mocks.addServiceEvent.mockResolvedValue({ ok: false, reason: 'mileage-above-odometer', odometerKm: 150000, odometerAt: '2026-10-01T00:00:00Z' });
    await mount();
    await choose('replacement');
    await submit();
    expect(all()).toContain('Пробег 150 205 км больше последнего показания одометра (150 000 км).');
    expect(button('Обновить пробег')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('never shows server details of an unexpected failure', async () => {
    mocks.addServiceEvent.mockRejectedValue(new Error('duplicate key value violates unique constraint "x"'));
    await mount();
    await choose('check');
    await submit();
    expect(all()).toContain('Не удалось сохранить запись. Попробуйте ещё раз.');
    expect(all()).not.toContain('duplicate key');
  });

  it('works in English', async () => {
    mocks.pathname = '/en';
    await mount();
    expect(all()).toContain('What did you do?');
    await choose('top_up');
    await type('serviceEventMileageKm', '151000');
    await submit();
    expect(all()).toContain('The odometer reading 151,000 km is higher than the last recorded reading (150,205 km).');
    expect(all()).toContain('Update odometer');
    expect(all()).toContain('Volume, L (optional)');
    expect(all()).toContain('Save top-up');
    expect(all().replace('Масло', '')).not.toMatch(/[А-Яа-яЁё]/);
  });
});
