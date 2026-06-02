/**
 * Code System Map — The Bridge's world layer, docked as a persistent side panel
 * so you can watch the system (modules by real imports, invariants, last-change
 * blast radius, live crew agents, contract-change rings) while you command a
 * crew in the chat thread. The graph itself lives in {@link CodeMapView}.
 * Scanning is incremental + cached in the main process (see `code-map-scan.ts`).
 */

import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'
import { useEditorStore } from '../stores/editor-store'
import { useToastStore } from '../stores/toast-store'
import { useCodeMapData } from '../hooks/useCodeMapData'
import { useMapDelta } from '../hooks/useMapDelta'
import { pct } from '../../shared/track-record'
import { moduleBrain, moduleBrainToMarkdown, parseMapIntent, type ModuleBrain } from '../../shared/module-brain'
import { resolveQueryFile } from '../../shared/map-query'
import { dirOf, shortenModuleId } from '../../shared/code-map'
import { gitModulesSince } from '../../shared/git-brain'
import { governanceVerdict } from '../../shared/governance'
import { comprehensionHealth, type ComprehensionHealth } from '../../shared/comprehension-health'
import { predictImpact, type ImpactPrediction } from '../../shared/predict-impact'
import { buildReplay, type ReplayStep } from '../../shared/replay'
import { buildOnboardingTour, type TourStep } from '../../shared/onboarding-tour'
import { buildDrill, scoreDrill, tallyDrills } from '../../shared/comprehension-drill'
import type { RankedHunk } from '../../shared/diff-rank'
import { annotationsForModule, type PluginMapAnnotation, type PluginDrill } from '@kairo/plugin'
import { gatherEvidence, type Evidence } from '../../shared/brain-qa'
import type { ServiceGraph } from '../../shared/service-graph'
import type { CodeMap as CodeMapData, CouplingEdge } from '../../shared/code-map'
import type { ChangeRecord } from '../../shared/map-delta'
import { buildNarrativeFeed } from '../../shared/narrative-feed'
import type { GitCommit } from '../../shared/git-brain'
import type { GateDecision } from '../../shared/types'
import { CodeMapView } from './CodeMapView'
import { ServiceGraphView } from './ServiceGraphView'

/** Width of the SVG canvas inside the dock (the column itself is wider). */
const DOCK_SVG_W = 400
const DOCK_SVG_H = 560

interface FileDeps {
  importers: string[]
  imports: string[]
}

