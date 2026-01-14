/**
 * App Mode Management
 * 
 * Defines and manages the application mode (TEST vs LIVE).
 * This module provides the infrastructure for mode persistence and retrieval.
 * 
 * Storage:
 * - Client: localStorage (primary) + cookie (synced for server access)
 * - Server: cookie (read via cookie bridge)
 */

/**
 * Application mode enum
 * 
 * - TEST: Development, testing, and demonstration mode
 *   Allows time manipulation and simulated trips
 * 
 * - LIVE: Real-world usage mode
 *   Uses real time, only manual entries allowed
 */
export enum AppMode {
  TEST = 'TEST',
  LIVE = 'LIVE',
}

/**
 * localStorage key for persisting app mode
 */
const APP_MODE_STORAGE_KEY = 'milekeeper_app_mode';

// Import cookie bridge (dynamic import to avoid server/client issues)
let cookieBridge: typeof import('./appCookieBridge') | null = null;

function getCookieBridge() {
  if (!cookieBridge) {
    // Lazy load cookie bridge (works on both server and client)
    try {
      cookieBridge = require('./appCookieBridge');
    } catch {
      // In non-Next runtimes (e.g., unit tests), the cookie bridge may not be resolvable.
      // Treat as unavailable; server-side will fall back to defaults.
      cookieBridge = null;
    }
  }
  return cookieBridge;
}

/**
 * Get current application mode
 * 
 * @returns Current app mode (defaults to LIVE if not set)
 */
export function getAppMode(): AppMode {
  if (typeof window === 'undefined') {
    // Server-side: read from cookie
    const bridge = getCookieBridge();
    if (bridge) {
      const cookieMode = bridge.readAppModeCookie();
      if (cookieMode) {
        return cookieMode;
      }
    }
    // Default to LIVE if cookie not set
    return AppMode.LIVE;
  }

  // Client-side: read from localStorage (primary source)
  try {
    const stored = localStorage.getItem(APP_MODE_STORAGE_KEY);
    if (stored === AppMode.TEST || stored === AppMode.LIVE) {
      // Mirror to cookie for server access
      const bridge = getCookieBridge();
      if (bridge) {
        bridge.writeAppModeCookie(stored as AppMode);
      }
      return stored as AppMode;
    }
  } catch (error) {
    // localStorage access failed (e.g., private browsing)
    // Fall through to default
  }

  // Default to LIVE mode
  return AppMode.LIVE;
}

/**
 * Set application mode and persist it
 * 
 * @param mode Mode to set (TEST or LIVE)
 * @throws Error if mode is invalid or storage fails
 */
export function setAppMode(mode: AppMode): void {
  if (mode !== AppMode.TEST && mode !== AppMode.LIVE) {
    throw new Error(`Invalid app mode: ${mode}`);
  }

  // Only access localStorage in browser environment
  if (typeof window === 'undefined') {
    // Server-side: mode cannot be persisted
    // This is expected - mode changes happen client-side
    return;
  }

  try {
    // Write to localStorage (primary storage)
    localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
    
    // Also write to cookie (for server access)
    const bridge = getCookieBridge();
    if (!bridge) {
      // Lazy load cookie bridge on client
      cookieBridge = require('./appCookieBridge');
    }
    if (cookieBridge) {
      cookieBridge.writeAppModeCookie(mode);
    }
  } catch (error) {
    throw new Error(`Failed to persist app mode: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if current mode is TEST
 * 
 * @returns true if mode is TEST, false otherwise
 */
export function isTestMode(): boolean {
  return getAppMode() === AppMode.TEST;
}

/**
 * Check if current mode is LIVE
 * 
 * @returns true if mode is LIVE, false otherwise
 */
export function isLiveMode(): boolean {
  return getAppMode() === AppMode.LIVE;
}

