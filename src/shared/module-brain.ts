/**
 * Module Brain — the answer behind "Ask the Map". Where {@link mapQuery} returns
 * pure topology (who depends on X / what X uses), `moduleBrain` fuses ALL five
 * Brain layers onto the queried module so a single glance answers "what is this,
 * can I trust it, and why is it the way it is" — without reading prose:
 *
 *   1. role/topology  — hub vs leaf (fan-in/out on the real import graph)
 *   2. invariant      — is it a protected (contract) region?
 *   3. comprehension  — high-risk changes here nobody ever confirmed (debt)
 *   4. time           — how many times it changed since you last caught up
 *   5. trust          — per-module verify/auto rates from the change log
 *   + decision history on the module AND on its blast radius
 *   + an impact preview (changing it touches N downstream, M of them invariant)
 *
 * Constitution: "point, don't tell" — this returns the evidence to point AT,
 * not a paragraph to read. Pure + browser-safe.
 */

import { couplingForModule, transitiveImpact, type CodeMap, type CouplingEdge } from './code-map'
import { isProtectedPath } from './comprehension-router'
import { resolveQueryModule, resolveQueryModules } from './map-query'
import { computeComprehensionDebt } from './comprehension-debt'
import { commitsForModule, type GitCommit } from './git-brain'
import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'

/** What the human is really asking — routes the answer card's emphasis. */
export type MapIntent = 'overview' | 'dependents' | 'dependencies' | 'why' | 'safety' | 'changes'

export interface MapQueryIntent {
  intent: MapIntent
  /** The module term, with intent words stripped (may be empty). */
  term: string
}

/** A module's classification on the real import graph. */
export type ModuleRole = 'hub' | 'leaf' | 'connector' | 'isolated'

/** A one-glance verdict on whether the human should worry about this module. */
export type HealthLevel = 'healthy' | 'watch' | 'risk'
export interface ModuleHealth {
  level: HealthLevel
  /** Why — the single most important reason behind the level. */
  reason: string
}

/** Per-module trust signal, distilled from the workspace change log. */
export interface ModuleTrust {
  changes: number
  verified: number
  auto: number
  review: number
}

export interface ModuleImpact {
  /** Transitive downstream modules that could break if the focus changes. */
  downstream: number
  /** How many of those downstream modules are invariant (protected) regions. */
  protectedDownstream: number
  /** How many of those downstream modules already carry comprehension debt. */
  debtDownstream: number
}

export interface ModuleBrain {
  focus: string
  intent: MapIntent
  /** Transitive dependents (who, directly or not, depends ON the focus). */
  dependents: string[]
  /** Transitive dependencies (what the focus, directly or not, depends on). */
  dependencies: string[]
  role: ModuleRole
  /** Direct importers / direct imports (degree, not transitive). */
  fanIn: number
  fanOut: number
  /** Brain ①: this module is a protected invariant region. */
  invariant: boolean
  /** Brain ②: high-risk changes here nobody confirmed at a gate. */
  debt: number
  /** Brain ③: changes recorded on this module since the human last caught up. */
  deltaCount: number
  /** Brain ④: per-module trust signal. */
  trust: ModuleTrust
  /** Brain ⑤: gate decisions hanging on the focus (newest first). */
  decisions: GateDecision[]
  /** Decisions hanging on the blast radius (downstream), excluding the focus. */
  blastDecisions: GateDecision[]
  impact: ModuleImpact
  /** The <60s verdict: should you worry about this module, and why. */
  health: ModuleHealth
  /** Git history touching the module (the "why" for non-crew changes). */
  history: GitCommit[]
  /** Latest change time on the module (crew log + git), 0 if none — freshness. */
  lastChangeAt: number
  /** Other modules that also matched the query (disambiguation runners-up). */
  alternatives: string[]
  /** Hidden coupling: non-import edges (shared table/event/route/flag). */
  coupling: CouplingEdge[]
}

/** A module string `c` (from a change/decision) refers to map module `id`. */
function matchesModule(id: string, c: string): boolean {
  return id === c || id.startsWith(`${c}/`) || c.startsWith(`${id}/`)
}

