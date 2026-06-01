/**
 * Crew plan parsing — turns the Team Lead's reply into a structured,
 * human-approvable CrewPlan. Pure + defensive: any junk falls back to a
 * sensible per-role plan so execution never blocks on a bad model reply.
 */

import type { CrewPlan, CrewPlanStep, CrewRoleConfig } from '../shared/types'
import { DEFAULT_CREW_ROLES } from '../shared/crew-roles'

/** A safe default plan: the default build pipeline, one brief per role. */
export function fallbackPlan(task: string, _library: CrewRoleConfig[]): CrewPlan {
  const roles = DEFAULT_CREW_ROLES
  return {
    approach: `Apply the ${roles.map((r) => r.label).join(' → ')} pipeline to: ${task.slice(0, 120)}`,
    roles: [...roles],
    steps: roles.map((r) => ({ roleId: r.id, brief: `Perform your role as ${r.label} for the task.` }))
  }
}

/**
 * Parse a Team Lead reply into a CrewPlan. The model PICKS roles from the
 * `library` (by id) appropriate to the task; we materialize the composed roster
 * from those ids. Unknown ids are dropped; junk falls back to the build pipeline.
 */
export function parseCrewPlan(text: string, task: string, library: CrewRoleConfig[]): CrewPlan {
  const byId = new Map(library.map((r) => [r.id, r]))
  const fallback = fallbackPlan(task, library)
  if (!text) return fallback

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return fallback

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return fallback
  }

  if (!parsed || typeof parsed !== 'object') return fallback
  const obj = parsed as { approach?: unknown; steps?: unknown }

  const rawSteps = Array.isArray(obj.steps) ? obj.steps : []
  // First pass: collect valid steps (so we can validate dependsOn against them).
  const picked: Array<{ roleId: string; brief: string; dependsOn: string[] }> = []
  for (const s of rawSteps) {
    if (!s || typeof s !== 'object') continue
    const { roleId, brief, dependsOn } = s as { roleId?: unknown; brief?: unknown; dependsOn?: unknown }
    if (typeof roleId !== 'string' || !byId.has(roleId)) continue
    if (typeof brief !== 'string' || brief.trim().length === 0) continue
    if (picked.some((x) => x.roleId === roleId)) continue // de-dupe (keep first)
    const deps = Array.isArray(dependsOn)
      ? (dependsOn.filter((d): d is string => typeof d === 'string'))
      : []
    picked.push({ roleId, brief: brief.trim(), dependsOn: deps })
  }

  if (picked.length === 0) return fallback

  const pickedIds = new Set(picked.map((p) => p.roleId))
  const steps: CrewPlanStep[] = []
  const roles: CrewRoleConfig[] = []
  for (const p of picked) {
    // Keep only deps that point at other picked roles (and not self).
    const deps = p.dependsOn.filter((d) => pickedIds.has(d) && d !== p.roleId)
    steps.push({ roleId: p.roleId, brief: p.brief, ...(deps.length ? { dependsOn: deps } : {}) })
    // Materialize the role with the Team Lead's dependency graph so the DAG
    // executor runs exactly the shape the plan specified.
    roles.push({ ...byId.get(p.roleId)!, ...(deps.length ? { dependsOn: deps } : {}) })
  }

  const approach =
    typeof obj.approach === 'string' && obj.approach.trim().length > 0
      ? obj.approach.trim()
      : fallback.approach

  return { approach, roles, steps }
}
