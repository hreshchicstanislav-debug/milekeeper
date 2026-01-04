'use client';

import type { ServiceItem } from '@/lib/db/types';
import type { ServiceStatusResult } from '@/lib/service/calcServiceStatus';

interface HomeAdaptiveContentProps {
  urgentItems: Array<{
    item: ServiceItem;
    lastEvent: any;
    statusResult: ServiceStatusResult;
  }>;
  odometerEntriesLength: number;
  confidence: 'high' | 'medium' | 'low';
  predictionHintText: string;
}

/**
 * HomeAdaptiveContent - Simplified to only show prediction hint
 * Legacy "Скоро замена" block removed (replaced by SoonMaintenance block)
 */
export default function HomeAdaptiveContent({
  urgentItems,
  odometerEntriesLength,
  confidence,
  predictionHintText,
}: HomeAdaptiveContentProps) {

  // Only render prediction hint (legacy "Скоро замена" block removed - replaced by SoonMaintenance)
  if (confidence === 'low' && odometerEntriesLength > 0) {
    return (
      <div className="prediction-hint">
        <p className="prediction-hint-text">{predictionHintText}</p>
      </div>
    );
  }

  return null;
}

