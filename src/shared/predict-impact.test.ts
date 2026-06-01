import { describe, expect, it } from 'vitest'
import { predictImpact } from './predict-impact'
import type { CodeMap, CouplingEdge } from './code-map'

// ui → api → db ; mailer is coupled to api via a shared table (no import).
const map: CodeMap = {
  modules: [
    { id: 'src/ui', label: 'src/ui', fileCount: 1, loc: 1, files: [] },
    { id: 'src/api', label: 'src/api', fileCount: 1, loc: 1, files: [] },
    { id: 'src/db', label: 'src/db', fileCount: 1, loc: 1, files: [] },
    { id: 'src/mailer', label: 'src/mailer', fileCount: 1, loc: 1, files: [] }
  ],
  edges: [
    { from: 'src/ui', to: 'src/api', weight: 1 },
    { from: 'src/api', to: 'src/db', weight: 1 }
  ]
}
const coupling: CouplingEdge[] = [{ from: 'src/api', to: 'src/mailer', kind: 'table', key: 'orders' }]

describe('predictImpact', () => {
  it('predicts seeds from the task text and the import blast radius', () => {
    const p = predictImpact('refactor the db layer', { map, protectedGlobs: [], debtModules: [] })
    expect(p.predicted).toEqual(['src/db'])
    // ui and api transitively depend on db.
    expect(p.blast.sort()).toEqual(['src/api', 'src/ui'])
  })

  it('includes hidden-coupling links in the blast radius', () => {
    const p = predictImpact('change the db', { map, protectedGlobs: [], debtModules: [], couplingEdges: coupling })
    // db ← api (import) ← ui; and api ↔ mailer (coupling) → mailer is reachable.
    expect(p.blast).toContain('src/mailer')
  })

  it('flags invariants and debt in the predicted + blast set', () => {
    // Changing api breaks ui (imports api) and reaches mailer (shared table).
    const p = predictImpact('touch the api', {
      map,
      protectedGlobs: ['**/ui/**'],
      debtModules: ['src/mailer'],
      couplingEdges: coupling
    })
    expect(p.predicted).toEqual(['src/api'])
    expect(p.invariantsAtRisk).toContain('src/ui') // ui imports api → in blast, and protected
    expect(p.debtHit).toContain('src/mailer') // coupled to api via table → in blast, carries debt
    expect(p.summary).toMatch(/不变量/)
    expect(p.summary).toMatch(/带债/)
  })

  it('returns nothing actionable when the task names no module', () => {
    const p = predictImpact('做点事情', { map, protectedGlobs: [], debtModules: [] })
    expect(p.predicted).toEqual([])
    expect(p.summary).toMatch(/没点到/)
  })
})
