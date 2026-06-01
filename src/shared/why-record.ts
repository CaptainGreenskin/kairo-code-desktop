/**
 * Why records — structured capture of WHY a file/module was changed. Populated
 * automatically from crew/agent task descriptions + behaviorDelta, so the Brain
 * can later answer "why is this code the way it is?" without mining commit
 * messages (which are usually garbage).
 *
 * Stored in `.kairo/why-records.json` (append-only, capped). Pure + browser-safe.
 */

export interface WhyRecord {
  file: string
  why: string
  task?: string
  at: number
}

const MAX_RECORDS = 500

/** Parse the persisted why-records array. */
export function parseWhyRecords(json: unknown): WhyRecord[] {
  if (!Array.isArray(json)) return []
  const out: WhyRecord[] = []
  for (const r of json) {
    if (!r || typeof r !== 'object') continue
    const e = r as Record<string, unknown>
    if (typeof e.file !== 'string' || typeof e.why !== 'string') continue
    out.push({
      file: e.file,
      why: e.why,
      task: typeof e.task === 'string' ? e.task : undefined,
      at: typeof e.at === 'number' ? e.at : 0
    })
  }
  return out
}

/** Append a new record, keeping the list capped. */
export function appendWhyRecord(records: WhyRecord[], rec: WhyRecord): WhyRecord[] {
  const next = [...records, rec]
  return next.length > MAX_RECORDS ? next.slice(-MAX_RECORDS) : next
}

/** Find why records for a specific file (newest first). */
export function whyForFile(records: WhyRecord[], file: string): WhyRecord[] {
  return records.filter((r) => r.file === file).sort((a, b) => b.at - a.at)
}

/** Build a why record from a crew task + the files it changed. */
export function buildWhyFromTask(task: string, filesChanged: string[]): WhyRecord[] {
  const at = Date.now()
  return filesChanged.map((file) => ({ file, why: task, task, at }))
}
