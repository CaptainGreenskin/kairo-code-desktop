/**
 * SleepTool pacing. In an overnight run the model itself decides how long to
 * wait before its next iteration by calling the `sleep` tool (e.g. "wait 30s
 * while the build finishes" / "nothing to do, idle a minute"). This resolves the
 * model's requested duration into a clamped delay the nightwatch loop honours,
 * so the agent self-paces instead of spinning on a fixed timer. Pure +
 * browser-safe. Idea: Claude Code's SleepTool; reimplemented for our loop.
 */

/** Default delay between iterations when the model didn't request a sleep. */
export const DEFAULT_SLEEP_MS = 800
/** Hard cap on a single between-iteration sleep (don't strand the loop). */
export const MAX_SLEEP_MS = 5 * 60_000

export interface SleepClampOptions {
  minMs?: number
  maxMs?: number
  defaultMs?: number
}

/** Clamp a model-requested sleep (in seconds) into a sane delay in ms. */
export function clampSleepSeconds(seconds: unknown, opts: SleepClampOptions = {}): number {
  const minMs = opts.minMs ?? 0
  const maxMs = opts.maxMs ?? MAX_SLEEP_MS
  const defaultMs = opts.defaultMs ?? DEFAULT_SLEEP_MS
  const n = typeof seconds === 'number' ? seconds : Number(seconds)
  if (!Number.isFinite(n) || n < 0) return defaultMs
  return Math.min(Math.max(Math.round(n * 1000), minMs), maxMs)
}

interface ToolCallLike {
  toolName: string
  args?: Record<string, unknown>
}

/**
 * Resolve the next-iteration delay (ms) from a turn's tool calls: the most
 * recent `sleep` call's requested seconds (clamped), or the default pace when
 * the model didn't ask to sleep.
 */
export function paceFromToolCalls(toolCalls: ToolCallLike[] | undefined, opts: SleepClampOptions = {}): number {
  const defaultMs = opts.defaultMs ?? DEFAULT_SLEEP_MS
  if (!toolCalls || toolCalls.length === 0) return defaultMs
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    if (toolCalls[i]!.toolName === 'sleep') {
      return clampSleepSeconds(toolCalls[i]!.args?.seconds, opts)
    }
  }
  return defaultMs
}
