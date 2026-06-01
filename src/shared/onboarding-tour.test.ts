import { describe, expect, it } from 'vitest'
import { buildOnboardingTour } from './onboarding-tour'
import type { CodeMap, CouplingEdge } from './code-map'

// core is a hub (x,y,z depend on it); api a lesser hub.
const map: CodeMap = {
  modules: [
    { id: 'core', label: 'core', fileCount: 4, loc: 1, files: [] },
    { id: 'api', label: 'api', fileCount: 2, loc: 1, files: [] },
    { id: 'x', label: 'x', fileCount: 1, loc: 1, files: [] },
    { id: 'y', label: 'y', fileCount: 1, loc: 1, files: [] },
    { id: 'z', label: 'z', fileCount: 1, loc: 1, files: [] }
  ],
  edges: [
    { from: 'x', to: 'core', weight: 1 },
    { from: 'y', to: 'core', weight: 1 },
    { from: 'z', to: 'core', weight: 1 },
    { from: 'x', to: 'api', weight: 1 }
  ]
}

describe('buildOnboardingTour', () => {
  it('returns an empty tour for an empty map', () => {
    expect(buildOnboardingTour({ map: { modules: [], edges: [] }, protectedGlobs: [], debtModules: [] })).toEqual([])
  })

  it('opens with an overview then walks the hubs by fan-in', () => {
    const tour = buildOnboardingTour({ map, protectedGlobs: [], debtModules: [], hubCount: 2 })
    expect(tour[0]!.kind).toBe('overview')
    const hubs = tour.filter((s) => s.kind === 'hub')
    expect(hubs[0]!.focusModules).toEqual(['core']) // most depended on
    expect(hubs.map((h) => h.focusModules[0])).toContain('api')
  })

  it('includes invariant, debt and coupling steps when present', () => {
    const coupling: CouplingEdge[] = [{ from: 'x', to: 'y', kind: 'table', key: 'orders' }]
    const tour = buildOnboardingTour({
      map,
      protectedGlobs: ['**/core/**'],
      debtModules: ['api'],
      coupling,
      healthScore: 0.6
    })
    const kinds = tour.map((s) => s.kind)
    expect(kinds).toContain('invariant')
    expect(kinds).toContain('debt')
    expect(kinds).toContain('coupling')
    expect(tour.find((s) => s.kind === 'invariant')!.focusModules).toContain('core')
    expect(tour.find((s) => s.kind === 'debt')!.focusModules).toContain('api')
    // Always ends on the health step.
    expect(tour[tour.length - 1]!.kind).toBe('health')
    expect(tour[tour.length - 1]!.detail).toMatch(/60%/)
  })

  it('omits optional steps that have no content', () => {
    const tour = buildOnboardingTour({ map, protectedGlobs: [], debtModules: [] })
    const kinds = tour.map((s) => s.kind)
    expect(kinds).not.toContain('invariant')
    expect(kinds).not.toContain('debt')
    expect(kinds).not.toContain('coupling')
  })
})
