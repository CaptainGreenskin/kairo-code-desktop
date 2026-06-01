/**
 * Expectation Diff — route attention to what you did NOT see coming. Before a
 * crew runs, the human states which modules they expect it to touch; after, we
 * compare that mental model against the real blast radius and surface only the
 * surprises. Pure + browser-safe.
 *
 * This serves the constitution: optimize the human's mental model (not AI
 * output), and "point, don't tell" — we highlight the gap, not the whole diff.
 */

/** Loose module match: same id, or one is a path-prefix of the other. */
function matches(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export interface ExpectationDiff {
  /** Touched but NOT expected — the surprises that need attention. */
  unexpected: string[]
  /** Expected but not touched — your model over-predicted. */
  missed: string[]
  /** Touched and expected — confirmation. */
  asExpected: string[]
  /** True when the human set an expectation (so callers can stay silent if not). */
  hasExpectation: boolean
}

export function expectationDiff(expected: string[], blastModules: string[]): ExpectationDiff {
  const hasExpectation = expected.length > 0
  const unexpected = blastModules.filter((m) => !expected.some((e) => matches(m, e)))
  const missed = expected.filter((e) => !blastModules.some((m) => matches(m, e)))
  const asExpected = blastModules.filter((m) => expected.some((e) => matches(m, e)))
  return { unexpected, missed, asExpected, hasExpectation }
}
