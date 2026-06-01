import { create } from 'zustand'

export interface ToastData {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
  action?: { label: string; onClick: () => void }
}

interface ToastState {
  toasts: ToastData[]
  addToast: (toast: Omit<ToastData, 'id'>) => void
  removeToast: (id: string) => void
}

const MAX_TOASTS = 5

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    set((s) => {
      const next = [...s.toasts, { ...toast, id }]
      return { toasts: next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next }
    })
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3000)
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
