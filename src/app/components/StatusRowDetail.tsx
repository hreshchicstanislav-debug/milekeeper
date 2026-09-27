'use client';

import StatusInfoTooltip from './StatusInfoTooltip';

interface StatusRowDetailProps {
  title: string;
  statusText: string;
  statusColor: 'green' | 'yellow' | 'orange' | 'red';
  remainingRatio: number | null;
  isPredictionReliable: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * StatusRowDetail component for Items List (detail mode)
 * 
 * Calm detail-mode rows with:
 * - Title on top (single line, ellipsis)
 * - Status line under it: statusText + optional ⓘ tooltip
 * - Progress bar under status line (thin, calm). This is the ONLY visual status signal besides text.
 * 
 * Important:
 * - Do NOT render any left stripe, accent border, or category dot.
 * - Progress bar color can reflect category, but keep it visually subtle (thin, low height).
 */
export default function StatusRowDetail({
  title,
  statusText,
  statusColor,
  remainingRatio,
  isPredictionReliable,
  onClick,
  className = '',
}: StatusRowDetailProps) {
  // Calculate progress bar fill percentage
  let progressFill = null;
  if (remainingRatio !== null) {
    if (remainingRatio < 0) {
      progressFill = 1.0; // Overdue: 100% filled
    } else {
      progressFill = Math.max(0, Math.min(1, 1 - remainingRatio));
    }
  }

  return (
    <div className={`status-row-detail ${className}`.trim()}>
      <div className="status-row-detail-header">
        <div className="status-row-detail-title">{title}</div>
        <div className="status-row-detail-status">
          <span className="status-row-detail-status-text">{statusText}</span>
          {!isPredictionReliable && (
            <StatusInfoTooltip />
          )}
        </div>
      </div>
      {progressFill !== null && (
        <div className="status-row-detail-progress-bar">
          <div 
            className={`status-row-detail-progress-fill status-row-detail-progress-${statusColor}`}
            style={{ width: `${progressFill * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

