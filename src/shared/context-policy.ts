/**
 * Context-window self-management policy. Long autonomous sessions — overnight
 * crews, autopilot — must not silently overflow the model's context. After each
 * completed turn we measure how full the window is and decide whether to
 * auto-compact (unattended/very full) or merely suggest it (attended). Pure +
 * browser-safe so it's unit-testable and shared by the UI.
 */

export type ContextAction = 'auto' | 'suggest' | 'none'

export interface ContextPolicyOptions {
  /** Unattended (autopilot/overnight) → compact at this fullness. */
  autopilot?: boolean
  /** Always auto-compact at/above this ratio, even when attended. */
  autoThreshold?: number
  /** Suggest compaction at/above this ratio when attended. */
  suggestThreshold?: number
}

/**
 * Decide what to do about context fullness. Unattended sessions compact earlier
 * (at the suggest threshold) so they keep running without a human; attended
 * sessions only auto-compact when nearly full and otherwise just suggest.
 */
export function autoCompactDecision(ratio: number, options: ContextPolicyOptions = {}): ContextAction {
  const autoThreshold = options.autoThreshold ?? 0.9
  const suggestThreshold = options.suggestThreshold ?? 0.8
  if (ratio >= autoThreshold) return 'auto'
  if (options.autopilot && ratio >= suggestThreshold) return 'auto'
  if (ratio >= suggestThreshold) return 'suggest'
  return 'none'
}
