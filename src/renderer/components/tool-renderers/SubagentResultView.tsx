import { useState } from 'react'

interface SubagentResultViewProps {
  result: string
  isError?: boolean
}

interface ParsedSubagentResult {
  toolSummary: string[]
  answer: string
}

function parseSubagentResult(raw: string): ParsedSubagentResult {
  const headerMatch = raw.match(/^\[Subagent used \d+ tool\(s\)\]\n/)
  if (!headerMatch) {
    return { toolSummary: [], answer: raw }
  }

  const afterHeader = raw.slice(headerMatch[0].length)
  const emptyLineIdx = afterHeader.indexOf('\n\n')
  if (emptyLineIdx === -1) {
    return { toolSummary: [], answer: raw }
  }

  const toolLines = afterHeader.slice(0, emptyLineIdx).split('\n').filter((l) => l.startsWith('- '))
  const answer = afterHeader.slice(emptyLineIdx + 2)
  return { toolSummary: toolLines, answer }
}

export function SubagentResultView({ result, isError }: SubagentResultViewProps): JSX.Element {
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const parsed = parseSubagentResult(result)

  return (
    <div className="space-y-2">
      {parsed.toolSummary.length > 0 && (
        <div className="bg-surface-2 border border-border rounded overflow-hidden">
          <button
            type="button"
            onClick={() => setToolsExpanded((v) => !v)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] text-text-secondary hover:bg-surface-3 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3 text-accent" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <span>Subagent: {parsed.toolSummary.length} tool call{parsed.toolSummary.length !== 1 ? 's' : ''}</span>
            <span className="ml-auto text-text-muted">{toolsExpanded ? '▾' : '▸'}</span>
          </button>
          {toolsExpanded && (
            <div className="px-3 py-2 border-t border-border text-[11px] font-mono text-text-muted space-y-0.5">
              {parsed.toolSummary.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <pre
        className={
          'bg-surface-2 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-[12px] leading-5 ' +
          (isError ? 'border-danger/40 text-danger' : 'border-border text-text-primary')
        }
      >
        <code>{parsed.answer || result}</code>
      </pre>
    </div>
  )
}
