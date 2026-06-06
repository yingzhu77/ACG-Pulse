import { useState, useCallback } from 'react';

export interface ToastState {
  type: 'success' | 'error';
  message: string;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  return { toast, showToast } as const;
}
