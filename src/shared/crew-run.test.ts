import { describe, expect, it } from 'vitest'
import { newCrewRun, reduceCrewView, withPlan } from './crew-run'
import type { CrewPlan } from './types'

describe('crew-run view model', () => {
  it('starts in the planning phase', () => {
    const v = newCrewRun('c1', 'do x', 'sequential')
    expect(v.phase).toBe('planning')
    expect(v.agents).toEqual([])
  })

  it('withPlan advances to review and carries the DAG roles', () => {
    const plan: CrewPlan = {
      approach: 'a',
      roles: [
        { id: 'planner', label: 'Planner', systemPrompt: 'p' },
        { id: 'coder', label: 'Coder', systemPrompt: 'c', dependsOn: ['planner'] }
      ],
      steps: [{ roleId: 'planner', brief: 'b' }]
    }
    const v = withPlan(newCrewRun('c1', 't', 'sequential'), plan)
    expect(v.phase).toBe('reviewing')
    expect(v.roles.map((r) => r.id)).toEqual(['planner', 'coder'])
    expect(v.roles[1]?.dependsOn).toEqual(['planner'])
  })

  it('reduces the event stream from start to done', () => {
    let v = newCrewRun('c1', 't', 'sequential')
    v = reduceCrewView(v, {
      type: 'crew-start', crewId: 'c1', sessionId: 's', task: 't', strategy: 'sequential',
      roles: [{ id: 'coder', label: 'Coder' }]
    })
    expect(v.phase).toBe('running')
    expect(v.agents).toHaveLength(1)

    v = reduceCrewView(v, { type: 'agent-start', crewId: 'c1', roleId: 'coder' })
    expect(v.agents[0]?.status).toBe('running')

    v = reduceCrewView(v, { type: 'agent-token', crewId: 'c1', roleId: 'coder', delta: 'hello' })
    expect(v.agents[0]?.output).toBe('hello')

    v = reduceCrewView(v, { type: 'agent-tool', crewId: 'c1', roleId: 'coder', toolName: 'edit', path: 'src/main/a.ts', toolCallId: 't1', args: { path: 'src/main/a.ts' } })
    expect(v.agents[0]?.toolCalls.map((t) => t.name)).toEqual(['edit'])
    expect(v.agents[0]?.currentModule).toBe('src/main')

    v = reduceCrewView(v, { type: 'agent-tool-result', crewId: 'c1', roleId: 'coder', toolCallId: 't1', ok: true, result: 'done' })
    expect(v.agents[0]?.toolCalls[0]?.result).toBe('done')
    expect(v.agents[0]?.toolCalls[0]?.ok).toBe(true)

    v = reduceCrewView(v, { type: 'agent-end', crewId: 'c1', roleId: 'coder', tokensUsed: 42 })
    expect(v.agents[0]?.status).toBe('done')
    expect(v.agents[0]?.tokensUsed).toBe(42)

    v = reduceCrewView(v, { type: 'crew-end', crewId: 'c1', reason: 'completed' })
    expect(v.phase).toBe('done')
    expect(v.reason).toBe('completed')
  })

  it('crew-end marks any still-running agent as done', () => {
    let v = newCrewRun('c1', 't', 'parallel')
    v = reduceCrewView(v, {
      type: 'crew-start', crewId: 'c1', sessionId: 's', task: 't', strategy: 'parallel',
      roles: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
    })
    v = reduceCrewView(v, { type: 'agent-start', crewId: 'c1', roleId: 'a' })
    v = reduceCrewView(v, { type: 'crew-end', crewId: 'c1', reason: 'aborted' })
    expect(v.agents.every((a) => a.status === 'done' || a.status === 'pending')).toBe(true)
    expect(v.agents.find((a) => a.id === 'a')?.status).toBe('done')
  })
})