// Intent keywords, both languages. Order matters: the first rule whose token is
// present wins, so the more specific / higher-signal intents come first. Bare
// "依赖" is intentionally excluded — it's ambiguous between the two directions.
const INTENT_RULES: ReadonlyArray<{ intent: MapIntent; tokens: readonly string[] }> = [
  { intent: 'why', tokens: ['为什么', '为何', '凭什么', 'why', 'rationale', '决策', '历史', 'history'] },
  { intent: 'safety', tokens: ['安全', '风险', '能信', '可信', '靠谱', '敢改', 'safe', 'safety', 'risk', 'risky', 'trust'] },
  { intent: 'changes', tokens: ['变了', '变化', '改了', '改动', '最近', 'changed', 'recent', 'delta'] },
  {
    intent: 'dependents',
    tokens: ['谁依赖', '被谁', '依赖它', '影响', '波及', '下游', 'used by', 'usedby', 'callers', 'caller', 'who depends', 'who uses', 'dependents', 'impact']
  },
  {
    intent: 'dependencies',
    tokens: ['依赖谁', '依赖什么', '它依赖', '上游', 'depends on', 'dependson', 'what does', 'uses', 'imports', 'dependencies']
  }
]

const ALL_TOKENS: readonly string[] = [...INTENT_RULES.flatMap((r) => r.tokens)].sort(
  (a, b) => b.length - a.length
)

/**
 * Parse a free-text query into an intent + module term — zero-LLM, pure. This is
 * "point, don't tell" applied to the search box itself: you ask a question and
 * the answer card emphasizes the matching facet, instead of forcing you to read
 * everything. Unknown phrasing falls back to `overview`.
 */
