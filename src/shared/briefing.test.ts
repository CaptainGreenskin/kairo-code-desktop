import { describe, expect, it } from 'vitest'
import { buildBriefing } from './briefing'
import type { MapDelta } from './map-delta'
import type { ComprehensionHealth } from './comprehension-health'
import type { GovernanceVerdict } from './governance'

const delta: MapDelta = {
  lastSeen: 0,
  sinceCount: 7,
  modules: [],
  needsJudgment: [
    { at: 1, task: 't', modules: ['src/auth'], filesChanged: [], risk: 'review' }
  ]
}
const health: ComprehensionHealth = {
  score: 0.62,
  liveModules: 8,
  freshModules: 5,
  staleModules: [{ id: 'src/payment', lastChangeAt: 2, lastUnderstoodAt: 1, weight: 3 }]
}
const gov: GovernanceVerdict = { action: 'review-first', reason: '2 处变更待确认', modules: ['src/auth'] }

describe('buildBriefing', () => {
  it('summarizes changes + things to judge in the headline', () => {
    const b = buildBriefing({ delta, health, governance: gov, stopReason: '任务完成 — 模型未请求继续' })
    expect(b.headline).toMatch(/7 处变更/)
    expect(b.headline).toMatch(/1 处待你判断/)
    expect(b.hasContent).toBe(true)
  })

  it('includes stop reason, comprehension health, governance and focus modules', () => {
    const b = buildBriefing({ delta, health, governance: gov, stopReason: '达到时间预算' })
    expect(b.lines.some((l) => l.includes('停止原因：达到时间预算'))).toBe(true)
    expect(b.lines.some((l) => l.includes('理解力 62%'))).toBe(true)
    expect(b.lines.some((l) => l.includes('1 处漂移'))).toBe(true)
    expect(b.lines.some((l) => l.includes('治理：2 处变更待确认'))).toBe(true)
    expect(b.focusModules).toContain('src/auth')
    expect(b.focusModules).toContain('src/payment')
  })

  it('loudly flags unverified changes (anti-rubber-stamp)', () => {
    const b = buildBriefing({ delta, health, governance: gov, unverifiedCount: 4 })
    expect(b.lines.some((l) => l.includes('4 处改动未跑测试验证'))).toBe(true)
  })

  it('reports a quiet night when nothing changed', () => {
    const quiet = buildBriefing({
      delta: { lastSeen: 0, sinceCount: 0, modules: [], needsJudgment: [] },
      health: { score: 1, liveModules: 0, freshModules: 0, staleModules: [] },
      governance: { action: 'ok', reason: '', modules: [] }
    })
    expect(quiet.headline).toMatch(/无变更/)
  })
})
