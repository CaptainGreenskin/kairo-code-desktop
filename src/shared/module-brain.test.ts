import { describe, expect, it } from 'vitest'
import { computeHealth, moduleBrain, moduleBrainToMarkdown, parseMapIntent } from './module-brain'
import type { CodeMap } from './code-map'
import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'

// a → b → c  and  d → b  (so b is a hub: a, d, and transitively nothing else
// import it; b imports c). 'b' has fan-in 2 from a,d.
const map: CodeMap = {
  modules: [
    { id: 'src/a', label: 'src/a', fileCount: 2, loc: 20, files: [] },
    { id: 'src/b', label: 'src/b', fileCount: 3, loc: 30, files: [] },
    { id: 'src/c', label: 'src/c', fileCount: 1, loc: 10, files: [] },
    { id: 'src/d', label: 'src/d', fileCount: 1, loc: 10, files: [] }
  ],
  edges: [
    { from: 'src/a', to: 'src/b', weight: 1 },
    { from: 'src/d', to: 'src/b', weight: 1 },
    { from: 'src/b', to: 'src/c', weight: 1 }
  ]
}

describe('parseMapIntent', () => {
  it('detects dependents intent and strips the intent words', () => {
    const r = parseMapIntent('谁依赖 src/b')
    expect(r.intent).toBe('dependents')
    expect(r.term).toBe('src/b')
  })

  it('detects dependencies, why, safety, changes intents', () => {
    expect(parseMapIntent('src/b 依赖谁').intent).toBe('dependencies')
    expect(parseMapIntent('why is src/b like this').intent).toBe('why')
    expect(parseMapIntent('src/b 安全吗').intent).toBe('safety')
    expect(parseMapIntent('src/b 最近变了什么').intent).toBe('changes')
  })

  it('falls back to overview for a bare module name', () => {
    const r = parseMapIntent('src/b')
    expect(r.intent).toBe('overview')
    expect(r.term).toBe('src/b')
  })

  it('strips english intent phrases too', () => {
    const r = parseMapIntent('who depends on auth')
    expect(r.intent).toBe('dependents')
    expect(r.term).toBe('auth')
  })
})

describe('moduleBrain', () => {
  const base = { map, decisions: [] as GateDecision[], changes: [] as ChangeRecord[], protectedGlobs: [] as string[], lastSeen: 0 }

  it('returns null when the query resolves to no module', () => {
    expect(moduleBrain({ ...base, query: 'zzz' })).toBeNull()
  })

  it('computes topology + role for a hub', () => {
    const b = moduleBrain({ ...base, query: 'b' })!
    expect(b.focus).toBe('src/b')
    expect(b.role).toBe('connector') // fan-in 2 (<3), fan-out 1
    expect(b.fanIn).toBe(2)
    expect(b.fanOut).toBe(1)
    // a and d transitively depend on b; b depends on c.
    expect(b.dependents.sort()).toEqual(['src/a', 'src/d'])
    expect(b.dependencies).toEqual(['src/c'])
  })

  it('classifies a widely-depended module as a hub', () => {
    const wide: CodeMap = {
      modules: [
        { id: 'core', label: 'core', fileCount: 1, loc: 1, files: [] },
        { id: 'x', label: 'x', fileCount: 1, loc: 1, files: [] },
        { id: 'y', label: 'y', fileCount: 1, loc: 1, files: [] },
        { id: 'z', label: 'z', fileCount: 1, loc: 1, files: [] }
      ],
      edges: [
        { from: 'x', to: 'core', weight: 1 },
        { from: 'y', to: 'core', weight: 1 },
        { from: 'z', to: 'core', weight: 1 }
      ]
    }
    expect(moduleBrain({ ...base, map: wide, query: 'core' })!.role).toBe('hub')
  })

  it('flags invariant regions from protected globs', () => {
    const b = moduleBrain({ ...base, query: 'b', protectedGlobs: ['src/b/**'] })!
    expect(b.invariant).toBe(true)
    expect(moduleBrain({ ...base, query: 'c', protectedGlobs: ['src/b/**'] })!.invariant).toBe(false)
  })

  it('scopes comprehension debt + trust + delta to the focus', () => {
    const changes: ChangeRecord[] = [
      { at: 100, task: 'x', modules: ['src/b'], filesChanged: [], risk: 'review', verified: false },
      { at: 200, task: 'y', modules: ['src/b'], filesChanged: [], risk: 'auto', verified: true },
      { at: 150, task: 'z', modules: ['src/c'], filesChanged: [], risk: 'review', verified: false }
    ]
    // A decision confirming src/c (but not src/b) → src/b's review change is debt.
    const decisions: GateDecision[] = [
      { at: 160, outcome: 'passed', files: [], modules: ['src/c'] }
    ]
    const b = moduleBrain({ ...base, query: 'b', changes, decisions, lastSeen: 120 })!
    expect(b.trust).toEqual({ changes: 2, verified: 1, auto: 1, review: 1 })
    expect(b.deltaCount).toBe(1) // only at:200 > lastSeen 120
    expect(b.debt).toBe(1) // the unconfirmed review change on src/b
  })

  it('separates focus decisions from blast-radius decisions', () => {
    const decisions: GateDecision[] = [
      { at: 300, outcome: 'changes', question: 'on b?', files: [], modules: ['src/b'] },
      { at: 250, outcome: 'passed', question: 'on a?', files: [], modules: ['src/a'] }
    ]
    const b = moduleBrain({ ...base, query: 'b', decisions })!
    expect(b.decisions.map((d) => d.question)).toEqual(['on b?'])
    // a is a transitive dependent of b → its decision is in the blast radius.
    expect(b.blastDecisions.map((d) => d.question)).toEqual(['on a?'])
  })

  it('counts invariant + debt modules in the downstream impact', () => {
    const changes: ChangeRecord[] = [
      { at: 100, task: 'x', modules: ['src/a'], filesChanged: [], risk: 'review', verified: false }
    ]
    const b = moduleBrain({
      ...base,
      query: 'b',
      changes,
      protectedGlobs: ['src/a/**'],
      lastSeen: 0
    })!
    expect(b.impact.downstream).toBe(2) // a, d
    expect(b.impact.protectedDownstream).toBe(1) // a
    expect(b.impact.debtDownstream).toBe(1) // a (unconfirmed review change)
  })
})