export function CodeMap({ mode = 'full' }: { mode?: 'full' | 'display' }): JSX.Element | null {
  const open = useAppStore((s) => s.codeMapOpen)
  const protectedGlobs = useAppStore((s) => s.protectedGlobs)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const serviceRoots = useAppStore((s) => s.serviceRoots)
  const pluginAnnotations = useAppStore((s) => s.pluginAnnotations)
  const pluginDrills = useAppStore((s) => s.pluginDrills)
  const { map, loading, error, stats } = useCodeMapData(open)
  const { delta, track, debt, drift, decisions, changes, commits, lastSeen, markCaughtUp } = useMapDelta(open)
  const [query, setQuery] = useState('')
  const [fileDeps, setFileDeps] = useState<FileDeps | null>(null)
  const [couplingEdges, setCouplingEdges] = useState<CouplingEdge[]>([])
  const [predictIds, setPredictIds] = useState<Set<string>>(new Set())
  const [replayIds, setReplayIds] = useState<Set<string>>(new Set())
  const [drillAccuracy, setDrillAccuracy] = useState<number | null>(null)

  // The module term with intent words stripped, for file/module resolution.
  const term = useMemo(() => parseMapIntent(query).term || query, [query])
  // If the query points at a concrete FILE (path + extension), answer at file level.
  const fileQuery = useMemo(() => (map && term.trim() ? resolveQueryFile(map, term) : null), [map, term])
  // The module dossier focuses the file's directory when a file is queried.
  const brainQuery = fileQuery ? dirOf(fileQuery) : query
  // "Ask the Map": resolve to a module + assemble its full Brain dossier
  // (topology + invariant + debt + delta + trust + decisions + git history).
  // Memoized so typing doesn't recompute debt over the whole log every keystroke.
  const brain = useMemo(
    () =>
      map && query.trim()
        ? moduleBrain({ map, query: brainQuery, decisions, changes, protectedGlobs, lastSeen, commits, couplingEdges })
        : null,
    [map, brainQuery, query, decisions, changes, protectedGlobs, lastSeen, commits, couplingEdges]
  )
  // From measuring to governing: a standing verdict on the workspace's health.
  const governance = useMemo(() => governanceVerdict({ debt, drift }), [debt, drift])
  // The north-star metric: how much of the changed system the human still understands.
  const health = useMemo(
    () => (map ? comprehensionHealth({ map, changes, commits, decisions, lastSeen }) : null),
    [map, changes, commits, decisions, lastSeen]
  )

  // Hidden coupling (non-import edges) for the whole workspace — fetched once
  // the map is available; rendered on the graph and in the dossier.
  useEffect(() => {
    if (!open || !map) return
    let cancelled = false
    void window.kairoAPI
      .getCoupling?.(workspacePath ?? undefined)
      .then((r) => {
        if (!cancelled && r?.ok) setCouplingEdges(r.edges ?? [])
      })
      .catch(() => {
        if (!cancelled) setCouplingEdges([])
      })
    return () => {
      cancelled = true
    }
  }, [open, workspacePath, map])

  // File-level "who imports this file" — fetched from main on a file query.
  useEffect(() => {
    if (!fileQuery) {
      setFileDeps(null)
      return
    }
    let cancelled = false
    void window.kairoAPI
      .getFileDeps?.(fileQuery, workspacePath ?? undefined)
      .then((r) => {
        if (!cancelled && r?.ok) setFileDeps({ importers: r.importers ?? [], imports: r.imports ?? [] })
      })
      .catch(() => {
        if (!cancelled) setFileDeps(null)
      })
    return () => {
      cancelled = true
    }
  }, [fileQuery, workspacePath])

  if (!open) return null

  const close = (): void => useAppStore.getState().setCodeMapOpen(false)
  // Map Delta overlay now includes non-crew git commits since you last caught up,
  // so the map lights up manual/external changes too — the history is complete.
  const deltaModuleIds = new Set([
    ...(delta?.modules.map((m) => m.id) ?? []),
    ...gitModulesSince(commits, lastSeen)
  ])
  const debtModuleIds = new Set(debt?.modules ?? [])
  const queryModuleIds = brain
    ? new Set([brain.focus, ...brain.dependents, ...brain.dependencies])
    : undefined

  // Open a file (e.g. a decision's focus) in the editor.
  const openFile = (relPath: string): void => {
    const abs = workspacePath ? `${workspacePath}/${relPath}` : relPath
    void window.kairoAPI
      .readFile(abs)
      .then((res) => {
        if (res.ok && res.content !== undefined) {
          useEditorStore.getState().openFile({ path: abs, name: relPath.split('/').pop() ?? relPath, content: res.content })
        } else {
          useToastStore.getState().addToast({ type: 'error', message: res.error ?? 'Could not open file' })
        }
      })
      .catch(() => useToastStore.getState().addToast({ type: 'error', message: 'Could not open file' }))
  }

  // Change Lens for any commit: the instrument explains human/external changes
  // too, not just crew runs. Surfaces blast + behavior-delta of a past commit.
  const commitLens = (sha: string): void => {
    void window.kairoAPI
      .lensForCommit?.(sha, workspacePath ?? undefined)
      .then((r) => {
        if (!r?.ok || !r.lens) {
          useToastStore.getState().addToast({ type: 'error', message: r?.error ?? '无法计算该提交的 Change Lens' })
          return
        }
        const bd = r.lens.behaviorDelta ?? []
        const breaking = bd.filter((s) => s.kind === 'api-removed' || s.kind === 'api-changed' || s.kind === 'return-shape').length
        useToastStore.getState().addToast({
          type: breaking > 0 ? 'info' : 'success',
          message: `提交 lens：${r.lens.filesChanged.length} 文件 · ${bd.length} 处行为变化${breaking > 0 ? `（${breaking} 破坏性）` : ''}`
        })
      })
      .catch(() => useToastStore.getState().addToast({ type: 'error', message: '无法计算该提交的 Change Lens' }))
  }

  // Map → Crew loop: send the dossier into the chat as grounding context. Stamp
  // the snapshot time + a staleness note so a later crew run that changes the
  // module doesn't leave the agent acting on a silently-outdated dossier.
  const sendToChat = (b: ModuleBrain): void => {
    const stamp = new Date().toLocaleString()
    const md = `${moduleBrainToMarkdown(b)}\n- _Snapshot @ ${stamp} — re-query the map if the module changed since._`
    useChatStore.getState().appendCodeContext(md)
    useToastStore.getState().addToast({ type: 'success', message: `已把 ${b.focus} 档案发给对话` })
  }

  // Map → Chat linkage: clicking a module/event in sidebar fills the main input.
  const fillChatInput = (text: string): void => {
    const input = document.querySelector<HTMLTextAreaElement>('[placeholder*="Plan and build"]')
    if (input) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      nativeSetter?.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
    }
  }

  const isDisplay = mode === 'display'

  return (
    <div className={`flex flex-col min-h-0 ${isDisplay ? 'w-full' : 'h-full w-full'} bg-surface-1`} data-testid="code-map-dock">
      {!isDisplay && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-text-primary">Code Map</span>
            <span className="text-xs text-text-muted truncate">
              {map ? `${map.modules.length} modules · ${map.edges.length} deps` : 'your system, by real imports'}
            </span>
            {stats && (
              <span
                className="text-xs text-text-muted/70 font-mono shrink-0"
                title={`${stats.read} read · ${stats.reused} cached · ${stats.removed} pruned`}
              >
                {stats.cached ? 'cached' : 'scanned'} {stats.durationMs}ms
              </span>
            )}
          </div>
          <button type="button" onClick={close} className="shrink-0 text-text-muted hover:text-text-primary text-sm px-1" title="关闭地图 (⌘⇧M)">&#10005;</button>
        </div>
      )}
      {isDisplay && map && (
        <div className="px-3 py-1 text-xs text-text-muted border-b border-border">
          {map.modules.length} modules · {map.edges.length} deps
        </div>
      )}

      {/* ── Compact feed: what you need to know (click → fills main chat) ── */}
      <SidebarFeed
        input={{ changes, commits, decisions, lastSeen, protectedGlobs }}
        onAsk={fillChatInput}
      />

      <CodeMapView
        map={map}
        loading={loading}
        error={error}
        width={DOCK_SVG_W}
        height={DOCK_SVG_H}
        deltaModuleIds={deltaModuleIds}
        debtModuleIds={debtModuleIds}
        queryFocus={brain?.focus ?? null}
        queryModuleIds={queryModuleIds}
        couplingEdges={couplingEdges}
        predictModuleIds={predictIds}
        replayModuleIds={replayIds}
        contextModuleIds={useAppStore((s) => s.contextModuleIds) ?? undefined}
      />
    </div>
  )
}

