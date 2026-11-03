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
  const [events, setEvents] = useState<ServiceEvent[]>([]);
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

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    moreControllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(null);
    setLoadMoreFailed(false);
    try {
      const page = await fetchPage(itemId, null, controller.signal);
      if (generation !== generationRef.current) return;
      setEvents(page.events);
      setPreviousReplacement(page.previousReplacement);
      setHasMore(page.hasMore);
    } catch (err) {
      if (generation !== generationRef.current || (err instanceof Error && err.name === 'AbortError')) return;
      setError(err instanceof Error ? err.message : LOAD_FAILED);
      if (process.env.NODE_ENV !== 'production') console.error('[useItemHistory] Failed to load history:', err);
    } finally {
      if (generation === generationRef.current) setIsLoading(false);
    }
  }, [itemId]);

  const loadMore = useCallback(async () => {
    const oldest = events.at(-1);
    // Never page from a list that is being replaced: it could leave a gap.
    if (!oldest || isLoading || isLoadingMore) return;
    const controller = new AbortController();
    moreControllerRef.current = controller;
    const generation = generationRef.current;
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      // Keyset cursor: everything strictly older than the last loaded record.
      const page = await fetchPage(itemId, cursorOf(oldest), controller.signal);
      if (generation !== generationRef.current) return;
      setEvents((loaded) => mergeHistoryPages(loaded, page.events));
      setPreviousReplacement(page.previousReplacement);
      setHasMore(page.hasMore);
    } catch (err) {
      if (generation !== generationRef.current || (err instanceof Error && err.name === 'AbortError')) return;
      setLoadMoreFailed(true);
    } finally {
      if (generation === generationRef.current) setIsLoadingMore(false);
    }
  }, [events, isLoading, isLoadingMore, itemId]);

  /**
   * Drops a deleted record locally, keeping the loaded pages. The loaded records stay a
   * prefix of the history, so the next cursor and `previousReplacement` remain valid.
   */
  const removeEvent = useCallback((eventId: string) => {
    setEvents((loaded) => loaded.filter((event) => event.id !== eventId));
  }, []);

  useEffect(() => () => {
    controllerRef.current?.abort();
    moreControllerRef.current?.abort();
  }, []);

  return { events, previousReplacement, hasMore, isLoading, error, isLoadingMore, loadMoreFailed, reload, loadMore, removeEvent };
}

export type ItemHistoryState = ReturnType<typeof useItemHistory>;