describe('moduleBrain — git history, freshness, alternatives', () => {
  const base = { map, decisions: [] as GateDecision[], changes: [] as ChangeRecord[], protectedGlobs: [] as string[], lastSeen: 0 }

  it('hangs git commits as history and tracks the latest change time', () => {
    const commits = [
      { hash: 'a', at: 5000, author: 'Ann', subject: 'refactor b', files: ['src/b/x.ts'] },
      { hash: 'z', at: 1000, author: 'Zed', subject: 'unrelated', files: ['src/c/y.ts'] }
    ]
    const b = moduleBrain({ ...base, query: 'b', commits })!
    expect(b.history.map((c) => c.subject)).toEqual(['refactor b'])
    expect(b.lastChangeAt).toBe(5000)
  })

  it('takes lastChangeAt from the crew log when newer than git', () => {
    const changes: ChangeRecord[] = [
      { at: 9000, task: 't', modules: ['src/b'], filesChanged: [], risk: 'auto', verified: true }
    ]
    const commits = [{ hash: 'a', at: 5000, author: 'Ann', subject: 'old', files: ['src/b/x.ts'] }]
    expect(moduleBrain({ ...base, query: 'b', changes, commits })!.lastChangeAt).toBe(9000)
  })

  it('surfaces the focus module hidden coupling (non-import edges)', () => {
    const couplingEdges = [
      { from: 'src/b', to: 'src/c', kind: 'table' as const, key: 'orders' },
      { from: 'src/a', to: 'src/d', kind: 'event' as const, key: 'x' }
    ]
    const b = moduleBrain({ ...base, query: 'b', couplingEdges })!
    expect(b.coupling).toEqual([{ from: 'src/b', to: 'src/c', kind: 'table', key: 'orders' }])
  })

  it('surfaces other matching modules as alternatives', () => {
    const multi = {
      modules: [
        { id: 'src/auth', label: 'src/auth', fileCount: 1, loc: 1, files: [] },
        { id: 'src/main/auth', label: 'src/main/auth', fileCount: 1, loc: 1, files: [] }
      ],
      edges: []
    }
    const b = moduleBrain({ ...base, map: multi, query: 'auth' })!
    expect(b.focus).toBe('src/auth')
    expect(b.alternatives).toEqual(['src/main/auth'])
  })
})

describe('computeHealth', () => {
  const clean = { invariant: false, debt: 0, deltaCount: 0, trust: { changes: 0, verified: 0, auto: 0, review: 0 }, impact: { downstream: 0, protectedDownstream: 0, debtDownstream: 0 } }

  it('is healthy when there is nothing to worry about', () => {
    expect(computeHealth(clean).level).toBe('healthy')
  })

  it('is risk when the module carries comprehension debt', () => {
    expect(computeHealth({ ...clean, debt: 2 }).level).toBe('risk')
  })

  it('is risk when an invariant region has pending changes', () => {
    expect(computeHealth({ ...clean, invariant: true, deltaCount: 1 }).level).toBe('risk')
  })

  it('is risk when downstream debt would be hit', () => {
    expect(computeHealth({ ...clean, impact: { downstream: 3, protectedDownstream: 0, debtDownstream: 1 } }).level).toBe('risk')
  })

  it('is watch for pending delta, low verify, or invariant', () => {
    expect(computeHealth({ ...clean, deltaCount: 1 }).level).toBe('watch')
    expect(computeHealth({ ...clean, trust: { changes: 4, verified: 1, auto: 0, review: 0 } }).level).toBe('watch')
    expect(computeHealth({ ...clean, invariant: true }).level).toBe('watch')
  })

  it('flows through moduleBrain as the verdict', () => {
    const changes: ChangeRecord[] = [
      { at: 100, task: 'x', modules: ['src/b'], filesChanged: [], risk: 'review', verified: false }
    ]
    const b = moduleBrain({ map, query: 'b', decisions: [], changes, protectedGlobs: [], lastSeen: 0 })!
    expect(b.health.level).toBe('risk') // unconfirmed review change → debt
  })
})

describe('moduleBrainToMarkdown', () => {
  it('renders the high-signal facts and omits empty sections', () => {
    const b = moduleBrain({
      map,
      query: 'b',
      decisions: [{ at: 1, outcome: 'passed', question: 'ok?', files: [], modules: ['src/b'] }],
      changes: [{ at: 1, task: 's', modules: ['src/b'], filesChanged: [], risk: 'auto', verified: true }],
      protectedGlobs: ['src/b/**'],
      lastSeen: 0
    })!
    const md = moduleBrainToMarkdown(b)
    expect(md).toContain('Module dossier: `src/b`')
    expect(md).toContain('Invariant region')
    expect(md).toContain('Decision history')
    expect(md).toContain('ok?')
  })
})
