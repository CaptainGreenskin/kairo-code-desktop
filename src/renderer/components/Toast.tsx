import { AnimatePresence, motion } from 'framer-motion'
import { useToastStore, type ToastData } from '../stores/toast-store'

export function ToastContainer(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function ToastItem({ toast }: { toast: ToastData }): JSX.Element {
  const removeToast = useToastStore((s) => s.removeToast)
  const borderColor =
    toast.type === 'success'
      ? 'border-l-success'
      : toast.type === 'error'
        ? 'border-l-danger'
        : 'border-l-accent'

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.2 }}
      className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-2 border border-border border-l-[3px] ${borderColor} shadow-lg min-w-[200px] max-w-[360px]`}
    >
      <span className="text-sm text-text-primary flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={toast.action.onClick}
          className="text-sm text-accent hover:text-accent-hover font-medium shrink-0"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => removeToast(toast.id)}
        className="text-text-muted hover:text-text-primary shrink-0 text-xs"
      >
        ✕
      </button>
    </motion.div>
  )
}
