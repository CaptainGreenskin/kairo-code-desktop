/**
 * Narrative Feed — instead of 7 panels waiting for the user to explore, surface
 * the 3-5 things they most need to know right now. Pure + browser-safe.
 *
 * Inputs are data already available in the Code Map dock (Map Delta, git history,
 * gate decisions, architecture deviations). The output is a sorted, capped list
 * of human-readable events with severity, action, and module references.
 */

import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'
import type { GitCommit } from './git-brain'

export interface NarrativeEvent {
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  modules: string[]
  source: 'unverified' | 'deviation' | 'invariant' | 'gate' | 'change'
  at: number
}

const MAX_EVENTS = 5

export function buildNarrativeFeed(input: {
  changes: ChangeRecord[]
  commits: GitCommit[]
  decisions: GateDecision[]
  lastSeen: number
  protectedGlobs: string[]
}): NarrativeEvent[] {
  const { changes, commits, decisions, lastSeen, protectedGlobs } = input
  const events: NarrativeEvent[] = []

  // Only consider things since lastSeen (the user's "catch-up" anchor).
  const recentChanges = changes.filter((c) => c.at > lastSeen)
  const recentCommits = commits.filter((c) => c.at > lastSeen)

  // 1. Unverified behavior changes (changed but no tests run) → critical
  const unverified = recentChanges.filter((c) => c.risk === 'review' && !c.verified)
  if (unverified.length > 0) {
    const modules = [...new Set(unverified.flatMap((c) => c.modules))]
    events.push({
      severity: 'critical',
      title: `${unverified.length} 处变更没有跑测试`,
      detail: modules.slice(0, 2).map((m) => m.split('/').pop()).join('、') + ' 等模块有未验证的变更',
      modules,
      source: 'unverified',
      at: Math.max(...unverified.map((c) => c.at))
    })
  }

  // 2. Invariant regions touched (protected globs) → warning
  if (protectedGlobs.length > 0 && recentChanges.length > 0) {
    const touchedInvariant = recentChanges.filter((c) =>
      c.modules.some((m) => protectedGlobs.some((g) => matchGlob(g, m)))
    )
    if (touchedInvariant.length > 0) {
      const modules = [...new Set(touchedInvariant.flatMap((c) => c.modules))]
      events.push({
        severity: 'warning',
        title: `保护区域被修改`,
        detail: modules.slice(0, 2).map((m) => m.split('/').pop()).join('、') + ' 被改动（保护区域）',
        modules,
        source: 'invariant',
        at: Math.max(...touchedInvariant.map((c) => c.at))
      })
    }
  }

  // 3. Gate rejections (decisions requiring changes) → warning
  const recentRejects = decisions.filter((d) => d.at > lastSeen && d.outcome === 'changes')
  if (recentRejects.length > 0) {
    events.push({
      severity: 'warning',
      title: `${recentRejects.length} 个闸门触发了人工审查`,
      detail: (recentRejects[0]!.question ?? '高风险变更需要你确认。').slice(0, 80),
      modules: [...new Set(recentRejects.flatMap((d) => d.modules))],
      source: 'gate',
      at: Math.max(...recentRejects.map((d) => d.at))
    })
  }

  // 4. Recent git commits — break into richer signals
  const manualCommits = recentCommits.filter((c) => !c.subject.includes('[crew]'))
  if (manualCommits.length > 0) {
    // 4a. Hot modules (touched by 3+ commits) → warning (high activity = potential risk)
    const moduleCounts = new Map<string, number>()
    for (const c of manualCommits) {
      for (const f of c.files) {
        const mod = f.split('/').slice(0, -1).join('/')
        if (mod) moduleCounts.set(mod, (moduleCounts.get(mod) ?? 0) + 1)
      }
    }
    const hotModules = [...moduleCounts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])
    if (hotModules.length > 0) {
      events.push({
        severity: 'warning',
        title: `${hotModules.length} 个模块活跃度很高`,
        detail: hotModules.slice(0, 3).map(([m, n]) => `${m.split('/').pop()} (${n}次)`).join('、'),
        modules: hotModules.map(([m]) => m),
        source: 'change',
        at: Math.max(...manualCommits.map((c) => c.at))
      })
    }

    // 4b. Per-author summary → info (who's been active)
    const authorCounts = new Map<string, number>()
    for (const c of manualCommits) authorCounts.set(c.author, (authorCounts.get(c.author) ?? 0) + 1)
    const topAuthors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (topAuthors.length > 0) {
      events.push({
        severity: 'info',
        title: `${manualCommits.length} 个提交来自 ${topAuthors.map(([a]) => a).join('、')}`,
        detail: manualCommits.slice(0, 2).map((c) => c.subject).join('；'),
        modules: [...new Set(manualCommits.flatMap((c) => c.files.map((f) => f.split('/').slice(0, -1).join('/')).filter(Boolean)))],
        source: 'change',
        at: Math.max(...manualCommits.map((c) => c.at))
      })
    }
  }

  // 5. Crew changes → info
  const crewChanges = recentChanges.filter((c) => c.risk !== 'review' || c.verified)
  if (crewChanges.length > 0 && events.length < MAX_EVENTS) {
    events.push({
      severity: 'info',
      title: `${crewChanges.length} 处 crew 变更已验证`,
      detail: crewChanges.slice(0, 2).map((c) => c.modules.map((m) => m.split('/').pop()).join('/')).join('、'),
      modules: [...new Set(crewChanges.flatMap((c) => c.modules))],
      source: 'change',
      at: Math.max(...crewChanges.map((c) => c.at))
    })
  }

  // Sort by severity (critical > warning > info), then by time (newest first).
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 }
  events.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || b.at - a.at)
  return events.slice(0, MAX_EVENTS)
}

function matchGlob(glob: string, path: string): boolean {
  const re = new RegExp('^' + glob.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$')
  return re.test(path)
}
