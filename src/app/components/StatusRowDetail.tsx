'use client';

import { useState, useEffect } from 'react';

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
  const [infoTooltipOpen, setInfoTooltipOpen] = useState(false);

  // Close tooltip when clicking outside or pressing Escape
  useEffect(() => {
    if (!infoTooltipOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.status-info-wrapper')) {
        setInfoTooltipOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInfoTooltipOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [infoTooltipOpen]);

  // Calculate progress bar fill percentage
  let progressFill = null;
  if (remainingRatio !== null) {
    if (remainingRatio < 0) {
      progressFill = 1.0; // Overdue: 100% filled
    } else {
      progressFill = Math.max(0, Math.min(1, 1 - remainingRatio));
    }
  }

  const tooltipText = 'Не можем точно посчитать срок, потому что пробег вносится редко. Добавляй пробег хотя бы раз в неделю — прогноз станет точнее.';

  return (
    <div className={`status-row-detail ${className}`.trim()}>
      <div className="status-row-detail-header">
        <div className="status-row-detail-title">{title}</div>
        <div className="status-row-detail-status">
          <span className="status-row-detail-status-text">{statusText}</span>
          {!isPredictionReliable && (
            <div className="status-info-wrapper">
              <button
                className="status-info-indicator"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent parent onClick
                  setInfoTooltipOpen(!infoTooltipOpen);
                }}
                aria-label="Почему прогноз неточный"
                title={tooltipText}
              >
                ⓘ
              </button>
              {infoTooltipOpen && (
                <div className="status-info-tooltip">
                  <div className="status-info-tooltip-content">
                    {tooltipText}
                  </div>
                </div>
              )}
            </div>
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

