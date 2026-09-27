'use client';

import StatusInfoTooltip from './StatusInfoTooltip';

interface StatusRowCompactProps {
  title: string;
  statusText: string;
  category: 'critical' | 'warning' | 'warning_unknown' | 'ok';
  isPredictionReliable: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * Compact StatusRow component for Home Soon Maintenance block
 * Optimized for density: single-line row with minimal visual indicators
 * 
 * Layout:
 * - Left: tiny category indicator (single signal, not a stripe and not a progress bar)
 * - Middle: title (single line, ellipsis if needed)
 * - Right: statusText (single line, aligned right)
 * 
 * NO progress bar in this component.
 * Tooltip info indicator ⓘ behavior must remain available (reuse same text you already use), but should not increase row height (inline).
 */
export default function StatusRowCompact({
  title,
  statusText,
  category,
  isPredictionReliable,
  onClick,
  className = '',
}: StatusRowCompactProps) {
  return (
    <div className={`status-row-compact ${className}`.trim()}>
      {/* Left: tiny category indicator */}
      <div className={`status-row-compact-indicator status-row-compact-indicator-${category}`} />
      
      {/* Middle: title */}
      <div className="status-row-compact-title">{title}</div>
      
      {/* Right: statusText with optional info indicator */}
      <div className="status-row-compact-right">
        <span className="status-row-compact-status-text">{statusText}</span>
        {!isPredictionReliable && (
          <StatusInfoTooltip />
        )}
      </div>
    </div>
  );
}

