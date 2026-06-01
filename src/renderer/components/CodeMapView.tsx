/**
 * Presentational Code System Map — renders the module dependency graph (derived
 * from real imports) plus the comprehension overlays: invariant regions
 * (protected globs) glow, the last crew change's blast radius lights up, and
 * live crew agents appear on the module they're working in. Pure view: data is
 * fetched by the consumer (see `useCodeMapData`), so it can be embedded both in
 * the full-screen Code Map and side-by-side with the Crew console.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../stores/app-store'
import { useCrewStore } from '../stores/crew-store'
import { useEditorStore } from '../stores/editor-store'
import { useToastStore } from '../stores/toast-store'
import { isProtectedPath } from '../../shared/comprehension-router'
import { forceLayout } from '../lib/force-layout'
import { dirOf, transitiveImpact } from '../../shared/code-map'
import type { CodeMap as CodeMapData, CodeModule, CouplingEdge } from '../../shared/code-map'
import type { BehaviorSignalKind } from '../../shared/behavior-delta'
import type { GateDecision } from '../../shared/types'

interface Node extends CodeModule {
  x: number
  y: number
  rad: number
}

/** Big repos (hundreds of modules) collapse into an unreadable blob, so the
 * canvas shows the largest N modules; the header still reports the true totals. */
const MAX_NODES = 48
/** Only the largest few nodes get a text label, to keep the canvas legible. */
const MAX_LABELS = 18

/** Reduce a map to its largest N modules + the edges among them. */
function capMap(map: CodeMapData, cap: number): { modules: CodeModule[]; edges: CodeMapData['edges']; total: number } {
  if (map.modules.length <= cap) return { modules: map.modules, edges: map.edges, total: map.modules.length }
  const modules = [...map.modules].sort((a, b) => b.fileCount - a.fileCount).slice(0, cap)
  const ids = new Set(modules.map((m) => m.id))
  return { modules, edges: map.edges.filter((e) => ids.has(e.from) && ids.has(e.to)), total: map.modules.length }
}

import { shortenModuleId } from '../../shared/code-map'

function shortLabel(id: string): string {
  const s = shortenModuleId(id)
  const segs = s.split('/')
  return segs.length <= 2 ? s : segs.slice(-2).join('/')
}

/** Color a behavior signal by severity: breaking contract = danger. */
function sigColor(kind: BehaviorSignalKind): string {
  if (kind === 'api-removed' || kind === 'api-changed' || kind === 'return-shape') return 'var(--color-danger)'
  if (kind === 'side-effect') return 'var(--color-warning)'
  if (kind === 'route') return 'var(--color-accent)'
  return 'var(--color-text-muted)' // api-added — additive, low risk
}

/** Compact badge text for a behavior signal kind. */
function sigLabel(kind: BehaviorSignalKind): string {
  switch (kind) {
    case 'api-added':
      return 'added'
    case 'api-removed':
      return 'removed'
    case 'api-changed':
      return 'changed'
    case 'return-shape':
      return 'return'
    case 'side-effect':
      return 'effect'
    case 'route':
      return 'route'
  }
}

function layout(modules: CodeModule[], edges: CodeMapData['edges'], width: number, height: number): Node[] {
  const maxFiles = Math.max(1, ...modules.map((m) => m.fileCount))
  const pos = forceLayout(
    modules.map((m) => ({ id: m.id, weight: m.fileCount })),
    edges,
    { width, height }
  )
  return modules.map((m) => ({
    ...m,
    x: pos[m.id]?.x ?? width / 2,
    y: pos[m.id]?.y ?? height / 2,
    rad: 14 + Math.sqrt(m.fileCount / maxFiles) * 26
  }))
}

interface Props {
  map: CodeMapData | null
  loading: boolean
  error: string | null
  width?: number
  height?: number
  /** Called after a file is opened (e.g. to dismiss a host modal). */
  onOpenFile?: () => void
  /** Modules changed since the human last caught up (Map Delta overlay). */
  deltaModuleIds?: Set<string>
  /** Modules carrying comprehension debt (high-risk, never confirmed). */
  debtModuleIds?: Set<string>
  /** "Ask the Map" highlight: the focus module + its related set. */
  queryFocus?: string | null
  queryModuleIds?: Set<string>
  /** Hidden-coupling edges (non-import: shared table/event/route/flag). */
  couplingEdges?: CouplingEdge[]
  /** Pre-dispatch prediction: modules a pending task is predicted to touch. */
  predictModuleIds?: Set<string>
  /** Comprehension replay: modules changed at the scrubbed-to moment. */
  replayModuleIds?: Set<string>
}

