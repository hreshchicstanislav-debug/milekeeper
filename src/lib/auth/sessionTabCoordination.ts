import type { SessionTokens } from './validateSession';

export interface TabCoordination {
  exclusive(work: () => Promise<boolean>): Promise<boolean>;
  isConfirmed(tokens: SessionTokens): Promise<boolean>;
  confirm(tokens: SessionTokens | null): Promise<void>;
}

const MARKER_KEY = 'mk_auth_cookie_sync_v1';

/** A short-lived dedupe hint, never an authentication decision. No tokens stored.
 * Auth JS broadcasts setSession to other tabs; without this hint each tab would
 * rotate and broadcast again indefinitely. The first sync in each tab always
 * verifies cookies through the endpoint, even if a marker exists.
 */
export function browserTabCoordination(): TabCoordination {
  async function fingerprint(tokens: SessionTokens) {
    const bytes = new TextEncoder().encode(JSON.stringify([tokens.access_token, tokens.refresh_token]));
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return {
    async exclusive(work) {
      if (navigator.locks?.request) return await navigator.locks.request('milekeeper-auth-cookie-sync', work);
      return work();
    },
    async isConfirmed(tokens) {
      try {
        const marker = JSON.parse(window.localStorage.getItem(MARKER_KEY) ?? 'null');
        return marker?.digest === await fingerprint(tokens) &&
          typeof marker.at === 'number' && Date.now() >= marker.at && Date.now() - marker.at < 10000;
      } catch { return false; }
    },
    async confirm(tokens) {
      if (tokens) {
        // Stop sync visibly if coordination storage fails. Broadcasting an
        // unmarked rotation could cause other tabs to rotate it indefinitely.
        window.localStorage.setItem(MARKER_KEY, JSON.stringify({ digest: await fingerprint(tokens), at: Date.now() }));
      } else {
        try { window.localStorage.removeItem(MARKER_KEY); } catch { /* Logout already cleared cookies. */ }
      }
    },
  };
}
