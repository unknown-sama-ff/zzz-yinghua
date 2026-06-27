import { create } from 'zustand';

interface ToastState {
  message: string | null;
  show: (msg: string) => void;
  clear: () => void;
}

/** Global transient-error channel; components call useToast.show(message). */
export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  clear: () => set({ message: null }),
}));