/** Tiny inline sparkline for a 0..1 series (structural drift). */
function Sparkline({ values, worsening }: { values: number[]; worsening: boolean }): JSX.Element {
  const w = 40
  const h = 12
  const n = values.length
  const color = worsening ? 'var(--color-danger)' : 'var(--color-text-muted)'
  const pts = values
    .map((v, i) => {
      const x = n <= 1 ? 0 : (i / (n - 1)) * w
      const y = h - Math.max(0, Math.min(1, v)) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="inline-block align-middle" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

const ROLE_LABEL: Record<ModuleBrain['role'], string> = {
  hub: '枢纽',
  leaf: '叶子',
  connector: '连接',
  isolated: '孤立'
}

const HEALTH_STYLE: Record<ModuleBrain['health']['level'], { label: string; color: string }> = {
  risk: { label: '危险', color: 'var(--color-danger)' },
  watch: { label: '留意', color: 'var(--color-warning)' },
  healthy: { label: '健康', color: 'var(--color-success)' }
}

/** Which reorderable block the query intent wants pinned first (null = default). */
function leadBlock(intent: ModuleBrain['intent']): string | null {
  switch (intent) {
    case 'safety':
    case 'dependents':
      return 'impact'
    case 'why':
      return 'decisions'
    case 'changes':
      return 'trust'
    default:
      return null
  }
}

/** A decision's "why" — prefer the human's captured rationale over the question. */
function decisionWhy(d: GateDecision): string {
  return d.rationale ?? d.question ?? '已在闸门确认'
}

/** Compact relative time ("3 天前") for freshness. 0 → null. */
function relTime(at: number): string | null {
  if (!at) return null
  const ms = Date.now() - at
  if (ms < 0) return '刚刚'
  const min = Math.floor(ms / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return `${Math.floor(day / 30)} 个月前`
}

/**
 * Comprehension Health bar — the north-star metric, pinned at the top of the
/** Compact Narrative Feed for sidebar mode — events are clickable → fill main chat. */
function SidebarFeed({
  input,
  onAsk
}: {
  input: { changes: ChangeRecord[]; commits: GitCommit[]; decisions: GateDecision[]; lastSeen: number; protectedGlobs: string[] }
  onAsk: (question: string) => void
}): JSX.Element {
  const feed = useMemo(() => buildNarrativeFeed(input), [input])
  if (feed.length === 0) {
    return <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border">一切正常。在下方聊天框问任何问题。</div>
  }
  return (
    <div className="border-b border-border px-2 py-1.5 space-y-1" data-testid="sidebar-feed">
      <div className="text-xs text-text-muted uppercase tracking-wider px-1">最近动态</div>
      {feed.map((ev, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onAsk(ev.title + '，详情是什么？')}
          className={
            'w-full text-left flex items-start gap-1.5 px-1.5 py-1 rounded text-xs hover:bg-surface-3 ' +
            (ev.severity === 'critical' ? 'text-danger' :
             ev.severity === 'warning' ? 'text-warning' :
             'text-text-secondary')
          }
        >
          <span className="shrink-0 mt-0.5">{ev.severity === 'critical' ? '●' : ev.severity === 'warning' ? '●' : '○'}</span>
          <span className="truncate">{ev.title}</span>
        </button>
      ))}
    </div>
  )
}

/** Collapsible group for less-frequently-used tools (drill, preflight, service map, etc.) */
function AdvancedToolsGroup({ children }: { children: React.ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="advanced-tools-toggle"
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>更多工具</span>
      </button>
      {open && children}
    </div>
  )
}

/**
 * dock. Shows the weighted fraction of the changed system you still understand,
 * and points at the modules drifting out of your mental model (click to ask).
 */
function ComprehensionHealthBar({
  health,
  drillAccuracy,
  onPick
}: {
  health: ComprehensionHealth
  /** Measured self-test accuracy (0..1), if any drills answered. */
  drillAccuracy: number | null
  onPick: (id: string) => void
}): JSX.Element {
  const pctNum = Math.round(health.score * 100)
  const color =
    health.score >= 0.8 ? 'var(--color-success)' : health.score >= 0.5 ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <div
      className="px-3 py-1.5 border-b border-border flex items-center gap-2 text-xs"
      data-testid="comprehension-health"
      data-score={pctNum}
      title={`${health.freshModules}/${health.liveModules} 个变更过的模块你已跟进（按重要度加权）`}
    >
      <span className="text-text-secondary font-medium shrink-0">理解力</span>
      <span className="font-semibold shrink-0" style={{ color }}>{pctNum}%</span>
      <div className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pctNum}%`, background: color }} />
      </div>
      {drillAccuracy != null && (
        <span className="shrink-0 text-text-muted" data-testid="drill-accuracy" title="理解力自测的实测准确率(跨会话累计)">
          自测 <span className="text-text-secondary">{Math.round(drillAccuracy * 100)}%</span>
        </span>
      )}
      {health.staleModules.length > 0 && (
        <span className="flex items-center gap-1 min-w-0">
          <span className="text-text-muted shrink-0">漂移</span>
          {health.staleModules.slice(0, 3).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m.id)}
              className="px-1 rounded text-xs font-mono bg-surface-2 border border-border text-text-secondary hover:text-text-primary hover:border-border-focus truncate"
              title={`${m.id} 自变更后没人跟进 — 点击问系统`}
            >
              {m.id.split('/').slice(-1)[0]}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

const EVIDENCE_KIND_LABEL: Record<Evidence['items'][number]['kind'], string> = {
  module: '模块',
  edge: '依赖',
  decision: '决策',
  commit: '提交'
}

/** Render an answer, turning each [E#] into a clickable citation chip. */
function renderCited(
  answer: string,
  evidence: Evidence,
  onOpenFile: (p: string) => void,
  onPick: (id: string) => void
): JSX.Element[] {
  return answer.split(/(\[E\d+\])/g).map((part, i) => {
    const m = /^\[(E\d+)\]$/.exec(part)
    if (!m) return <span key={i}>{part}</span>
    const item = evidence.items.find((e) => e.id === m[1])
    if (!item) return <span key={i}>{part}</span>
    return (
      <button
        key={i}
        type="button"
        onClick={() => (item.file ? onOpenFile(item.file) : item.module ? onPick(item.module) : undefined)}
        className="px-0.5 rounded text-xs align-baseline text-accent hover:underline"
        title={item.text}
      >
        [{item.id}]
      </button>
    )
  })
}

/**
 * Talk to the system — grounded. A natural-language question is answered ONLY
 * from the Brain's evidence (edges/decisions/commits), with [E#] citations that
 * jump to the file/module. No model configured → still shows the evidence (the
 * grounding), so it never degrades into ungrounded prose.
 */
function BrainChat({
  data,
  onOpenFile,
  onPick,
  narrativeInput
}: {
  data: { map: CodeMapData; decisions: GateDecision[]; commits: GitCommit[]; changes: ChangeRecord[] }
  onOpenFile: (p: string) => void
  onPick: (id: string) => void
  narrativeInput?: { changes: ChangeRecord[]; commits: GitCommit[]; decisions: GateDecision[]; lastSeen: number; protectedGlobs: string[] }
}): JSX.Element {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [noModel, setNoModel] = useState(false)

  const feed = useMemo(
    () => narrativeInput ? buildNarrativeFeed(narrativeInput) : [],
    [narrativeInput]
  )
  const hasAsked = answer !== null || evidence !== null || loading

  const ask = (): void => {
    const question = q.trim()
    if (!question || loading) return
    const ev = gatherEvidence(question, data)
    setEvidence(ev)
    setAnswer(null)
    setNoModel(false)
    setLoading(true)
    void window.kairoAPI
      .askBrain?.(question, ev)
      .then((r) => {
        if (r?.ok) setAnswer(r.answer ?? '')
        else setNoModel(true)
      })
      .catch(() => setNoModel(true))
      .finally(() => setLoading(false))
  }

  return (
    <div className="border-b border-border" data-testid="brain-chat">
      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-text-secondary">与系统对话</span>
          <span className="text-xs text-text-muted">grounded · 每句都引用证据</span>
        </div>
        <div className="flex gap-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
            placeholder="问系统：流程怎么走？为什么这样？发生了什么？"
            data-testid="brain-chat-input"
            className="flex-1 px-2 py-1 rounded bg-surface-2 border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus"
          />
          <button
            type="button"
            onClick={ask}
            disabled={loading}
            data-testid="brain-chat-ask"
            className="px-2 py-1 rounded text-xs bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? '…' : '问'}
          </button>
        </div>

        {/* ── Narrative Feed: shown when the user hasn't asked anything yet ── */}
        {!hasAsked && feed.length > 0 && (
          <div className="space-y-1" data-testid="narrative-feed">
            <div className="text-xs text-text-muted">自上次查看以来，你需要知道的事：</div>
            {feed.map((ev, i) => (
              <div
                key={i}
                data-testid={`narrative-event-${i}`}
                className={
                  'flex items-start gap-1.5 px-2 py-1 rounded text-xs ' +
                  (ev.severity === 'critical' ? 'bg-danger/10 text-danger' :
                   ev.severity === 'warning' ? 'bg-warning/10 text-warning' :
                   'bg-surface-2 text-text-secondary')
                }
              >
                <span className="shrink-0">{ev.severity === 'critical' ? '🔴' : ev.severity === 'warning' ? '🟡' : '🟢'}</span>
                <div className="min-w-0">
                  <div className="font-medium">{ev.title}</div>
                  <div className="text-xs opacity-80">{ev.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!hasAsked && feed.length === 0 && (
          <div className="text-xs text-text-muted" data-testid="narrative-feed-empty">
            一切正常，没有需要你关注的变化。试试问一个问题。
          </div>
        )}

        {answer && evidence && (
          <div className="text-xs text-text-primary leading-snug rounded bg-surface-2 px-2 py-1.5" data-testid="brain-chat-answer">
            {renderCited(answer, evidence, onOpenFile, onPick)}
          </div>
        )}

        {noModel && evidence && (
          <div className="rounded bg-surface-2 px-2 py-1.5 space-y-1" data-testid="brain-chat-nomodel">
            <div className="text-xs text-text-primary font-medium">
              找到 {evidence.items.length} 条相关证据（无模型，显示原始数据）
            </div>
            {evidence.items.length > 0 && (
              <div className="text-xs text-text-secondary leading-snug">
                {/* Summarize evidence kinds for quick overview */}
                {(() => {
                  const kinds = new Map<string, number>()
                  for (const e of evidence.items) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
                  return [...kinds.entries()].map(([k, n]) => `${(EVIDENCE_KIND_LABEL as Record<string, string>)[k] ?? k} ×${n}`).join('　')
                })()}
              </div>
            )}
            <div className="text-xs text-accent">
              配置模型后（Settings → Provider），AI 会用这些证据 + 读代码工具生成完整回答
            </div>
          </div>
        )}
        {noModel && !evidence && (
          <div className="text-xs text-text-muted" data-testid="brain-chat-nomodel">
            未配置模型 — 去 Settings 配模型后可以问系统任何问题
          </div>
        )}

        {evidence && (
          <div className="space-y-0.5" data-testid="brain-chat-evidence">
            {evidence.items.length === 0 ? (
              <div className="text-xs text-text-muted">Brain 里没有与这个问题相关的证据</div>
            ) : (
              evidence.items.slice(0, 8).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => (e.file ? onOpenFile(e.file) : e.module ? onPick(e.module) : undefined)}
                  className="w-full text-left flex items-start gap-1 text-xs px-0.5 py-0.5 rounded hover:bg-surface-3"
                  title={e.file ?? e.module ?? ''}
                >
                  <span className="text-accent shrink-0">[{e.id}]</span>
                  <span className="px-1 rounded text-xs shrink-0 bg-surface-3 text-text-muted">{EVIDENCE_KIND_LABEL[e.kind]}</span>
                  <span className="text-text-secondary truncate">{e.text}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Pre-dispatch blast-radius prediction — autopsy → flight plan. Type the task
 * you're about to hand a crew; before it runs, see which modules it'll likely
 * touch, how far the blast reaches (import + hidden coupling), and which
 * invariants / debt it'll hit. The predicted set lights up on the map.
 */
function PreflightPredict({
  data,
  onPredict,
  onPick
}: {
  data: { map: CodeMapData; protectedGlobs: string[]; debtModules: string[]; couplingEdges: CouplingEdge[] }
  onPredict: (ids: Set<string>) => void
  onPick: (id: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [task, setTask] = useState('')
  const [pred, setPred] = useState<ImpactPrediction | null>(null)

  const run = (): void => {
    const t = task.trim()
    if (!t) return
    const p = predictImpact(t, data)
    setPred(p)
    onPredict(new Set([...p.predicted, ...p.blast]))
  }

  return (
    <div className="border-b border-border" data-testid="preflight">
      <button
        type="button"
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          if (!next) onPredict(new Set())
        }}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">派单前预测</span>
        <span className="text-xs text-text-muted">改之前先看会炸到哪</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="flex gap-1.5">
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="要派给 crew 的任务，如：重构 auth 的 token 刷新"
              data-testid="preflight-input"
              className="flex-1 px-2 py-1 rounded bg-surface-2 border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus"
            />
            <button
              type="button"
              onClick={run}
              data-testid="preflight-run"
              className="px-2 py-1 rounded text-xs bg-accent text-white hover:bg-accent-hover"
            >
              预测
            </button>
          </div>
          {pred && (
            <div className="space-y-1" data-testid="preflight-result">
              <div className="text-xs text-text-primary">{pred.summary}</div>
              {pred.invariantsAtRisk.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="text-warning shrink-0">不变量</span>
                  {pred.invariantsAtRisk.slice(0, 4).map((id) => (
                    <button key={id} type="button" onClick={() => onPick(id)} className="px-1 rounded text-xs font-mono bg-surface-2 border border-border text-text-secondary hover:text-text-primary">
                      {id.split('/').slice(-1)[0]}
                    </button>
                  ))}
                </div>
              )}
              {pred.debtHit.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="text-danger shrink-0">带债</span>
                  {pred.debtHit.slice(0, 4).map((id) => (
                    <button key={id} type="button" onClick={() => onPick(id)} className="px-1 rounded text-xs font-mono bg-surface-2 border border-border text-text-secondary hover:text-text-primary">
                      {id.split('/').slice(-1)[0]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const HUNK_KIND_STYLE: Record<RankedHunk['kind'], { label: string; color: string }> = {
  contract: { label: '契约', color: 'var(--color-danger)' },
  logic: { label: '逻辑', color: 'var(--color-warning)' },
  dependency: { label: '依赖', color: 'var(--color-accent)' },
  edit: { label: '改动', color: 'var(--color-text-muted)' },
  cosmetic: { label: '装饰', color: 'var(--color-text-muted)' }
}

/**
 * Comprehension-ranked diff — when you must read code, this orders the working
 * tree's hunks by how much they matter to understanding (contract > logic >
 * dependency > edit) and folds away pure formatting/comment churn. "Point, don't
 * tell" at the line level.
 */
function RankedDiffPanel({
  workspacePath,
  onOpenFile
}: {
  workspacePath: string | null
  onOpenFile: (path: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [hunks, setHunks] = useState<RankedHunk[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [showCosmetic, setShowCosmetic] = useState(false)

  const load = (): void => {
    setLoading(true)
    void window.kairoAPI
      .getRankedDiff?.(workspacePath ?? undefined)
      .then((r) => setHunks(r?.ok ? (r.hunks ?? []) : []))
      .catch(() => setHunks([]))
      .finally(() => setLoading(false))
  }

  const meaningful = (hunks ?? []).filter((h) => h.kind !== 'cosmetic')
  const cosmetic = (hunks ?? []).filter((h) => h.kind === 'cosmetic')

  return (
    <div className="border-b border-border" data-testid="ranked-diff">
      <button
        type="button"
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          if (next && hunks === null) load()
        }}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">关键改动</span>
        <span className="text-xs text-text-muted">本地改动 · 按理解重要性排序</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1" data-testid="ranked-diff-body">
          <div className="flex items-center gap-2">
            <button type="button" onClick={load} className="px-2 py-0.5 rounded text-xs border border-border text-text-secondary hover:text-text-primary">刷新</button>
            <span className="text-xs text-text-muted">{loading ? '读取中…' : hunks ? `${meaningful.length} 处关键 · ${cosmetic.length} 处装饰` : ''}</span>
          </div>
          {hunks && meaningful.length === 0 && cosmetic.length === 0 && (
            <div className="text-xs text-text-muted">本地无未提交改动</div>
          )}
          {meaningful.map((h, i) => {
            const st = HUNK_KIND_STYLE[h.kind]
            return (
              <button
                key={`${h.file}-${i}`}
                type="button"
                onClick={() => onOpenFile(h.file)}
                className="w-full text-left rounded px-1.5 py-1 hover:bg-surface-3 border border-border/50"
                title={`打开 ${h.file}`}
              >
                <div className="flex items-center gap-1 text-xs">
                  <span className="px-1 rounded text-xs shrink-0" style={{ background: st.color, color: 'var(--color-surface-0)' }}>{st.label}</span>
                  <span className="font-mono text-text-secondary truncate">{h.file.split('/').slice(-1)[0]}{h.header ? ` · ${h.header}` : ''}</span>
                  <span className="ml-auto shrink-0 text-text-muted">+{h.added}/-{h.removed}</span>
                </div>
                {h.reasons[0] && <div className="text-xs text-text-muted pl-0.5">{h.reasons[0]}</div>}
              </button>
            )
          })}
          {cosmetic.length > 0 && (
            <button type="button" onClick={() => setShowCosmetic((v) => !v)} className="text-xs text-text-muted hover:text-text-secondary" data-testid="ranked-diff-cosmetic-toggle">
              {showCosmetic ? '收起' : `展开 ${cosmetic.length} 处格式/注释改动`}
            </button>
          )}
          {showCosmetic &&
            cosmetic.map((h, i) => (
              <button key={`c-${h.file}-${i}`} type="button" onClick={() => onOpenFile(h.file)} className="w-full text-left text-xs text-text-muted px-1.5 py-0.5 rounded hover:bg-surface-3 truncate">
                装饰 · {h.file.split('/').slice(-1)[0]} (+{h.added}/-{h.removed})
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

/**
 * Comprehension drill — quiz the human on the system's real structure (answers
 * come from the Living Map) and score it, turning "your understanding" from a
 * proxy into a measured accuracy. Targets least-engaged modules first.
 */
function DrillPanel({
  map,
  engaged,
  workspacePath,
  pluginDrills,
  onFocus,
  onAccuracy
}: {
  map: CodeMapData
  engaged: Set<string>
  workspacePath: string | null
  pluginDrills: PluginDrill[]
  onFocus: (q: string) => void
  onAccuracy: (acc: number) => void
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const [seed, setSeed] = useState(0)
  const [answered, setAnswered] = useState<number | null>(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })

  // Seed the rolling score from persisted drill history (accuracy across sessions).
  useEffect(() => {
    void window.kairoAPI.getDrills?.(workspacePath ?? undefined).then((r) => {
      if (r?.ok && r.results.length > 0) {
        const t = tallyDrills(r.results)
        setScore({ correct: t.correct, total: t.total })
        onAccuracy(t.accuracy)
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])

  // Interleave plugin-authored drills (even seeds) with generated ones (odd).
  const drill = useMemo(() => {
    if (pluginDrills.length > 0 && seed % 2 === 0) {
      const pd = pluginDrills[Math.floor(seed / 2) % pluginDrills.length]!
      return { target: '', question: pd.question, options: pd.options, answerIndex: pd.answerIndex }
    }
    return buildDrill(map, { engaged, seed })
  }, [map, engaged, seed, pluginDrills])
  if (!drill) return null

  const choose = (i: number): void => {
    if (answered !== null) return
    setAnswered(i)
    const ok = scoreDrill(drill, i)
    const next = { correct: score.correct + (ok ? 1 : 0), total: score.total + 1 }
    setScore(next)
    onAccuracy(next.total > 0 ? next.correct / next.total : 1)
    void window.kairoAPI.recordDrill?.(ok, workspacePath ?? undefined).catch(() => {})
    if (drill.target) onFocus(drill.target) // reveal the answer on the map
  }
  const next = (): void => {
    setAnswered(null)
    setSeed((s) => s + 1)
  }
  const acc = score.total > 0 ? Math.round((score.correct / score.total) * 100) : null

  return (
    <div className="border-b border-border" data-testid="drill-panel">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">理解力自测</span>
        <span className="text-xs text-text-muted">{acc != null ? `本轮准确率 ${acc}%（${score.correct}/${score.total}）` : '考考你对系统的理解'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5" data-testid="drill-question">
          <div className="text-xs text-text-primary font-mono">{drill.question}</div>
          <div className="space-y-1">
            {drill.options.map((opt, i) => {
              const isAnswer = i === drill.answerIndex
              const chosen = answered === i
              const reveal = answered !== null
              const bg = reveal && isAnswer ? 'var(--color-success)' : reveal && chosen ? 'var(--color-danger)' : undefined
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => choose(i)}
                  disabled={reveal}
                  data-testid={`drill-option-${i}`}
                  className="w-full text-left px-2 py-1 rounded text-xs font-mono border border-border hover:border-border-focus disabled:cursor-default"
                  style={bg ? { background: bg, color: 'var(--color-surface-0)', borderColor: bg } : undefined}
                >
                  {opt}
                </button>
              )
            })}
          </div>
          {answered !== null && (
            <button
              type="button"
              onClick={next}
              data-testid="drill-next"
              className="px-2 py-0.5 rounded text-xs bg-accent text-white hover:bg-accent-hover"
            >
              下一题
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Onboarding tour — step through a guided "understand this system" walk built
 * from the Living Map + Brain. Each step narrates a facet (hubs / invariants /
 * debt / coupling) and focuses its modules on the map (via the query) so you
 * build a mental model fast instead of reading the whole repo.
 */
function OnboardingTour({ steps, onFocus }: { steps: TourStep[]; onFocus: (q: string) => void }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const [idx, setIdx] = useState(0)
  if (steps.length === 0) return null
  const cur = steps[Math.min(idx, steps.length - 1)]!
  const go = (next: number): void => {
    const i = Math.max(0, Math.min(next, steps.length - 1))
    setIdx(i)
    const focus = steps[i]!.focusModules[0]
    if (focus) onFocus(focus)
  }
  return (
    <div className="border-b border-border" data-testid="onboarding-tour">
      <button
        type="button"
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          if (next) go(idx)
        }}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">理解上手之旅</span>
        <span className="text-xs text-text-muted">{steps.length} 步 · 快速读懂这个系统</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5" data-testid="tour-step">
          <div className="text-xs font-medium text-text-primary">{cur.title}</div>
          <div className="text-xs text-text-secondary leading-snug">{cur.detail}</div>
          {cur.focusModules.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {cur.focusModules.slice(0, 6).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onFocus(m)}
                  className="px-1 rounded text-xs font-mono bg-surface-2 border border-border text-text-secondary hover:text-text-primary hover:border-border-focus"
                >
                  {m.split('/').slice(-1)[0]}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => go(idx - 1)}
              disabled={idx === 0}
              className="px-2 py-0.5 rounded text-xs border border-border text-text-secondary hover:text-text-primary disabled:opacity-40"
            >
              上一步
            </button>
            <span className="text-xs text-text-muted">{Math.min(idx, steps.length - 1) + 1}/{steps.length}</span>
            <button
              type="button"
              onClick={() => go(idx + 1)}
              disabled={idx >= steps.length - 1}
              data-testid="tour-next"
              className="px-2 py-0.5 rounded text-xs bg-accent text-white hover:bg-accent-hover disabled:opacity-40"
            >
              下一步
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Cross-repo service map — system of systems. Register sibling service folders;
 * services that share an event topic or HTTP route are linked, so you can see
 * "change here breaks the service over there" across repo boundaries. Minimal
 * text view (v0); each cross-service contract is one line.
 */
function ServiceMap({
  workspacePath,
  serviceRoots
}: {
  workspacePath: string | null
  serviceRoots: string[]
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [graph, setGraph] = useState<ServiceGraph | null>(null)
  const [loading, setLoading] = useState(false)

  const allRoots = useMemo(
    () => [...(workspacePath ? [workspacePath] : []), ...serviceRoots],
    [workspacePath, serviceRoots]
  )

  // Rebuild the service graph whenever the registered roots change.
  useEffect(() => {
    if (!expanded || allRoots.length === 0) return
    let cancelled = false
    setLoading(true)
    void window.kairoAPI
      .getServiceGraph?.(allRoots)
      .then((r) => {
        if (!cancelled) setGraph(r?.ok ? (r.graph ?? null) : null)
      })
      .catch(() => {
        if (!cancelled) setGraph(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, allRoots])

  const addService = (): void => {
    void window.kairoAPI
      .openFolder?.()
      .then((path) => {
        if (path) useAppStore.getState().addServiceRoot(path)
      })
      .catch(() => {})
  }

  const discover = (): void => {
    if (!workspacePath) return
    void window.kairoAPI
      .discoverServices?.(workspacePath)
      .then((r) => {
        if (r?.ok) for (const root of r.roots ?? []) useAppStore.getState().addServiceRoot(root)
      })
      .catch(() => {})
  }

  return (
    <div className="border-b border-border" data-testid="service-map">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">服务图</span>
        <span className="text-xs text-text-muted">跨仓:谁的事件/接口连着谁</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={addService}
              data-testid="service-add"
              className="px-2 py-1 rounded text-xs border border-border text-text-secondary hover:text-text-primary hover:border-border-focus"
            >
              + 添加服务目录
            </button>
            <button
              type="button"
              onClick={discover}
              disabled={!workspacePath}
              data-testid="service-discover"
              className="px-2 py-1 rounded text-xs border border-border text-text-secondary hover:text-text-primary hover:border-border-focus disabled:opacity-50"
            >
              自动发现同级
            </button>
            <span className="text-xs text-text-muted">{allRoots.length} 个服务{loading ? ' · 扫描中…' : ''}</span>
          </div>

          {/* Registered sibling roots, each removable. */}
          {serviceRoots.length > 0 && (
            <div className="flex flex-wrap gap-1" data-testid="service-roots">
              {serviceRoots.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => useAppStore.getState().removeServiceRoot(r)}
                  className="px-1 rounded text-xs font-mono bg-surface-2 border border-border text-text-secondary hover:text-danger hover:border-danger/50"
                  title={`移除 ${r}`}
                >
                  {r.split('/').slice(-1)[0]} ✕
                </button>
              ))}
            </div>
          )}

          {graph && graph.edges.length > 0 ? (
            <ServiceGraphView graph={graph} />
          ) : (
            <div className="text-xs text-text-muted" data-testid="service-empty">
              {allRoots.length < 2 ? '添加 ≥2 个服务目录（或"自动发现同级"），看跨服务的事件/接口连接' : '这些服务之间没有共享的事件/接口'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Comprehension Replay bar — scrub history and watch the system evolve. Each
 * step lights up the modules that changed at that moment, so you rebuild your
 * mental model by replay instead of reading 40 PRs. Collapsed by default.
 */
function ReplayBar({
  steps,
  onScrub
}: {
  steps: ReplayStep[]
  onScrub: (ids: Set<string>) => void
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const [idx, setIdx] = useState(0)
  if (steps.length === 0) return null
  const cur = steps[Math.min(idx, steps.length - 1)]!
  const scrub = (i: number): void => {
    setIdx(i)
    onScrub(new Set(steps[i]!.modules))
  }
  return (
    <div className="border-b border-border" data-testid="replay">
      <button
        type="button"
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          if (next) scrub(idx)
          else onScrub(new Set())
        }}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">理解力回放</span>
        <span className="text-xs text-text-muted">{steps.length} 步 · 看系统怎么长成现在这样</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          <input
            type="range"
            min={0}
            max={steps.length - 1}
            value={Math.min(idx, steps.length - 1)}
            onChange={(e) => scrub(Number(e.target.value))}
            data-testid="replay-slider"
            className="w-full accent-accent"
          />
          <div className="flex items-center gap-1.5 text-xs" data-testid="replay-step">
            <span className="text-text-muted shrink-0">{Math.min(idx, steps.length - 1) + 1}/{steps.length}</span>
            <span
              className="px-1 rounded text-xs shrink-0"
              style={{ background: cur.source === 'crew' ? 'var(--color-accent)' : 'var(--color-surface-3)', color: cur.source === 'crew' ? 'var(--color-surface-0)' : 'var(--color-text-muted)' }}
            >
              {cur.source === 'crew' ? 'crew' : 'git'}
            </span>
            <span className="text-text-secondary truncate" title={cur.label}>{cur.label}</span>
          </div>
          <div className="text-xs text-text-muted">
            {cur.modules.length} 个模块变更{relTime(cur.at) ? ` · ${relTime(cur.at)}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * File-level answer ("who imports this file") — finer than the module dossier,
 * for when the query names a concrete file. Point, don't tell: each importer
 * links straight to the file.
 */
function FileLevelPanel({
  file,
  deps,
  onOpenFile
}: {
  file: string
  deps: FileDeps
  onOpenFile: (path: string) => void
}): JSX.Element {
  const row = (label: string, list: string[]): JSX.Element => (
    <div className="space-y-0.5">
      <div className="text-xs uppercase tracking-wide text-text-muted">{label}（{list.length}）</div>
      {list.slice(0, 6).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onOpenFile(f)}
          className="w-full text-left px-0.5 py-0.5 rounded text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary truncate"
          title={`打开 ${f}`}
        >
          {f.split('/').pop()} ↗
        </button>
      ))}
      {list.length === 0 && <div className="text-xs text-text-muted px-0.5">（无）</div>}
    </div>
  )
  return (
    <div className="mt-1.5 space-y-1.5 rounded border border-border bg-surface-2 px-2 py-1.5" data-testid="map-file-deps">
      <div className="flex items-center gap-1.5">
        <span className="px-1 rounded text-xs bg-accent text-white shrink-0">文件级</span>
        <span className="font-mono text-xs text-text-primary truncate" title={file}>{file}</span>
      </div>
      {row('被这些文件 import', deps.importers)}
      {row('它 import 了', deps.imports)}
    </div>
  )
}

