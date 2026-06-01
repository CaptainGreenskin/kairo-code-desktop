/**
 * Flow trace persistence — a traced call path (from BrainChat's tool-augmented
 * agent) can be saved, recalled, and checked for staleness. Stored in
 * `.kairo/flows/<scenario-slug>.json`. Pure + browser-safe; the IO lives in main.
 */

export interface FlowStep {
  method: string
  file?: string
  line?: number
  note?: string
  uncertain?: boolean
}

export interface FlowTrace {
  scenario: string
  entry?: string
  steps: FlowStep[]
  confirmedAt: number
}

/** Slugify a scenario description for use as a filename. */
export function flowSlug(scenario: string): string {
  return scenario
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'flow'
}

/** Parse a persisted flow trace. Returns null if malformed. */
export function parseFlowTrace(json: unknown): FlowTrace | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (typeof o.scenario !== 'string' || !o.scenario.trim()) return null
  if (!Array.isArray(o.steps)) return null
  const steps: FlowStep[] = []
  for (const s of o.steps) {
    if (!s || typeof s !== 'object') continue
    const st = s as Record<string, unknown>
    if (typeof st.method !== 'string') continue
    steps.push({
      method: st.method,
      file: typeof st.file === 'string' ? st.file : undefined,
      line: typeof st.line === 'number' ? st.line : undefined,
      note: typeof st.note === 'string' ? st.note : undefined,
      uncertain: st.uncertain === true ? true : undefined
    })
  }
  return {
    scenario: o.scenario.trim(),
    entry: typeof o.entry === 'string' ? o.entry : undefined,
    steps,
    confirmedAt: typeof o.confirmedAt === 'number' ? o.confirmedAt : 0
  }
}

/** Check whether any files in a flow trace have been modified since confirmation. */
export function flowIsStale(trace: FlowTrace, modifiedFiles: Set<string>): boolean {
  return trace.steps.some((s) => s.file && modifiedFiles.has(s.file))
}
