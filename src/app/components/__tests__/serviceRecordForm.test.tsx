import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/',
  addServiceEvent: vi.fn(),
  mileageForm: vi.fn(),
}));
// Release B behaviour (check and top-up creatable); release A is covered in the *ReleaseA tests.
vi.mock('@/lib/service/serviceEventKinds', async (importOriginal) =>
  (await import('@/lib/service/__tests__/allKindsCreatable')).allKindsCreatable(await importOriginal()));
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
    // Today is one compact line; the date input only appears on demand.
    expect(tree.root.findAll((n) => n.props.id === 'serviceEventDate')).toHaveLength(0);
    expect(all()).toContain('Дата: Сегодня');
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
    for (const value of ['0', '1,234', '1000', '1000,5', 'abc']) {
      await type('serviceEventAmount', value);
      await submit();
      expect(all()).toContain('Укажите объём больше нуля, не более двух знаков после запятой (максимум 999,99 л)');
    }
    expect(mocks.addServiceEvent).not.toHaveBeenCalled();
  });

  it.each([['100', 100], ['250,5', 250.5], ['999,99', 999.99]])('has no product limit below the column range: %s L is sent', async (value, liters) => {
    await mount();
    await choose('top_up');
    await type('serviceEventAmount', value);
    await submit();
    expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'top_up', amountLiters: liters }));
  });

  it('puts the volume of a top-up above the mileage, right after the date line', async () => {
    await mount();
    await choose('top_up');
    const order = tree.root.findAll((n) => typeof n.props.id === 'string' && /^serviceEvent(Amount|MileageKm|Note)$/.test(n.props.id) && n.type !== 'label')
      .map((n) => n.props.id);
    expect(order).toEqual(['serviceEventAmount', 'serviceEventMileageKm', 'serviceEventNote']);
    expect(all().indexOf('Дата: Сегодня')).toBeLessThan(all().indexOf('Объём, л'));
  });

  it('shows today as one compact line and reveals the date field on demand', async () => {
    await mount();
    await choose('check');
    expect(tree.root.findAll((n) => n.props['data-testid'] === 'service-event-date-today')).toHaveLength(1);
    await act(async () => { button('Изменить дату').props.onClick(); });
    expect(input('serviceEventDate').props.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input('serviceEventDate').props.min).toBe('1950-01-01');
    expect(tree.root.findAll((n) => n.props['data-testid'] === 'service-event-date-today')).toHaveLength(0);
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

  describe('date before the last odometer reading', () => {
    const pickDate = async (value: string) => {
      await act(async () => { button('Изменить дату').props.onClick(); });
      await type('serviceEventDate', value);
    };
    const hint = () => tree.root.findAll((n) => n.props['data-testid'] === 'service-event-historical-reading');

    it('does not leave the current mileage in the field: asks for the mileage on the chosen date', async () => {
      await mount();
      await choose('replacement');
      expect(input('serviceEventMileageKm').props.value).toBe('150 205');

      await pickDate('2026-09-01');
      expect(input('serviceEventMileageKm').props.value).toBe('');
      expect(hint()).toHaveLength(1);
      expect(all()).toMatch(/Выбранная дата раньше последнего показания одометра \(150 205 км от \S+\)\. Укажите пробег на выбранную дату\./);
      expect(tree.root.find((n) => n.type === 'button' && n.props['data-service-event-submit']).props.disabled).toBe(true);

      await submit();
      expect(all()).toContain('Введите пробег');
      expect(mocks.addServiceEvent).not.toHaveBeenCalled();

      await type('serviceEventMileageKm', '149000');
      await submit();
      expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'replacement', mileageKm: 149000, occurredAt: new Date(2026, 8, 1, 12),
      }));
    });

    it('restores the last reading when the user returns to a date on or after it (nothing typed)', async () => {
      await mount();
      await choose('check');
      await pickDate('2026-09-01');
      expect(input('serviceEventMileageKm').props.value).toBe('');
      await type('serviceEventDate', '2026-10-20');
      expect(input('serviceEventMileageKm').props.value).toBe('150 205');
      expect(hint()).toHaveLength(0);
      expect(all()).toMatch(/Последнее показание одометра: 150 205 км/);
    });

    it('never erases a mileage the user typed, but keeps the reminder visible', async () => {
      await mount();
      await choose('check');
      await type('serviceEventMileageKm', '140000');
      await pickDate('2026-09-01');
      expect(input('serviceEventMileageKm').props.value).toBe('140 000');
      expect(hint()).toHaveLength(1);
      await type('serviceEventDate', '2026-10-20');
      expect(input('serviceEventMileageKm').props.value).toBe('140 000');
      await submit();
      expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({ mileageKm: 140000 }));
    });

    it('works in English', async () => {
      mocks.pathname = '/en';
      await mount();
      await choose('check');
      await act(async () => { button('Change date').props.onClick(); });
      await type('serviceEventDate', '2026-09-01');
      expect(all()).toMatch(/The selected date is earlier than the last odometer reading \(150,205 km on \S+\)\. Enter the mileage for the selected date\./);
      expect(input('serviceEventMileageKm').props.value).toBe('');
    });
  });

  describe('record date validation', () => {
    it.each([
      ['a future date in the form', '2099-01-01', undefined, 'Дата не может быть позже сегодняшней'],
      ['a mistyped old year in the form', '1015-03-01', undefined, 'Дата не может быть раньше 1 января 1950 года'],
      ['a future date refused by the server', '2026-10-20', 'date-in-future', 'Дата не может быть позже сегодняшней'],
      ['an old date refused by the server', '2026-10-20', 'date-too-old', 'Дата не может быть раньше 1 января 1950 года'],
    ])('explains %s', async (_label, date, serverReason, message) => {
      if (serverReason) mocks.addServiceEvent.mockResolvedValue({ ok: false, reason: serverReason });
      await mount();
      await choose('check');
      await act(async () => { button('Изменить дату').props.onClick(); });
      await type('serviceEventDate', date);
      await submit();
      expect(all()).toContain(message);
      expect(mocks.addServiceEvent).toHaveBeenCalledTimes(serverReason ? 1 : 0);
      expect(onSuccess).not.toHaveBeenCalled();
      // The date field stays open so the user can fix it.
      expect(input('serviceEventDate').props.value).toBe(date);
    });

    it('explains a server date rejection in English', async () => {
      mocks.pathname = '/en';
      mocks.addServiceEvent.mockResolvedValue({ ok: false, reason: 'date-in-future' });
      await mount();
      await choose('check');
      await submit();
      expect(all()).toContain('The date cannot be later than today');
      expect(input('serviceEventDate')).toBeTruthy();
    });
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
    expect(all()).toContain('Date: Today');
    expect(all()).toContain('Save top-up');
    expect(all().replace('Масло', '')).not.toMatch(/[А-Яа-яЁё]/);
  });
});
