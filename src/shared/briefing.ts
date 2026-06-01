/**
 * Morning briefing — the payoff of overnight autonomy and the comprehension
 * instrument's killer scene: you come back to a one-glance summary of what the
 * fleet did while you were away — how much changed, how much needs your
 * judgment, whether your understanding is drifting, and any governance alarm —
 * instead of reading 40 PRs. Pure: composes already-computed signals. The UI
 * routes attention from here to the Living Map / gate.
 */

import { pct } from './track-record'
import type { MapDelta } from './map-delta'
import type { ComprehensionHealth } from './comprehension-health'
import type { GovernanceVerdict } from './governance'

export interface Briefing {
  /** One-line summary (toast / banner headline). */
  headline: string
  /** Supporting lines, ordered by attention priority. */
  lines: string[]
  /** True when there is anything worth surfacing at all. */
  hasContent: boolean
  /** Modules most worth looking at first (stale / drifting). */
  focusModules: string[]
}

export interface BriefingInput {
  /** Why the overnight run ended (from nightwatch). */
  stopReason?: string
  delta: MapDelta | null
  health: ComprehensionHealth | null
  governance: GovernanceVerdict | null
  /** Changes since last caught-up that ran NO tests (anti-rubber-stamp). */
  unverifiedCount?: number
}

/** Build the morning briefing from the current comprehension signals. */
export function buildBriefing(input: BriefingInput): Briefing {
  const { delta, health, governance, stopReason, unverifiedCount = 0 } = input
  const changes = delta?.sinceCount ?? 0
  const toJudge = delta?.needsJudgment.length ?? 0

  const headline =
    changes > 0
      ? `隔夜运行结束：${changes} 处变更${toJudge > 0 ? ` · ${toJudge} 处待你判断` : ''}`
      : '隔夜运行结束：系统无变更'

  const lines: string[] = []
  if (stopReason) lines.push(`停止原因：${stopReason}`)
  // Anti-rubber-stamp: surface unverified changes loudly — you should not wake
  // to code that was written autonomously and never tested.
  if (unverifiedCount > 0) lines.push(`⚠️ ${unverifiedCount} 处改动未跑测试验证 — 凭什么相信它对？`)
  if (health) {
    lines.push(
      `理解力 ${pct(health.score)}` +
        (health.staleModules.length > 0 ? ` · ${health.staleModules.length} 处漂移` : '')
    )
  }
  if (governance && governance.action !== 'ok') {
    lines.push(`治理：${governance.reason}`)
  }
  if (toJudge > 0) {
    const mods = (delta?.needsJudgment ?? []).flatMap((c) => c.modules).slice(0, 5)
    if (mods.length > 0) lines.push(`待判断模块：${[...new Set(mods)].join('、')}`)
  }

  const focusModules = [
    ...new Set([
      ...(delta?.needsJudgment ?? []).flatMap((c) => c.modules),
      ...(health?.staleModules ?? []).map((m) => m.id),
      ...(governance?.modules ?? [])
    ])
  ].slice(0, 6)

  return { headline, lines, hasContent: changes > 0 || lines.length > 0, focusModules }
}
