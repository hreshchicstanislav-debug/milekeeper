/**
 * Development-only request-scoped DB profiler
 * Tracks all database queries within a request scope
 * NOOP in production builds
 */

interface ProfiledCall {
  name: string;
  ms: number;
  rows?: number;
  error?: string;
}

interface RequestScope {
  requestId: string;
  scopeName: string;
  calls: ProfiledCall[];
  startTime: number;
}

interface RequestScopeResult {
  requestId: string;
  scopeName: string;
  totalMs: number;
  calls: ProfiledCall[];
}

/**
 * Start a new request scope for profiling
 * @param scopeName Name of the scope (e.g., 'home', 'items')
 * @returns Request scope object with wrap() and summary() methods
 */
export function startRequestScope(scopeName: string): {
  requestId: string;
  wrap: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  summary: () => RequestScopeResult;
} {
  // NOOP in production
  if (process.env.NODE_ENV === 'production') {
    return {
      requestId: '',
      wrap: async <T>(_name: string, fn: () => Promise<T>) => fn(),
      summary: () => ({
        requestId: '',
        scopeName,
        totalMs: 0,
        calls: [],
      }),
    };
  }

  const requestId = `${scopeName}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
  const startTime = performance.now();
  const calls: ProfiledCall[] = [];

  const wrap = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const callStart = performance.now();
    try {
      const result = await fn();
      
      // Try to extract row count from result
      let rows: number | undefined;
      if (Array.isArray(result)) {
        rows = result.length;
      } else if (result && typeof result === 'object') {
        // Check for Supabase response format: { data, error }
        if ('data' in result) {
          const supabaseResult = result as { data: unknown; error?: unknown };
          if (Array.isArray(supabaseResult.data)) {
            rows = supabaseResult.data.length;
          } else if (supabaseResult.data !== null && supabaseResult.data !== undefined) {
            rows = 1; // Single object
          }
        } else if ('length' in result && typeof (result as { length: number }).length === 'number') {
          // Array-like object
          rows = (result as { length: number }).length;
        } else {
          // Object with keys (e.g., Record<string, ServiceEvent | null>)
          const keys = Object.keys(result);
          if (keys.length > 0) {
            rows = keys.length; // Count of keys
          }
        }
      } else if (result !== null && result !== undefined) {
        rows = 1; // Single value
      }

      const ms = performance.now() - callStart;
      calls.push({ name, ms, rows });
      return result;
    } catch (error) {
      const ms = performance.now() - callStart;
      const errorMessage = error instanceof Error ? error.message : String(error);
      calls.push({ name, ms, error: errorMessage });
      throw error;
    }
  };

  const summary = (): RequestScopeResult => {
    const totalMs = performance.now() - startTime;
    return {
      requestId,
      scopeName,
      totalMs,
      calls: [...calls], // Return a copy
    };
  };

  return { requestId, wrap, summary };
}

/**
 * Format profiler summary for console output (dev-only)
 */
export function formatProfilerSummary(summary: RequestScopeResult): string {
  if (process.env.NODE_ENV === 'production') {
    return '';
  }

  const lines: string[] = [];
  lines.push(`\n📊 DB Profiler: ${summary.scopeName} (${summary.requestId})`);
  lines.push(`   Total: ${summary.totalMs.toFixed(2)}ms | Calls: ${summary.calls.length}`);
  
  if (summary.calls.length === 0) {
    lines.push('   No DB calls');
    return lines.join('\n');
  }

  // Sort by time (slowest first)
  const sortedCalls = [...summary.calls].sort((a, b) => b.ms - a.ms);
  
  lines.push('   Calls:');
  for (const call of sortedCalls) {
    const rowsStr = call.rows !== undefined ? ` | ${call.rows} rows` : '';
    const errorStr = call.error ? ` | ERROR: ${call.error}` : '';
    lines.push(`     • ${call.name}: ${call.ms.toFixed(2)}ms${rowsStr}${errorStr}`);
  }

  return lines.join('\n');
}