export function CodeMapView({
  map,
  loading,
  error,
  width = 760,
  height = 460,
  onOpenFile,
  deltaModuleIds,
  debtModuleIds,
  queryFocus,
  queryModuleIds,
  couplingEdges,
  predictModuleIds,
  replayModuleIds
}: Props): JSX.Element {
  const workspacePath = useAppStore((s) => s.workspacePath)
  const protectedGlobs = useAppStore((s) => s.protectedGlobs)
  const focusedModule = useAppStore((s) => s.focusedModule)
  const decisionsRev = useAppStore((s) => s.decisionsRev)
  const lens = useCrewStore((s) => s.lens)
  const crewAgents = useCrewStore((s) => s.agents)
  const [selected, setSelected] = useState<CodeModule | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<GateDecision[]>([])

  // Living Map: load the Brain's gate decisions to hang on module nodes.
  useEffect(() => {
    if (!map || typeof window.kairoAPI?.getGateDecisions !== 'function') return
    let cancelled = false
    void window.kairoAPI
      .getGateDecisions(workspacePath ?? undefined)
      .then((res) => {
        if (!cancelled && res?.ok) setDecisions(res.decisions)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, decisionsRev, map !== null])

  // When a crew chip asks to focus a module, select the matching node here.
  useEffect(() => {
    if (!focusedModule || !map) return
    const match = (id: string): boolean =>
      id === focusedModule || id.startsWith(`${focusedModule}/`) || focusedModule.startsWith(`${id}/`)
    const hit =
      map.modules.find((m) => m.id === focusedModule) ?? map.modules.find((m) => match(m.id))
    if (hit) setSelected(hit)
  }, [focusedModule, map])

  const vmap = map ? capMap(map, MAX_NODES) : null
  const nodes = vmap ? layout(vmap.modules, vmap.edges, width, height) : []
  const visibleEdges = vmap?.edges ?? []
  const posById = new Map(nodes.map((n) => [n.id, n]))
  // Largest nodes get labels; the rest stay clean (full id on hover).
  const labelIds = new Set([...nodes].sort((a, b) => b.fileCount - a.fileCount).slice(0, MAX_LABELS).map((n) => n.id))
  const hiddenCount = (vmap?.total ?? 0) - nodes.length

  // Hover: route the eye to the hovered module's dependency subgraph. Imports
  // (outgoing) + dependents (incoming) come from the FULL graph, so the card
  // tells the truth even about edges to collapsed modules.
  const hoverDeps = useMemo(() => {
    if (!hovered || !map) return null
    const imports = map.edges.filter((e) => e.from === hovered).sort((a, b) => b.weight - a.weight)
    const dependents = map.edges.filter((e) => e.to === hovered).sort((a, b) => b.weight - a.weight)
    return { imports, dependents }
  }, [hovered, map])
  // Neighbors among the *visible* nodes, for on-canvas highlight/dim.
  const neighbors = new Set<string>()
  if (hovered) {
    for (const e of visibleEdges) {
      if (e.from === hovered) neighbors.add(e.to)
      if (e.to === hovered) neighbors.add(e.from)
    }
  }
  const isRelated = (id: string): boolean => id === hovered || neighbors.has(id)

  // The hover card is interactive (click a dep to drill in, click a behavior
  // signal to jump to its file). Moving the cursor from a node onto the card
  // would otherwise fire the node's mouseleave and dismiss the card, so closing
  // is deferred and cancelled when the cursor lands on the card.
  const closeTimer = useRef<number | null>(null)
  const cancelClose = (): void => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = (): void => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setHovered(null), 160)
  }
  useEffect(() => cancelClose, [])

  // Drill into a dependency from the hover card → select that module so its
  // file list (drawer) opens; works even for collapsed modules (full list).
  const selectModule = (id: string): void => {
    const m = map?.modules.find((mm) => mm.id === id)
    if (!m) return
    cancelClose()
    setHovered(null)
    setSelected(m)
  }

  const openModuleFile = (relPath: string): void => {
    const abs = workspacePath ? `${workspacePath}/${relPath}` : relPath
    void window.kairoAPI
      .readFile(abs)
      .then((res) => {
        if (res.ok && res.content !== undefined) {
          useEditorStore.getState().openFile({ path: abs, name: relPath.split('/').pop() ?? relPath, content: res.content })
          onOpenFile?.()
        } else {
          useToastStore.getState().addToast({ type: 'error', message: res.error ?? 'Could not open file' })
        }
      })
      .catch(() => useToastStore.getState().addToast({ type: 'error', message: 'Could not open file' }))
  }

  // Overlays.
  const isProtected = (id: string): boolean => isProtectedPath(`${id}/x.ts`, protectedGlobs)
  const matchesModule = (id: string, c: string): boolean =>
    id === c || id.startsWith(`${c}/`) || c.startsWith(`${id}/`)
  const changedModules = new Set(lens?.blastRadius.map((b) => b.module) ?? [])
  const isChanged = (id: string): boolean => [...changedModules].some((c) => matchesModule(id, c))

  // Transitive blast radius ("system > diff"): every module that transitively
  // depends on a changed one could break. Computed over the FULL graph so it's
  // truthful even when some downstream modules are collapsed off-canvas.
  const impact = useMemo(
    () => (map && changedModules.size > 0 ? transitiveImpact(map.edges, [...changedModules]) : new Map<string, number>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, lens]
  )
  /** Downstream depth for a visible node (>0 means impacted but not changed). */
  const impactDepth = (id: string): number => {
    let best = Infinity
    for (const [m, d] of impact) if (d > 0 && matchesModule(id, m)) best = Math.min(best, d)
    return best === Infinity ? 0 : best
  }
  const downstreamCount = [...impact.values()].filter((d) => d > 0).length
  // Contract-change overlay: modules whose public behavior changed (export
  // removed/changed or return shape changed) — the highest-leverage places.
  const contractModules = new Set(
    (lens?.behaviorDelta ?? [])
      .filter((s) => s.kind === 'api-removed' || s.kind === 'api-changed' || s.kind === 'return-shape')
      .map((s) => dirOf(s.file))
  )
  const isContractChanged = (id: string): boolean =>
    [...contractModules].some((c) => matchesModule(id, c))

  // Architecture deviations (inverted signal): the cross-module edges this
  // change newly introduced — keyed "from→to" so the map can color those edges.
  const deviationEdges = new Map<string, 'new-dependency' | 'cyclic-dependency'>()
  for (const d of lens?.deviations ?? []) {
    deviationEdges.set(`${d.fromModule}→${d.toModule}`, d.kind)
    if (d.kind === 'cyclic-dependency') deviationEdges.set(`${d.toModule}→${d.fromModule}`, d.kind)
  }
  const edgeDeviation = (from: string, to: string): 'new-dependency' | 'cyclic-dependency' | undefined =>
    deviationEdges.get(`${from}→${to}`)

  // Hidden-coupling edges among VISIBLE nodes, deduped per module pair. "Hidden"
  // = no import edge between them (the breakages the import graph can't see).
  const importPairs = new Set(visibleEdges.map((e) => [e.from, e.to].sort().join('|')))
  const couplingPairs = (() => {
    const seen = new Set<string>()
    const out: Array<{ from: string; to: string; kind: string; key: string; hidden: boolean }> = []
    for (const c of couplingEdges ?? []) {
      if (!posById.has(c.from) || !posById.has(c.to)) continue
      const pair = [c.from, c.to].sort().join('|')
      if (seen.has(pair)) continue
      seen.add(pair)
      out.push({ ...c, hidden: !importPairs.has(pair) })
    }
    return out
  })()

  // Living Map overlay: which modules a human has reviewed at the gate, and when.
  const reviewOf = (id: string): { count: number; latest: number } | null => {
    let count = 0
    let latest = 0
    for (const d of decisions) {
      if (d.modules.some((m) => matchesModule(id, m))) {
        count += 1
        if (d.at > latest) latest = d.at
      }
    }
    return count > 0 ? { count, latest } : null
  }

  // Brain on the map: the human decisions hanging on a module (newest first),
  // so a node carries its why/history (what was reviewed, the question, when).
  const decisionsOf = (id: string): GateDecision[] =>
    decisions
      .filter((d) => d.modules.some((m) => matchesModule(id, m)))
      .sort((a, b) => b.at - a.at)

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="relative flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center" data-testid="code-map">
        {loading && !map && <div className="text-text-muted text-sm">Scanning workspace…</div>}
        {error && <div className="text-danger text-sm">{error}</div>}
        {!error && map && map.modules.length === 0 && (
          <div className="text-text-muted text-sm">No source modules found. Open a workspace (⌘O).</div>
        )}
        {!error && map && map.modules.length > 0 && (
          <svg width={width} height={height} role="img" aria-label="Code system map">
            {/* edges */}
            {visibleEdges.map((e, i) => {
              const a = posById.get(e.from)
              const b = posById.get(e.to)
              if (!a || !b) return null
              const onHover = hovered != null && (e.from === hovered || e.to === hovered)
              const dimmed = hovered != null && !onHover
              const devKind = edgeDeviation(e.from, e.to)
              const devColor =
                devKind === 'cyclic-dependency'
                  ? 'var(--color-danger)'
                  : devKind === 'new-dependency'
                    ? 'var(--color-warning)'
                    : null
              const stroke = devColor ?? (onHover ? 'var(--color-accent)' : 'var(--color-border)')
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={stroke}
                  strokeWidth={Math.min(4, 0.6 + e.weight * 0.5) + (onHover || devColor ? 1 : 0)}
                  strokeOpacity={dimmed ? 0.12 : devColor ? 0.95 : onHover ? 0.9 : 0.5}
                  {...(devKind ? { strokeDasharray: '4 2', 'data-testid': `map-deviation-${e.from}-${e.to}` } : {})}
                />
              )
            })}
            {/* hidden-coupling edges (non-import: shared table/event/route/flag) */}
            {couplingPairs.map((c, i) => {
              const a = posById.get(c.from)!
              const b = posById.get(c.to)!
              const onHover = hovered != null && (c.from === hovered || c.to === hovered)
              if (hovered != null && !onHover) return null
              // A gentle arc so it reads distinct from the straight import lines.
              const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12
              const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12
              return (
                <path
                  key={`coup-${i}`}
                  d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
                  fill="none"
                  stroke="var(--color-purple, #a78bfa)"
                  strokeWidth={onHover ? 2 : 1.2}
                  strokeOpacity={onHover ? 0.9 : 0.4}
                  strokeDasharray="1 4"
                  data-testid={`map-coupling-${c.from}-${c.to}`}
                />
              )
            })}
            {/* nodes */}
            {nodes.map((n) => {
              const changed = isChanged(n.id)
              const prot = isProtected(n.id)
              const fill = changed ? 'var(--color-accent)' : 'var(--color-surface-3)'
              const stroke = prot ? 'var(--color-warning)' : 'var(--color-border)'
              const isSel = selected?.id === n.id
              const contract = isContractChanged(n.id)
              const review = reviewOf(n.id)
              // Downstream of a change (transitive): impacted but not itself changed.
              const dep = changed ? 0 : impactDepth(n.id)
              // Changed since the human last caught up (Map Delta overlay).
              const isDelta = deltaModuleIds?.has(n.id) ?? false
              // Carries comprehension debt (high-risk, never confirmed).
              const isDebt = debtModuleIds?.has(n.id) ?? false
              // "Ask the Map" query: highlight the focus + related, dim the rest.
              const queryActive = (queryModuleIds?.size ?? 0) > 0
              const inQuery = queryModuleIds?.has(n.id) ?? false
              const isQueryFocus = queryFocus === n.id
              // Pre-dispatch prediction: a pending task is predicted to touch this.
              const isPredicted = predictModuleIds?.has(n.id) ?? false
              // Comprehension replay: changed at the scrubbed-to moment.
              const isReplay = replayModuleIds?.has(n.id) ?? false
              const dimNode =
                (hovered != null && !isRelated(n.id)) || (queryActive && !inQuery)
              return (
                <g
                  key={n.id}
                  onClick={() => setSelected(n)}
                  onMouseEnter={() => {
                    cancelClose()
                    setHovered(n.id)
                  }}
                  onMouseLeave={scheduleClose}
                  style={{ cursor: 'pointer', opacity: dimNode ? 0.22 : 1, transition: 'opacity 120ms' }}
                  data-testid={`map-node-${n.id}`}
                >
                  {/* Concise a11y label only; the rich detail lives in the
                      immediate hover card (avoids a delayed double tooltip). */}
                  <title>{n.id}</title>
                  {isReplay && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.rad + 4}
                      fill="var(--color-success)"
                      fillOpacity={0.18}
                      stroke="var(--color-success)"
                      strokeWidth={2}
                      data-testid={`map-replay-${n.id}`}
                    />
                  )}
                  {isPredicted && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.rad + 7}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth={2.5}
                      strokeDasharray="3 2"
                      strokeOpacity={0.85}
                      data-testid={`map-predicted-${n.id}`}
                    >
                      <animate attributeName="stroke-opacity" values="0.85;0.3;0.85" dur="1.4s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {isDebt && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.rad + 6}
                      fill="none"
                      stroke="var(--color-danger)"
                      strokeWidth={2}
                      strokeOpacity={0.7}
                      data-testid={`map-debt-${n.id}`}
                    />
                  )}
                  {isDelta && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.rad + 8}
                      fill="var(--color-accent)"
                      fillOpacity={0.12}
                      stroke="var(--color-accent)"
                      strokeWidth={1}
                      strokeOpacity={0.5}
                      data-testid={`map-delta-${n.id}`}
                    />
                  )}
                  {dep > 0 && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.rad + 5}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth={2}
                      strokeDasharray="2 3"
                      strokeOpacity={dep === 1 ? 0.55 : dep === 2 ? 0.35 : 0.22}
                      data-testid={`map-impact-${n.id}`}
                    />
                  )}
                  {review && (
                    <circle
                      cx={n.x - n.rad + 3}
                      cy={n.y + n.rad - 3}
                      r={4}
                      fill="var(--color-success)"
                      stroke="var(--color-surface-1)"
                      strokeWidth={1.5}
                      data-testid={`map-reviewed-${n.id}`}
                    />
                  )}
                  {contract && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.rad + 4}
                      fill="none"
                      stroke="var(--color-danger)"
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                      data-testid={`map-contract-${n.id}`}
                    >
                      <animate attributeName="stroke-opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.rad}
                    fill={isQueryFocus ? 'var(--color-accent)' : fill}
                    stroke={isQueryFocus || isSel ? 'var(--color-text-primary)' : stroke}
                    strokeWidth={isQueryFocus ? 3 : isSel ? 3 : prot ? 3 : 1.5}
                    {...(isQueryFocus ? { 'data-testid': `map-query-focus-${n.id}` } : {})}
                  />
                  {(labelIds.has(n.id) || isSel) && (
                    <text
                      x={n.x}
                      y={n.y + n.rad + 12}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--color-text-secondary)"
                    >
                      {shortLabel(n.label)}
                    </text>
                  )}
                  <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" fontSize={10} fill="var(--color-text-primary)">
                    {n.fileCount}
                  </text>
                </g>
              )
            })}
            {/* Live agents working on the system (World overlay). */}
            {crewAgents
              .filter((a) => a.currentModule && posById.has(a.currentModule))
              .map((a, i) => {
                const node = posById.get(a.currentModule!)!
                const live = a.status === 'running'
                return (
                  <g key={`agent-${a.id}`} data-testid={`map-agent-${a.id}`}>
                    <circle
                      cx={node.x + node.rad - 4}
                      cy={node.y - node.rad + 4 + i * 4}
                      r={5}
                      fill={live ? 'var(--color-success)' : 'var(--color-text-muted)'}
                      stroke="var(--color-surface-1)"
                      strokeWidth={1.5}
                    >
                      {live && <animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite" />}
                    </circle>
                  </g>
                )
              })}
            {/* Hover card: route the eye to the hovered module's dependency
                subgraph + observable behavior changes. Interactive — click a
                dependency to drill into that module, or a behavior signal to
                jump straight to the file whose contract/effects changed. */}
            {hovered &&
              hoverDeps &&
              (() => {
                const hn = posById.get(hovered)
                if (!hn) return null
                const CW = 236
                const imports = hoverDeps.imports.slice(0, 5)
                const dependents = hoverDeps.dependents.slice(0, 5)
                // Behavior Delta restricted to this module — the highest-leverage
                // "what actually changed" rows, each linking to its file.
                const signals = (lens?.behaviorDelta ?? []).filter((s) =>
                  matchesModule(hovered, dirOf(s.file))
                )
                // Deviations touching this module (as source or target).
                const devs = (lens?.deviations ?? []).filter(
                  (d) => d.fromModule === hovered || d.toModule === hovered
                )
                // Brain: human decisions hanging on this module (newest first).
                const brain = decisionsOf(hovered).slice(0, 3)
                const rows =
                  2 + imports.length + dependents.length + signals.length * 2 + devs.length + brain.length + 2
                const CH = Math.min(380, 48 + rows * 15)
                let cx = hn.x + hn.rad + 10
                if (cx + CW > width) cx = hn.x - hn.rad - 10 - CW
                cx = Math.max(4, Math.min(cx, width - CW - 4))
                const cy = Math.max(4, Math.min(hn.y - 24, height - CH - 4))
                const flags: Array<{ t: string; c: string }> = []
                if (isProtected(hovered)) flags.push({ t: 'invariant', c: 'var(--color-warning)' })
                if (isChanged(hovered)) flags.push({ t: 'changed', c: 'var(--color-accent)' })
                if (isContractChanged(hovered)) flags.push({ t: 'contract', c: 'var(--color-danger)' })
                const rev = reviewOf(hovered)
                if (rev) flags.push({ t: `reviewed ×${rev.count}`, c: 'var(--color-success)' })
                const hm = map?.modules.find((m) => m.id === hovered)
                return (
                  <foreignObject x={cx} y={cy} width={CW} height={CH}>
                    <div
                      onMouseEnter={cancelClose}
                      onMouseLeave={scheduleClose}
                      className="rounded-md border border-border bg-surface-0/95 shadow-lg px-2.5 py-2 text-[11px] leading-tight overflow-y-auto"
                      style={{ maxHeight: CH }}
                      data-testid="map-hover-card"
                    >
                      <div className="font-mono text-text-primary truncate" title={hovered}>{shortenModuleId(hovered)}</div>
                      <div className="text-[10px] text-text-muted mb-1">
                        {hm ? `${hm.fileCount} files · ${hm.loc} LOC` : ''}
                      </div>
                      {isChanged(hovered) && downstreamCount > 0 && (
                        <div className="text-[10px] mb-1" style={{ color: 'var(--color-accent)' }}>
                          改动中心 · 波及 {downstreamCount} 个下游模块
                        </div>
                      )}
                      {!isChanged(hovered) && impactDepth(hovered) > 0 && (
                        <div className="text-[10px] mb-1" style={{ color: 'var(--color-accent)' }}>
                          受最近改动影响（{impactDepth(hovered)} 跳下游）
                        </div>
                      )}
                      {flags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {flags.map((f) => (
                            <span key={f.t} className="px-1 rounded text-[9px]" style={{ background: f.c, color: 'var(--color-surface-0)' }}>{f.t}</span>
                          ))}
                        </div>
                      )}
                      {signals.length > 0 && (
                        <div className="mb-1.5 -mx-0.5">
                          <div className="text-[9px] uppercase tracking-wide text-text-muted px-0.5 mb-0.5">behavior delta</div>
                          {signals.map((s, si) => (
                            <button
                              key={`s-${si}`}
                              type="button"
                              onClick={() => openModuleFile(s.file)}
                              className="w-full text-left px-1 py-0.5 rounded hover:bg-surface-3 group"
                              title={`打开 ${s.file}`}
                            >
                              <div className="flex items-center gap-1">
                                <span className="px-1 rounded text-[9px] shrink-0" style={{ background: sigColor(s.kind), color: 'var(--color-surface-0)' }}>{sigLabel(s.kind)}</span>
                                <span className="truncate text-text-secondary group-hover:text-text-primary">{s.detail}</span>
                              </div>
                              <div className="text-[9px] text-text-muted truncate pl-0.5">{s.file.split('/').pop()} ↗</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {devs.length > 0 && (
                        <div className="mb-1.5 -mx-0.5" data-testid="hover-deviations">
                          <div className="text-[9px] uppercase tracking-wide text-text-muted px-0.5 mb-0.5">architecture deviation</div>
                          {devs.map((d, di) => (
                            <button
                              key={`dev-${di}`}
                              type="button"
                              onClick={() => openModuleFile(d.file)}
                              className="w-full text-left px-1 py-0.5 rounded hover:bg-surface-3 flex items-center gap-1"
                              title={`打开 ${d.file}`}
                            >
                              <span
                                className="px-1 rounded text-[9px] shrink-0"
                                style={{ background: d.kind === 'cyclic-dependency' ? 'var(--color-danger)' : 'var(--color-warning)', color: 'var(--color-surface-0)' }}
                              >
                                {d.kind === 'cyclic-dependency' ? 'cycle' : 'new dep'}
                              </span>
                              <span className="truncate text-text-secondary">{d.detail}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {brain.length > 0 && (
                        <div className="mb-1.5 -mx-0.5" data-testid="hover-brain">
                          <div className="text-[9px] uppercase tracking-wide text-text-muted px-0.5 mb-0.5">brain · 决策史</div>
                          {brain.map((d, bi) => (
                            <button
                              key={`brain-${bi}`}
                              type="button"
                              onClick={() => d.focus && openModuleFile(d.focus)}
                              className={
                                'w-full text-left px-1 py-0.5 rounded flex items-start gap-1 ' +
                                (d.focus ? 'hover:bg-surface-3 cursor-pointer' : 'cursor-default')
                              }
                              title={d.focus ? `打开 ${d.focus}` : undefined}
                            >
                              <span
                                className="px-1 rounded text-[9px] shrink-0 mt-px"
                                style={{ background: d.outcome === 'passed' ? 'var(--color-success)' : 'var(--color-warning)', color: 'var(--color-surface-0)' }}
                              >
                                {d.outcome === 'passed' ? '通过' : '改过'}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-text-secondary">{d.rationale ?? d.question ?? '已在闸门确认'}</span>
                                <span className="block text-[9px] text-text-muted">{new Date(d.at).toLocaleDateString()}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="text-[10px] text-text-muted">
                        imports → <span className="text-text-secondary">{hoverDeps.imports.length}</span> · used by ← <span className="text-text-secondary">{hoverDeps.dependents.length}</span>
                      </div>
                      {imports.length > 0 && (
                        <div className="mt-1">
                          {imports.map((e) => (
                            <button
                              key={`i-${e.to}`}
                              type="button"
                              onClick={() => selectModule(e.to)}
                              className="w-full flex justify-between gap-2 px-1 py-0.5 rounded text-text-secondary hover:bg-surface-3 hover:text-text-primary"
                              title={`钻入 ${e.to}`}
                            >
                              <span className="truncate">→ {shortLabel(e.to)}</span>
                              <span className="text-text-muted shrink-0">×{e.weight}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {dependents.length > 0 && (
                        <div className="mt-1">
                          {dependents.map((e) => (
                            <button
                              key={`d-${e.from}`}
                              type="button"
                              onClick={() => selectModule(e.from)}
                              className="w-full flex justify-between gap-2 px-1 py-0.5 rounded text-text-secondary hover:bg-surface-3 hover:text-text-primary"
                              title={`钻入 ${e.from}`}
                            >
                              <span className="truncate">← {shortLabel(e.from)}</span>
                              <span className="text-text-muted shrink-0">×{e.weight}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {imports.length === 0 && dependents.length === 0 && signals.length === 0 && (
                        <div className="mt-1 text-text-muted">no cross-module deps</div>
                      )}
                    </div>
                  </foreignObject>
                )
              })()}
          </svg>
        )}
        {hiddenCount > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-text-muted bg-surface-0/80 px-2 py-0.5 rounded">
            最大 {nodes.length} 个模块（共 {vmap?.total}），其余 {hiddenCount} 个已折叠
          </div>
        )}
      </div>

      {/* Drill-down: files in the selected module → open in the editor. */}
      {selected && (
        <div className="w-64 shrink-0 border-l border-border bg-surface-0 flex flex-col" data-testid="map-drawer">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[12px] font-mono text-text-primary truncate" title={selected.label}>{shortenModuleId(selected.label)}</span>
            <button type="button" onClick={() => setSelected(null)} className="text-text-muted hover:text-text-primary text-xs px-1">&#10005;</button>
          </div>
          <div className="px-3 py-1.5 text-[10px] text-text-muted">{selected.files.length} files · {selected.loc} LOC</div>
          <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
            {selected.files.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => openModuleFile(f)}
                className="w-full text-left px-2 py-1 rounded text-[12px] font-mono text-text-secondary hover:bg-surface-3 hover:text-text-primary truncate"
                title={f}
              >
                {f.split('/').pop()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
