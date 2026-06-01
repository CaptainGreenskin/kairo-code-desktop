/**
 * Loads the comprehension signals an overnight run needs to brief on, and folds
 * them into a {@link Briefing}. Reuses the same pure computations the Code Map
 * uses (Map Delta, comprehension health, governance) so the morning briefing is
 * consistent with the Living Map the human then drills into.
 */

import { computeMapDelta } from '../../shared/map-delta'
import { comprehensionHealth } from '../../shared/comprehension-health'
import { computeComprehensionDebt } from '../../shared/comprehension-debt'
import { computeDriftTrend } from '../../shared/drift-trend'
import { governanceVerdict } from '../../shared/governance'
import { buildBriefing, type Briefing } from '../../shared/briefing'

export async function loadBriefing(stopReason: string, workspacePath?: string): Promise<Briefing> {
  const api = window.kairoAPI
  const ws = workspacePath
  const [changesR, seenR, decR, commitsR, mapR] = await Promise.all([
    api.getChanges(ws),
    api.getLastSeen(ws),
    typeof api.getGateDecisions === 'function' ? api.getGateDecisions(ws) : Promise.resolve({ ok: true as const, decisions: [] }),
    typeof api.getGitHistory === 'function' ? api.getGitHistory(ws) : Promise.resolve({ ok: true as const, commits: [] }),
    api.getCodeMap(ws)
  ])
  const changes = changesR.ok ? changesR.changes : []
  const lastSeen = seenR.ok ? seenR.at : 0
  const decisions = decR.ok ? decR.decisions : []
  const commits = commitsR.ok ? commitsR.commits : []
  const map = mapR.ok && mapR.map ? mapR.map : null

  const delta = computeMapDelta(changes, lastSeen)
  const debt = computeComprehensionDebt(changes, decisions)
  const drift = computeDriftTrend(changes)
  const health = map ? comprehensionHealth({ map, changes, commits, decisions, lastSeen }) : null
  const governance = governanceVerdict({ debt, drift })
  // Changes since the human last caught up that ran no tests.
  const unverifiedCount = changes.filter((c) => c.at > lastSeen && c.verified === false).length

  return buildBriefing({ stopReason, delta, health, governance, unverifiedCount })
}