export function parseMapIntent(query: string): MapQueryIntent {
  const lower = query.toLowerCase()
  let intent: MapIntent = 'overview'
  for (const rule of INTENT_RULES) {
    if (rule.tokens.some((t) => lower.includes(t.toLowerCase()))) {
      intent = rule.intent
      break
    }
  }
  let term = lower
  for (const tok of ALL_TOKENS) term = term.split(tok.toLowerCase()).join(' ')
  // Drop question particles/punctuation + english filler left after stripping a
  // multi-word phrase (e.g. "who depends" leaves a dangling "on"/"is").
  term = term
    .replace(/[?？。！!,，、呢吗啊的]/g, ' ')
    .replace(/\b(on|of|is|are|the|a|it|does|do|what|which)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { intent, term }
}

export interface ModuleBrainInput {
  map: CodeMap
  query: string
  decisions: GateDecision[]
  changes: ChangeRecord[]
  protectedGlobs: string[]
  /** The human's "last caught up" anchor (ms epoch); 0 means never. */
  lastSeen: number
  /** Git commits (whole workspace), for non-crew history + freshness. */
  commits?: GitCommit[]
  /** Hidden-coupling edges (whole workspace), for the focus's non-import links. */
  couplingEdges?: CouplingEdge[]
}

/**
 * Resolve a free-text query to a module and assemble its full Brain dossier.
 * Returns null when the query resolves to no module (so the UI can say "no
 * match" exactly as before).
 */
export function moduleBrain(input: ModuleBrainInput): ModuleBrain | null {
  const { map, query, decisions, changes, protectedGlobs, lastSeen, commits = [], couplingEdges = [] } = input
  const { intent, term } = parseMapIntent(query)
  const effectiveQuery = term || query
  const focus = resolveQueryModule(map, effectiveQuery)
  if (!focus) return null

  // Topology: transitive dependents / dependencies + direct degree for role.
  const impactMap = transitiveImpact(map.edges, [focus])
  const dependents = [...impactMap.keys()].filter((id) => id !== focus)
  const dependencies = dependencyClosure(map, focus)
  const fanIn = new Set(map.edges.filter((e) => e.to === focus).map((e) => e.from)).size
  const fanOut = new Set(map.edges.filter((e) => e.from === focus).map((e) => e.to)).size
  const role: ModuleRole =
    fanIn === 0 && fanOut === 0
      ? 'isolated'
      : fanIn >= 3
        ? 'hub'
        : fanIn === 0
          ? 'leaf'
          : 'connector'

  // Brain ①: invariant region (use a representative path inside the module).
  const invariant = isProtectedPath(`${focus}/x.ts`, protectedGlobs)

  // Brain ②: comprehension debt scoped to the focus.
  const debtAll = computeComprehensionDebt(changes, decisions)
  const debt = debtAll.items.filter((it) =>
    it.change.modules.some((m) => matchesModule(focus, m))
  ).length

  // Brain ③ + ④: time + trust, from the change log scoped to the focus.
  const onFocus = changes.filter((c) => c.modules.some((m) => matchesModule(focus, m)))
  const deltaCount = onFocus.filter((c) => c.at > lastSeen).length
  const trust: ModuleTrust = {
    changes: onFocus.length,
    verified: onFocus.filter((c) => c.verified === true).length,
    auto: onFocus.filter((c) => c.risk === 'auto').length,
    review: onFocus.filter((c) => c.risk === 'review').length
  }

  // Brain ⑤: decision history on the focus, and separately on its blast radius.
  const focusDecisions = decisions
    .filter((d) => d.modules.some((m) => matchesModule(focus, m)))
    .sort((a, b) => b.at - a.at)
  const focusDecisionSet = new Set(focusDecisions)
  const downstreamSet = new Set(dependents)
  const blastDecisions = decisions
    .filter(
      (d) =>
        !focusDecisionSet.has(d) &&
        d.modules.some((m) => [...downstreamSet].some((id) => matchesModule(id, m)))
    )
    .sort((a, b) => b.at - a.at)

  // Impact preview: of the transitive downstream, how many are invariant / in debt.
  const debtModuleSet = new Set(debtAll.modules)
  const protectedDownstream = dependents.filter((id) =>
    isProtectedPath(`${id}/x.ts`, protectedGlobs)
  ).length
  const debtDownstream = dependents.filter((id) =>
    [...debtModuleSet].some((m) => matchesModule(id, m))
  ).length

  const impact: ModuleImpact = {
    downstream: dependents.length,
    protectedDownstream,
    debtDownstream
  }

  // Git history on the focus (the "why" for non-crew changes) + freshness.
  const history = commitsForModule(commits, focus).slice(0, 6)
  const lastChangeAt = Math.max(
    0,
    ...onFocus.map((c) => c.at),
    ...history.map((c) => c.at)
  )

  // Disambiguation: other modules that also matched the query.
  const alternatives = resolveQueryModules(map, effectiveQuery, 5).filter((id) => id !== focus)

  // Hidden coupling: non-import links touching the focus.
  const coupling = couplingForModule(couplingEdges, focus)

  return {
    focus,
    intent,
    dependents,
    dependencies,
    role,
    fanIn,
    fanOut,
    invariant,
    debt,
    deltaCount,
    trust,
    decisions: focusDecisions,
    blastDecisions,
    impact,
    health: computeHealth({ invariant, debt, deltaCount, trust, impact }),
    history,
    lastChangeAt,
    alternatives,
    coupling
  }
}

/**
 * The <60s verdict (constitution #5): collapse the dossier's signals into one
 * level + the single most important reason. Ordered — the first matching rule
 * wins, so the loudest danger surfaces. Pure + deterministic.
 */
export function computeHealth(p: {
  invariant: boolean
  debt: number
  deltaCount: number
  trust: ModuleTrust
  impact: ModuleImpact
}): ModuleHealth {
  if (p.debt > 0) return { level: 'risk', reason: `理解债 ${p.debt}：高风险变更没人在闸门确认过` }
  if (p.invariant && p.deltaCount > 0)
    return { level: 'risk', reason: `不变量区有 ${p.deltaCount} 处变更待确认` }
  if (p.impact.debtDownstream > 0)
    return { level: 'risk', reason: `下游 ${p.impact.debtDownstream} 个带债模块会被波及` }
  if (p.deltaCount > 0) return { level: 'watch', reason: `${p.deltaCount} 处变更待你跟进` }
  if (p.trust.changes > 0 && p.trust.verified * 2 < p.trust.changes)
    return { level: 'watch', reason: `验证率偏低（${p.trust.verified}/${p.trust.changes} 跑了测试）` }
  if (p.impact.protectedDownstream > 0)
    return { level: 'watch', reason: `下游含 ${p.impact.protectedDownstream} 个不变量区，改动需谨慎` }
  if (p.invariant) return { level: 'watch', reason: '不变量区，改动需审批' }
  return { level: 'healthy', reason: '无未决变更、无理解债' }
}

/**
 * Render a dossier as compact markdown for grounding the agent (the "send to
 * chat" path). Stays evidence-shaped — facts the model can act on, not prose.
 */
export function moduleBrainToMarkdown(b: ModuleBrain): string {
  const verdict = b.health.level === 'risk' ? '🔴 RISK' : b.health.level === 'watch' ? '🟡 WATCH' : '🟢 HEALTHY'
  const lines: string[] = [
    `## Module dossier: \`${b.focus}\``,
    `- Verdict: ${verdict} — ${b.health.reason}`,
    `- Role: ${b.role} (fan-in ${b.fanIn} · fan-out ${b.fanOut})`,
    `- Topology: depended on by ${b.dependents.length} module(s), depends on ${b.dependencies.length}`
  ]
  if (b.invariant) lines.push('- ⚠️ Invariant region (protected/contract) — changes need approval')
  if (b.debt > 0) lines.push(`- 🔴 Comprehension debt: ${b.debt} high-risk change(s) never confirmed`)
  if (b.deltaCount > 0) lines.push(`- Δ ${b.deltaCount} change(s) since you last caught up`)
  if (b.trust.changes > 0) {
    lines.push(
      `- Trust: ${b.trust.changes} change(s) · ${b.trust.verified} verified · ${b.trust.auto} auto-passed · ${b.trust.review} reviewed`
    )
  }
  if (b.impact.downstream > 0) {
    const extra: string[] = []
    if (b.impact.protectedDownstream > 0) extra.push(`${b.impact.protectedDownstream} invariant`)
    if (b.impact.debtDownstream > 0) extra.push(`${b.impact.debtDownstream} in debt`)
    lines.push(
      `- Blast radius: changing it could reach ${b.impact.downstream} downstream module(s)` +
        (extra.length ? ` (${extra.join(', ')})` : '')
    )
  }
  if (b.decisions.length > 0) {
    lines.push('- Decision history:')
    for (const d of b.decisions.slice(0, 5)) {
      lines.push(`  - [${d.outcome === 'passed' ? 'passed' : 'changes'}] ${d.rationale ?? d.question ?? 'confirmed at gate'}`)
    }
  }
  if (b.history.length > 0) {
    lines.push('- Git history (why, from commits):')
    for (const c of b.history.slice(0, 5)) {
      lines.push(`  - ${c.subject} — ${c.author}`)
    }
  }
  if (b.coupling.length > 0) {
    lines.push('- Hidden coupling (non-import — shared table/event/route/flag):')
    for (const c of b.coupling.slice(0, 5)) {
      const other = c.from === b.focus ? c.to : c.from
      lines.push(`  - ${c.kind}:${c.key} ↔ ${other}`)
    }
  }
  return lines.join('\n')
}

/** Forward transitive closure: every module the start (transitively) imports. */
function dependencyClosure(map: CodeMap, start: string): string[] {
  const out = new Map<string, string[]>()
  for (const e of map.edges) {
    const arr = out.get(e.from)
    if (arr) arr.push(e.to)
    else out.set(e.from, [e.to])
  }
  const seen = new Set<string>()
  const queue = [start]
  for (let i = 0; i < queue.length; i++) {
    for (const next of out.get(queue[i]!) ?? []) {
      if (!seen.has(next) && next !== start) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return [...seen]
}
