import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceEvent, ServiceItem } from '@/lib/db/types';

/**
 * Release A (compatible): the real `serviceEventKinds` module, no release-B mock. Only a
 * replacement can be created, so the form has no kind choice; existing checks and top-ups
 * are still shown and deletable. Release B's kind choice is covered in serviceRecordForm,
 * formOpenRace, mileageHistoryUi and itemDetailsSheet tests.
 */
const mocks = vi.hoisted(() => ({
  pathname: '/', addServiceEvent: vi.fn(), deleteServiceEvent: vi.fn(), toast: vi.fn(), fetch: vi.fn(), mileageForm: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/serviceActions', () => ({ addServiceEvent: mocks.addServiceEvent, deleteServiceEvent: mocks.deleteServiceEvent }));
vi.mock('../ToastProvider', () => ({ useToast: () => ({ success: mocks.toast }) }));
vi.mock('../ModalSheet', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../AddMileageForm', () => ({ default: (props: Record<string, unknown>) => { mocks.mileageForm(props); return null; } }));

import AddServiceEventForm from '../AddServiceEventForm';
import ItemDetailsSheet from '../ItemDetailsSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ITEM = '00000000-0000-4000-8000-000000000010';
let tree: ReactTestRenderer;
const onSuccess = vi.fn();
const onClose = vi.fn();

const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const all = () => text(tree.root).replace(/[\u00a0\u202f]/g, ' ');
const field = (id: string) => tree.root.find((n) => (n.type === 'input' || n.type === 'textarea') && n.props.id === id);
const fields = (id: string) => tree.root.findAll((n) => (n.type === 'input' || n.type === 'textarea') && n.props.id === id);
const radios = () => tree.root.findAll((n) => n.type === 'input' && n.props.type === 'radio');
const fieldsets = () => tree.root.findAll((n) => n.type === 'fieldset');
const type = async (id: string, value: string) => { await act(async () => { field(id).props.onChange({ target: { value } }); }); };
const submit = async () => { await act(async () => { await tree.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); }); };
const button = (label: string) => tree.root.find((n) => n.type === 'button' && text(n) === label);
const submitButton = () => tree.root.find((n) => n.type === 'button' && n.props['data-service-event-submit']);
const lastMileageFormProps = () => mocks.mileageForm.mock.calls.at(-1)![0] as { open: boolean; onSaved: (entry: object) => void; onClose: () => void };

const form = (isOpen = true) => (
  <AddServiceEventForm serviceItemId={ITEM} serviceItemTitle="Масло" defaultMileage={150205}
    lastReadingAt="2026-10-05T08:00:00Z" isOpen={isOpen} onClose={onClose} onSuccess={onSuccess} />
);
async function mount() { await act(async () => { tree = create(form()); }); }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pathname = '/';
  mocks.addServiceEvent.mockResolvedValue({ ok: true, event: { id: 'e' } });
  mocks.deleteServiceEvent.mockResolvedValue({ ok: true, deleted: {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  vi.unstubAllGlobals();
});

describe('release A record form: replacement only, no kind choice', () => {
  it.each([
    ['/', 'Сохранить замену', ['Что вы сделали?', 'Тип записи', 'Проверка', 'Долив']],
    ['/en', 'Save replacement', ['What did you do?', 'Record type', 'Check', 'Top-up']],
  ])('opens with the replacement fields at once and no kind switch (%s)', async (pathname, save, absent) => {
    mocks.pathname = pathname;
    await mount();
    expect(radios()).toHaveLength(0);
    expect(fieldsets()).toHaveLength(0);
    for (const label of absent) expect(all()).not.toContain(label);
    // The replacement fields are on screen from the first render, prefilled with the last reading.
    expect(field('serviceEventMileageKm').props.value.replace(/\D/g, '')).toBe('150205');
    expect(fields('serviceEventNote')).toHaveLength(1);
    expect(fields('serviceEventAmount')).toHaveLength(0);
    expect(text(submitButton())).toBe(save);
    expect(submitButton().props.disabled).toBe(false);
  });

  it('saves a replacement without a volume and reports the kind', async () => {
    await mount();
    await type('serviceEventNote', '  Масло 5W-30  ');
    await submit();
    expect(mocks.addServiceEvent).toHaveBeenCalledTimes(1);
    expect(mocks.addServiceEvent).toHaveBeenCalledWith({
      serviceItemId: ITEM, kind: 'replacement', occurredAt: expect.any(Date), mileageKm: 150205, amountLiters: null, note: 'Масло 5W-30',
    });
    expect(onSuccess).toHaveBeenCalledWith('replacement');
    expect(onClose).toHaveBeenCalled();
  });

  it('a reopened form starts fresh, already on a replacement, and keeps input typed at once', async () => {
    await mount();
    await type('serviceEventMileageKm', '140000');
    await act(async () => { tree.update(form(false)); });
    await act(async () => { tree.update(form(true)); });
    expect(field('serviceEventMileageKm').props.value.replace(/\D/g, '')).toBe('150205');
    expect(field('serviceEventNote').props.value).toBe('');
    await type('serviceEventNote', 'Сразу после открытия');
    await submit();
    expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'replacement', note: 'Сразу после открытия' }));
  });

  it('mileage above the last reading: not saved, "Update odometer", back to the replacement with the input kept', async () => {
    await mount();
    await type('serviceEventMileageKm', '151000');
    await type('serviceEventNote', 'После трассы');
    await submit();
    expect(mocks.addServiceEvent).not.toHaveBeenCalled();
    expect(all()).toContain('Пробег 151 000 км больше последнего показания одометра (150 205 км).');
    await act(async () => { button('Обновить пробег').props.onClick(); });
    expect(lastMileageFormProps().open).toBe(true);
    await act(async () => {
      lastMileageFormProps().onSaved({ id: 'r', mileage_km: 151000, occurred_at: '2026-10-09T10:00:00Z' });
      lastMileageFormProps().onClose();
    });
    expect(radios()).toHaveLength(0);
    expect(text(submitButton())).toBe('Сохранить замену');
    expect(field('serviceEventNote').props.value).toBe('После трассы');
    await submit();
    expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'replacement', mileageKm: 151000, note: 'После трассы' }));
  });

  it('a date before the last reading asks for the mileage on that date', async () => {
    await mount();
    await act(async () => { button('Изменить дату').props.onClick(); });
    await type('serviceEventDate', '2026-09-01');
    expect(field('serviceEventMileageKm').props.value).toBe('');
    expect(submitButton().props.disabled).toBe(true);
    await type('serviceEventMileageKm', '149000');
    await submit();
    expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replacement', mileageKm: 149000, occurredAt: new Date(2026, 8, 1, 12),
    }));
  });

  it('explains a server refusal of the kind (a client of a newer release) as a generic failure', async () => {
    mocks.addServiceEvent.mockResolvedValue({ ok: false, reason: 'invalid-input' });
    await mount();
    await submit();
    expect(all()).toContain('Не удалось сохранить запись. Попробуйте ещё раз.');
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('release A item sheet: existing checks and top-ups', () => {
  const item: ServiceItem = {
    id: ITEM, user_id: 'u', title: 'Масло двигателя', interval_km: 10000, interval_days: null,
    notify_before_days: 30, notify_before_km: null, measurement_mode: 'km', note: null, is_active: true, created_at: '2025-01-01T00:00:00Z',
  };
  const event = (n: number, kind: ServiceEvent['kind'], mileage_km: number): ServiceEvent => ({
    id: `00000000-0000-4000-8000-00000000000${n}`, user_id: 'u', service_item_id: ITEM,
    occurred_at: new Date(Date.UTC(2026, n, 1)).toISOString(), mileage_km, note: null, created_at: '2026-01-01T00:00:00Z',
    kind, amount_liters: kind === 'top_up' ? '0.50' as unknown as number : null,
  });
  // Newest first: a top-up and a check recorded after the last replacement.
  const history = [event(4, 'top_up', 131000), event(3, 'check', 130000), event(2, 'replacement', 120000), event(1, 'replacement', 100000)];
  const onRefresh = vi.fn();

  async function mountSheet() {
    vi.stubGlobal('window', { scrollTo: vi.fn() });
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, events: history, hasMore: false, previousReplacement: null }) });
    await act(async () => {
      tree = create(
        <ItemDetailsSheet item={item} latestOdometer={{ mileage_km: 131000, occurred_at: '2026-10-05T08:00:00Z' }}
          estimatedOdometer={{ estimatedKm: 131000, lastActualKm: 131000, lastActualAt: '2026-10-05T08:00:00Z', elapsedDays: 0, dailyRate: null, isEstimated: false }}
          dailyKmRate={null} onClose={onClose} onOpenSettings={vi.fn()} onRefresh={onRefresh} />
      );
    });
  }
  const rows = () => tree.root.findAll((n) => n.type === 'li' && n.props.className === 'item-history-row');
  const deleteButtons = () => tree.root.findAll((n) => n.type === 'button' && n.props.className === 'item-history-delete');

  it('shows them in the history, with the last replacement taken from replacements only', async () => {
    await mountSheet();
    expect(rows().map((row) => row.props['data-kind'])).toEqual(['top_up', 'check', 'replacement', 'replacement']);
    expect(all()).toContain('0,5 л');
    await act(async () => { button('Расчёт').props.onClick(); });
    const lastReplacement = tree.root.findAll((n) => n.props.className === 'calc-row').find((row) => text(row).includes('Последняя замена'))!;
    expect(text(lastReplacement).replace(/[\u00a0\u202f]/g, ' ')).toContain('120 000 км');
    expect(text(lastReplacement)).not.toMatch(/13[01].000/);
  });

  it.each([['top-up', 0], ['check', 1]] as const)('deletes an existing %s (row %s) without the replacement warning', async (_label, index) => {
    await mountSheet();
    await act(async () => { deleteButtons()[index].props.onClick(); });
    expect(tree.root.findAll((n) => n.props['data-testid'] === 'delete-replacement-warning')).toHaveLength(0);
    await act(async () => { button('Удалить запись').props.onClick(); });
    expect(mocks.deleteServiceEvent).toHaveBeenCalledWith(history[index].id);
    expect(rows().map((row) => row.props['data-event-id'])).toEqual(history.filter((_, i) => i !== index).map((e) => e.id));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('adds a record from the sheet as a replacement, without a kind choice', async () => {
    await mountSheet();
    await act(async () => { button('Добавить запись').props.onClick(); });
    expect(radios()).toHaveLength(0);
    expect(all()).not.toContain('Что вы сделали?');
    await submit();
    expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({ serviceItemId: ITEM, kind: 'replacement', mileageKm: 131000, amountLiters: null }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ subtitle: 'Замена отмечена' }));
  });
});
