'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServiceEvent } from '@/lib/db/types';
import { ITEM_HISTORY_PAGE_SIZE, mergeHistoryPages } from '@/lib/service/replacementIntervals';
import { cursorOf, cursorSearchParams, type HistoryCursor, type HistoryPage } from '@/lib/service/historyPage';

/** Shown when the API response carries no message; translated by `errorMessageText`. */
const LOAD_FAILED = 'Не удалось загрузить историю. Попробуйте ещё раз.';

async function fetchPage(itemId: string, cursor: HistoryCursor | null, signal: AbortSignal): Promise<HistoryPage> {
  const query = `itemId=${encodeURIComponent(itemId)}&limit=${ITEM_HISTORY_PAGE_SIZE}`
    + (cursor ? `&${cursorSearchParams(cursor)}` : '');
  const response = await fetch(`/api/service-events?${query}`, { cache: 'no-store', signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || LOAD_FAILED);
  return { events: data.events ?? [], hasMore: data.hasMore === true, previousReplacement: data.previousReplacement ?? null };
}

/**
 * Service history of one item, loaded page by page (newest first). Shared by the
 * details sheet (/items) and the details page (/items/[id]).
 */
export function useItemHistory(itemId: string) {
  const [events, setEventsState] = useState<ServiceEvent[]>([]);
  const [previousReplacement, setPreviousReplacement] = useState<ServiceEvent | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const moreControllerRef = useRef<AbortController | null>(null);
  // A reload invalidates pages that are still being fetched for the previous state.
  const generationRef = useRef(0);
  // Synchronous mirrors for event handlers (removeEvent → load the next page).
  const eventsRef = useRef<ServiceEvent[]>([]);
  const hasMoreRef = useRef(false);
  const busyRef = useRef<'reload' | 'more' | null>('reload');
  /**
   * Keyset cursor of the oldest record ever loaded in this generation. Kept when that
   * record is deleted: "strictly older than the deleted record" is still exactly the
   * next page, and it is the only cursor left once every loaded record is deleted.
   */
  const cursorRef = useRef<HistoryCursor | null>(null);

  const setEvents = useCallback((next: ServiceEvent[]) => {
    eventsRef.current = next;
    setEventsState(next);
  }, []);
  const setMore = useCallback((next: boolean) => {
    hasMoreRef.current = next;
    setHasMore(next);
  }, []);

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    moreControllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    busyRef.current = 'reload';
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(null);
    setLoadMoreFailed(false);
    try {
      const page = await fetchPage(itemId, null, controller.signal);
      if (generation !== generationRef.current) return;
      cursorRef.current = page.events.length ? cursorOf(page.events[page.events.length - 1]) : null;
      setEvents(page.events);
      setPreviousReplacement(page.previousReplacement);
      setMore(page.hasMore);
    } catch (err) {
      if (generation !== generationRef.current || (err instanceof Error && err.name === 'AbortError')) return;
      setError(err instanceof Error ? err.message : LOAD_FAILED);
      if (process.env.NODE_ENV !== 'production') console.error('[useItemHistory] Failed to load history:', err);
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = null;
        setIsLoading(false);
      }
    }
  }, [itemId, setEvents, setMore]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    // Never page from a list that is being replaced: it could leave a gap.
    if (!cursor || !hasMoreRef.current || busyRef.current !== null) return;
    const controller = new AbortController();
    moreControllerRef.current = controller;
    const generation = generationRef.current;
    busyRef.current = 'more';
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      // Keyset cursor: everything strictly older than the oldest record loaded so far.
      const page = await fetchPage(itemId, cursor, controller.signal);
      if (generation !== generationRef.current) return;
      if (page.events.length) cursorRef.current = cursorOf(page.events[page.events.length - 1]);
      setEvents(mergeHistoryPages(eventsRef.current, page.events));
      setPreviousReplacement(page.previousReplacement);
      setMore(page.hasMore);
    } catch (err) {
      if (generation !== generationRef.current || (err instanceof Error && err.name === 'AbortError')) return;
      setLoadMoreFailed(true);
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = null;
        setIsLoadingMore(false);
      }
    }
  }, [itemId, setEvents, setMore]);

  /**
   * Drops a deleted record locally, keeping the loaded pages. The loaded records stay a
   * prefix of the history, so the cursor and `previousReplacement` remain valid. When
   * the last loaded record goes while older ones exist, the next page is loaded at once,
   * so the remaining history is shown instead of an empty list.
   */
  const removeEvent = useCallback((eventId: string) => {
    const remaining = eventsRef.current.filter((event) => event.id !== eventId);
    setEvents(remaining);
    if (remaining.length === 0 && hasMoreRef.current) void loadMore();
  }, [loadMore, setEvents]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    moreControllerRef.current?.abort();
  }, []);

  /** Nothing loaded and nothing left on the server: the history is really empty. */
  const isEmpty = events.length === 0 && !hasMore;

  return { events, previousReplacement, hasMore, isEmpty, isLoading, error, isLoadingMore, loadMoreFailed, reload, loadMore, removeEvent };
}

export type ItemHistoryState = ReturnType<typeof useItemHistory>;
