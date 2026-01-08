/**
 * Cookie Bridge for AppMode and AppNow
 * 
 * Provides cookie-based storage for AppMode and AppNow so server components
 * can read the same values that are stored in localStorage on the client.
 * 
 * Cookies are automatically synced from localStorage on the client side.
 */

import { AppMode } from './appMode';

/**
 * Cookie keys (match localStorage keys for consistency)
 */
export const APP_MODE_COOKIE_KEY = 'milekeeper_app_mode';
export const APP_NOW_COOKIE_KEY = 'milekeeper_app_now_iso';

/**
 * Cookie options
 */
const COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  // Secure flag: only set if protocol is https (works on localhost without https)
  // This will be set dynamically in write functions
};

/**
 * Read AppMode from cookie (server-side only)
 * 
 * @returns AppMode or null if not set
 */
export function readAppModeCookie(): AppMode | null {
  if (typeof window !== 'undefined') {
    // Client-side: should not be called (use localStorage instead)
    return null;
  }

  try {
    // Dynamic import to avoid bundling next/headers in client code
    const { cookies } = require('next/headers');
    const cookieStore = cookies();
    const value = cookieStore.get(APP_MODE_COOKIE_KEY)?.value;
    if (value === AppMode.TEST || value === AppMode.LIVE) {
      return value as AppMode;
    }
  } catch (error) {
    // Cookie read failed (e.g., in middleware, edge runtime, or import error)
    // Fall through to null
  }

  return null;
}

/**
 * Read AppNow from cookie (server-side only)
 * 
 * @returns Date or null if not set or invalid
 */
export function readAppNowCookie(): Date | null {
  if (typeof window !== 'undefined') {
    // Client-side: should not be called (use localStorage instead)
    return null;
  }

  try {
    // Dynamic import to avoid bundling next/headers in client code
    const { cookies } = require('next/headers');
    const cookieStore = cookies();
    const isoString = cookieStore.get(APP_NOW_COOKIE_KEY)?.value;
    if (isoString) {
      const parsed = new Date(isoString);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  } catch (error) {
    // Cookie read failed (e.g., in middleware, edge runtime, or import error)
    // Fall through to null
  }

  return null;
}

/**
 * Write AppMode to cookie (client-side only)
 * 
 * @param mode AppMode to write
 */
export function writeAppModeCookie(mode: AppMode): void {
  if (typeof window === 'undefined') {
    // Server-side: cannot write cookies (use headers/setCookie in server actions if needed)
    return;
  }

  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const maxAge = 365 * 24 * 60 * 60; // 365 days

  document.cookie = `${APP_MODE_COOKIE_KEY}=${mode}; Path=${COOKIE_OPTIONS.path}; SameSite=${COOKIE_OPTIONS.sameSite}; Max-Age=${maxAge}${isSecure ? '; Secure' : ''}`;
}

/**
 * Write AppNow to cookie (client-side only)
 * 
 * @param iso ISO string of AppNow date
 */
export function writeAppNowCookie(iso: string): void {
  if (typeof window === 'undefined') {
    // Server-side: cannot write cookies (use headers/setCookie in server actions if needed)
    return;
  }

  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const maxAge = 30 * 24 * 60 * 60; // 30 days

  document.cookie = `${APP_NOW_COOKIE_KEY}=${iso}; Path=${COOKIE_OPTIONS.path}; SameSite=${COOKIE_OPTIONS.sameSite}; Max-Age=${maxAge}${isSecure ? '; Secure' : ''}`;
}

/**
 * Clear AppNow cookie (client-side only)
 */
export function clearAppNowCookie(): void {
  if (typeof window === 'undefined') {
    // Server-side: cannot clear cookies
    return;
  }

  // Set cookie with Max-Age=0 to delete it
  document.cookie = `${APP_NOW_COOKIE_KEY}=; Path=${COOKIE_OPTIONS.path}; SameSite=${COOKIE_OPTIONS.sameSite}; Max-Age=0`;
}

