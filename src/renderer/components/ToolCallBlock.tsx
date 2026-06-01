/**
 * Collapsible tool-call card rendered inline within an assistant message.
 */

import { useState } from 'react'
import type { ToolCallDisplay } from '../stores/chat-store'
import { useChatStore } from '../stores/chat-store'
import { DiffPreview } from './DiffPreview'
import { GrepResultView } from './tool-renderers/GrepResultView'
import { BashResultView } from './tool-renderers/BashResultView'
import { EditResultView } from './tool-renderers/EditResultView'
import { ReadFileResultView } from './tool-renderers/ReadFileResultView'
import { GitStatusView } from './tool-renderers/GitStatusView'
import { GitDiffView } from './tool-renderers/GitDiffView'
import { GitLogView } from './tool-renderers/GitLogView'
import { SubagentResultView } from './tool-renderers/SubagentResultView'

interface ToolCallBlockProps {
  toolCall: ToolCallDisplay
}

const RESULT_PREVIEW_CHARS = 600

export function ToolCallBlock({ toolCall }: ToolCallBlockProps): JSX.Element {
  const toggle = useChatStore((s) => s.toggleToolCallExpand)
  const removePendingDiff = useChatStore((s) => s.removePendingDiff)
  const updatePendingDiffStatus = useChatStore((s) => s.updatePendingDiffStatus)
  const pendingDiff = useChatStore((s) =>
    toolCall.pendingDiffId
      ? s.pendingDiffs.find((d) => d.id === toolCall.pendingDiffId)
      : undefined
  )
  const [resultExpanded, setResultExpanded] = useState(false)

  const isPending = toolCall.result === undefined && !toolCall.isError
  const status = isPending ? 'pending' : toolCall.isError ? 'error' : 'ok'

  const argsJson = formatArgs(toolCall.args)
  const result = toolCall.result ?? ''
  const resultIsLong = result.length > RESULT_PREVIEW_CHARS
  const resultDisplay =
    resultIsLong && !resultExpanded
      ? result.slice(0, RESULT_PREVIEW_CHARS) + '\n…'
      : result

  return (
    <div
      className={
        'my-2 rounded-md border bg-surface-0/60 ' +
        (status === 'error'
          ? 'border-danger/40'
          : status === 'pending'
            ? 'border-accent/40'
            : 'border-border')
      }
    >
      <button
        type="button"
        onClick={() => toggle(toolCall.id)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-mono text-text-secondary hover:bg-surface-2 rounded-md"
      >
        <StatusIcon status={status} />
        <span className="text-text-muted">tool</span>
        <span className="text-text-primary">{toolCall.toolName}</span>
        {pendingDiff && (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-warning/20 text-warning text-xs uppercase tracking-wide">
            review
          </span>
        )}
        {toolCall.subagentSteps && toolCall.subagentSteps.length > 0 && (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-accent/15 text-accent text-xs">
            ↳ {toolCall.subagentSteps.length} step{toolCall.subagentSteps.length > 1 ? 's' : ''}
            {toolCall.subagentDone ? '' : ' …'}
          </span>
        )}
        <span className="ml-auto text-text-muted">
          {toolCall.isExpanded ? '▾' : '▸'}
        </span>
      </button>

      {pendingDiff && (
        <div className="px-3 pb-2">
          <DiffPreview
            filePath={pendingDiff.filePath}
            originalContent={pendingDiff.originalContent}
            newContent={pendingDiff.newContent}
            language={pendingDiff.language}
            writePreviewId={pendingDiff.writePreviewId}
            status={pendingDiff.status}
            onAccept={() => {
              if (pendingDiff.writePreviewId) {
                updatePendingDiffStatus(pendingDiff.id, 'accepted')
              } else {
                removePendingDiff(pendingDiff.id)
              }
            }}
            onReject={() => {
              if (pendingDiff.writePreviewId) {
                updatePendingDiffStatus(pendingDiff.id, 'rejected')
              } else {
                removePendingDiff(pendingDiff.id)
              }
            }}
          />
        </div>
      )}

      {toolCall.isExpanded && (
        <div className="px-3 pb-3 space-y-2 text-xs">
          <div>
            <div className="text-xs uppercase tracking-wide text-text-muted mb-1">
              Arguments
            </div>
            <pre className="bg-surface-2 border border-border rounded p-2 overflow-x-auto text-text-primary">
              <code>{argsJson}</code>
            </pre>
          </div>

          {toolCall.subagentSteps && toolCall.subagentSteps.length > 0 && (
            <SubagentTrace steps={toolCall.subagentSteps} done={toolCall.subagentDone} />
          )}

          {result || isPending ? (
            <div>
              <div className="text-xs uppercase tracking-wide text-text-muted mb-1">
                {toolCall.isError ? 'Error' : 'Result'}
              </div>
              {isPending ? (
                <div className="text-text-muted italic">Executing…</div>
              ) : (
                <>
                  {renderToolResult(toolCall.toolName, hasSpecialRenderer(toolCall.toolName) ? result : resultDisplay, toolCall.isError, toolCall.args)}
                  {resultIsLong && !hasSpecialRenderer(toolCall.toolName) && (
                    <button
                      type="button"
                      onClick={() => setResultExpanded((v) => !v)}
                      className="mt-1 text-xs text-accent hover:text-accent-hover"
                    >
                      {resultExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** Live, expandable trace of a sub-agent's own tool sequence — makes delegated
 * work observable inline instead of a black box that only returns a summary. */
function SubagentTrace({
  steps,
  done
}: {
  steps: NonNullable<ToolCallDisplay['subagentSteps']>
  done?: boolean
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <div data-testid="subagent-trace">
      <div className="text-xs uppercase tracking-wide text-text-muted mb-1">
        Sub-agent trace{done ? '' : ' · running…'}
      </div>
      <div className="border-l-2 border-accent/30 pl-2 space-y-1">
        {steps.map((st) => {
          const open = openId === st.id
          const pending = st.endedAt === undefined
          const mark = pending ? '◌' : st.ok === false ? '✕' : '✓'
          const markColor = pending ? 'text-accent' : st.ok === false ? 'text-danger' : 'text-success'
          return (
            <div key={st.id} className="text-xs">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : st.id)}
                className="w-full flex items-center gap-2 text-left font-mono hover:bg-surface-2 rounded px-1 py-0.5"
              >
                <span className={markColor}>{mark}</span>
                <span className="text-text-primary">{st.name}</span>
                {st.args && <span className="text-text-muted truncate min-w-0">{oneLine(st.args)}</span>}
                {st.endedAt !== undefined && st.startedAt !== undefined && (
                  <span className="ml-auto shrink-0 text-text-muted">{st.endedAt - st.startedAt}ms</span>
                )}
              </button>
              {open && (
                <div className="ml-5 mt-0.5 space-y-1">
                  {st.args && (
                    <pre className="bg-surface-2 border border-border rounded p-1.5 overflow-x-auto text-text-secondary whitespace-pre-wrap break-words">
                      <code>{st.args}</code>
                    </pre>
                  )}
                  {st.result && (
                    <pre className="bg-surface-2 border border-border rounded p-1.5 overflow-x-auto text-text-secondary whitespace-pre-wrap break-words">
                      <code>{st.result}</code>
                    </pre>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? flat.slice(0, 80) + '…' : flat
}

const SPECIAL_RENDERERS = new Set(['grep', 'bash', 'edit', 'read_file', 'git_status', 'git_diff', 'git_log', 'spawn_subagent'])

function hasSpecialRenderer(toolName: string): boolean {
  return SPECIAL_RENDERERS.has(toolName)
}

function renderToolResult(
  toolName: string,
  result: string,
  isError?: boolean,
  args?: Record<string, unknown>
): JSX.Element {
  switch (toolName) {
    case 'grep':
      return <GrepResultView result={result} isError={isError} />
    case 'bash':
      return <BashResultView result={result} isError={isError} />
    case 'edit':
      return <EditResultView result={result} isError={isError} args={args ?? {}} />
    case 'read_file':
      return <ReadFileResultView result={result} isError={isError} args={args ?? {}} />
    case 'git_status':
      return <GitStatusView result={result} isError={isError} />
    case 'git_diff':
      return <GitDiffView result={result} isError={isError} />
    case 'git_log':
      return <GitLogView result={result} isError={isError} />
    case 'spawn_subagent':
      return <SubagentResultView result={result} isError={isError} />
    default:
      return (
        <pre
          className={
            'bg-surface-2 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words ' +
            (isError ? 'border-danger/40 text-danger' : 'border-border text-text-primary')
          }
        >
          <code>{result}</code>
        </pre>
      )
  }
}

function StatusIcon({ status }: { status: 'pending' | 'ok' | 'error' }): JSX.Element {
  if (status === 'pending') {
    return (
      <svg
        viewBox="0 0 24 24"
        className="w-3.5 h-3.5 animate-spin text-accent"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
      </svg>
    )
  }
  if (status === 'error') {
    return (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-danger" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-success" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 12l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function formatArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}
