import { NextRequest, NextResponse } from 'next/server';
import { getRlsClientAndUserId } from '@/lib/supabase/rlsServerClient';
import { AuthenticationRequiredError, AuthenticationUnavailableError } from '@/lib/auth/authFailure';
import { ITEM_HISTORY_PAGE_SIZE } from '@/lib/service/replacementIntervals';
import { fetchHistoryPage, parseHistoryCursor, UUID_PATTERN, type EventsQuery } from '@/lib/service/historyPage';

/** Shown to the user (translated on the client); never contains database details. */
const LOAD_FAILED = 'Не удалось загрузить историю. Попробуйте ещё раз.';

/**
 * GET /api/service-events?itemId=...&limit=10[&beforeAt=...&beforeKm=...&beforeId=...]
 *
 * One page of an item's service history (all record kinds), newest first in the order
 * `occurred_at DESC, mileage_km DESC, id DESC`. Without a cursor: the newest records.
 * With the cursor of the last loaded record: the next, older page.
 *
 * Response: `{ ok, events, hasMore, previousReplacement }`. `previousReplacement` is
 * the newest replacement older than the page and only supplies the mileage between
 * replacements for the oldest replacement on the page.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const itemId = searchParams.get('itemId');
    const limitParam = searchParams.get('limit');

    if (!itemId || itemId.trim() === '') {
      return NextResponse.json({ ok: false, error: 'itemId is required' }, { status: 400 });
    }
    if (!UUID_PATTERN.test(itemId)) {
      return NextResponse.json({ ok: false, error: 'itemId is invalid' }, { status: 400 });
    }

    let limit = ITEM_HISTORY_PAGE_SIZE;
    if (limitParam) {
      const parsedLimit = Number(limitParam);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return NextResponse.json({ ok: false, error: 'limit must be between 1 and 50' }, { status: 400 });
      }
      limit = parsedLimit;
    }

    const cursor = parseHistoryCursor(searchParams);
    if (!cursor.ok) {
      return NextResponse.json({ ok: false, error: 'cursor is invalid' }, { status: 400 });
    }

    // RLS client: the user filter is explicit and RLS enforces it again.
    const { supabase, userId } = await getRlsClientAndUserId();
    const base = () => supabase
      .from('service_events')
      .select('*')
      .eq('service_item_id', itemId)
      .eq('user_id', userId) as unknown as EventsQuery;

    const page = await fetchHistoryPage(base, cursor.cursor, limit);

    return NextResponse.json(
      { ok: true, ...page },
      { status: 200, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  } catch (err) {
    const status = err instanceof AuthenticationRequiredError ? 401
      : err instanceof AuthenticationUnavailableError ? (err.kind === 'rate-limit' ? 429 : 503) : 500;
    // Details stay in the server log.
    console.error('[API /service-events] Failed:', err);
    return NextResponse.json(
      { ok: false, error: status === 500 ? LOAD_FAILED : (err as Error).message },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
