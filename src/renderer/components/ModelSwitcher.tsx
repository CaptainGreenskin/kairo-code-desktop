import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../stores/app-store'
import type { ModelProviderKind } from '../../shared/types'
import { PROVIDER_LABELS, defaultModelFor, presetsFor } from '../lib/model-presets'

/**
 * Compact model/provider switcher for the status bar. One click from the
 * conversation to change the active model — no Settings round-trip.
 */
export function ModelSwitcher(): JSX.Element {
  const provider = useAppStore((s) => s.provider)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)
  const setProvider = useAppStore((s) => s.setProvider)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const presets = presetsFor(provider)

  const selectModel = (m: string): void => {
    setModel(m)
    setOpen(false)
  }

  const switchProvider = (p: ModelProviderKind): void => {
    if (p === provider) return
    setProvider(p)
    setModel(defaultModelFor(p))
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change model"
        className="font-mono hover:text-text-primary transition-colors flex items-center gap-1"
      >
        <span>{model}</span>
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.1 }}
            className="absolute bottom-full left-0 mb-2 w-60 bg-surface-2 border border-border rounded-lg shadow-xl overflow-hidden z-30"
          >
            {/* Provider toggle */}
            <div className="flex gap-1 p-1.5 border-b border-border">
              {(['openai', 'anthropic'] as ModelProviderKind[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => switchProvider(p)}
                  className={
                    'flex-1 px-2 py-1 rounded text-xs transition-colors ' +
                    (provider === p
                      ? 'bg-accent/15 text-text-primary'
                      : 'text-text-muted hover:bg-surface-3')
                  }
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>

            {/* Model list */}
            <div className="max-h-60 overflow-y-auto py-1">
              {presets.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectModel(m)}
                  className={
                    'w-full flex items-center justify-between px-3 py-1.5 text-left text-sm font-mono transition-colors ' +
                    (m === model
                      ? 'bg-accent/10 text-text-primary'
                      : 'text-text-secondary hover:bg-surface-3')
                  }
                >
                  <span className="truncate">{m}</span>
                  {m === model && <CheckIcon />}
                </button>
              ))}
              {!presets.includes(model) && (
                <div className="px-3 py-1.5 text-xs text-text-muted border-t border-border mt-1">
                  Custom: <span className="font-mono text-text-secondary">{model}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CheckIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 text-accent shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
