/**
 * Canonical App Time (AppNow)
 * 
 * Provides the canonical "current time" used by the application for all calculations,
 * forecasting, and status determinations.
 * 
 * Implementation:
 * - In LIVE mode: getAppNow() always returns real current time (new Date())
 * - In TEST mode: getAppNow() returns stored AppNow from localStorage (client) or cookie (server) if present, else defaults to real current time
 * - AppNow is persisted in localStorage (client, primary) and cookie (synced for server access)
 * - AppNow can be set, advanced, or reset via Test Clock UI in DevToolsPanel (TEST mode only)
 * 
 * Note: Existing calculations (Home/Items pages) still use new Date() directly.
 * Future steps will migrate them to use getAppNow().
 */

import { getAppMode, AppMode } from './appMode';

/**
 * localStorage key for persisting AppNow (ISO string format)
 */
const APP_NOW_STORAGE_KEY = 'milekeeper_app_now_iso';

// Import cookie bridge (dynamic import to avoid server/client issues)
let cookieBridge: typeof import('./appCookieBridge') | null = null;

function getCookieBridge() {
  if (!cookieBridge) {
    // Lazy load cookie bridge (works on both server and client)
    cookieBridge = require('./appCookieBridge');
  }
  return cookieBridge;
}

/**
 * Get canonical application time (AppNow)
 * 
 * This is the single source of truth for "current time" in the application.
 * All calculations that need "current time" should use this function.
 * 
 * Behavior:
 * - In LIVE mode: Always equals real current time (new Date())
 * - In TEST mode: Returns stored AppNow from localStorage if present, else defaults to real current time
 * 
 * @returns Current application time as Date object
 */
export function getAppNow(): Date {
  const mode = getAppMode();

  if (mode === AppMode.LIVE) {
    // LIVE mode: AppNow always equals real current time
    return new Date();
  }

  // TEST mode: Read from storage
  if (typeof window === 'undefined') {
    // Server-side: read from cookie
    const bridge = getCookieBridge();
    if (bridge) {
      const cookieAppNow = bridge.readAppNowCookie();
      if (cookieAppNow) {
        return cookieAppNow;
      }
    }
    // Fallback to real time if cookie not set
    return new Date();
  }

  // Client-side: read from localStorage (primary source)
  try {
    const stored = localStorage.getItem(APP_NOW_STORAGE_KEY);
    if (stored) {
      const parsed = new Date(stored);
      // Validate parsed date
      if (!isNaN(parsed.getTime())) {
        // Mirror to cookie for server access
        const bridge = getCookieBridge();
        if (bridge) {
          bridge.writeAppNowCookie(stored);
        }
        return parsed;
      }
    }
  } catch (error) {
    // localStorage access failed, fall through to default
  }

  // Default to real current time if not stored or invalid
  return new Date();
}

/**
 * Set AppNow value (for TEST mode)
 * 
 * @param appNow Date to set as AppNow (or ISO string)
 * @throws Error if called in LIVE mode or if storage fails
 */
export function setAppNow(appNow: Date | string): void {
  const mode = getAppMode();

  if (mode === AppMode.LIVE) {
    // In LIVE mode, silently ignore (no-op)
    // This allows calling setAppNow without checking mode first
    return;
  }

  // Only access localStorage in browser environment
  if (typeof window === 'undefined') {
    // Server-side: cannot persist
    return;
  }

  // Convert to Date if string provided
  const date = typeof appNow === 'string' ? new Date(appNow) : appNow;

  // Validate date
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${appNow}`);
  }

  try {
    const isoString = date.toISOString();
    // Store as ISO string in localStorage (primary storage)
    localStorage.setItem(APP_NOW_STORAGE_KEY, isoString);
    
    // Also write to cookie (for server access)
    const bridge = getCookieBridge();
    if (bridge) {
      bridge.writeAppNowCookie(isoString);
    }
  } catch (error) {
    throw new Error(`Failed to persist AppNow: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Advance AppNow by a specified number of days (for TEST mode)
 * 
 * @param days Number of days to advance (can be negative to go backwards)
 * @returns New AppNow value after advancement
 * @throws Error if called in LIVE mode or if storage fails
 */
export function advanceAppNow(days: number): Date {
  const mode = getAppMode();

  if (mode === AppMode.LIVE) {
    throw new Error('Cannot advance AppNow in LIVE mode. AppNow always equals real time.');
  }

  // Get current AppNow (from storage or initialize to real time)
  const current = getAppNow();
  
  // Add days
  const advanced = new Date(current);
  advanced.setDate(advanced.getDate() + days);
  
  // Store new AppNow value
  setAppNow(advanced);
  
  return advanced;
}

/**
 * Reset AppNow to real current time (for TEST mode)
 * 
 * Removes stored AppNow from localStorage, causing getAppNow() to return real current time.
 * 
 * @throws Error if called in LIVE mode or if storage fails
 */
export function resetAppNow(): void {
  const mode = getAppMode();

  if (mode === AppMode.LIVE) {
    // In LIVE mode, silently ignore (no-op)
    return;
  }

  // Only access localStorage in browser environment
  if (typeof window === 'undefined') {
    // Server-side: cannot remove
    return;
  }

  try {
    // Remove from localStorage (primary storage)
    localStorage.removeItem(APP_NOW_STORAGE_KEY);
    
    // Also clear cookie (for server access)
    const bridge = getCookieBridge();
    if (bridge) {
      bridge.clearAppNowCookie();
    }
  } catch (error) {
    throw new Error(`Failed to reset AppNow: ${error instanceof Error ? error.message : String(error)}`);
  }
}

