import { useCallback, useEffect, useRef, useState } from 'react'
import { useTerminalStore, type TerminalLine } from '../../stores/terminal-store'
import { useAppStore } from '../../stores/app-store'

export function TerminalPanel(): JSX.Element {
  const lines = useTerminalStore((s) => s.lines)
  const running = useTerminalStore((s) => s.running)
  const addLine = useTerminalStore((s) => s.addLine)
  const clearLines = useTerminalStore((s) => s.clearLines)
  const setRunning = useTerminalStore((s) => s.setRunning)
  const setVisible = useTerminalStore((s) => s.setVisible)
  const workspacePath = useAppStore((s) => s.workspacePath)

  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const api = window.kairoAPI
    const unsubs: Array<() => void> = []
    if (typeof api.onTerminalData === 'function') {
      unsubs.push(
        api.onTerminalData((event) => {
          addLine({ type: event.type, text: event.text })
        })
      )
    }
    if (typeof api.onTerminalExit === 'function') {
      unsubs.push(
        api.onTerminalExit((event) => {
          addLine({
            type: 'system',
            text: `Process exited with code ${event.exitCode ?? 'null'}`
          })
          setRunning(false)
        })
      )
    }
    return () => {
      for (const u of unsubs) u()
    }
  }, [addLine, setRunning])

  const handleSubmit = useCallback(() => {
    const cmd = input.trim()
    if (!cmd || running) return
    addLine({ type: 'input', text: `$ ${cmd}` })
    setHistory((h) => [...h, cmd])
    setHistoryIdx(-1)
    setInput('')
    setRunning(true)

    const cwd = workspacePath || process.cwd?.() || '/'
    void window.kairoAPI.terminalExec(cmd, cwd).catch((err: unknown) => {
      addLine({
        type: 'stderr',
        text: err instanceof Error ? err.message : String(err)
      })
      setRunning(false)
    })
  }, [input, running, workspacePath, addLine, setRunning])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      clearLines()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1)
      setHistoryIdx(newIdx)
      setInput(history[newIdx] ?? '')
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx === -1) return
      const newIdx = historyIdx + 1
      if (newIdx >= history.length) {
        setHistoryIdx(-1)
        setInput('')
      } else {
        setHistoryIdx(newIdx)
        setInput(history[newIdx] ?? '')
      }
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] border-t border-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2 border-b border-border">
        <span className="text-xs font-medium text-text-primary">Terminal</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearLines}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-sm leading-5">
        {lines.map((line) => (
          <TerminalLineView key={line.id} line={line} />
        ))}
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border/50">
        <span className="text-sm text-success font-mono shrink-0">
          {workspacePath ? `${workspacePath.split('/').pop()} $` : '$'}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          placeholder={running ? 'Running…' : 'Enter command…'}
          className="flex-1 bg-transparent text-sm font-mono text-text-primary outline-none placeholder:text-text-muted disabled:opacity-50"
        />
      </div>
    </div>
  )
}

function TerminalLineView({ line }: { line: TerminalLine }): JSX.Element {
  const colorClass =
    line.type === 'input'
      ? 'text-accent'
      : line.type === 'stderr'
        ? 'text-danger'
        : line.type === 'system'
          ? 'text-text-muted italic'
          : 'text-text-primary'

  return (
    <div className={`whitespace-pre-wrap break-all ${colorClass}`}>
      {line.text}
    </div>
  )
}
