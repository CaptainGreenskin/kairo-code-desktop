/**
 * Denial / failure loop guard. An autonomous agent (autopilot / crew) that keeps
 * retrying the SAME failing or denied tool call burns turns and tokens without
 * progress. This tracks consecutive failures per operation and, past a
 * threshold, returns a nudge to inject into the conversation so the model is
 * forced to change strategy instead of looping. A success resets the streak.
 *
 * Idea borrowed from Claude Code's denial-tracking loop guard, reimplemented.
 * Pure logic — the hook layer decides how to inject the returned nudge.
 */

export interface DenialTrackerOptions {
  /** Consecutive failures of the SAME operation before nudging. */
  maxConsecutive?: number
  /** Total failures in a turn/session before a hard "stop and rethink" nudge. */
  maxTotal?: number
}

export class DenialTracker {
  private readonly consecutive = new Map<string, number>()
  private total = 0
  private readonly maxConsecutive: number
  private readonly maxTotal: number

  constructor(opts: DenialTrackerOptions = {}) {
    this.maxConsecutive = opts.maxConsecutive ?? 3
    this.maxTotal = opts.maxTotal ?? 20
  }

  /**
   * Record a tool outcome for `key` (e.g. `toolName:argsHash`). Returns a nudge
   * string when the agent is looping, or null otherwise. After emitting a nudge
   * the relevant counter resets so it nudges once per streak, not every call.
   */
  record(key: string, isError: boolean): string | null {
    if (!isError) {
      this.consecutive.set(key, 0)
      return null
    }
    const n = (this.consecutive.get(key) ?? 0) + 1
    this.consecutive.set(key, n)
    this.total += 1

    if (n >= this.maxConsecutive) {
      this.consecutive.set(key, 0)
      return `你对同一个操作（${key}）已经连续失败 ${n} 次。停止重复同样的调用——换一种方法，或先排查失败的根因，再继续。`
    }
    if (this.total >= this.maxTotal) {
      this.total = 0
      return `本轮工具调用已累计失败 ${this.maxTotal} 次。停下来重新评估整体方案，而不是继续逐个试错。`
    }
    return null
  }

  /** Clear all streaks (e.g. on a new turn / session). */
  reset(): void {
    this.consecutive.clear()
    this.total = 0
  }
}

/** Build a stable dedup key for a tool call from its name + arguments. */
export function denialKey(toolName: string, args: unknown): string {
  let argStr = ''
  try {
    argStr = typeof args === 'string' ? args : JSON.stringify(args ?? {})
  } catch {
    argStr = String(args)
  }
  // Cap so a huge arg blob doesn't make the key unwieldy (still discriminating).
  return `${toolName}:${argStr.slice(0, 200)}`
}
