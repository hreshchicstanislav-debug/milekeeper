import { NextRequest, NextResponse } from 'next/server';
import { createManifest } from '@/lib/i18n/manifest';
import { callbackLocale } from '@/lib/i18n/routing';
export function GET(request: NextRequest) {
  return NextResponse.json(createManifest(callbackLocale(request.nextUrl.searchParams.get('lang'))), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
}