/**
 * Ask-the-Map answer card — the queried module's full Brain dossier in one
 * glance. The verdict (#2) is pinned on top as the <60s answer ("should I
 * worry?"); the remaining facets reorder by query intent (#1) so "X 安全吗"
 * leads with impact and "为什么 X" leads with decision history. "Point, don't
 * tell": every row links to the file/decision, and the whole thing can be sent
 * to chat as grounding (Map → Crew loop).
 */
function ModuleDossier({
  brain,
  annotations,
  onOpenFile,
  onSendToChat,
  onPick,
  onCommitLens
}: {
  brain: ModuleBrain
  /** Plugin-contributed Living-Map annotations for the focus module. */
  annotations: PluginMapAnnotation[]
  onOpenFile: (path: string) => void
  onSendToChat: (b: ModuleBrain) => void
  /** Switch the query focus to another matching module (disambiguation). */
  onPick: (id: string) => void
  /** Compute + surface a Change Lens for a git commit. */
  onCommitLens: (sha: string) => void
}): JSX.Element {
  const t = brain.trust
  const hs = HEALTH_STYLE[brain.health.level]
  const fresh = relTime(brain.lastChangeAt)

  const blocks: Record<string, JSX.Element | null> = {
    flags:
      brain.invariant || brain.debt > 0 || brain.deltaCount > 0 ? (
        <div className="flex flex-wrap gap-1" data-testid="dossier-flags">
          {brain.invariant && (
            <span className="px-1 rounded text-xs" style={{ background: 'var(--color-warning)', color: 'var(--color-surface-0)' }}>
              不变量
            </span>
          )}
          {brain.debt > 0 && (
            <span className="px-1 rounded text-xs" style={{ background: 'var(--color-danger)', color: 'var(--color-surface-0)' }} title="高风险变更没人在闸门确认过">
              理解债 {brain.debt}
            </span>
          )}
          {brain.deltaCount > 0 && (
            <span className="px-1 rounded text-xs" style={{ background: 'var(--color-accent)', color: 'var(--color-surface-0)' }} title="自上次理解以来的变更">
              Δ {brain.deltaCount} 待跟进
            </span>
          )}
        </div>
      ) : null,
    impact:
      brain.impact.downstream > 0 ? (
        <div className="text-xs" style={{ color: 'var(--color-accent)' }} data-testid="dossier-impact">
          改它波及 {brain.impact.downstream} 个下游
          {(brain.impact.protectedDownstream > 0 || brain.impact.debtDownstream > 0) && (
            <span className="text-text-muted">
              （
              {brain.impact.protectedDownstream > 0 && <span className="text-warning">{brain.impact.protectedDownstream} 不变量</span>}
              {brain.impact.protectedDownstream > 0 && brain.impact.debtDownstream > 0 && ' · '}
              {brain.impact.debtDownstream > 0 && <span className="text-danger">{brain.impact.debtDownstream} 带债</span>}
              ）
            </span>
          )}
        </div>
      ) : null,
    trust:
      t.changes > 0 ? (
        <div className="text-xs text-text-muted" data-testid="dossier-trust">
          信任：{t.changes} 次变更 · 验证 <span className={t.verified * 2 < t.changes ? 'text-warning' : 'text-text-secondary'}>{t.verified}</span> · 自动 {t.auto} · 审 {t.review}
        </div>
      ) : null,
    decisions:
      brain.decisions.length > 0 ? (
        <div className="space-y-0.5" data-testid="dossier-decisions">
          <div className="text-xs uppercase tracking-wide text-text-muted">brain · 决策史</div>
          {brain.decisions.slice(0, 3).map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => d.focus && onOpenFile(d.focus)}
              className={
                'w-full text-left flex items-start gap-1 text-xs px-0.5 py-0.5 rounded ' +
                (d.focus ? 'hover:bg-surface-3 cursor-pointer' : 'cursor-default')
              }
              title={d.focus ? `打开 ${d.focus}` : undefined}
            >
              <span
                className="px-1 rounded text-xs shrink-0 mt-px"
                style={{ background: d.outcome === 'passed' ? 'var(--color-success)' : 'var(--color-warning)', color: 'var(--color-surface-0)' }}
              >
                {d.outcome === 'passed' ? '通过' : '改过'}
              </span>
              <span className="text-text-secondary truncate">{decisionWhy(d)}</span>
            </button>
          ))}
        </div>
      ) : null,
    blastDecisions:
      brain.blastDecisions.length > 0 ? (
        <div className="space-y-0.5" data-testid="dossier-blast-decisions">
          <div className="text-xs uppercase tracking-wide text-text-muted">影响半径上的决策</div>
          {brain.blastDecisions.slice(0, 2).map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => d.focus && onOpenFile(d.focus)}
              className={
                'w-full text-left flex items-start gap-1 text-xs px-0.5 py-0.5 rounded ' +
                (d.focus ? 'hover:bg-surface-3 cursor-pointer' : 'cursor-default')
              }
              title={d.focus ? `打开 ${d.focus}` : undefined}
            >
              <span className="px-1 rounded text-xs shrink-0 mt-px bg-surface-3 text-text-muted">下游</span>
              <span className="text-text-muted truncate">{decisionWhy(d)}</span>
            </button>
          ))}
        </div>
      ) : null,
    coupling:
      brain.coupling.length > 0 ? (
        <div className="space-y-0.5" data-testid="dossier-coupling">
          <div className="text-xs uppercase tracking-wide text-text-muted">隐藏耦合 · 非导入（共享表/事件/接口/开关）</div>
          {brain.coupling.slice(0, 4).map((c, i) => {
            const other = c.from === brain.focus ? c.to : c.from
            return (
              <button
                key={i}
                type="button"
                onClick={() => onPick(other)}
                className="w-full text-left flex items-center gap-1 text-xs px-0.5 py-0.5 rounded hover:bg-surface-3"
                title={`与 ${other} 共享 ${c.kind}:${c.key} — 点击钻入`}
              >
                <span className="px-1 rounded text-xs shrink-0" style={{ background: 'var(--color-purple, #a78bfa)', color: 'var(--color-surface-0)' }}>
                  {c.kind}
                </span>
                <span className="text-text-secondary truncate font-mono">{c.key}</span>
                <span className="text-text-muted shrink-0">↔ {other.split('/').slice(-1)[0]}</span>
              </button>
            )
          })}
        </div>
      ) : null,
    history:
      brain.history.length > 0 ? (
        <div className="space-y-0.5" data-testid="dossier-history">
          <div className="text-xs uppercase tracking-wide text-text-muted">git · 谁改过 / 为什么（点击看 Change Lens）</div>
          {brain.history.slice(0, 4).map((c) => (
            <button
              key={c.hash}
              type="button"
              onClick={() => onCommitLens(c.hash)}
              className="w-full text-left flex items-start gap-1 text-xs px-0.5 py-0.5 rounded hover:bg-surface-3"
              title={`计算该提交的 Change Lens：${c.subject}`}
            >
              <span className="px-1 rounded text-xs shrink-0 mt-px bg-surface-3 text-text-muted">
                {c.author.split(/\s+/)[0]?.slice(0, 6) || 'git'}
              </span>
              <span className="text-text-secondary truncate">{c.subject}</span>
            </button>
          ))}
        </div>
      ) : null
  }

  // Intent (#1): pin the matching facet first, keep the rest in default order.
  const defaultOrder = ['flags', 'impact', 'coupling', 'trust', 'decisions', 'history', 'blastDecisions']
  const lead = leadBlock(brain.intent)
  const order = lead ? [lead, ...defaultOrder.filter((k) => k !== lead)] : defaultOrder

  return (
    <div className="mt-1.5 space-y-1.5" data-testid="map-dossier">
      {/* Verdict (#2): the <60s answer, pinned on top. */}
      <div
        className="flex items-baseline gap-1.5 rounded px-1.5 py-1"
        style={{ background: `color-mix(in srgb, ${hs.color} 14%, transparent)` }}
        data-testid="dossier-verdict"
        data-level={brain.health.level}
      >
        <span className="text-xs font-semibold shrink-0" style={{ color: hs.color }}>{hs.label}</span>
        <span className="text-xs text-text-secondary leading-snug">{brain.health.reason}</span>
      </div>

      {/* Identity + topology */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-mono text-xs text-text-primary truncate" title={brain.focus}>{shortenModuleId(brain.focus)}</span>
        <span className="px-1 rounded text-xs bg-surface-3 text-text-secondary shrink-0">
          {ROLE_LABEL[brain.role]} · 入{brain.fanIn}/出{brain.fanOut}
        </span>
      </div>
      <div className="text-xs text-text-muted">
        被 <span className="text-text-secondary">{brain.dependents.length}</span> 个依赖 · 依赖{' '}
        <span className="text-text-secondary">{brain.dependencies.length}</span> 个
        {fresh && <span className="ml-1.5" data-testid="dossier-freshness">· 最近变更 {fresh}</span>}
      </div>

      {/* Disambiguation: other modules that also matched the query. */}
      {brain.alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" data-testid="dossier-alternatives">
          <span className="text-xs text-text-muted">其他匹配</span>
          {brain.alternatives.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className="px-1 rounded text-xs font-mono bg-surface-2 border border-border text-text-secondary hover:text-text-primary hover:border-border-focus"
              title={`切到 ${id}`}
            >
              {shortenModuleId(id).split('/').slice(-2).join('/')}
            </button>
          ))}
        </div>
      )}

      {annotations.length > 0 && (
        <div className="space-y-0.5" data-testid="dossier-annotations">
          <div className="text-xs uppercase tracking-wide text-text-muted">插件标注</div>
          {annotations.slice(0, 4).map((a, i) => (
            <div key={i} className="flex items-start gap-1 text-xs">
              <span className="px-1 rounded text-xs shrink-0 mt-px" style={{ background: 'var(--color-purple, #a78bfa)', color: 'var(--color-surface-0)' }}>
                {a.label}
              </span>
              {a.note && <span className="text-text-secondary truncate">{a.note}</span>}
            </div>
          ))}
        </div>
      )}

      {order.map((key) => {
        const block = blocks[key]
        if (!block) return null
        const isLead = key === lead
        return (
          <div key={key} className={isLead ? 'border-l-2 border-accent pl-1.5' : undefined} data-lead={isLead || undefined}>
            {block}
          </div>
        )
      })}

      <button
        type="button"
        onClick={() => onSendToChat(brain)}
        className="w-full text-xs px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-border-focus"
        data-testid="dossier-send-to-chat"
        title="把这份档案作为上下文发给对话"
      >
        发给对话 ↗
      </button>
    </div>
  )
}
