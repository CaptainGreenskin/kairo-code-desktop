/**
 * Turn-end autonomy plan — the single decision point that composes every
 * autonomous-loop policy (context compaction + nightwatch continue/stop + the
 * SleepTool pacing) into one pure result. Separating this decision from the
 * side-effecting hook keeps the loop's combined behaviour unit-testable (the
 * pieces were tested individually; this covers their interplay). Pure +
 * browser-safe.
 */

import { autoCompactDecision, type ContextAction } from './context-policy'
import {
  nextNightwatchAction,
  DEFAULT_MAX_WALLCLOCK_MS,
  DEFAULT_MAX_TOKENS,
  type NightwatchAction
} from './nightwatch'
import { paceFromToolCalls } from './sleep-policy'

export interface TurnEndInput {
  autopilotEnabled: boolean
  /** Session context fullness 0..1 (measured this turn). */
  contextRatio: number
  turnsRemaining: number
  /** The model signalled more work (continue marker). */
  modelWantsMore: boolean
  startedAt: number
  now: number
  /** Cumulative tokens spent this run. */
  tokensUsed: number
  /** This turn's tool calls (for SleepTool pacing). */
  lastToolCalls?: Array<{ toolName: string; args?: Record<string, unknown> }>
  maxWallClockMs?: number
  maxTokens?: number
}

export interface TurnEndPlan {
  /** What to do about context fullness. */
  compact: ContextAction
  /** The overnight loop's next move, or null when not in autopilot. */
  autonomy: NightwatchAction | null
}

/** Compose the turn-end decisions (compaction + nightwatch + pacing). */
export function planTurnEnd(input: TurnEndInput): TurnEndPlan {
  const compact = autoCompactDecision(input.contextRatio, { autopilot: input.autopilotEnabled })
  const autonomy = input.autopilotEnabled
    ? nextNightwatchAction(
        {
          enabled: true,
          turnsRemaining: input.turnsRemaining,
          modelWantsMore: input.modelWantsMore,
          startedAt: input.startedAt,
          now: input.now,
          maxWallClockMs: input.maxWallClockMs ?? DEFAULT_MAX_WALLCLOCK_MS,
          tokensUsed: input.tokensUsed,
          maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS
        },
        paceFromToolCalls(input.lastToolCalls)
      )
    : null
  return { compact, autonomy }
}
