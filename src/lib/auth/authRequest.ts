import { NextRequest, NextResponse } from 'next/server';

export function authResponse(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
  } });
}

/** Browser fetch supplies Origin; never trust X-Forwarded-* as an origin allowlist.
 * Host is the browser request's authority. NextURL normalizes loopback addresses
 * to localhost, so using nextUrl.origin alone rejects valid requests to 127.0.0.1.
 */
export async function readAuthRequest(req: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  let requestOrigin: string;
  try {
    requestOrigin = new URL(`${req.nextUrl.protocol}//${req.headers.get('host') ?? req.nextUrl.host}`).origin;
  } catch { return authResponse({ ok: false, error: 'Forbidden origin' }, 403); }
  if (!origin || origin !== requestOrigin || (site && site !== 'same-origin')) {
    return authResponse({ ok: false, error: 'Forbidden origin' }, 403);
  }
  if (req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return authResponse({ ok: false, error: 'Expected application/json' }, 415);
  }
  try {
    const reader = req.body?.getReader();
    if (!reader) return authResponse({ ok: false, error: 'bad request' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        return authResponse({ ok: false, error: 'Request too large' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid JSON object');
    return body as Record<string, unknown>;
  } catch {
    return authResponse({ ok: false, error: 'bad request' }, 400);
  }
}
