/**
 * Map Delta hook — "what changed since I last understood the system?". Fetches
 * the workspace change log + last-seen anchor and computes the delta, so the
 * Code Map can show an overnight crew's damage as "N changes · M need your
 * judgment" instead of 40 PRs. Re-fetches when `decisionsRev` bumps (a new
 * change recorded or a gate reviewed).
 */

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../stores/app-store'
import { computeMapDelta, type ChangeRecord, type MapDelta } from '../../shared/map-delta'
import { computeTrackRecord, type TrackRecord } from '../../shared/track-record'
import { computeComprehensionDebt, type ComprehensionDebt } from '../../shared/comprehension-debt'
import { computeDriftTrend, type DriftTrend } from '../../shared/drift-trend'
import type { GitCommit } from '../../shared/git-brain'
import type { GateDecision } from '../../shared/types'

export interface MapDeltaData {
  delta: MapDelta | null
  /** Workspace-level Agent Track Record (trust signal). */
  track: TrackRecord | null
  /** High-risk changes nobody confirmed — comprehension collapse, quantified. */
  debt: ComprehensionDebt | null
  /** Structural health over time (review/unverified rates per bucket). */
  drift: DriftTrend | null
  /** Gate decisions (Brain), for hanging history on Ask-the-Map results. */
  decisions: GateDecision[]
  /** Raw change log, for scoping per-module trust/delta in the dossier. */
  changes: ChangeRecord[]
  /** Git commits (non-crew history), for hanging "why" on modules. */
  commits: GitCommit[]
  /** The human's "last caught up" anchor (ms epoch); 0 means never. */
  lastSeen: number
  /** Mark the current moment as "caught up" — clears the delta. */
  markCaughtUp: () => void
}

const EMPTY: MapDelta = { lastSeen: 0, sinceCount: 0, modules: [], needsJudgment: [] }

export function useMapDelta(active: boolean): MapDeltaData {
  const workspacePath = useAppStore((s) => s.workspacePath)
  const decisionsRev = useAppStore((s) => s.decisionsRev)
  const [delta, setDelta] = useState<MapDelta | null>(null)
  const [track, setTrack] = useState<TrackRecord | null>(null)
  const [debt, setDebt] = useState<ComprehensionDebt | null>(null)
  const [drift, setDrift] = useState<DriftTrend | null>(null)
  const [decisions, setDecisions] = useState<GateDecision[]>([])
  const [changes, setChanges] = useState<ChangeRecord[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [lastSeen, setLastSeen] = useState(0)

  const load = useCallback(() => {
    const api = window.kairoAPI
    if (typeof api?.getChanges !== 'function' || typeof api?.getLastSeen !== 'function') {
      setDelta(EMPTY)
      return
    }
    const ws = workspacePath ?? undefined
    const decisionsP =
      typeof api.getGateDecisions === 'function'
        ? api.getGateDecisions(ws)
        : Promise.resolve({ ok: true as const, decisions: [] })
    const commitsP =
      typeof api.getGitHistory === 'function'
        ? api.getGitHistory(ws)
        : Promise.resolve({ ok: true as const, commits: [] })
    void Promise.all([api.getChanges(ws), api.getLastSeen(ws), decisionsP, commitsP])
      .then(async ([changesRes, seenRes, decRes, commitsRes]) => {
        const changes = changesRes.ok ? changesRes.changes : []
        let lastSeen = seenRes.ok ? seenRes.at : 0
        const decisions = decRes.ok ? decRes.decisions : []
        const commits = commitsRes.ok ? commitsRes.commits : []
        // Cold start: first time opening a project with git history — treat the
        // user as having "seen" everything up to now. Otherwise the health score
        // starts at 0% which is meaningless and anxiety-inducing.
        if (lastSeen === 0 && commits.length > 0) {
          lastSeen = Date.now()
          void api.markSeen?.(lastSeen, ws)?.catch(() => {})
        }
        setDelta(computeMapDelta(changes, lastSeen))
        setTrack(computeTrackRecord(changes, decisions))
        setDebt(computeComprehensionDebt(changes, decisions))
        setDrift(computeDriftTrend(changes))
        setDecisions(decisions)
        setChanges(changes)
        setCommits(commits)
        setLastSeen(lastSeen)
      })
      .catch(() => {
        setDelta(EMPTY)
        setTrack(null)
        setDebt(null)
        setDrift(null)
        setDecisions([])
        setChanges([])
        setCommits([])
        setLastSeen(0)
      })
  }, [workspacePath])

  useEffect(() => {
    if (!active) return
    load()
  }, [active, load, decisionsRev])

  const markCaughtUp = useCallback(() => {
    const api = window.kairoAPI
    if (typeof api?.markSeen !== 'function') return
    void api
      .markSeen(Date.now(), workspacePath ?? undefined)
      .then(() => useAppStore.getState().bumpDecisions())
      .catch(() => {})
  }, [workspacePath])

  return { delta, track, debt, drift, decisions, changes, commits, lastSeen, markCaughtUp }
}
