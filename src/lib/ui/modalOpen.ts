/**
 * Global modal open registry with reference counting
 * Tracks whether any modal/sheet is currently open
 * Used by route guard to determine if scroll lock is legitimate
 */

let modalCount = 0;

/**
 * Register that a modal was opened
 * @param reason - Debug reason (dev-only)
 */
export function modalOpened(reason: string): void {
  modalCount++;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[ModalRegistry] OPENED (count: ${modalCount}) - ${reason}`);
  }
}

/**
 * Register that a modal was closed
 * @param reason - Debug reason (dev-only)
 */
export function modalClosed(reason: string): void {
  if (modalCount === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[ModalRegistry] CLOSED called but count is 0 - ${reason}`);
    }
    return;
  }

  modalCount--;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[ModalRegistry] CLOSED (count: ${modalCount}) - ${reason}`);
  }
}

/**
 * Check if any modal is currently open
 */
export function isAnyModalOpen(): boolean {
  return modalCount > 0;
}

/**
 * Get current modal count (for debugging)
 */
export function getModalCount(): number {
  return modalCount;
}

