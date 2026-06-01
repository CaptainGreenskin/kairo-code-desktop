/**
 * Predictive blast radius — autopsy → flight plan. Before a crew runs, predict
 * from the task text + the map which modules it will likely touch, the full
 * transitive blast radius (import + hidden coupling), which invariants it will
 * hit, and where it will pile on comprehension debt — so the human's attention
 * is routed BEFORE the change, not after. Pure + browser-safe.
 */

import { transitiveImpact, type CodeMap, type CouplingEdge } from './code-map'
import { isProtectedPath } from './comprehension-router'

export interface ImpactPrediction {
  /** Modules the task text names (the predicted seeds). */
  predicted: string[]
  /** Transitive downstream modules (import + coupling), excluding the seeds. */
  blast: string[]
  /** Predicted ∪ blast modules that are invariant (protected) regions. */
  invariantsAtRisk: string[]
  /** Predicted ∪ blast modules that already carry comprehension debt. */
  debtHit: string[]
  /** One-line, pointable summary. */
  summary: string
}

/** Modules named in the task text — whole-word segment match (avoids matching
 * "ui" inside "build"), or the full module id appearing verbatim. */
function seedsFromTask(map: CodeMap, task: string): string[] {
  const q = task.toLowerCase()
  const words = new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length >= 2))
  const hits: string[] = []
  for (const m of map.modules) {
    const id = m.id.toLowerCase()
    const segs = id.split('/')
    if (q.includes(id) || segs.some((s) => s.length >= 2 && words.has(s))) hits.push(m.id)
  }
  return hits
}

/**
 * Predict a task's blast radius before dispatch. Blast = transitive dependents
 * over BOTH the import graph and the hidden-coupling graph (coupling edges are
 * undirected, so each becomes two directed edges for the walk).
 */
export function predictImpact(
  task: string,
  data: { map: CodeMap; protectedGlobs: string[]; debtModules: string[]; couplingEdges?: CouplingEdge[] }
): ImpactPrediction {
  const { map, protectedGlobs, debtModules, couplingEdges = [] } = data
  const predicted = seedsFromTask(map, task)
  if (predicted.length === 0) {
    return { predicted: [], blast: [], invariantsAtRisk: [], debtHit: [], summary: '任务里没点到具体模块 — 无法预测影响' }
  }

  // Combine import edges with coupling (both directions) for a truthful walk.
  const edges = [
    ...map.edges,
    ...couplingEdges.flatMap((c) => [
      { from: c.from, to: c.to, weight: 1 },
      { from: c.to, to: c.from, weight: 1 }
    ])
  ]
  const impact = transitiveImpact(edges, predicted)
  const seedSet = new Set(predicted)
  const blast = [...impact.keys()].filter((id) => !seedSet.has(id))

  const all = [...new Set([...predicted, ...blast])]
  const debtSet = new Set(debtModules)
  const matches = (id: string, c: string): boolean => id === c || id.startsWith(`${c}/`) || c.startsWith(`${id}/`)
  const invariantsAtRisk = all.filter((id) => isProtectedPath(`${id}/x.ts`, protectedGlobs))
  const debtHit = all.filter((id) => [...debtSet].some((d) => matches(id, d)))

  const parts = [`大概率改 ${predicted.length} 个模块`]
  if (blast.length > 0) parts.push(`波及 ${blast.length} 个下游`)
  if (invariantsAtRisk.length > 0) parts.push(`碰 ${invariantsAtRisk.length} 个不变量区`)
  if (debtHit.length > 0) parts.push(`在 ${debtHit.length} 个带债模块上加注`)
  return { predicted, blast, invariantsAtRisk, debtHit, summary: parts.join(' · ') }
}
