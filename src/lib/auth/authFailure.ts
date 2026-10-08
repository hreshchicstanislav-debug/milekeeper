export type AuthFailureKind = 'invalid' | 'rate-limit' | 'unavailable' | 'network' | 'unexpected';

const INVALID_CODES = new Set([
  'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found',
  'session_expired', 'user_not_found', 'user_banned', 'invalid_grant',
]);

/** Unknown/configuration errors are never evidence that cookies should be deleted. */
export function classifyAuthFailure(error: { status?: number; code?: string; name?: string; message?: string }): AuthFailureKind {
  // Our SDK transport adapter preserves the original 429 in this fixed message.
  if (error.message === 'Supabase Auth rate limit exceeded (HTTP 429)') return 'rate-limit';
  if (error.status === 429) return 'rate-limit';
  if (error.status === 408 || (error.status && error.status >= 500)) return 'unavailable';
  if (error.status === 0 || error.name === 'AuthRetryableFetchError' || error.name === 'TypeError') return 'network';
  if (error.code && INVALID_CODES.has(error.code)) return 'invalid';
  return 'unexpected';
}

export class AuthenticationRequiredError extends Error {
  constructor() { super('Not authenticated'); }
}

export class AuthenticationUnavailableError extends Error {
  constructor(public readonly kind: AuthFailureKind = 'unavailable') {
    super(kind === 'rate-limit' ? 'Authentication rate limit exceeded' : 'Authentication temporarily unavailable');
  }
}
