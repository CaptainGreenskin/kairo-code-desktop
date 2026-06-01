/**
 * Token-budget logic for compaction. The desktop previously compacted by a
 * fixed "keep last 6 messages" rule with no notion of how full the context
 * actually is — so it compacted too early on short messages and too late on
 * long ones. This adds real token accounting (via @kairo/core's estimator) so
 * the app can (a) tell the user how full the window is and (b) keep a
 * token-bounded recent window instead of a magic count.
 *
 * Pure functions take an `estimate(text)` so they're deterministic in tests;
 * production passes the shared heuristic estimator. Mirrors the budgeting in the
 * Kairo (Java) TokenBudgetManager — this is our own design ported to the app.
 */

import type { SessionMessage } from '../shared/types'

export type Estimate = (text: string) => number

/** Flatten a session message (content + tool calls/results) to text for sizing. */
export function messageText(m: SessionMessage): string {
  let text = `${m.role}: ${m.content ?? ''}`
  if (m.toolCalls) {
    for (const tc of m.toolCalls) {
      let args = ''
      try {
        args = tc.args ? JSON.stringify(tc.args) : ''
      } catch {
        args = ''
      }
      text += ` ${tc.toolName ?? ''} ${args} ${tc.result ?? ''}`
    }
  }
  return text
}

/** Estimated tokens for a list of session messages. */
export function estimateMessagesTokens(messages: SessionMessage[], estimate: Estimate): number {
  let total = 0
  for (const m of messages) total += estimate(messageText(m))
  return total
}

export interface ContextUsage {
  tokens: number
  maxTokens: number
  /** 0..1 fraction of the budget used. */
  ratio: number
  /** True once usage crosses `threshold` of the budget. */
  shouldCompact: boolean
}

/** Compute current context usage against a budget. */
export function contextUsage(
  messages: SessionMessage[],
  maxTokens: number,
  estimate: Estimate,
  threshold = 0.8
): ContextUsage {
  const tokens = estimateMessagesTokens(messages, estimate)
  const ratio = maxTokens > 0 ? tokens / maxTokens : 0
  return { tokens, maxTokens, ratio, shouldCompact: ratio >= threshold }
}

/**
 * Pick how many trailing messages to keep so the recent window fits within
 * `maxTailTokens`, but always keep at least `minKeep` (and never more than the
 * total). Walking from the newest backward, we stop before exceeding the tail
 * budget — so a few huge recent messages keep fewer items, many small ones keep
 * more. Returns the index to keep FROM (messages[keepFrom..] are retained).
 */
export function selectRecentWindow(
  messages: SessionMessage[],
  maxTailTokens: number,
  estimate: Estimate,
  minKeep = 4
): number {
  const n = messages.length
  if (n <= minKeep) return 0
  let used = 0
  let kept = 0
  for (let i = n - 1; i >= 0; i--) {
    const t = estimate(messageText(messages[i]!))
    if (kept >= minKeep && used + t > maxTailTokens) {
      return i + 1
    }
    used += t
    kept += 1
  }
  return 0
}
