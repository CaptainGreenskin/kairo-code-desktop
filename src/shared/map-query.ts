/**
 * Ask the Map — answer "who depends on X?" / "what does X depend on?" by
 * pointing on the Living Map, not by emitting prose (constitution: point, don't
 * tell). Pure + browser-safe; resolves a free-text query to a module and
 * returns its transitive dependents + dependencies for the UI to highlight.
 */

import { transitiveImpact, type CodeMap } from './code-map'

export interface MapQueryResult {
  focus: string
  /** Modules that (transitively) depend ON the focus. */
  dependents: string[]
  /** Modules the focus (transitively) depends on. */
  dependencies: string[]
}

/**
 * Ranked module matches for a free-text query: exact › path-suffix › substring,
 * shortest id first within each tier. Powers query disambiguation — when several
 * modules match, the UI can offer the runners-up instead of silently picking one.
 */
export function resolveQueryModules(map: CodeMap, query: string, limit = 5): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored = map.modules
    .map((m) => {
      const l = m.id.toLowerCase()
      const tier = l === q ? 0 : l.endsWith(`/${q}`) ? 1 : l.includes(q) ? 2 : -1
      return { id: m.id, tier, len: m.id.length }
    })
    .filter((x) => x.tier >= 0)
    .sort((a, b) => a.tier - b.tier || a.len - b.len || a.id.localeCompare(b.id))
  return scored.slice(0, limit).map((x) => x.id)
}

/** Best module match for a free-text query: exact › path-suffix › substring. */
export function resolveQueryModule(map: CodeMap, query: string): string | null {
  return resolveQueryModules(map, query, 1)[0] ?? null
}

/**
 * Resolve a query to a concrete FILE (finer than a module), when it looks like a
 * path with an extension. Powers file-level "who imports this file". Returns the
 * shortest matching relative path, or null. Pure.
 */
export function resolveQueryFile(map: CodeMap, query: string): string | null {
  const q = query.trim().toLowerCase()
  if (!q || !q.includes('.')) return null // files carry an extension; modules don't
  const files = map.modules.flatMap((m) => m.files)
  const exact = files.find((f) => f.toLowerCase() === q)
  if (exact) return exact
  return (
    files
      .filter((f) => f.toLowerCase() === q || f.toLowerCase().endsWith(`/${q}`))
      .sort((a, b) => a.length - b.length)[0] ?? null
  )
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

/** Resolve a query and compute the focus module's dependents + dependencies. */
export function mapQuery(map: CodeMap, query: string): MapQueryResult | null {
  const focus = resolveQueryModule(map, query)
  if (!focus) return null
  // transitiveImpact walks dependents (who imports the seed, transitively).
  const impact = transitiveImpact(map.edges, [focus])
  const dependents = [...impact.keys()].filter((id) => id !== focus)
  const dependencies = dependencyClosure(map, focus)
  return { focus, dependents, dependencies }
}
