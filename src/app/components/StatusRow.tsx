'use client';

import { useCopy } from '@/lib/i18n/client';

import { useState, useEffect } from 'react';

interface StatusRowProps {
  title: string;
  statusText: string;
  statusColor: 'green' | 'yellow' | 'orange' | 'red';
  remainingRatio: number | null;
  isPredictionReliable: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * Reusable StatusRow component for Items List and Home Soon Maintenance block
 * Displays title, status text with optional info indicator, and progress bar
 */
export default function StatusRow({
  title,
  statusText,
  statusColor,
  remainingRatio,
  isPredictionReliable,
  onClick,
  className = '',
}: StatusRowProps) {
  const { t, systemText } = useCopy();
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

  const tooltipText = t("Не можем точно посчитать срок, потому что пробег вносится редко. Добавляй пробег хотя бы раз в неделю — прогноз станет точнее.");

  return (
    <div className={className}>
      <div className="status-row-header">
        <div className="status-row-title">{title}</div>
        <div className="status-row">
          <span className="status-text">{systemText(statusText)}</span>
          {!isPredictionReliable && (
            <div className="status-info-wrapper">
              <button
                className="status-info-indicator"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent parent onClick
                  setInfoTooltipOpen(!infoTooltipOpen);
                }}
                aria-label={t("Почему прогноз неточный")}
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
        <div className="status-progress-bar">
          <div 
            className={`status-progress-fill status-progress-${statusColor}`}
            style={{ width: `${progressFill * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

