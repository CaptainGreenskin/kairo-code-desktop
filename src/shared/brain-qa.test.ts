import { describe, expect, it } from 'vitest'
import { buildQaPrompt, gatherEvidence } from './brain-qa'
import type { CodeMap } from './code-map'
import type { ChangeRecord } from './map-delta'
import type { GitCommit } from './git-brain'
import type { GateDecision } from './types'

const map: CodeMap = {
  modules: [
    { id: 'src/checkout', label: 'src/checkout', fileCount: 2, loc: 50, files: ['src/checkout/pay.ts'] },
    { id: 'src/mailer', label: 'src/mailer', fileCount: 1, loc: 20, files: ['src/mailer/send.ts'] },
    { id: 'src/util', label: 'src/util', fileCount: 1, loc: 10, files: ['src/util/x.ts'] }
  ],
  edges: [{ from: 'src/checkout', to: 'src/mailer', weight: 2 }]
}

const decisions: GateDecision[] = [
  { at: 200, outcome: 'passed', question: 'q', rationale: 'mailer 是历史遗留，暂不拆', files: [], modules: ['src/checkout'], focus: 'src/checkout/pay.ts' }
]
const commits: GitCommit[] = [
  { hash: 'h1', at: 100, author: 'Ada', subject: 'checkout 接入 mailer', files: ['src/checkout/pay.ts'] }
]
const changes: ChangeRecord[] = []

describe('gatherEvidence', () => {
  it('matches modules named in the question and pulls their edges/decisions/commits', () => {
    const ev = gatherEvidence('为什么 checkout 依赖 mailer？', { map, decisions, commits, changes })
    expect(ev.focus).toBe('src/checkout')
    const kinds = ev.items.map((i) => i.kind)
    expect(kinds).toContain('edge')
    expect(kinds).toContain('decision')
    expect(kinds).toContain('commit')
    // The dependency edge checkout → mailer is present.
    expect(ev.items.some((i) => i.kind === 'edge' && i.text.includes('src/checkout → src/mailer'))).toBe(true)
    // The decision rationale (the "why") is included and links to its file.
    const dec = ev.items.find((i) => i.kind === 'decision')!
    expect(dec.text).toContain('mailer 是历史遗留')
    expect(dec.file).toBe('src/checkout/pay.ts')
    // Items are labeled E1, E2, … for citation.
    expect(ev.items[0]!.id).toBe('E1')
  })

  it('returns no items when the question names nothing in the map', () => {
    const ev = gatherEvidence('天气怎么样', { map, decisions, commits, changes })
    expect(ev.items).toEqual([])
    expect(ev.focus).toBeNull()
  })
})

describe('buildQaPrompt', () => {
  it('numbers the evidence for citation', () => {
    const ev = gatherEvidence('checkout', { map, decisions, commits, changes })
    const prompt = buildQaPrompt('checkout 安全吗', ev)
    expect(prompt).toContain('问题：checkout 安全吗')
    expect(prompt).toMatch(/\[E1\]/)
  })

  it('says so when there is no evidence', () => {
    const ev = gatherEvidence('天气', { map, decisions, commits, changes })
    expect(buildQaPrompt('天气', ev)).toContain('没有与这个问题相关的证据')
  })
})
