'use client';

import { useState, useEffect } from 'react';

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

  const tooltipText = 'Не можем точно посчитать срок, потому что пробег вносится редко. Добавляй пробег хотя бы раз в неделю — прогноз станет точнее.';

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
  );
}

