/**
 * Scroll lock manager with reference counting
 * Prevents body scroll lock from getting stuck when multiple sheets are open
 * or when navigation occurs while a sheet is open
 */

let lockCount = 0;
let savedStyles: {
  overflow: string;
  position: string;
  width: string;
  top: string;
  left: string;
  right: string;
} | null = null;
let savedScrollY = 0;

/**
 * Lock body scroll (increment counter)
 * @param reason - Debug reason for locking (dev-only)
 */
export function lockScroll(reason: string): void {
  lockCount++;

  // Save original styles only on first lock
  if (lockCount === 1) {
    // Save current scroll position before locking
    savedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    
    savedStyles = {
      overflow: document.body.style.overflow || '',
      position: document.body.style.position || '',
      width: document.body.style.width || '',
      top: document.body.style.top || '',
      left: document.body.style.left || '',
      right: document.body.style.right || '',
    };

    // Lock body scroll with position fixed to prevent iOS rubber-band effect
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[ScrollLock] LOCK (count: ${lockCount}) - ${reason}`, {
        savedStyles,
        savedScrollY,
      });
    }
  } else {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[ScrollLock] LOCK (count: ${lockCount}) - ${reason}`);
    }
  }
}

/**
 * Unlock body scroll (decrement counter)
 * @param reason - Debug reason for unlocking (dev-only)
 */
export function unlockScroll(reason: string): void {
  if (lockCount === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[ScrollLock] UNLOCK called but count is 0 - ${reason}`);
    }
    return;
  }

  lockCount--;

  // Restore original styles only on last unlock
  if (lockCount === 0 && savedStyles) {
    const stylesToRestore = { ...savedStyles };
    const scrollYToRestore = savedScrollY;
    
    // Restore body styles
    document.body.style.overflow = savedStyles.overflow;
    document.body.style.position = savedStyles.position;
    document.body.style.width = savedStyles.width;
    document.body.style.top = savedStyles.top;
    document.body.style.left = savedStyles.left;
    document.body.style.right = savedStyles.right;
    
    savedStyles = null;
    savedScrollY = 0;
    
    // Restore scroll position after styles are applied
    // Use double requestAnimationFrame to ensure layout is stable
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({
          top: scrollYToRestore,
          behavior: 'instant' // Instant restore, no smooth scroll
        });
      });
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[ScrollLock] UNLOCK (count: ${lockCount}) - ${reason}`, {
        restoredStyles: stylesToRestore,
        restoredScrollY: scrollYToRestore,
      });
    }
  } else {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[ScrollLock] UNLOCK (count: ${lockCount}) - ${reason}`);
    }
  }
}

/**
 * Force reset all scroll locks (emergency cleanup)
 * @param reason - Debug reason for reset (dev-only)
 */
export function resetScrollLocks(reason: string): void {
  const wasLocked = lockCount > 0;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[ScrollLock] RESET (count: ${lockCount} -> 0) - ${reason}`, {
      wasLocked,
      savedStyles,
    });
  }

  lockCount = 0;

  if (savedStyles) {
    document.body.style.overflow = savedStyles.overflow;
    document.body.style.position = savedStyles.position;
    document.body.style.width = savedStyles.width;
    document.body.style.top = savedStyles.top;
    document.body.style.left = savedStyles.left;
    document.body.style.right = savedStyles.right;
    savedStyles = null;
  }
  
  // Restore scroll position if we had one saved
  if (savedScrollY > 0) {
    const scrollYToRestore = savedScrollY;
    savedScrollY = 0;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({
          top: scrollYToRestore,
          behavior: 'instant'
        });
      });
    });
  }
}

/**
 * Get current lock count (for debugging)
 */
export function getScrollLockCount(): number {
  return lockCount;
}

