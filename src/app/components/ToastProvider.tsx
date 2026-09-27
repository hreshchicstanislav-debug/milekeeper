'use client';

import { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';

interface ToastState {
  open: boolean;
  title: string;
  subtitle?: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  success: (payload: { title: string; subtitle?: string; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastState>({
    open: false,
    title: '',
    subtitle: undefined,
    type: 'success',
  });
  
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (toast.open) toastRef.current?.showPopover?.();
  }, [toast.open, toast.title, toast.subtitle]);

  const showToast = (
    title: string,
    subtitle: string | undefined,
    type: 'success' | 'error' | 'info',
    durationMs: number = 2000
  ) => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Set new toast
    setToast({
      open: true,
      title,
      subtitle,
      type,
    });

    // Auto-hide after duration
    timeoutRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, open: false }));
      timeoutRef.current = null;
    }, durationMs);
  };

  const success = (payload: { title: string; subtitle?: string; durationMs?: number }) => {
    showToast(payload.title, payload.subtitle, 'success', payload.durationMs ?? 2000);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={{ success }}>
      {children}
      {/* Toast overlay */}
      {toast.open && (
        <div ref={toastRef} popover="manual" role="status" aria-live="polite" className="toast-overlay toast-open">
          <div className={`toast-card toast-${toast.type} toast-enter`}>
            {toast.type === 'success' && (
              <svg
                className="toast-icon"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M20 6L9 17L4 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <div className="toast-content">
              <div className="toast-title">{toast.title}</div>
              {toast.subtitle && <div className="toast-subtitle">{toast.subtitle}</div>}
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
