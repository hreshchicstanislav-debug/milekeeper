'use client';

import { useRef, useEffect } from 'react';

// Hook for swipe-to-close gesture
export function useSwipeToClose<T extends HTMLElement>(
  elementRef: React.RefObject<T | null>,
  onClose: () => void,
  enabled: boolean = true
) {
  const startYRef = useRef<number | null>(null);
  const currentYRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !elementRef.current) return;

    const element = elementRef.current;

    const handleStart = (clientY: number) => {
      startYRef.current = clientY;
      currentYRef.current = clientY;
      startTimeRef.current = Date.now();
      isDraggingRef.current = true;
      element.style.transition = 'none';
    };

    const handleMove = (clientY: number) => {
      if (!isDraggingRef.current || startYRef.current === null) return;

      const deltaY = clientY - startYRef.current;
      
      // Only allow downward swipes
      if (deltaY > 0) {
        currentYRef.current = clientY;
        // Apply rubber-band effect: reduce movement for larger drags
        const dragAmount = Math.min(deltaY, deltaY * 0.5 + 50);
        element.style.transform = `translateY(${dragAmount}px)`;
      }
    };

    const handleEnd = () => {
      if (!isDraggingRef.current || startYRef.current === null || currentYRef.current === null || startTimeRef.current === null) {
        isDraggingRef.current = false;
        return;
      }

      const deltaY = currentYRef.current - startYRef.current;
      const deltaTime = Date.now() - startTimeRef.current;
      const velocity = Math.abs(deltaY / deltaTime); // px/ms

      element.style.transition = 'transform 0.3s ease-out';

      // Close if dragged > 80px or high velocity (> 0.5 px/ms)
      if (deltaY > 80 || (deltaY > 30 && velocity > 0.5)) {
        element.style.transform = 'translateY(100%)';
        setTimeout(() => {
          onClose();
        }, 300);
      } else {
        // Snap back
        element.style.transform = 'translateY(0)';
      }

      startYRef.current = null;
      currentYRef.current = null;
      startTimeRef.current = null;
      isDraggingRef.current = false;
    };

    // Touch events
    const handleTouchStart = (e: TouchEvent) => {
      // Don't start swipe if user is interacting with scrollable content
      const target = e.target as HTMLElement;
      // Prefer .form-content inside the element ref, fallback to closest
      const scrollable = element.querySelector('.form-content') as HTMLElement | null
        || target.closest('.form-content') as HTMLElement | null;
      if (scrollable) {
        // Only allow swipe if at the very top of scrollable content
        if (scrollable.scrollTop > 5) {
          return; // User is scrolling content, don't start swipe
        }
        // Check if content is actually scrollable
        if (scrollable.scrollHeight > scrollable.clientHeight + 5) {
          // Content is scrollable, only allow swipe from top
          if (scrollable.scrollTop > 0) {
            return;
          }
        }
      }
      handleStart(e.touches[0].clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      
      // Only preventDefault if we're actually dragging the sheet
      // Check if user is trying to scroll content instead
      const target = e.target as HTMLElement;
      // Prefer .form-content inside the element ref, fallback to closest
      const scrollable = element.querySelector('.form-content') as HTMLElement | null
        || target.closest('.form-content') as HTMLElement | null;
      if (scrollable && scrollable.scrollTop > 0) {
        // User is scrolling content, cancel drag
        isDraggingRef.current = false;
        startYRef.current = null;
        currentYRef.current = null;
        element.style.transition = '';
        element.style.transform = '';
        return;
      }
      
      e.preventDefault(); // Prevent scrolling only when dragging sheet
      handleMove(e.touches[0].clientY);
    };

    const handleTouchEnd = () => {
      handleEnd();
    };

    // Pointer events (for mouse support)
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return; // Only handle touch
      const target = e.target as HTMLElement;
      // Prefer .form-content inside the element ref, fallback to closest
      const scrollable = element.querySelector('.form-content') as HTMLElement | null
        || target.closest('.form-content') as HTMLElement | null;
      if (scrollable) {
        // Only allow swipe if at the very top of scrollable content (within 2px tolerance)
        if (scrollable.scrollTop > 2) {
          return; // User is scrolling content, don't start swipe
        }
        // Check if content is actually scrollable
        if (scrollable.scrollHeight > scrollable.clientHeight + 2) {
          // Content is scrollable, only allow swipe from absolute top
          if (scrollable.scrollTop > 0) {
            return;
          }
        }
      }
      handleStart(e.clientY);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current || e.pointerType === 'mouse') return;
      
      // Check if user is trying to scroll content instead of dragging sheet
      const target = e.target as HTMLElement;
      // Prefer .form-content inside the element ref, fallback to closest
      const scrollable = element.querySelector('.form-content') as HTMLElement | null
        || target.closest('.form-content') as HTMLElement | null;
      
      // If user is scrolling content (scrollTop > 0), cancel drag immediately
      if (scrollable && scrollable.scrollTop > 0) {
        // User is scrolling content, cancel drag and allow native scroll
        isDraggingRef.current = false;
        startYRef.current = null;
        currentYRef.current = null;
        startTimeRef.current = null;
        element.style.transition = '';
        element.style.transform = '';
        return; // Don't preventDefault - allow native scroll
      }
      
      // Only preventDefault when we're actually dragging the sheet (not scrolling content)
      e.preventDefault();
      handleMove(e.clientY);
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        handleEnd();
      }
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
    };
  }, [enabled, elementRef, onClose]);
}

