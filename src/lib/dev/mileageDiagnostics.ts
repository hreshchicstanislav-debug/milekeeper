/**
 * Safe diagnostic logging for mileage queries
 * Only logs in dev/preview or when NEXT_PUBLIC_DIAGNOSTICS=1
 * Never logs PII (emails, phones, full UUIDs, names)
 */

type DiagnosticContext = {
  screenName: string;
  queryName: string;
  sortKey: string;
  returnedRecord?: {
    id: string; // Truncated to first 6 chars
    mileage_km: number;
    occurred_at: string; // ISO timestamp
    timestamp: string; // ISO timestamp for occurred_at
  } | null;
  error?: string;
};

/**
 * Check if diagnostics should be enabled
 */
function isDiagnosticsEnabled(): boolean {
  // Enable in dev mode
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }
  
  // Enable if explicitly requested via environment variable
  if (process.env.NEXT_PUBLIC_DIAGNOSTICS === '1') {
    return true;
  }
  
  return false;
}

/**
 * Truncate UUID to first 6 characters for safe logging
 */
function truncateId(id: string | null | undefined): string {
  if (!id) return 'null';
  return id.substring(0, 6);
}

/**
 * Log diagnostic information about mileage query
 */
export function logMileageQuery(context: DiagnosticContext): void {
  if (!isDiagnosticsEnabled()) {
    return;
  }

  const logData: Record<string, any> = {
    screen: context.screenName,
    query: context.queryName,
    sortKey: context.sortKey,
  };

  if (context.returnedRecord) {
    logData.record = {
      id: truncateId(context.returnedRecord.id),
      mileage_km: context.returnedRecord.mileage_km,
      occurred_at: context.returnedRecord.occurred_at,
      timestamp: context.returnedRecord.timestamp,
    };
  } else {
    logData.record = null;
  }

  if (context.error) {
    logData.error = context.error;
  }

  console.log('[MileageDiagnostics]', JSON.stringify(logData, null, 2));
}

/**
 * Log comparison between two mileage values
 */
export function logMileageComparison(
  screenName: string,
  source1: { query: string; mileage: number | null },
  source2: { query: string; mileage: number | null }
): void {
  if (!isDiagnosticsEnabled()) {
    return;
  }

  const logData = {
    screen: screenName,
    comparison: {
      source1: {
        query: source1.query,
        mileage: source1.mileage,
      },
      source2: {
        query: source2.query,
        mileage: source2.mileage,
      },
      match: source1.mileage === source2.mileage,
      diff: source1.mileage !== null && source2.mileage !== null
        ? Math.abs(source1.mileage - source2.mileage)
        : null,
    },
  };

  console.log('[MileageDiagnostics:Comparison]', JSON.stringify(logData, null, 2));
}

