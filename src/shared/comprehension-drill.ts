/**
 * Comprehension drills — actively MEASURE (and build) the human's mental model
 * instead of inferring it from engagement. The instrument generates a question
 * with a ground-truth answer from the Living Map ("who depends on X?"), the human
 * answers, and we score it. Run over time (preferring least-engaged modules) this
 * turns "your understanding" from a proxy into a measured accuracy. Deterministic
 * given a seed (no randomness) so it's unit-testable. Pure + browser-safe.
 */

import type { CodeMap } from './code-map'

export interface Drill {
  /** The module the question is about. */
  target: string
  question: string
  /** Multiple-choice module options. */
  options: string[]
  /** Index of the correct option. */
  answerIndex: number
}

export interface BuildDrillOptions {
  /** Modules the human has already engaged with (deprioritized as targets). */
  engaged?: Set<string>
  /** Deterministic seed (rotate to vary the drill). */
  seed?: number
  /** Number of multiple-choice options (incl. the answer). */
  optionCount?: number
}

/**
 * Build one drill, or null if the map has no module with a dependent. Targets
 * the least-engaged, most-important module first (where measuring matters most).
 */
export function buildDrill(map: CodeMap, options: BuildDrillOptions = {}): Drill | null {
  const { engaged = new Set<string>(), seed = 0, optionCount = 4 } = options
  const fanIn = new Map<string, number>()
  for (const e of map.edges) fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1)

  const withDeps = map.modules.filter((m) => (fanIn.get(m.id) ?? 0) > 0)
  if (withDeps.length === 0) return null
  // Least-engaged first, then most-depended-on (highest leverage to learn).
  withDeps.sort(
    (a, b) =>
      (engaged.has(a.id) ? 1 : 0) - (engaged.has(b.id) ? 1 : 0) ||
      (fanIn.get(b.id) ?? 0) - (fanIn.get(a.id) ?? 0) ||
      a.id.localeCompare(b.id)
  )
  const target = withDeps[seed % withDeps.length]!.id

  const deps = [...new Set(map.edges.filter((e) => e.to === target).map((e) => e.from))]
  const correct = deps[seed % deps.length]!
  const nonDeps = map.modules.map((m) => m.id).filter((id) => id !== target && !deps.includes(id))

  const distractors: string[] = []
  for (let i = 0; distractors.length < optionCount - 1 && i < nonDeps.length; i++) {
    const cand = nonDeps[(seed + i) % nonDeps.length]!
    if (!distractors.includes(cand)) distractors.push(cand)
  }

  const answerIndex = seed % (distractors.length + 1)
  const opts = [...distractors]
  opts.splice(answerIndex, 0, correct)

  return { target, question: `谁直接依赖 ${target}?`, options: opts, answerIndex }
}

/** Was the chosen option correct? */
export function scoreDrill(drill: Drill, chosenIndex: number): boolean {
  return chosenIndex === drill.answerIndex
}

export interface DrillScore {
  correct: number
  total: number
  /** Accuracy 0..1; 1 when nothing answered yet (no basis to penalize). */
  accuracy: number
}

/** Fold a sequence of answers into an accuracy score (the real comprehension metric). */
export function tallyDrills(results: boolean[]): DrillScore {
  const total = results.length
  const correct = results.filter(Boolean).length
  return { correct, total, accuracy: total === 0 ? 1 : correct / total }
}
