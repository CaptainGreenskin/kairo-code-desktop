/**
 * Fetches the Code System Map from main, with the incremental cache doing the
 * heavy lifting on the other side. `active` gates the fetch so closed panels
 * don't scan; `refresh()` re-runs it (cheap — the main-process cache only
 * re-reads changed files), which the live "World" map uses while a crew runs.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../stores/app-store'
import type { CodeMap } from '../../shared/code-map'
import type { CodeMapScanStats } from '../../shared/types'

export interface CodeMapData {
  map: CodeMap | null
  loading: boolean
  error: string | null
  stats: CodeMapScanStats | null
  refresh: () => void
}

export function useCodeMapData(active: boolean): CodeMapData {
  const workspacePath = useAppStore((s) => s.workspacePath)
  const [map, setMap] = useState<CodeMap | null>(null)
  const [stats, setStats] = useState<CodeMapScanStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!active) return
    if (typeof window.kairoAPI?.getCodeMap !== 'function') return
    let cancelled = false
    // Only show the spinner on the very first load; refreshes update in place
    // so the live map doesn't flicker between scans.
    setLoading((prev) => prev || map === null)
    setError(null)
    void window.kairoAPI
      .getCodeMap(workspacePath ?? undefined)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.map) {
          setMap(res.map)
          setStats(res.stats ?? null)
        } else {
          setError(res.error ?? 'Failed to scan')
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspacePath, tick])

  // Live updates: the main process pushes a freshly-assembled map whenever the
  // file watcher sees a source change (precise invalidation, no polling).
  useEffect(() => {
    if (!active) return
    if (typeof window.kairoAPI?.onCodeMapChanged !== 'function') return
    return window.kairoAPI.onCodeMapChanged(({ map: next }) => {
      setMap(next)
      setStats((prev) => (prev ? { ...prev, cached: true, read: 0, reused: prev.total } : prev))
    })
  }, [active])

  return { map, loading, error, stats, refresh }
}
