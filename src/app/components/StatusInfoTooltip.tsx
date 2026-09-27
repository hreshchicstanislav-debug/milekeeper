'use client';

import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useRef, useState } from 'react';

const tooltipText = 'Не можем точно посчитать срок, потому что пробег вносится редко. Добавляй пробег хотя бы раз в неделю — прогноз станет точнее.';

export default function StatusInfoTooltip() {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const popup = tooltipRef.current?.getBoundingClientRect();
      if (!anchor || !popup) return;
      const left = Math.max(12, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 12));
      const above = anchor.top - popup.height - 8;
      const top = Math.max(12, Math.min(above >= 12 ? above : anchor.bottom + 8, window.innerHeight - popup.height - 12));
      setPosition({ left, top });
    };
    place();
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <span
      className="status-info-wrapper"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="status-info-indicator"
        onClick={() => setOpen((value) => !value)}
        aria-label="Почему прогноз неточный"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
      >ⓘ</button>
      {open && createPortal(
        <div ref={tooltipRef} id={id} role="tooltip" className="status-info-popover" style={position}>
          {tooltipText}
        </div>,
        document.body,
      )}
    </span>
  );
}
