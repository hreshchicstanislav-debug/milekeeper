'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { lockScroll, unlockScroll } from '@/lib/ui/scrollLock';
import { modalOpened, modalClosed } from '@/lib/ui/modalOpen';

interface ModalSheetProps {
  children: ReactNode;
  label: string;
  onClose: () => void;
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  returnFocusSelector?: string;
}

/** Native top layer keeps nested sheets above navigation and makes the background inert. */
export default function ModalSheet({
  children, label, onClose, busy = false, dismissOnBackdrop = false, returnFocusSelector,
}: ModalSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockScroll('ModalSheet');
    modalOpened('ModalSheet');
    dialog.showModal();

    return () => {
      dialog.close();
      modalClosed('ModalSheet');
      unlockScroll('ModalSheet');
      requestAnimationFrame(() => {
        const target = opener?.isConnected && opener !== document.body
          ? opener
          : returnFocusSelector ? document.querySelector<HTMLElement>(returnFocusSelector) : null;
        target?.focus({ preventScroll: true });
      });
    };
  }, [returnFocusSelector]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="modal-sheet"
      aria-label={label}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (dismissOnBackdrop && !busy && event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
