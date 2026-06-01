/**
 * Nightwatch — self-paced, bounded autonomy. The plain autopilot fires the next
 * "continue" instantly and only counts turns. This upgrades it into a real
 * overnight loop: it keeps working while you're away, paces itself between
 * iterations (a SleepTool-style delay), and STOPS for an explicit reason —
 * model is done, turn budget hit, wall-clock budget hit, or you stopped it.
 * The stop reason feeds the morning briefing. Pure + browser-safe.
 *
 * Idea borrowed from Claude Code's proactive/SleepTool loop + the Kairo (Java)
 * AgentTaskScheduler; reimplemented for the desktop's overnight-crew scenario.
 */

export interface NightwatchState {
  /** Autopilot/overnight mode is on. */
  enabled: boolean
  /** Remaining turns in the budget (counted down by the caller). */
  turnsRemaining: number
  /** The model signalled it has more work to do (e.g. emitted a continue marker). */
  modelWantsMore: boolean
  /** When the autonomous run started (ms epoch). */
  startedAt: number
  /** Now (ms epoch) — injected for deterministic tests. */
  now: number
  /** Wall-clock budget for the whole run (ms). */
  maxWallClockMs: number
  /** Cumulative tokens spent this run (prompt + completion). */
  tokensUsed?: number
  /** Hard token budget for the run; 0/undefined = no cap. */
  maxTokens?: number
  /** The user explicitly asked to stop. */
  stopRequested?: boolean
}

export type NightwatchAction =
  | { action: 'continue'; delayMs: number }
  | { action: 'stop'; reason: string }

/** Default self-pacing delay between iterations (the "sleep"). */
export const DEFAULT_PACE_MS = 800
/** Default wall-clock budget for an overnight run (30 min). */
export const DEFAULT_MAX_WALLCLOCK_MS = 30 * 60_000
/** Default token budget for an overnight run (cost runaway guard). */
export const DEFAULT_MAX_TOKENS = 500_000

/**
 * Decide whether the overnight loop should run another iteration (and how long
 * to wait first) or stop with a reason. Ordered so the clearest terminal signal
 * wins: explicit stop → disabled → model done → turn budget → time budget.
 */
export function nextNightwatchAction(state: NightwatchState, paceMs: number = DEFAULT_PACE_MS): NightwatchAction {
  if (state.stopRequested) return { action: 'stop', reason: '已手动停止' }
  if (!state.enabled) return { action: 'stop', reason: '隔夜模式未开启' }
  if (!state.modelWantsMore) return { action: 'stop', reason: '任务完成 — 模型未请求继续' }
  if (state.turnsRemaining <= 0) return { action: 'stop', reason: '达到最大轮数' }
  if (state.now - state.startedAt >= state.maxWallClockMs) return { action: 'stop', reason: '达到时间预算' }
  if (state.maxTokens && state.maxTokens > 0 && (state.tokensUsed ?? 0) >= state.maxTokens) {
    return { action: 'stop', reason: '达到成本(token)预算' }
  }
  return { action: 'continue', delayMs: paceMs }
}
