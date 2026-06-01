import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'
import { useCrewStore, type CrewAgent } from '../stores/crew-store'
import { useCrewRosterStore, type RoleDraft } from '../stores/crew-roster-store'
import { useToastStore } from '../stores/toast-store'
import { useEditorStore } from '../stores/editor-store'
import type { ChangeLens, CrewPlan, CrewRoleConfig, CrewStrategy } from '../../shared/types'
import { lensToMarkdown } from '../../shared/change-lens-format'
import { computeWaves, effectiveDeps } from '../../shared/crew-dag'
import { evaluateGate } from '../../shared/comprehension-gate'
import { expectationDiff } from '../../shared/expectation-diff'
import { CrewGraph, type CrewNodeStatus } from './CrewGraph'
import { CodeMapView } from './CodeMapView'
import { useCodeMapData } from '../hooks/useCodeMapData'

const MAP_WIDTH_KEY = 'kairo:crew:mapWidth'
const MAP_WIDTH_MIN = 300
const MAP_WIDTH_MAX = 760
const MAP_WIDTH_DEFAULT = 440

function loadMapWidth(): number {
  if (typeof localStorage === 'undefined') return MAP_WIDTH_DEFAULT
  const raw = Number(localStorage.getItem(MAP_WIDTH_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return MAP_WIDTH_DEFAULT
  return Math.max(MAP_WIDTH_MIN, Math.min(raw, MAP_WIDTH_MAX))
}

/**
 * Crew panel — launch and watch a multi-agent pipeline (Planner → Coder →
 * Reviewer) work a task live, each teammate in its own column.
 */
export function CrewPanel(): JSX.Element | null {
  const open = useAppStore((s) => s.crewPanelOpen)
  const sessionId = useChatStore((s) => s.sessionId)
  const running = useCrewStore((s) => s.running)
  const agents = useCrewStore((s) => s.agents)
  const reason = useCrewStore((s) => s.reason)
  const crewId = useCrewStore((s) => s.crewId)
  const task = useCrewStore((s) => s.task)
  const lens = useCrewStore((s) => s.lens)

  const roles = useCrewRosterStore((s) => s.roles)
  const strategy = useCrewRosterStore((s) => s.strategy)
  const protectedGlobs = useAppStore((s) => s.protectedGlobs)
  const workspacePath = useAppStore((s) => s.workspacePath)

  const [draft, setDraft] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  // System map docked beside the console — "watch the map while you command".
  const [showMap, setShowMap] = useState(false)
  const [mapWidth, setMapWidth] = useState(loadMapWidth)
  const mapDragRef = useRef(false)

  // Persist the docked map width across sessions.
  useEffect(() => {
    try {
      localStorage.setItem(MAP_WIDTH_KEY, String(mapWidth))
    } catch {
      /* ignore quota / serialization errors */
    }
  }, [mapWidth])
  // Plan Gate: idle → planning → reviewing → (run). Running/done come from the store.
  const [phase, setPhase] = useState<'idle' | 'planning' | 'reviewing'>('idle')
  const [planDraft, setPlanDraft] = useState<CrewPlan | null>(null)
  const [pendingTask, setPendingTask] = useState('')
  const [hasModel, setHasModel] = useState(true)
  // The roster that is actually executing (carries the DAG), for the live graph.
  const [executedRoles, setExecutedRoles] = useState<CrewPlan['roles']>([])

  // Check the model is configured whenever the panel opens (main knows env too).
  useEffect(() => {
    if (!open) return
    void window.kairoAPI.getConfigStatus?.().then((s) => setHasModel(s.hasModel)).catch(() => {})
  }, [open])

  // The live System Map, docked beside the console. Fetch only when shown; the
  // main-process cache makes refreshes cheap (re-reads just the changed files).
  const codeMap = useCodeMapData(open && showMap)

  // Auto-reveal the map the moment a crew starts working — that's when watching
  // agents move across the system matters most.
  useEffect(() => {
    if (running) setShowMap(true)
  }, [running])

  // Drag-to-resize the docked map column.
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!mapDragRef.current) return
      setMapWidth((w) => Math.max(MAP_WIDTH_MIN, Math.min(w + e.movementX, MAP_WIDTH_MAX)))
    }
    const onUp = (): void => {
      if (!mapDragRef.current) return
      mapDragRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const close = (): void => {
    if (running) return
    setPhase('idle')
    setPlanDraft(null)
    useAppStore.getState().setCrewPanelOpen(false)
  }

  // Step 1: Team Lead drafts a plan for human approval (the Plan Gate).
  const startPlanning = (): void => {
    const t = draft.trim()
    if (!t || running || phase !== 'idle') return
    setPendingTask(t)
    setPhase('planning')
    // Offer the Team Lead the user roster PLUS trusted plugins' agents.
    const library = [...roles, ...useAppStore.getState().pluginAgents]
    void window.kairoAPI
      .planCrew(t, library)
      .then((res) => {
        if (res.ok && res.plan) {
          setPlanDraft(res.plan)
          setPhase('reviewing')
        } else {
          useToastStore.getState().addToast({ type: 'error', message: res.error ?? 'Planning failed' })
          setPhase('idle')
        }
      })
      .catch((err: unknown) => {
        useToastStore.getState().addToast({ type: 'error', message: err instanceof Error ? err.message : String(err) })
        setPhase('idle')
      })
  }

  const cancelPlan = (): void => {
    setPhase('idle')
    setPlanDraft(null)
  }

  // Step 2: human approved the plan → execute the crew with it.
  const approveAndRun = (): void => {
    const t = pendingTask.trim()
    if (!t || running) return
    const id = `crew-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const plan = planDraft ?? undefined
    // Use the Team-Lead-composed roster from the plan (falls back to the
    // configured roster if planning produced none).
    const crewRoles = plan?.roles?.length ? plan.roles : roles
    useCrewStore.getState().reset()
    setExecutedRoles(crewRoles)
    setDraft('')
    setPhase('idle')
    setPlanDraft(null)
    void window.kairoAPI
      .runCrew(id, sessionId, t, crewRoles, strategy, plan)
      .then((res) => {
        if (res.lens) useCrewStore.getState().setLens(res.lens)
        if (res.ok && res.summary) {
          const lensMd = res.lens ? `\n\n${lensToMarkdown(res.lens)}` : ''
          const cs = useChatStore.getState()
          cs.addUserMessage(`[Crew] ${t}`)
          cs.appendToken({ sessionId, turnId: id, delta: res.summary + lensMd, index: 0 })
          cs.finalizeTurn({ sessionId, turnId: id, reason: 'completed' })
          useToastStore.getState().addToast({ type: 'success', message: 'Crew finished — result added to chat' })
        } else if (!res.ok) {
          useToastStore.getState().addToast({ type: 'error', message: res.error ?? 'Crew failed' })
        }
      })
      .catch((err: unknown) => {
        useToastStore.getState().addToast({
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
  }

  const abort = (): void => {
    if (crewId) void window.kairoAPI.abortCrew(crewId)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !running) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, running])

  if (!open) return null

  const hasRun = agents.length > 0

  return (
    <motion.div
      className="fixed inset-0 z-40 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      <div
        className={
          'relative flex flex-col mx-auto my-8 w-full max-h-[calc(100vh-4rem)] bg-surface-1 border border-border rounded-xl shadow-2xl overflow-hidden transition-[max-width] ' +
          (showMap ? 'max-w-7xl' : 'max-w-5xl')
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
          <div className="flex items-center gap-2 min-w-0">
            <CrewIcon />
            <h3 className="text-sm font-semibold text-text-primary">Crew</h3>
            <span className="text-[11px] text-text-muted truncate">
              {roles.map((r) => r.label).join(strategy === 'parallel' ? ' + ' : ' → ')}
            </span>
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">
              {strategy === 'parallel' ? 'parallel' : 'sequential'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              title="Show the live System Map beside the console"
              className={
                'px-2.5 py-1 text-[11px] rounded-md transition-colors ' +
                (showMap ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-3')
              }
            >
              {showMap ? 'Hide map' : 'Map'}
            </button>
            {!running && (
              <button
                type="button"
                onClick={() => setShowConfig((v) => !v)}
                className={
                  'px-2.5 py-1 text-[11px] rounded-md transition-colors ' +
                  (showConfig ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-3')
                }
              >
                Configure
              </button>
            )}
            {running ? (
              <button
                type="button"
                onClick={abort}
                className="px-2.5 py-1 text-[11px] rounded-md bg-danger/20 hover:bg-danger/30 text-danger transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={close}
                className="text-text-muted hover:text-text-primary text-sm px-1"
              >
                &#10005;
              </button>
            )}
          </div>
        </div>

        {/* Body: live System Map (left) beside the command console (right). */}
        <div className="flex-1 min-h-0 flex">
          {showMap && (
            <>
              <aside
                className="shrink-0 border-r border-border bg-surface-0 flex flex-col min-h-0"
                style={{ width: mapWidth }}
                data-testid="crew-system-map"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">System map</span>
                  <span className="text-[10px] text-text-muted/70 font-mono">
                    {codeMap.map ? `${codeMap.map.modules.length} mod · ${codeMap.map.edges.length} dep` : 'live'}
                  </span>
                </div>
                <CodeMapView map={codeMap.map} loading={codeMap.loading} error={codeMap.error} width={mapWidth - 40} height={360} />
              </aside>
              <div
                className="w-1 cursor-col-resize bg-border hover:bg-accent transition-colors shrink-0"
                data-testid="crew-map-resize"
                onMouseDown={() => {
                  mapDragRef.current = true
                  document.body.style.cursor = 'col-resize'
                  document.body.style.userSelect = 'none'
                }}
              />
            </>
          )}

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {showConfig && !running && <RosterEditor onClose={() => setShowConfig(false)} />}

        {/* Onboarding guard — no usable model credential. */}
        {!hasModel && (
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-warning/10 text-[12px] text-warning">
            <span>No model configured. Set your API key &amp; model to run a crew.</span>
            <button
              type="button"
              onClick={() => {
                useAppStore.getState().setCrewPanelOpen(false)
                useAppStore.getState().setSettingsOpen(true)
              }}
              className="shrink-0 px-2.5 py-1 rounded-md bg-warning/20 hover:bg-warning/30 text-warning font-medium"
            >
              Open Settings
            </button>
          </div>
        )}

        {/* Task input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface-0">
          <input
            value={running ? task : draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') startPlanning()
            }}
            disabled={running || phase !== 'idle'}
            placeholder="Describe a task for the crew to tackle together…"
            className="flex-1 px-3 py-2 rounded-md bg-surface-2 border border-border text-[13px] text-text-primary outline-none focus:border-border-focus disabled:opacity-60"
          />
          <button
            type="button"
            onClick={startPlanning}
            disabled={running || phase !== 'idle' || !draft.trim() || !hasModel}
            className="px-3 py-2 text-[13px] rounded-md bg-accent hover:bg-accent-hover text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {running ? 'Running…' : phase === 'planning' ? 'Planning…' : 'Plan Crew'}
          </button>
        </div>

        {/* Plan Gate — review/edit the Team Lead's plan before execution */}
        {phase === 'reviewing' && planDraft && (
          <PlanReview
            plan={planDraft}
            roleLabels={Object.fromEntries((planDraft.roles ?? []).map((r) => [r.id, r.label]))}
            onChange={setPlanDraft}
            onApprove={approveAndRun}
            onCancel={cancelPlan}
          />
        )}

        {/* The Bridge — live dependency-graph map of the run */}
        {hasRun && executedRoles.length > 0 && (
          <div className="px-4 pt-3 border-b border-border bg-surface-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Crew map</div>
            <CrewGraph
              roles={executedRoles}
              strategy={strategy}
              status={Object.fromEntries(agents.map((a) => [a.id, a.status as CrewNodeStatus]))}
            />
          </div>
        )}

        {/* Agent columns */}
        <div className="flex-1 min-h-0 overflow-hidden p-4">
          {!hasRun ? (
            <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center text-text-muted">
              <CrewIcon large />
              <p className="mt-3 text-sm">A crew of specialized agents will plan, implement, and review your task.</p>
              <p className="mt-1 text-[12px]">Enter a task above and press Run Crew.</p>
            </div>
          ) : (
            <div className="h-full grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${agents.length}, minmax(220px, 1fr))` }}>
              {agents.map((agent) => (
                <AgentColumn key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>

        {/* Comprehension Gate — route attention to the one decision that matters,
            with the full Change Lens folded underneath. */}
        {lens && !running && (
          <>
            <GateCard lens={lens} protectedGlobs={protectedGlobs} workspacePath={workspacePath} />
            <CollapsibleLens lens={lens} />
          </>
        )}

        {/* Footer status */}
        {hasRun && !running && reason && (
          <div className="px-4 py-2 border-t border-border bg-surface-2 text-[12px]">
            {reason === 'completed' && <span className="text-success">Crew completed.</span>}
            {reason === 'aborted' && <span className="text-warning">Crew aborted.</span>}
            {reason === 'error' && <span className="text-danger">Crew failed.</span>}
          </div>
        )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function AgentColumn({ agent }: { agent: CrewAgent }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [agent.output])

  return (
    <div className="flex flex-col min-h-0 rounded-lg border border-border bg-surface-2 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-0">
        <div className="flex items-center gap-2">
          <StatusDot status={agent.status} />
          <span className="text-[13px] font-medium text-text-primary">{agent.label}</span>
        </div>
        {agent.tokensUsed !== undefined && (
          <span className="text-[10px] text-text-muted font-mono">{agent.tokensUsed}t</span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 text-[12px] text-text-secondary leading-relaxed markdown-body">
        {agent.output ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{agent.output}</ReactMarkdown> : (agent.status === 'pending' ? <span className="text-text-muted">Waiting…</span> : '')}
        {agent.status === 'running' && <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-accent animate-pulse" />}
      </div>
      {agent.tools.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border bg-surface-0 flex flex-wrap gap-1">
          {agent.tools.slice(-6).map((t, i) => (
            <span key={`${t}-${i}`} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function PlanReview({
  plan,
  roleLabels,
  onChange,
  onApprove,
  onCancel,
  expected,
  onExpectedChange
}: {
  plan: CrewPlan
  roleLabels: Record<string, string>
  onChange: (p: CrewPlan) => void
  onApprove: () => void
  onCancel: () => void
  /** Modules the human expects the run to touch (Expectation Diff). */
  expected?: string[]
  onExpectedChange?: (modules: string[]) => void
}): JSX.Element {
  const setBrief = (i: number, brief: string): void =>
    onChange({ ...plan, steps: plan.steps.map((s, idx) => (idx === i ? { ...s, brief } : s)) })
  const removeStep = (i: number): void =>
    onChange({ ...plan, steps: plan.steps.filter((_, idx) => idx !== i) })

  return (
    <div className="px-4 py-3 border-b border-border bg-surface-0 space-y-3 max-h-[42vh] overflow-y-auto">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">Team Lead plan — review before running</span>
      </div>

      {/* The proposed crew as a dependency graph. */}
      {(plan.roles ?? []).length > 0 && <CrewGraph roles={plan.roles} />}

      <label className="block">
        <span className="text-[11px] text-text-muted">Approach</span>
        <input
          value={plan.approach}
          onChange={(e) => onChange({ ...plan, approach: e.target.value })}
          className="mt-1 w-full px-2 py-1.5 rounded bg-surface-2 border border-border text-[12px] text-text-primary outline-none focus:border-border-focus"
        />
      </label>

      {onExpectedChange && (
        <label className="block" data-testid="expected-input">
          <span className="text-[11px] text-text-muted">你预期它改哪些模块？（逗号分隔，可选——完成后会高亮你没料到的）</span>
          <input
            value={(expected ?? []).join(', ')}
            onChange={(e) => onExpectedChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            placeholder="如 src/main, src/shared"
            className="mt-1 w-full px-2 py-1.5 rounded bg-surface-2 border border-border text-[12px] text-text-primary outline-none focus:border-border-focus"
          />
        </label>
      )}

      <div className="space-y-2">
        {plan.steps.map((step, i) => (
          <div key={i} className="rounded-md border border-border bg-surface-2 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-medium text-text-primary">
                {i + 1}. {roleLabels[step.roleId] ?? step.roleId}
              </span>
              <button
                type="button"
                onClick={() => removeStep(i)}
                disabled={plan.steps.length <= 1}
                className="text-[11px] text-danger/70 hover:text-danger disabled:opacity-30"
                title="Remove step"
              >
                ✕
              </button>
            </div>
            <textarea
              value={step.brief}
              onChange={(e) => setBrief(i, e.target.value)}
              rows={2}
              className="w-full px-2 py-1 rounded bg-surface-0 border border-border text-[11px] text-text-secondary outline-none focus:border-border-focus resize-none"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-[12px] rounded-md bg-surface-3 hover:bg-surface-2 text-text-secondary border border-border"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApprove}
          className="px-3 py-1.5 text-[12px] rounded-md bg-accent hover:bg-accent-hover text-white font-medium"
        >
          Approve &amp; Run
        </button>
      </div>
    </div>
  )
}

/**
 * Comprehension Gate — replaces rubber-stamp approval. Low-risk runs show a
 * quiet auto-cleared chip; high-risk/high-uncertainty runs surface exactly ONE
 * question plus a pointer to where the answer lives, and record the human's
 * decision to the workspace Brain so the loop closes.
 */
export function GateCard({
  lens,
  protectedGlobs,
  workspacePath
}: {
  lens: ChangeLens
  protectedGlobs: string[]
  workspacePath: string | null
}): JSX.Element {
  const verdict = useMemo(() => evaluateGate(lens, protectedGlobs), [lens, protectedGlobs])
  const [resolved, setResolved] = useState<null | 'passed' | 'changes'>(null)
  const [showWhy, setShowWhy] = useState(false)
  // The human's "why" captured at the gate — stored on the decision so the Brain
  // can later answer "why is X like this", not just "someone looked at it".
  const [rationale, setRationale] = useState('')
  // Comprehension Probe: the human guesses the impacted modules, then we reveal
  // the blind spots (real impact = blast radius + transitive downstream).
  const realImpacted = useMemo(
    () => [...new Set([...lens.blastRadius.map((b) => b.module), ...(lens.downstreamModules ?? [])])],
    [lens]
  )
  const [guess, setGuess] = useState<Set<string>>(new Set())
  const [probed, setProbed] = useState(false)
  // The answer-in-place: the few lines around the focus symbol (point, don't tell).
  const [snippet, setSnippet] = useState<{ startLine: number; lines: string[]; hitOffset: number } | null>(null)

  useEffect(() => {
    setSnippet(null)
    const focus = verdict.focus
    if (verdict.risk !== 'review' || !focus?.symbol) return
    const abs = workspacePath ? `${workspacePath}/${focus.file}` : focus.file
    let cancelled = false
    void window.kairoAPI
      .readFile?.(abs)
      .then((res) => {
        if (cancelled || !res?.ok || res.content === undefined) return
        const all = res.content.split('\n')
        const idx = all.findIndex((l) => l.includes(focus.symbol!))
        if (idx === -1) return
        const start = Math.max(0, idx - 3)
        setSnippet({ startLine: start + 1, lines: all.slice(start, Math.min(all.length, idx + 5)), hitOffset: idx - start })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [verdict, workspacePath])

  const openFocus = (): void => {
    const f = verdict.focus?.file
    if (!f) return
    const abs = workspacePath ? `${workspacePath}/${f}` : f
    void window.kairoAPI
      .readFile(abs)
      .then((res) => {
        if (res.ok && res.content !== undefined) {
          useEditorStore.getState().openFile({ path: abs, name: f.split('/').pop() ?? f, content: res.content })
        } else {
          useToastStore.getState().addToast({ type: 'error', message: res.error ?? 'Could not open file' })
        }
      })
      .catch(() => useToastStore.getState().addToast({ type: 'error', message: 'Could not open file' }))
  }

  const record = (outcome: 'passed' | 'changes'): void => {
    setResolved(outcome)
    const label = outcome === 'passed' ? '通过' : '需要修改'
    const q = verdict.question ?? verdict.summary
    const why = rationale.trim()
    const entry =
      `**Comprehension Gate** — ${label}\n` +
      `- 问题：${q}\n` +
      (why ? `- 结论：${why}\n` : '') +
      `- 改动文件：${lens.filesChanged.join(', ') || '（无）'}` +
      (verdict.focus ? `\n- 关注：${verdict.focus.file}` : '')
    void window.kairoAPI.recordDecision?.(entry, workspacePath ?? undefined).catch(() => {})
    // Structured log for the Living Map (decisions hang on modules).
    const moduleOf = (f: string): string => f.replace(/\\/g, '/').split('/').filter(Boolean).slice(0, 2).join('/')
    void window.kairoAPI.recordGateDecision?.(
      {
        at: Date.now(),
        outcome,
        question: q,
        ...(why ? { rationale: why } : {}),
        files: lens.filesChanged,
        modules: [...new Set(lens.filesChanged.map(moduleOf))],
        ...(verdict.focus ? { focus: verdict.focus.file } : {})
      },
      workspacePath ?? undefined
    ).then(() => useAppStore.getState().bumpDecisions()).catch(() => {})
    useToastStore.getState().addToast({
      type: outcome === 'passed' ? 'success' : 'info',
      message: outcome === 'passed' ? '已通过 — 决策记入 Brain' : '已标记需修改 — 记入 Brain'
    })
  }

  if (verdict.risk === 'auto') {
    return (
      <div
        className="px-4 py-2 border-t border-border bg-success/10 flex items-center gap-2 text-[12px]"
        data-testid="gate-auto"
      >
        <span className="text-success font-medium">✓ Comprehension Gate</span>
        <span className="text-text-secondary">{verdict.summary}</span>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-border bg-warning/10 space-y-2" data-testid="gate-review">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-warning">
        Comprehension Gate · 需要你判断
      </span>
      <p className="text-[13px] text-text-primary leading-snug">{verdict.question}</p>

      {verdict.note && (
        <p className="text-[11px] text-warning/90" data-testid="gate-note">
          {verdict.note}
        </p>
      )}

      {verdict.verificationGap && (
        <div
          className="text-[11px] rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-text-secondary"
          data-testid="gate-verification-gap"
        >
          <span className="font-semibold text-danger">未验证 · </span>
          {verdict.verificationGap}
        </div>
      )}

      {/* Comprehension Probe: test understanding before confirming, instead of
          self-declaring "I get it". Only meaningful when there's downstream. */}
      {realImpacted.length > 1 && (lens.downstreamModules?.length ?? 0) > 0 && (
        <div className="rounded-md border border-border bg-surface-0 px-2 py-1.5" data-testid="gate-probe">
          {!probed ? (
            <>
              <div className="text-[11px] text-text-secondary mb-1">确认前自测：勾选你认为这次改动会影响的模块</div>
              <div className="flex flex-wrap gap-1.5">
                {realImpacted.map((m) => {
                  const on = guess.has(m)
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setGuess((g) => {
                          const next = new Set(g)
                          next.has(m) ? next.delete(m) : next.add(m)
                          return next
                        })
                      }
                      className={
                        'px-1.5 py-0.5 rounded text-[10px] font-mono border ' +
                        (on ? 'bg-accent/20 text-accent border-accent/40' : 'border-border text-text-muted hover:text-text-secondary')
                      }
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => setProbed(true)}
                className="mt-1.5 text-[10px] px-1.5 py-0.5 rounded bg-surface-3 hover:bg-surface-2 text-text-secondary border border-border"
              >
                对照真实影响
              </button>
            </>
          ) : (
            (() => {
              const diff = expectationDiff([...guess], realImpacted)
              return diff.unexpected.length === 0 ? (
                <div className="text-[11px] text-success" data-testid="probe-result">
                  ✓ 你的心智模型与真实影响半径一致
                </div>
              ) : (
                <div className="text-[11px]" data-testid="probe-result">
                  <span className="text-warning font-medium">盲区：</span>
                  <span className="text-text-primary font-mono">{diff.unexpected.join('、')}</span>
                  <span className="text-text-muted"> 也（传递）受影响，你没勾</span>
                </div>
              )
            })()
          )}
        </div>
      )}

      {verdict.focus && (
        <button
          type="button"
          onClick={openFocus}
          data-testid="gate-focus"
          className="block w-full text-left px-2 py-1.5 rounded-md bg-surface-2 border border-border hover:border-border-focus text-[12px] text-text-secondary"
        >
          看那一处 → <span className="font-mono text-text-primary">{verdict.focus.file}</span>
          <span className="text-text-muted">（{verdict.focus.why}）</span>
        </button>
      )}

      {/* Answer-in-place++: the exact before→after lines that changed the
          contract — not the whole diff. The fastest path to <60s understanding. */}
      {(() => {
        const sig = (lens.behaviorDelta ?? []).find(
          (s) => verdict.focus && s.file === verdict.focus.file && (s.before || s.after)
        )
        if (!sig) return null
        return (
          <div className="rounded-md border border-border bg-surface-0 overflow-hidden" data-testid="gate-keydiff">
            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted border-b border-border">{sig.detail}</div>
            {sig.before && (
              <pre className="text-[11px] font-mono px-2 py-1 bg-danger/10 text-danger overflow-x-auto whitespace-pre-wrap break-words">- {sig.before}</pre>
            )}
            {sig.after && (
              <pre className="text-[11px] font-mono px-2 py-1 bg-success/10 text-success overflow-x-auto whitespace-pre-wrap break-words">+ {sig.after}</pre>
            )}
          </div>
        )
      })()}

      {snippet && (
        <pre
          data-testid="gate-snippet"
          className="text-[11px] font-mono bg-surface-0 border border-border rounded-md overflow-x-auto p-2 leading-relaxed"
        >
          {snippet.lines.map((l, i) => (
            <div
              key={i}
              className={i === snippet.hitOffset ? 'bg-warning/15 text-text-primary' : 'text-text-secondary'}
            >
              <span className="text-text-muted/50 select-none mr-2">{snippet.startLine + i}</span>
              {l || ' '}
            </div>
          ))}
        </pre>
      )}

      {!resolved && (
        <input
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="结论（可选）：为什么这样判？这句会挂到模块上，下次有人能直接读到"
          data-testid="gate-rationale"
          className="w-full px-2 py-1 rounded bg-surface-0 border border-border text-[11px] text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus"
        />
      )}

      <div className="flex items-center gap-2">
        {resolved ? (
          <span className="text-[12px] text-text-muted">
            已{resolved === 'passed' ? '通过' : '标记需修改'} — 记入 Brain
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => record('passed')}
              className="px-3 py-1.5 text-[12px] rounded-md bg-accent hover:bg-accent-hover text-white font-medium"
            >
              理解了，通过
            </button>
            <button
              type="button"
              onClick={() => record('changes')}
              className="px-3 py-1.5 text-[12px] rounded-md bg-surface-3 hover:bg-surface-2 text-text-secondary border border-border"
            >
              需要修改
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          className="ml-auto text-[11px] text-text-muted hover:text-text-secondary"
        >
          {showWhy ? '收起原因' : `为什么（${verdict.reasons.length}）`}
        </button>
      </div>

      {showWhy && (
        <ul className="space-y-0.5 pt-1">
          {verdict.reasons.map((r, i) => (
            <li key={i} className="text-[11px] flex gap-1.5">
              <span className={r.severity === 'high' ? 'text-danger' : 'text-warning'}>
                {r.severity === 'high' ? '●' : '○'}
              </span>
              <span className="text-text-secondary">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The full Change Lens, folded under the gate — open it only if you want detail. */
export function CollapsibleLens({ lens }: { lens: ChangeLens }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-border bg-surface-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-1.5 text-[11px] text-text-muted hover:text-text-secondary"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{open ? '收起完整 Change Lens' : '展开完整 Change Lens'}</span>
      </button>
      {open && <ChangeLensView lens={lens} />}
    </div>
  )
}

export function ChangeLensView({ lens }: { lens: ChangeLens }): JSX.Element {
  return (
    <div className="px-4 py-3 border-t border-border bg-surface-0 max-h-[32vh] overflow-y-auto space-y-3">
      <div className="flex items-center gap-2">
        <LensIcon />
        <span className="text-[12px] font-semibold text-text-primary">Change Lens</span>
        <span className="text-[10px] text-text-muted">understand it in 60s — not re-read it</span>
      </div>

      {/* Verification ledger — the anti-rubber-stamp punch */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Verification</div>
        {lens.verification.ran.length > 0 ? (
          <div className="space-y-0.5">
            {lens.verification.ran.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[12px] font-mono">
                <span className={r.ok ? 'text-success' : 'text-danger'}>{r.ok ? '✓' : '✗'}</span>
                <span className="text-text-secondary truncate">{r.command}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-text-muted">Nothing was executed.</div>
        )}
        {lens.verification.warning && (
          <div className="mt-1 text-[12px] text-warning flex items-center gap-1">
            <span>⚠</span>
            <span>{lens.verification.warning}</span>
          </div>
        )}
      </div>

      {/* Blast radius */}
      {lens.blastRadius.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
            Blast radius · {lens.filesChanged.length} file(s)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lens.blastRadius.map((m) => (
              <button
                key={m.module}
                type="button"
                onClick={() => useAppStore.getState().focusModuleOnMap(m.module)}
                title={`在地图上定位 ${m.module}\n${m.files.join('\n')}`}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
              >
                {m.module} ({m.files.length})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Behavior delta — what observably changed (contract / side effects / routes) */}
      {lens.behaviorDelta && lens.behaviorDelta.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Behavior delta</div>
          <ul className="space-y-0.5">
            {lens.behaviorDelta.map((s, i) => (
              <li key={i} className="text-[12px] text-text-secondary flex gap-1.5">
                <span
                  className={
                    s.kind === 'api-removed' || s.kind === 'api-changed' || s.kind === 'return-shape'
                      ? 'text-danger shrink-0'
                      : 'text-accent shrink-0'
                  }
                >
                  {s.kind === 'api-removed' || s.kind === 'api-changed' || s.kind === 'return-shape' ? '⚠' : '→'}
                </span>
                <span>
                  {s.detail} <span className="text-text-muted font-mono">{s.file.split('/').pop()}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Uncertainty flags — where the crew was unsure */}
      {lens.uncertaintyFlags.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Where the crew was unsure</div>
          <ul className="space-y-0.5">
            {lens.uncertaintyFlags.map((f, i) => (
              <li key={i} className="text-[12px] text-text-secondary flex gap-1.5">
                <span className="text-warning shrink-0">?</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function LensIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function RosterEditor({ onClose }: { onClose: () => void }): JSX.Element {
  const strategy = useCrewRosterStore((s) => s.strategy)
  const setStrategy = useCrewRosterStore((s) => s.setStrategy)
  const setRoles = useCrewRosterStore((s) => s.setRoles)
  const resetToDefault = useCrewRosterStore((s) => s.resetToDefault)
  const pluginAgents = useAppStore((s) => s.pluginAgents)
  const [drafts, setDrafts] = useState<RoleDraft[]>(() => useCrewRosterStore.getState().drafts())

  const update = (i: number, patch: Partial<RoleDraft>): void =>
    setDrafts((d) => d.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i: number): void => setDrafts((d) => d.filter((_, idx) => idx !== i))
  const move = (i: number, dir: -1 | 1): void =>
    setDrafts((d) => {
      const j = i + dir
      if (j < 0 || j >= d.length) return d
      const c = [...d]
      ;[c[i], c[j]] = [c[j]!, c[i]!]
      return c
    })
  const add = (): void =>
    setDrafts((d) => [...d, { id: '', label: 'New Role', systemPrompt: 'You are ...', canWrite: false, dependsOn: [] }])
  const toggleDep = (i: number, depId: string): void =>
    setDrafts((d) =>
      d.map((r, idx) =>
        idx === i
          ? { ...r, dependsOn: r.dependsOn.includes(depId) ? r.dependsOn.filter((x) => x !== depId) : [...r.dependsOn, depId] }
          : r
      )
    )
  const save = (): void => {
    setRoles(drafts)
    onClose()
  }

  // Execution preview: derive the dependency graph and topological waves.
  const previewRoles: CrewRoleConfig[] = drafts
    .filter((d) => d.label.trim())
    .map((d) => ({ id: d.id || d.label, label: d.label, systemPrompt: '', dependsOn: d.dependsOn }))
  const { waves, hasCycle } = computeWaves(previewRoles, effectiveDeps(previewRoles, strategy))
  const labelById = new Map(previewRoles.map((r) => [r.id, r.label]))

  return (
    <div className="px-4 py-3 border-b border-border bg-surface-0 space-y-3 max-h-[40vh] overflow-y-auto">
      {pluginAgents.length > 0 && (
        <div data-testid="plugin-agents" className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
            来自插件的 agents（受信任，Team Lead 可调用）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pluginAgents.map((a) => (
              <span
                key={a.id}
                data-testid={`plugin-agent-${a.id}`}
                title={a.id}
                className="text-[11px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-mono"
              >
                {a.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Strategy</span>
        {(['sequential', 'parallel'] as CrewStrategy[]).map((s) => (
          <label key={s} className="flex items-center gap-1.5 cursor-pointer text-[12px] text-text-secondary">
            <input
              type="radio"
              name="crew-strategy"
              checked={strategy === s}
              onChange={() => setStrategy(s)}
              className="accent-accent"
            />
            {s === 'parallel' ? 'Parallel (fan-out)' : 'Sequential (pipeline)'}
          </label>
        ))}
      </div>

      <div className="space-y-2">
        {drafts.map((role, i) => (
          <div key={i} className="rounded-md border border-border bg-surface-2 p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                value={role.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Role name"
                className="flex-1 px-2 py-1 rounded bg-surface-0 border border-border text-[12px] text-text-primary outline-none focus:border-border-focus"
              />
              <label className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer" title="Allow this role to write files / run commands (requires approval)">
                <input type="checkbox" checked={role.canWrite} onChange={(e) => update(i, { canWrite: e.target.checked })} className="accent-accent" />
                can write
              </label>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-text-muted hover:text-text-primary disabled:opacity-30" title="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === drafts.length - 1} className="px-1 text-text-muted hover:text-text-primary disabled:opacity-30" title="Move down">↓</button>
              <button type="button" onClick={() => remove(i)} disabled={drafts.length <= 1} className="px-1 text-danger/70 hover:text-danger disabled:opacity-30" title="Remove role">✕</button>
            </div>
            <textarea
              value={role.systemPrompt}
              onChange={(e) => update(i, { systemPrompt: e.target.value })}
              placeholder="System prompt for this role…"
              rows={2}
              className="w-full px-2 py-1 rounded bg-surface-0 border border-border text-[11px] text-text-secondary outline-none focus:border-border-focus resize-none font-mono"
            />
            {/* Dependencies: which other roles must finish first. */}
            {drafts.some((o, oi) => oi !== i && o.id) && (
              <div className="flex items-center flex-wrap gap-1">
                <span className="text-[10px] text-text-muted mr-1">runs after:</span>
                {drafts.map((o, oi) =>
                  oi === i || !o.id ? null : (
                    <button
                      key={o.id}
                      type="button"
                      data-testid={`runafter-${i}-${o.id}`}
                      onClick={() => toggleDep(i, o.id)}
                      className={
                        'text-[10px] px-1.5 py-0.5 rounded border transition-colors ' +
                        (role.dependsOn.includes(o.id)
                          ? 'bg-accent/15 border-accent/40 text-accent'
                          : 'border-border text-text-muted hover:bg-surface-3')
                      }
                    >
                      {o.label}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Execution preview — the DAG as topological waves. */}
      <div data-testid="exec-preview" className="rounded-md border border-border bg-surface-2 p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Execution preview</div>
        {hasCycle ? (
          <div className="text-[11px] text-danger">⚠ Dependency cycle — will fall back to sequential.</div>
        ) : (
          <div className="flex items-center flex-wrap gap-1.5 text-[11px]">
            {waves.map((w, wi) => (
              <span key={wi} className="flex items-center gap-1.5">
                {wi > 0 && <span className="text-text-muted">→</span>}
                <span className="px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary">
                  {w.map((id) => labelById.get(id) ?? id).join(' ∥ ')}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={add} className="text-[12px] text-accent hover:text-accent-hover">+ Add role</button>
        <div className="flex-1" />
        <button type="button" onClick={resetToDefault} className="text-[11px] text-text-muted hover:text-text-secondary">Reset</button>
        <button type="button" onClick={save} className="px-3 py-1 text-[12px] rounded-md bg-accent hover:bg-accent-hover text-white font-medium">Save</button>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: CrewAgent['status'] }): JSX.Element {
  const cls =
    status === 'running'
      ? 'bg-success animate-pulse'
      : status === 'done'
        ? 'bg-accent'
        : 'bg-surface-3'
  return <span className={`w-2 h-2 rounded-full ${cls}`} />
}

function CrewIcon({ large }: { large?: boolean }): JSX.Element {
  const size = large ? 'w-8 h-8 text-text-muted' : 'w-4 h-4 text-accent'
  return (
    <svg viewBox="0 0 24 24" className={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="3" />
      <path d="M2 21v-1a6 6 0 0 1 6-6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M14.5 21v-1a5 5 0 0 1 5-5" />
    </svg>
  )
}
