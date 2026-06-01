import { describe, expect, it } from 'vitest'
import { fallbackPlan, parseCrewPlan } from './crew-plan'
import { ROLE_LIBRARY } from '../shared/crew-roles'
import type { CrewRoleConfig } from '../shared/types'

const ROLES: CrewRoleConfig[] = [
  { id: 'planner', label: 'Planner', systemPrompt: 'plan' },
  { id: 'coder', label: 'Coder', systemPrompt: 'code', allowedTools: ['edit'] },
  { id: 'reviewer', label: 'Reviewer', systemPrompt: 'review' }
]

describe('fallbackPlan', () => {
  it('produces one brief per role in roster order', () => {
    const p = fallbackPlan('do x', ROLES)
    expect(p.steps.map((s) => s.roleId)).toEqual(['planner', 'coder', 'reviewer'])
    expect(p.approach).toContain('do x')
  })
})

describe('parseCrewPlan', () => {
  it('parses a clean JSON plan', () => {
    const text = JSON.stringify({
      approach: 'build the feature',
      steps: [
        { roleId: 'planner', brief: 'outline the API' },
        { roleId: 'coder', brief: 'implement it' }
      ]
    })
    const p = parseCrewPlan(text, 'task', ROLES)
    expect(p.approach).toBe('build the feature')
    expect(p.steps).toEqual([
      { roleId: 'planner', brief: 'outline the API' },
      { roleId: 'coder', brief: 'implement it' }
    ])
  })

  it('extracts JSON embedded in prose', () => {
    const text = 'Here is the plan:\n{"approach":"a","steps":[{"roleId":"coder","brief":"do it"}]}\nThanks.'
    const p = parseCrewPlan(text, 'task', ROLES)
    expect(p.steps).toEqual([{ roleId: 'coder', brief: 'do it' }])
  })

  it('drops steps with unknown roleIds', () => {
    const text = JSON.stringify({
      approach: 'a',
      steps: [
        { roleId: 'ghost', brief: 'nope' },
        { roleId: 'coder', brief: 'yes' }
      ]
    })
    const p = parseCrewPlan(text, 'task', ROLES)
    expect(p.steps).toEqual([{ roleId: 'coder', brief: 'yes' }])
  })

  it('de-dupes repeated roleIds (keeps first)', () => {
    const text = JSON.stringify({
      approach: 'a',
      steps: [
        { roleId: 'coder', brief: 'first' },
        { roleId: 'coder', brief: 'second' }
      ]
    })
    expect(parseCrewPlan(text, 'task', ROLES).steps).toEqual([{ roleId: 'coder', brief: 'first' }])
  })

  it('falls back when JSON is junk', () => {
    const p = parseCrewPlan('not json at all', 'task X', ROLES)
    expect(p.steps).toHaveLength(ROLES.length)
  })

  it('falls back when steps end up empty', () => {
    const text = JSON.stringify({ approach: 'a', steps: [{ roleId: 'ghost', brief: 'x' }] })
    const p = parseCrewPlan(text, 'task', ROLES)
    expect(p.steps).toHaveLength(ROLES.length)
  })

  it('composes a research roster from the library (no Coder)', () => {
    const text = JSON.stringify({
      approach: 'evaluate GraphQL vs REST',
      steps: [
        { roleId: 'researcher', brief: 'gather pros/cons' },
        { roleId: 'analyst', brief: 'compare on cost/risk' },
        { roleId: 'synthesizer', brief: 'write the recommendation' }
      ]
    })
    const p = parseCrewPlan(text, 'research task', ROLE_LIBRARY)
    expect(p.roles.map((r) => r.id)).toEqual(['researcher', 'analyst', 'synthesizer'])
    // The composed roster is materialized from the library (real configs).
    expect(p.roles.every((r) => !r.allowedTools || !r.allowedTools.includes('write_file'))).toBe(true)
    expect(p.roles.map((r) => r.id)).not.toContain('coder')
  })

  it('materializes the Team Lead dependency graph onto the roster (parallel fork)', () => {
    const text = JSON.stringify({
      approach: 'full-stack feature',
      steps: [
        { roleId: 'planner', brief: 'plan', dependsOn: [] },
        { roleId: 'coder', brief: 'frontend', dependsOn: ['planner'] },
        { roleId: 'tester', brief: 'backend tests', dependsOn: ['planner'] },
        { roleId: 'reviewer', brief: 'review', dependsOn: ['coder', 'tester'] }
      ]
    })
    const p = parseCrewPlan(text, 'task', ROLE_LIBRARY)
    const dep = (id: string): string[] | undefined => p.roles.find((r) => r.id === id)?.dependsOn
    expect(dep('planner')).toBeUndefined()
    expect(dep('coder')).toEqual(['planner'])
    expect(dep('tester')).toEqual(['planner']) // coder ∥ tester
    expect(dep('reviewer')).toEqual(['coder', 'tester'])
    // Steps also carry the graph.
    expect(p.steps.find((s) => s.roleId === 'reviewer')?.dependsOn).toEqual(['coder', 'tester'])
  })

  it('drops dependsOn pointing at non-picked roles', () => {
    const text = JSON.stringify({
      approach: 'x',
      steps: [{ roleId: 'coder', brief: 'do it', dependsOn: ['ghost', 'coder'] }]
    })
    const p = parseCrewPlan(text, 'task', ROLE_LIBRARY)
    expect(p.roles.find((r) => r.id === 'coder')?.dependsOn).toBeUndefined()
  })

  it('uses fallback approach when approach missing but steps valid', () => {
    const text = JSON.stringify({ steps: [{ roleId: 'coder', brief: 'do it' }] })
    const p = parseCrewPlan(text, 'task', ROLES)
    expect(p.approach.length).toBeGreaterThan(0)
    expect(p.steps).toEqual([{ roleId: 'coder', brief: 'do it' }])
  })
})
