/**
 * Crew DAG utilities — pure functions that turn a roster (+ strategy) into a
 * dependency graph and execution waves. `sequential` and `parallel` become
 * special cases of the same model:
 *   - sequential = a chain (each role depends on the previous)
 *   - parallel   = no dependencies (one wave)
 *   - explicit `dependsOn` on any role → use the declared graph
 */

import type { CrewRoleConfig, CrewStrategy } from './types'

/**
 * Resolve the effective dependencies for each role. If any role declares
 * `dependsOn`, the declared graph is used (filtered to known roles). Otherwise
 * the strategy derives them.
 */
export function effectiveDeps(roles: CrewRoleConfig[], strategy: CrewStrategy): Map<string, string[]> {
  const ids = new Set(roles.map((r) => r.id))
  const deps = new Map<string, string[]>()

  // Per-role override: a role with explicit `dependsOn` uses it; otherwise it
  // inherits the strategy default (parallel = none; sequential = the previous
  // role in roster order). This keeps the implicit pipeline intact when you set
  // a dependency on just one role — setting Tester "runs after Coder" must NOT
  // fling Planner/Coder/Reviewer into parallel.
  roles.forEach((r, i) => {
    const explicit = (r.dependsOn ?? []).filter((d) => ids.has(d) && d !== r.id)
    if (explicit.length > 0) {
      deps.set(r.id, explicit)
    } else if (strategy === 'parallel') {
      deps.set(r.id, [])
    } else {
      deps.set(r.id, i === 0 ? [] : [roles[i - 1]!.id])
    }
  })
  return deps
}

export interface WaveResult {
  /** Role ids grouped into execution waves (each wave runs concurrently). */
  waves: string[][]
  /** True if a dependency cycle was detected (the graph is then unusable). */
  hasCycle: boolean
}

/**
 * Compute topological execution waves via Kahn's algorithm. Roles with no
 * unmet dependencies form each successive wave. Detects cycles.
 */
export function computeWaves(roles: CrewRoleConfig[], deps: Map<string, string[]>): WaveResult {
  const ids = roles.map((r) => r.id)
  const remaining = new Set(ids)
  const indeg = new Map<string, number>()
  for (const id of ids) indeg.set(id, (deps.get(id) ?? []).length)

  const waves: string[][] = []
  while (remaining.size > 0) {
    const wave = [...remaining].filter((id) => (indeg.get(id) ?? 0) === 0)
    if (wave.length === 0) {
      return { waves, hasCycle: true } // remaining nodes form a cycle
    }
    waves.push(wave)
    for (const id of wave) remaining.delete(id)
    // Decrement in-degree of nodes depending on the just-scheduled wave.
    for (const id of remaining) {
      const d = deps.get(id) ?? []
      const met = d.filter((x) => wave.includes(x)).length
      if (met > 0) indeg.set(id, (indeg.get(id) ?? 0) - met)
    }
  }
  return { waves, hasCycle: false }
}

/** Roles nothing else depends on — the "sinks" whose output is the final result. */
export function sinkRoleIds(roles: CrewRoleConfig[], deps: Map<string, string[]>): string[] {
  const depended = new Set<string>()
  for (const d of deps.values()) for (const x of d) depended.add(x)
  return roles.map((r) => r.id).filter((id) => !depended.has(id))
}
