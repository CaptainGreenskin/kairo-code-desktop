import { describe, expect, it } from 'vitest'
import { buildDrill, scoreDrill, tallyDrills } from './comprehension-drill'
import type { CodeMap } from './code-map'

// x,y,z depend on core; w depends on api. So core (3) and api (1) have deps.
const map: CodeMap = {
  modules: ['core', 'api', 'x', 'y', 'z', 'w'].map((id) => ({ id, label: id, fileCount: 1, loc: 1, files: [] })),
  edges: [
    { from: 'x', to: 'core', weight: 1 },
    { from: 'y', to: 'core', weight: 1 },
    { from: 'z', to: 'core', weight: 1 },
    { from: 'w', to: 'api', weight: 1 }
  ]
}

describe('buildDrill', () => {
  it('returns null when no module has a dependent', () => {
    expect(buildDrill({ modules: [{ id: 'a', label: 'a', fileCount: 1, loc: 1, files: [] }], edges: [] })).toBeNull()
  })

  it('asks about a module that has dependents, with the correct answer present', () => {
    const d = buildDrill(map, { seed: 0 })!
    expect(d.question).toMatch(/谁直接依赖/)
    expect(['core', 'api']).toContain(d.target)
    // The option at answerIndex really is a dependent of the target.
    const deps = map.edges.filter((e) => e.to === d.target).map((e) => e.from)
    expect(deps).toContain(d.options[d.answerIndex])
    // Distractors are NOT dependents.
    d.options.forEach((opt, i) => {
      if (i !== d.answerIndex) expect(deps).not.toContain(opt)
    })
  })

  it('prefers the least-engaged module as target', () => {
    // Engage core → drill should target api instead.
    const d = buildDrill(map, { seed: 0, engaged: new Set(['core']) })!
    expect(d.target).toBe('api')
  })

  it('is deterministic for a given seed', () => {
    expect(buildDrill(map, { seed: 2 })).toEqual(buildDrill(map, { seed: 2 }))
  })
})

describe('scoreDrill + tallyDrills', () => {
  it('scores the chosen option', () => {
    const d = buildDrill(map, { seed: 0 })!
    expect(scoreDrill(d, d.answerIndex)).toBe(true)
    expect(scoreDrill(d, (d.answerIndex + 1) % d.options.length)).toBe(false)
  })
  it('tallies accuracy (the real comprehension metric)', () => {
    expect(tallyDrills([true, true, false, true])).toEqual({ correct: 3, total: 4, accuracy: 0.75 })
    expect(tallyDrills([]).accuracy).toBe(1)
  })
})
