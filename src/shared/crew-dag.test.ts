import { describe, expect, it } from 'vitest'
import { computeWaves, effectiveDeps, sinkRoleIds } from './crew-dag'
import type { CrewRoleConfig } from './types'

const role = (id: string, dependsOn?: string[]): CrewRoleConfig => ({
  id,
  label: id,
  systemPrompt: id,
  ...(dependsOn ? { dependsOn } : {})
})

describe('effectiveDeps', () => {
  it('sequential → chain in roster order', () => {
    const roles = [role('a'), role('b'), role('c')]
    const d = effectiveDeps(roles, 'sequential')
    expect(d.get('a')).toEqual([])
    expect(d.get('b')).toEqual(['a'])
    expect(d.get('c')).toEqual(['b'])
  })

  it('parallel → no deps', () => {
    const roles = [role('a'), role('b')]
    const d = effectiveDeps(roles, 'parallel')
    expect(d.get('a')).toEqual([])
    expect(d.get('b')).toEqual([])
  })

  it('uses declared deps when any role specifies them', () => {
    const roles = [role('planner'), role('fe', ['planner']), role('be', ['planner']), role('rev', ['fe', 'be'])]
    const d = effectiveDeps(roles, 'sequential') // strategy ignored when deps declared
    expect(d.get('planner')).toEqual([])
    expect(d.get('fe')).toEqual(['planner'])
    expect(d.get('rev')).toEqual(['fe', 'be'])
  })

  it('filters unknown and self deps', () => {
    const roles = [role('a'), role('b', ['a', 'ghost', 'b'])]
    const d = effectiveDeps(roles, 'parallel')
    expect(d.get('b')).toEqual(['a'])
  })

  it('per-role override: one explicit dep does NOT break the sequential pipeline (regression)', () => {
    // Tester "runs after Coder" must keep Planner→Coder→Reviewer intact,
    // not collapse them into parallel.
    const roles = [role('planner'), role('coder'), role('reviewer'), role('tester', ['coder'])]
    const d = effectiveDeps(roles, 'sequential')
    expect(d.get('planner')).toEqual([])
    expect(d.get('coder')).toEqual(['planner'])
    expect(d.get('reviewer')).toEqual(['coder'])
    expect(d.get('tester')).toEqual(['coder'])
    const { waves } = computeWaves(roles, d)
    expect(waves[0]).toEqual(['planner'])
    expect(waves[1]).toEqual(['coder'])
    expect(waves[2]?.sort()).toEqual(['reviewer', 'tester'])
  })
})

describe('computeWaves', () => {
  it('chains produce one role per wave', () => {
    const roles = [role('a'), role('b'), role('c')]
    const { waves, hasCycle } = computeWaves(roles, effectiveDeps(roles, 'sequential'))
    expect(hasCycle).toBe(false)
    expect(waves).toEqual([['a'], ['b'], ['c']])
  })

  it('parallel produces a single wave', () => {
    const roles = [role('a'), role('b'), role('c')]
    const { waves } = computeWaves(roles, effectiveDeps(roles, 'parallel'))
    expect(waves).toEqual([['a', 'b', 'c']])
  })

  it('diamond DAG: planner → (fe ∥ be) → rev', () => {
    const roles = [role('planner'), role('fe', ['planner']), role('be', ['planner']), role('rev', ['fe', 'be'])]
    const { waves, hasCycle } = computeWaves(roles, effectiveDeps(roles, 'sequential'))
    expect(hasCycle).toBe(false)
    expect(waves[0]).toEqual(['planner'])
    expect(waves[1]?.sort()).toEqual(['be', 'fe'])
    expect(waves[2]).toEqual(['rev'])
  })

  it('detects cycles', () => {
    const roles = [role('a', ['b']), role('b', ['a'])]
    const { hasCycle } = computeWaves(roles, effectiveDeps(roles, 'sequential'))
    expect(hasCycle).toBe(true)
  })
})

describe('sinkRoleIds', () => {
  it('returns roles nothing depends on', () => {
    const roles = [role('planner'), role('fe', ['planner']), role('be', ['planner']), role('rev', ['fe', 'be'])]
    expect(sinkRoleIds(roles, effectiveDeps(roles, 'sequential'))).toEqual(['rev'])
  })

  it('parallel → all are sinks', () => {
    const roles = [role('a'), role('b')]
    expect(sinkRoleIds(roles, effectiveDeps(roles, 'parallel'))).toEqual(['a', 'b'])
  })
})
