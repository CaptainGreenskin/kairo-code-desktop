import { useRef, useEffect } from 'react'
import { useActivityStore } from '../stores/activity-store'
import type { ActivityEvent } from '../../shared/types'

export function ActivityPanel(): JSX.Element {
  const events = useActivityStore((s) => s.events)
  const clearEvents = useActivityStore((s) => s.clearEvents)
  const setPanelVisible = useActivityStore((s) => s.setPanelVisible)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events.length])

  return (
    <div className="flex flex-col h-full bg-surface-0 border-l border-border">
      <div className="flex items-center justify-between px-3 py-2 bg-surface-2 border-b border-border">
        <span className="text-xs font-medium text-text-primary">Activity</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearEvents}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setPanelVisible(false)}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {events.length === 0 ? (
          <div className="text-xs text-text-muted italic py-4 text-center">
            No activity yet
          </div>
        ) : (
          events.map((event, i) => <ActivityRow key={i} event={event} />)
        )}
      </div>
    </div>
  )
}

function ActivityRow({ event }: { event: ActivityEvent }): JSX.Element {
  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  const { icon, color, label } = getEventDisplay(event)

  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      <span className="text-text-muted shrink-0 font-mono w-16">{time}</span>
      <span className={`shrink-0 ${color}`}>{icon}</span>
      <span className="text-text-secondary min-w-0">
        <span className={`font-medium ${color}`}>{label}</span>
        {event.toolName && (
          <span className="font-mono text-text-muted ml-1">{event.toolName}</span>
        )}
        {event.durationMs !== undefined && (
          <span className="text-text-muted ml-1">({event.durationMs}ms)</span>
        )}
        {event.message && (
          <span className="text-text-muted ml-1">{event.message}</span>
        )}
      </span>
    </div>
  )
}

function getEventDisplay(event: ActivityEvent): {
  icon: string
  color: string
  label: string
} {
  switch (event.type) {
    case 'tool-start':
      return { icon: '▸', color: 'text-accent', label: 'START' }
    case 'tool-end':
      return event.isError
        ? { icon: '✕', color: 'text-danger', label: 'FAIL' }
        : { icon: '✓', color: 'text-success', label: 'DONE' }
    case 'error':
      return { icon: '⚠', color: 'text-danger', label: 'ERROR' }
    case 'compaction':
      return { icon: '◇', color: 'text-warning', label: 'COMPACT' }
    case 'subagent-start':
      return { icon: '⑂', color: 'text-accent', label: 'SPAWN' }
    case 'subagent-end':
      return { icon: '⑃', color: 'text-success', label: 'MERGE' }
    case 'subagent-tool':
      return { icon: '  ▸', color: 'text-text-muted', label: 'SUB' }
    case 'subagent-tool-result':
      return event.ok === false
        ? { icon: '  ✕', color: 'text-danger', label: 'SUB' }
        : { icon: '  ✓', color: 'text-text-muted', label: 'SUB' }
  }
}
