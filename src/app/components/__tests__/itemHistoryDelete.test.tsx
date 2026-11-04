import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceEvent } from '@/lib/db/types';

const mocks = vi.hoisted(() => ({ pathname: '/', deleteServiceEvent: vi.fn(), toast: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/serviceActions', () => ({ deleteServiceEvent: mocks.deleteServiceEvent }));
vi.mock('../ToastProvider', () => ({ useToast: () => ({ success: mocks.toast }) }));

import ItemHistoryList from '../ItemHistoryList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const event = (n: number, kind: ServiceEvent['kind'], mileage_km: number): ServiceEvent => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, user_id: 'u', service_item_id: 'oil',
  occurred_at: new Date(Date.UTC(2025, n, 1)).toISOString(), mileage_km, note: null, created_at: '2025-01-01T00:00:00Z',
  kind, amount_liters: null,
});

let tree: ReactTestRenderer;
const focus = vi.fn();
const scrollIntoView = vi.fn();
const onDeleted = vi.fn();
// DOM nodes stand-ins: which element received focus / was scrolled into view.
const nodeMock = (element: React.ReactElement) => {
  const props = element.props as Record<string, unknown>;
  const label = typeof props['aria-label'] === 'string' ? props['aria-label'] : String(props.className ?? element.type);
  return { focus: () => focus(label), scrollIntoView: (options: unknown) => scrollIntoView(label, options) };
};

const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const all = () => text(tree.root).replace(/[  ]/g, ' ');
const deleteButtons = () => tree.root.findAll((n) => n.type === 'button' && n.props.className === 'item-history-delete');
const confirmBox = () => tree.root.find((n) => n.type === 'div' && n.props.className === 'item-history-confirm');
const warning = () => tree.root.findAll((n) => n.props['data-testid'] === 'delete-replacement-warning' && n.type === 'p');
const button = (label: string) => tree.root.find((n) => n.type === 'button' && text(n) === label);

async function mount(events: ServiceEvent[], previousReplacement: ServiceEvent | null = null) {
  await act(async () => {
    tree = create(
      <ItemHistoryList events={events} previousReplacement={previousReplacement} hasMore={false} isLoadingMore={false}
        loadMoreFailed={false} onLoadMore={() => {}} onDeleted={onDeleted} />,
      { createNodeMock: nodeMock },
    );
  });
}
const open = async (index: number) => { await act(async () => { deleteButtons()[index].props.onClick(); }); };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pathname = '/';
  mocks.deleteServiceEvent.mockResolvedValue({ ok: true, deleted: {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => tree?.unmount()); });

describe('delete confirmation: what happens to the forecast', () => {
  // Newest first.
  const newest = event(3, 'replacement', 130000);
  const middle = event(2, 'check', 120000);
  const oldest = event(1, 'replacement', 100000);

  it('latest replacement with an earlier one: the forecast moves to the previous replacement', async () => {
    await mount([newest, middle, oldest]);
    await open(0);
    expect(warning()).toHaveLength(1);
    expect(warning()[0].props['data-impact']).toBe('latest');
    expect(all()).toContain('Это последняя замена: прогноз следующего обслуживания будет пересчитан по предыдущей замене.');
  });

  it('latest replacement whose predecessor is on an older, unloaded page still counts as having one', async () => {
    await mount([newest, middle], oldest);
    await open(0);
    expect(warning()[0].props['data-impact']).toBe('latest');
  });

  it('the only replacement: does not claim a recalculation from a previous replacement that does not exist', async () => {
    await mount([middle, oldest]);
    await open(1);
    expect(warning()[0].props['data-impact']).toBe('only');
    expect(all()).toContain('Это единственная замена. После удаления элемент снова будет ждать отметки первой замены, а прогноз пропадёт.');
    expect(all()).not.toContain('по предыдущей замене');
    await act(async () => { button('Удалить запись').props.onClick(); });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Запись удалена. Отметьте первую замену, чтобы вернуть прогноз.' }));
  });

  it('an older replacement: the forecast does not change', async () => {
    await mount([newest, middle, oldest]);
    await open(2);
    expect(warning()[0].props['data-impact']).toBe('older');
    expect(all()).toContain('Это не последняя замена: прогноз не изменится, но интервалы между заменами будут пересчитаны.');
    await act(async () => { button('Удалить запись').props.onClick(); });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Запись удалена' }));
  });

  it('a check or top-up has no forecast warning', async () => {
    await mount([newest, middle, oldest]);
    await open(1);
    expect(warning()).toHaveLength(0);
  });

  it('latest replacement toast says the forecast was recalculated', async () => {
    await mount([newest, middle, oldest]);
    await open(0);
    await act(async () => { button('Удалить запись').props.onClick(); });
    expect(mocks.deleteServiceEvent).toHaveBeenCalledWith(newest.id);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Запись удалена. Прогноз пересчитан.' }));
    expect(onDeleted).toHaveBeenCalledWith(newest, 'deleted');
  });

  it('is correct in English', async () => {
    mocks.pathname = '/en';
    await mount([middle, oldest]);
    await open(1);
    expect(all()).toContain('This is the only replacement. After deleting it the item will wait for a first replacement again and the forecast will disappear.');
    expect(all()).not.toMatch(/[А-Яа-яЁё]/);
    await act(async () => { button('Delete record').props.onClick(); });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Record deleted. Mark a first replacement to bring the forecast back.' }));
  });
});

describe('delete confirmation: visibility and keyboard', () => {
  const rows = [event(2, 'replacement', 120000), event(1, 'replacement', 100000)];

  it('scrolls the confirmation into view and moves focus to the safe choice, Cancel', async () => {
    await mount(rows);
    await open(0);
    // The confirmation, then its buttons (the whole box can be taller than a short screen).
    expect(scrollIntoView.mock.calls.map(([label]) => label)).toEqual(['item-history-confirm', 'item-history-confirm-actions']);
    expect(scrollIntoView).toHaveBeenCalledWith('item-history-confirm-actions', { block: 'nearest' });
    expect(focus).toHaveBeenCalledWith('btn btn-secondary');
  });

  it('does not move focus on first render or when the confirmation is closed again', async () => {
    await mount(rows);
    expect(focus).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('Escape closes only the confirmation (not the sheet around it) and returns focus to the delete button', async () => {
    await mount(rows);
    await open(0);
    focus.mockClear();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    await act(async () => { confirmBox().props.onKeyDown({ key: 'Escape', preventDefault, stopPropagation }); });
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.type === 'div' && n.props.className === 'item-history-confirm')).toHaveLength(0);
    expect(focus).toHaveBeenCalledWith(expect.stringMatching(/^Удалить: /));
  });

  it('other keys are left alone; Cancel restores focus too', async () => {
    await mount(rows);
    await open(0);
    const stopPropagation = vi.fn();
    await act(async () => { confirmBox().props.onKeyDown({ key: 'Tab', preventDefault() {}, stopPropagation }); });
    expect(stopPropagation).not.toHaveBeenCalled();
    focus.mockClear();
    await act(async () => { button('Отмена').props.onClick(); });
    expect(focus).toHaveBeenCalledWith(expect.stringMatching(/^Удалить: /));
  });

  it('is an alertdialog named by its title and described by the text', async () => {
    await mount(rows);
    await open(0);
    const box = confirmBox();
    expect(box.props.role).toBe('alertdialog');
    const title = tree.root.find((n) => n.props.id === box.props['aria-labelledby']);
    expect(text(title)).toBe('Удалить запись?');
    expect(tree.root.find((n) => n.props.id === box.props['aria-describedby'])).toBeTruthy();
  });

  it('a failed deletion keeps the confirmation open with an error', async () => {
    mocks.deleteServiceEvent.mockRejectedValue(new Error('connection refused 10.0.0.1'));
    await mount(rows);
    await open(0);
    await act(async () => { button('Удалить запись').props.onClick(); });
    expect(all()).toContain('Не удалось удалить запись. Попробуйте ещё раз.');
    expect(all()).not.toContain('10.0.0.1');
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a record that is already gone refreshes the history instead of failing', async () => {
    mocks.deleteServiceEvent.mockResolvedValue({ ok: false, reason: 'not-found' });
    await mount(rows);
    await open(0);
    await act(async () => { button('Удалить запись').props.onClick(); });
    expect(onDeleted).toHaveBeenCalledWith(rows[0], 'already-deleted');
  });
});
