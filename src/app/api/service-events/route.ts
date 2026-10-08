import { NextRequest, NextResponse } from 'next/server';
import { getRlsClientAndUserId } from '@/lib/supabase/rlsServerClient';
import type { ServiceEvent } from '@/lib/db/types';
import { AuthenticationRequiredError, AuthenticationUnavailableError } from '@/lib/auth/authFailure';

/**
 * GET /api/service-events?itemId=...&limit=10
 * Returns service events for a specific service item
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const itemId = searchParams.get('itemId');
    const limitParam = searchParams.get('limit');

    // Validate itemId
    if (!itemId || itemId.trim() === '') {
      return NextResponse.json(
        { ok: false, error: 'itemId is required' },
        { status: 400 }
      );
    }

    // Validate and parse limit
    let limit = 10; // default
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return NextResponse.json(
          { ok: false, error: 'limit must be between 1 and 50' },
          { status: 400 }
        );
      }
      limit = parsedLimit;
    }

    // Fetch service events
    const { supabase, userId } = await getRlsClientAndUserId();
    const { data, error } = await supabase
      .from('service_events')
      .select('*')
      .eq('service_item_id', itemId)
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false })
      .order('mileage_km', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[API /service-events] Database error:', error);
      return NextResponse.json(
        { ok: false, error: `Failed to fetch service events: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, events: (data || []) as ServiceEvent[] },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err) {
    console.error('[API /service-events] Unexpected error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Internal server error',
      },
      { status: err instanceof AuthenticationRequiredError ? 401 :
          err instanceof AuthenticationUnavailableError ? (err.kind === 'rate-limit' ? 429 : 503) : 500,
        headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
