/**
 * Inline crew turn, rendered in the chat thread. Drives the whole lifecycle on
 * a single persisted message: Team-Lead plan gate → live run (DAG + agent
 * columns) → Comprehension Gate + Change Lens. One thread, one history.
 */

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'
import { useCrewRun } from '../hooks/useCrewRun'
import { CrewGraph, type CrewNodeStatus } from './CrewGraph'
import { PlanReview, GateCard, CollapsibleLens } from './CrewPanel'
import { expectationDiff } from '../../shared/expectation-diff'
import type { CrewRunView, CrewRunAgent, CrewToolCall } from '../../shared/crew-run'
import type { CrewPlan } from '../../shared/types'

export function CrewRunBlock({ crew }: { crew: CrewRunView }): JSX.Element {
  const { approve, cancel, abort } = useCrewRun()
  const protectedGlobs = useAppStore((s) => s.protectedGlobs)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const [focusId, setFocusId] = useState<string | null>(null)
  const focusAgent = focusId ? crew.agents.find((a) => a.id === focusId) ?? null : null

  // Editable copy of the plan while at the review gate.
  const [planDraft, setPlanDraft] = useState<CrewPlan | null>(crew.plan ?? null)
  useEffect(() => {
    if (crew.phase === 'reviewing' && crew.plan) setPlanDraft(crew.plan)
  }, [crew.phase, crew.plan])

  const strategyLabel = crew.strategy === 'parallel' ? 'parallel' : 'sequential'

  return (
    <div className="rounded-lg border border-border bg-surface-2 overflow-hidden" data-testid="crew-run-block">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-0">
        <div className="flex items-center gap-2 min-w-0">
          <CrewIcon />
          <span className="text-[13px] font-semibold text-text-primary">Crew</span>
          <span className="text-[12px] text-text-secondary truncate">{crew.task}</span>
          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">{strategyLabel}</span>
        </div>
        {crew.phase === 'running' && (
          <button
            type="button"
            onClick={() => abort(crew.crewId)}
            className="shrink-0 px-2 py-0.5 text-[11px] rounded-md bg-danger/20 hover:bg-danger/30 text-danger"
          >
            Stop
          </button>
        )}
      </div>

      {/* Planning spinner */}
      {crew.phase === 'planning' && (
        <div className="px-4 py-3 text-[12px] text-text-muted flex items-center gap-2">
          <span className="inline-block w-1.5 h-3.5 bg-accent animate-pulse" />
          Team Lead 正在规划阵容与步骤…
        </div>
      )}

      {/* Plan gate — review/edit before running */}
      {crew.phase === 'reviewing' && planDraft && (
        <PlanReview
          plan={planDraft}
          roleLabels={Object.fromEntries((planDraft.roles ?? []).map((r) => [r.id, r.label]))}
          onChange={setPlanDraft}
          onApprove={() => approve(crew.crewId, planDraft)}
          onCancel={() => cancel(crew.crewId)}
          expected={crew.expectedModules ?? []}
          onExpectedChange={(mods) => useChatStore.getState().setCrewExpected(crew.crewId, mods)}
        />
      )}

      {/* Live / finished run */}
      {(crew.phase === 'running' || crew.phase === 'done') && (
        <>
          {crew.roles.length > 0 && (
            <div className="px-3 pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Crew map</div>
              <CrewGraph
                roles={crew.roles.map((r) => ({ ...r, systemPrompt: '' }))}
                strategy={crew.strategy}
                status={Object.fromEntries(crew.agents.map((a) => [a.id, a.status as CrewNodeStatus]))}
              />
            </div>
          )}

          {crew.agents.length > 0 && (
            <div className="p-3 flex gap-3 overflow-x-auto items-start">
              {crew.agents.map((agent) => (
                <CrewAgentColumn key={agent.id} agent={agent} onExpand={() => setFocusId(agent.id)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Expectation Diff — route the eye to what you did not see coming. */}
      {crew.phase === 'done' && crew.lens && (crew.expectedModules?.length ?? 0) > 0 && (() => {
        const diff = expectationDiff(crew.expectedModules ?? [], crew.lens.blastRadius.map((b) => b.module))
        if (diff.unexpected.length === 0 && diff.missed.length === 0) {
          return (
            <div className="px-4 py-2 border-t border-border bg-success/10 text-[12px] text-text-secondary" data-testid="expectation-diff">
              ✓ 影响范围与你的预期一致
            </div>
          )
        }
        return (
          <div className="px-4 py-2 border-t border-border bg-warning/10 text-[12px] space-y-1" data-testid="expectation-diff">
            {diff.unexpected.length > 0 && (
              <div>
                <span className="text-warning font-medium">你没料到的改动：</span>
                <span className="text-text-primary font-mono">{diff.unexpected.join('、')}</span>
              </div>
            )}
            {diff.missed.length > 0 && (
              <div className="text-text-muted">
                预期会改但没碰：<span className="font-mono">{diff.missed.join('、')}</span>
              </div>
            )}
          </div>
        )
      })()}

      {/* Comprehension Gate + Change Lens (done) */}
      {crew.phase === 'done' && crew.lens && (
        <>
          <GateCard lens={crew.lens} protectedGlobs={protectedGlobs} workspacePath={workspacePath} />
          <CollapsibleLens lens={crew.lens} />
        </>
      )}

      {crew.phase === 'done' && crew.reason === 'error' && (
        <div className="px-4 py-2 border-t border-border text-[12px] text-danger">
          {crew.error ?? 'Crew failed.'}
        </div>
      )}

      {focusAgent && <CrewAgentModal agent={focusAgent} onClose={() => setFocusId(null)} />}
    </div>
  )
}

/** Full-screen detail for one crew agent — read its whole run + every tool call. */
function CrewAgentModal({ agent, onClose }: { agent: CrewRunAgent; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dot =
    agent.status === 'running' ? 'bg-success animate-pulse' : agent.status === 'done' ? 'bg-accent' : 'bg-surface-3'

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex flex-col mx-auto my-8 w-full max-w-3xl max-h-[calc(100vh-4rem)] bg-surface-1 border border-border rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            <span className="text-sm font-semibold text-text-primary">{agent.label}</span>
            {agent.tokensUsed !== undefined && (
              <span className="text-[11px] text-text-muted font-mono">{agent.tokensUsed}t</span>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-sm px-1">&#10005;</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <div className="text-[13px] text-text-secondary leading-relaxed markdown-body">
            {agent.output ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{agent.output}</ReactMarkdown> : <span className="text-text-muted">（暂无输出）</span>}
          </div>
          {agent.toolCalls.length > 0 && (
            <div className="space-y-1 border-t border-border pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                工具调用 · {agent.toolCalls.length}
              </div>
              {agent.toolCalls.map((tc) => (
                <CrewToolChip key={tc.id} call={tc} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** One crew agent's column: live output + auditable, expandable tool calls. */
function CrewAgentColumn({ agent, onExpand }: { agent: CrewRunAgent; onExpand: () => void }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [agent.output])

  const dot =
    agent.status === 'running' ? 'bg-success animate-pulse' : agent.status === 'done' ? 'bg-accent' : 'bg-surface-3'

  return (
    <div className="w-64 h-[280px] shrink-0 flex flex-col rounded-lg border border-border bg-surface-2 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <span className="text-[13px] font-medium text-text-primary">{agent.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {agent.tokensUsed !== undefined && (
            <span className="text-[10px] text-text-muted font-mono">{agent.tokensUsed}t</span>
          )}
          <button
            type="button"
            onClick={onExpand}
            title="放大查看这个 agent"
            className="text-text-muted hover:text-text-primary text-xs leading-none"
          >
            ⤢
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 text-[12px] text-text-secondary leading-relaxed markdown-body">
        {agent.output ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{agent.output}</ReactMarkdown> : (agent.status === 'pending' ? <span className="text-text-muted">Waiting…</span> : '')}
        {agent.status === 'running' && <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-accent animate-pulse" />}
      </div>

      {agent.toolCalls.length > 0 && (
        <div className="max-h-[40%] overflow-y-auto border-t border-border bg-surface-0 px-2 py-1.5 space-y-1">
          {agent.toolCalls.map((tc) => (
            <CrewToolChip key={tc.id} call={tc} />
          ))}
        </div>
      )}
    </div>
  )
}

/** A tool invocation chip that expands to show its args and result. */
function CrewToolChip({ call }: { call: CrewToolCall }): JSX.Element {
  const [open, setOpen] = useState(false)
  const pending = call.ok === undefined
  const mark = pending ? '·' : call.ok ? '✓' : '✗'
  const markColor = pending ? 'text-text-muted' : call.ok ? 'text-success' : 'text-danger'
  const argsStr = call.args ? JSON.stringify(call.args, null, 2) : ''

  return (
    <div className="rounded bg-surface-3/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] font-mono text-text-muted hover:text-text-primary"
      >
        <span className="text-text-muted/70">{open ? '▾' : '▸'}</span>
        <span className={markColor}>{mark}</span>
        <span className="text-text-secondary truncate">{call.name}</span>
      </button>
      {open && (
        <div className="px-2 pb-1.5 space-y-1">
          {argsStr && (
            <pre className="text-[10px] font-mono text-text-secondary bg-surface-0 rounded p-1.5 overflow-x-auto whitespace-pre-wrap">{argsStr}</pre>
          )}
          {call.result !== undefined ? (
            <pre className="text-[10px] font-mono text-text-secondary bg-surface-0 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">{call.result || '(empty)'}</pre>
          ) : (
            <div className="text-[10px] text-text-muted">运行中…</div>
          )}
        </div>
      )}
    </div>
  )
}

function CrewIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="3" />
      <path d="M2 21v-1a6 6 0 0 1 6-6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M14.5 21v-1a5 5 0 0 1 5-5" />
    </svg>
  )
}
