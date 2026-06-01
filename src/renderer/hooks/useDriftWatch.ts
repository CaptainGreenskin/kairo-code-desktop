/**
 * Drift Watch — extends the comprehension instrument from "crew output" to ANY
 * change: when a file in an invariant region (protected globs) changes —
 * including outside a crew run (git pull, a manual edit) — raise a quiet alert
 * so the human notices the system drifting under them. Throttled per path.
 */

import { useEffect } from 'react'
import { useAppStore } from '../stores/app-store'
import { useToastStore } from '../stores/toast-store'
import { isProtectedPath } from '../../shared/comprehension-router'

const THROTTLE_MS = 30_000

/** Pure: should this path raise a drift alert now, given the last alert time? */
export function shouldAlertDrift(
  path: string,
  protectedGlobs: string[],
  lastAlertedAt: number | undefined,
  now: number,
  windowMs = THROTTLE_MS
): boolean {
  if (!isProtectedPath(path, protectedGlobs)) return false
  return lastAlertedAt === undefined || now - lastAlertedAt >= windowMs
}

export function useDriftWatch(): void {
  const protectedGlobs = useAppStore((s) => s.protectedGlobs)
  useEffect(() => {
    if (typeof window.kairoAPI?.onFileChange !== 'function') return
    const lastAlerted = new Map<string, number>()
    return window.kairoAPI.onFileChange((event) => {
      const now = Date.now()
      if (!shouldAlertDrift(event.path, protectedGlobs, lastAlerted.get(event.path), now)) return
      lastAlerted.set(event.path, now)
      useToastStore.getState().addToast({
        type: 'info',
        message: `不变量区被改动：${event.path} —— 确认你看过这次变化`
      })
    })
  }, [protectedGlobs])
}
