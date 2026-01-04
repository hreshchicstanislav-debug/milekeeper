'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface WheelPickerColumnProps {
  values: number[];
  value: number;
  onChange: (value: number) => void;
  label: string;
  suffix?: string;
  itemHeight?: number;
  visibleItems?: number;
}

export default function WheelPickerColumn({
  values,
  value,
  onChange,
  label,
  suffix = '',
  itemHeight = 36,
  visibleItems = 5,
}: WheelPickerColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [currentScrollIndex, setCurrentScrollIndex] = useState(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastIndexRef = useRef<number>(-1);
  const isInternalUpdateRef = useRef(false);

  // Find current index from value
  const findIndexFromValue = useCallback(() => {
    const index = values.indexOf(value);
    return index >= 0 ? index : 0;
  }, [values, value]);

  // Scroll to index
  const scrollToIndex = useCallback((index: number, smooth: boolean = false) => {
    if (!scrollRef.current) return;
    // Calculate target scroll position (padding is handled by CSS, so we just use index * height)
    const targetScrollTop = index * itemHeight;
    isInternalUpdateRef.current = true;
    scrollRef.current.scrollTo({
      top: targetScrollTop,
      behavior: smooth ? 'smooth' : 'instant',
    });
    setCurrentScrollIndex(index);
    setTimeout(() => {
      isInternalUpdateRef.current = false;
    }, 100);
  }, [itemHeight]);

  // Get index from scroll position
  const getIndexFromScroll = useCallback((): number => {
    if (!scrollRef.current) return 0;
    const scrollTop = scrollRef.current.scrollTop;
    // Account for padding (72px top padding)
    const adjustedScrollTop = scrollTop;
    const index = Math.round(adjustedScrollTop / itemHeight);
    return Math.max(0, Math.min(index, values.length - 1));
  }, [itemHeight, values.length]);

  // Handle scroll event with throttling
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || isInternalUpdateRef.current) return;
    
    setIsScrolling(true);
    const currentIndex = getIndexFromScroll();
    setCurrentScrollIndex(currentIndex);
    
    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    // Throttle: wait for scroll to settle
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
      const finalIndex = getIndexFromScroll();
      
      // Only call onChange if index actually changed
      if (finalIndex !== lastIndexRef.current && finalIndex >= 0 && finalIndex < values.length) {
        lastIndexRef.current = finalIndex;
        onChange(values[finalIndex]);
        
        // Snap to exact position
        scrollToIndex(finalIndex, false);
      }
    }, 150);
  }, [getIndexFromScroll, onChange, values, scrollToIndex]);

  // Sync scroll position when value changes externally
  useEffect(() => {
    if (isScrolling || isInternalUpdateRef.current) return; // Don't interfere with user scrolling
    
    const currentIndex = findIndexFromValue();
    if (currentIndex !== lastIndexRef.current && currentIndex !== currentScrollIndex) {
      lastIndexRef.current = currentIndex;
      setCurrentScrollIndex(currentIndex);
      scrollToIndex(currentIndex, false);
    }
  }, [value, findIndexFromValue, scrollToIndex, isScrolling, currentScrollIndex]);

  // Initialize scroll position on mount
  useEffect(() => {
    const index = findIndexFromValue();
    lastIndexRef.current = index;
    setCurrentScrollIndex(index);
    // Delay initial scroll to ensure DOM is ready
    setTimeout(() => {
      scrollToIndex(index, false);
    }, 50);
  }, []); // Only on mount

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Use scroll-based index for active state, fallback to value-based for initial render
  const activeIndex = isScrolling ? currentScrollIndex : (currentScrollIndex >= 0 ? currentScrollIndex : findIndexFromValue());
  const containerHeight = itemHeight * visibleItems;

  return (
    <div className="wheel-col" role="listbox" aria-label={label}>
      <div className="wheel-label">{suffix}</div>
      <div className="wheel-window"></div>
      <div className="wheel-fade-top"></div>
      <div className="wheel-fade-bot"></div>
      <div
        ref={scrollRef}
        className="wheel-scroll"
        onScroll={handleScroll}
        style={{ height: containerHeight }}
      >
        {values.map((val, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              key={index}
              className={`wheel-item ${isActive ? 'active' : ''}`}
              role="option"
              aria-selected={isActive}
              style={{ height: itemHeight }}
            >
              {val}
            </div>
          );
        })}
      </div>
    </div>
  );
}

