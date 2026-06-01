import { beforeEach, describe, expect, it } from 'vitest'
import { useCrewStore } from './crew-store'
import type { CrewEvent } from '../../shared/types'

const apply = (e: CrewEvent): void => useCrewStore.getState().apply(e)
const state = () => useCrewStore.getState()

const ROLES = [
  { id: 'planner', label: 'Planner' },
  { id: 'coder', label: 'Coder' },
  { id: 'reviewer', label: 'Reviewer' }
]

describe('crew-store reducer', () => {
  beforeEach(() => {
    useCrewStore.getState().reset()
  })

  it('crew-start seeds agents as pending and marks running', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 'do x', roles: ROLES, strategy: 'sequential' })
    const s = state()
    expect(s.crewId).toBe('c1')
    expect(s.task).toBe('do x')
    expect(s.running).toBe(true)
    expect(s.reason).toBeNull()
    expect(s.agents).toHaveLength(3)
    expect(s.agents.every((a) => a.status === 'pending')).toBe(true)
    expect(s.agents.map((a) => a.id)).toEqual(['planner', 'coder', 'reviewer'])
  })

  it('agent-start flips only the targeted role to running', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 't', roles: ROLES, strategy: 'sequential' })
    apply({ type: 'agent-start', crewId: 'c1', roleId: 'coder' })
    const s = state()
    expect(s.agents.find((a) => a.id === 'coder')?.status).toBe('running')
    expect(s.agents.find((a) => a.id === 'planner')?.status).toBe('pending')
  })

  it('agent-token accumulates output on the right role only', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 't', roles: ROLES, strategy: 'sequential' })
    apply({ type: 'agent-token', crewId: 'c1', roleId: 'planner', delta: 'Hello ' })
    apply({ type: 'agent-token', crewId: 'c1', roleId: 'planner', delta: 'world' })
    apply({ type: 'agent-token', crewId: 'c1', roleId: 'coder', delta: 'X' })
    const s = state()
    expect(s.agents.find((a) => a.id === 'planner')?.output).toBe('Hello world')
    expect(s.agents.find((a) => a.id === 'coder')?.output).toBe('X')
  })

  it('agent-tool appends tool names', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 't', roles: ROLES, strategy: 'sequential' })
    apply({ type: 'agent-tool', crewId: 'c1', roleId: 'coder', toolName: 'read_file' })
    apply({ type: 'agent-tool', crewId: 'c1', roleId: 'coder', toolName: 'edit' })
    expect(state().agents.find((a) => a.id === 'coder')?.tools).toEqual(['read_file', 'edit'])
  })

  it('agent-end marks role done and records token usage', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 't', roles: ROLES, strategy: 'sequential' })
    apply({ type: 'agent-start', crewId: 'c1', roleId: 'planner' })
    apply({ type: 'agent-end', crewId: 'c1', roleId: 'planner', tokensUsed: 1234 })
    const planner = state().agents.find((a) => a.id === 'planner')
    expect(planner?.status).toBe('done')
    expect(planner?.tokensUsed).toBe(1234)
  })

  it('crew-end stops running, sets reason, and finalizes any still-running role', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 't', roles: ROLES, strategy: 'sequential' })
    apply({ type: 'agent-start', crewId: 'c1', roleId: 'reviewer' })
    apply({ type: 'crew-end', crewId: 'c1', reason: 'completed', summary: 'all good' })
    const s = state()
    expect(s.running).toBe(false)
    expect(s.reason).toBe('completed')
    // A role left in 'running' when the crew ends should be coerced to 'done'.
    expect(s.agents.find((a) => a.id === 'reviewer')?.status).toBe('done')
  })

  it('crew-end with error carries the error message', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 't', roles: ROLES, strategy: 'sequential' })
    apply({ type: 'crew-end', crewId: 'c1', reason: 'error', error: 'boom' })
    const s = state()
    expect(s.reason).toBe('error')
    expect(s.error).toBe('boom')
  })

  it('reset clears everything', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 't', roles: ROLES, strategy: 'sequential' })
    useCrewStore.getState().reset()
    const s = state()
    expect(s.crewId).toBeNull()
    expect(s.agents).toHaveLength(0)
    expect(s.running).toBe(false)
  })

  it('a fresh crew-start replaces a previous run', () => {
    apply({ type: 'crew-start', crewId: 'c1', sessionId: 's1', task: 'first', roles: ROLES, strategy: 'sequential' })
    apply({ type: 'agent-token', crewId: 'c1', roleId: 'planner', delta: 'stale' })
    apply({ type: 'crew-start', crewId: 'c2', sessionId: 's1', task: 'second', strategy: 'sequential', roles: [{ id: 'planner', label: 'Planner' }] })
    const s = state()
    expect(s.crewId).toBe('c2')
    expect(s.task).toBe('second')
    expect(s.agents).toHaveLength(1)
    expect(s.agents[0]?.output).toBe('')
  })
})
