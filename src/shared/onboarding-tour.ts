/**
 * Onboarding tour — "understand this system in 15 minutes". When you inherit an
 * AI-written (or just unfamiliar) codebase, the hardest part is building a mental
 * model from zero. This composes the Living Map + Brain signals into an ordered
 * guided tour: start at the hubs (where understanding pays off most), then the
 * invariants you must not break, the comprehension debt nobody owns, the hidden
 * (non-import) coupling, and where your understanding currently stands. Each step
 * points at the modules to look at. Pure + browser-safe.
 */

import { isProtectedPath } from './comprehension-router'
import type { CodeMap, CouplingEdge } from './code-map'

export type TourStepKind = 'overview' | 'hub' | 'invariant' | 'debt' | 'coupling' | 'health'

export interface TourStep {
  kind: TourStepKind
  title: string
  detail: string
  /** Modules this step is about (the UI focuses/highlights them). */
  focusModules: string[]
}

export interface OnboardingTourInput {
  map: CodeMap
  protectedGlobs: string[]
  debtModules: string[]
  /** 0..1 comprehension health, if known. */
  healthScore?: number
  coupling?: CouplingEdge[]
  /** How many hub modules to walk individually. */
  hubCount?: number
}

/** Build the ordered onboarding tour. Empty map → empty tour. */
export function buildOnboardingTour(input: OnboardingTourInput): TourStep[] {
  const { map, protectedGlobs, debtModules, healthScore, coupling = [], hubCount = 3 } = input
  if (map.modules.length === 0) return []

  // Fan-in per module (how many depend on it) → importance.
  const fanIn = new Map<string, number>()
  for (const e of map.edges) fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1)
  const byImportance = [...map.modules].sort(
    (a, b) => (fanIn.get(b.id) ?? 0) - (fanIn.get(a.id) ?? 0) || b.fileCount - a.fileCount
  )

  const steps: TourStep[] = []

  steps.push({
    kind: 'overview',
    title: '系统概览',
    detail: `${map.modules.length} 个模块 · ${map.edges.length} 条依赖。先从被依赖最多的"枢纽"入手——理解它们的杠杆最高。`,
    focusModules: byImportance.slice(0, hubCount).map((m) => m.id)
  })

  for (const m of byImportance.slice(0, hubCount)) {
    const deps = fanIn.get(m.id) ?? 0
    if (deps === 0) break // no more hubs worth a dedicated step
    steps.push({
      kind: 'hub',
      title: `枢纽：${m.id}`,
      detail: `被 ${deps} 个模块依赖、含 ${m.fileCount} 个文件。改它波及面最大,先弄懂它的契约。`,
      focusModules: [m.id]
    })
  }

  const invariants = map.modules.map((m) => m.id).filter((id) => isProtectedPath(`${id}/x.ts`, protectedGlobs))
  if (invariants.length > 0) {
    steps.push({
      kind: 'invariant',
      title: '不变量区',
      detail: `这些是受保护的契约/敏感区,改动需谨慎:${invariants.slice(0, 6).join('、')}。`,
      focusModules: invariants.slice(0, 6)
    })
  }

  if (debtModules.length > 0) {
    steps.push({
      kind: 'debt',
      title: '理解债',
      detail: `这些模块有高风险变更、没人在闸门确认过——最该优先理解:${debtModules.slice(0, 6).join('、')}。`,
      focusModules: debtModules.slice(0, 6)
    })
  }

  if (coupling.length > 0) {
    const pairs = [...new Set(coupling.map((c) => [c.from, c.to].sort().join(' ↔ ')))].slice(0, 5)
    const mods = [...new Set(coupling.flatMap((c) => [c.from, c.to]))].slice(0, 6)
    steps.push({
      kind: 'coupling',
      title: '隐藏耦合',
      detail: `这些模块没有 import 关系、却共享表/事件/接口——爆炸半径看不见的地方:${pairs.join('；')}。`,
      focusModules: mods
    })
  }

  steps.push({
    kind: 'health',
    title: '你的理解力',
    detail:
      healthScore != null
        ? `当前你对系统的理解约 ${Math.round(healthScore * 100)}%。跟着上面走一遍,再用"问系统"补齐薄弱处。`
        : '跟着上面走一遍,再用"问系统"补齐薄弱处,理解力分会随你的参与上升。',
    focusModules: []
  })

  return steps
}
