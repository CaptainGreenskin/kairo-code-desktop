/**
 * Durable overnight run record. The nightwatch loop runs in the renderer, so an
 * app close/crash pauses it. Persisting the run's intent lets the app RESUME it
 * on next launch instead of silently abandoning an overnight job. A stale record
 * (older than a cutoff) is not auto-resumed — you don't want yesterday's job
 * springing back to life. Pure + browser-safe.
 */

export interface NightwatchSession {
  active: boolean
  sessionId: string
  turnsRemaining: number
  startedAt: number
  /** Heartbeat — updated each iteration so staleness can be judged. */
  updatedAt: number
  /** Workspace the run belongs to (resume only when it matches). */
  workspacePath?: string
}

/** Don't auto-resume a run whose heartbeat is older than this (default 1h). */
export const DEFAULT_MAX_STALE_MS = 60 * 60_000

export interface ResumeDecision {
  resume: boolean
  reason: string
}

/**
 * Decide whether a persisted run should resume on launch: it must be active,
 * have turns left, belong to the current workspace, and have a fresh heartbeat.
 */
export function shouldResume(
  record: NightwatchSession | null,
  now: number,
  currentWorkspace?: string,
  maxStaleMs: number = DEFAULT_MAX_STALE_MS
): ResumeDecision {
  if (!record || !record.active) return { resume: false, reason: '无进行中的隔夜任务' }
  if (record.turnsRemaining <= 0) return { resume: false, reason: '隔夜任务已用完轮数' }
  if (now - record.updatedAt > maxStaleMs) return { resume: false, reason: '隔夜任务记录已过期' }
  if ((record.workspacePath ?? '') !== (currentWorkspace ?? '')) {
    return { resume: false, reason: '工作区不匹配' }
  }
  return { resume: true, reason: `可续跑（剩 ${record.turnsRemaining} 轮）` }
}
