import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from './chat-store'
import { newCrewRun } from '../../shared/crew-run'
import type { ActivityEvent, CrewPlan } from '../../shared/types'

beforeEach(() => {
  useChatStore.getState().resetForSession('sess-1')
})

describe('chat-store subagent observability', () => {
  const activity = (over: Partial<ActivityEvent>): ActivityEvent => ({
    sessionId: 'sess-1',
    turnId: 't1',
    type: 'subagent-tool',
    timestamp: Date.now(),
    ...over
  })

  function seedParentToolCall(): void {
    useChatStore.getState().addUserMessage('find usages')
    useChatStore.getState().addToolCall({
      sessionId: 'sess-1', turnId: 't1', toolCallId: 'parent-1',
      name: 'spawn_subagent', args: { task: 'find usages of X' }, startedAt: Date.now()
    })
  }

  it('attaches sub-agent steps to the parent spawn_subagent tool call', () => {
    seedParentToolCall()
    useChatStore.getState().applySubagentActivity(
      activity({ type: 'subagent-tool', parentToolCallId: 'parent-1', toolName: 'grep', toolCallId: 'st-1', args: '{"pattern":"X"}' })
    )
    useChatStore.getState().applySubagentActivity(
      activity({ type: 'subagent-tool-result', parentToolCallId: 'parent-1', toolCallId: 'st-1', ok: true, message: 'found 3' })
    )
    useChatStore.getState().applySubagentActivity(
      activity({ type: 'subagent-end', parentToolCallId: 'parent-1', message: '1 tool calls' })
    )

    const tc = useChatStore.getState().messages.flatMap((m) => m.toolCalls ?? []).find((t) => t.id === 'parent-1')
    expect(tc?.subagentSteps).toHaveLength(1)
    expect(tc?.subagentSteps?.[0]).toMatchObject({ name: 'grep', ok: true, result: 'found 3' })
    expect(tc?.subagentSteps?.[0]?.endedAt).toBeDefined()
    expect(tc?.subagentDone).toBe(true)
  })

  it('ignores subagent activity with no parent or an unknown parent', () => {
    seedParentToolCall()
    useChatStore.getState().applySubagentActivity(activity({ parentToolCallId: undefined, toolName: 'grep', toolCallId: 'x' }))
    useChatStore.getState().applySubagentActivity(activity({ parentToolCallId: 'missing', toolName: 'grep', toolCallId: 'y' }))
    const tc = useChatStore.getState().messages.flatMap((m) => m.toolCalls ?? []).find((t) => t.id === 'parent-1')
    expect(tc?.subagentSteps ?? []).toHaveLength(0)
  })
})

describe('chat-store inline crew messages', () => {
  it('adds a crew message and drives it plan → run → done on one message', () => {
    const s = useChatStore.getState()
    s.addCrewMessage(newCrewRun('c1', 'optimize the parser', 'sequential'))

    let msg = useChatStore.getState().messages.find((m) => m.crew?.crewId === 'c1')
    expect(msg?.crew?.phase).toBe('planning')

    const plan: CrewPlan = {
      approach: 'a',
      roles: [{ id: 'coder', label: 'Coder', systemPrompt: 'c' }],
      steps: [{ roleId: 'coder', brief: 'b' }]
    }
    useChatStore.getState().setCrewPlan('c1', plan)
    msg = useChatStore.getState().messages.find((m) => m.crew?.crewId === 'c1')
    expect(msg?.crew?.phase).toBe('reviewing')
    expect(msg?.crew?.roles.map((r) => r.id)).toEqual(['coder'])

    // Stream the run via crew events.
    useChatStore.getState().applyCrewEvent({
      type: 'crew-start', crewId: 'c1', sessionId: 'sess-1', task: 't', strategy: 'sequential',
      roles: [{ id: 'coder', label: 'Coder' }]
    })
    useChatStore.getState().applyCrewEvent({ type: 'agent-token', crewId: 'c1', roleId: 'coder', delta: 'working' })
    useChatStore.getState().applyCrewEvent({ type: 'crew-end', crewId: 'c1', reason: 'completed' })

    msg = useChatStore.getState().messages.find((m) => m.crew?.crewId === 'c1')
    expect(msg?.crew?.phase).toBe('done')
    expect(msg?.crew?.agents[0]?.output).toBe('working')
  })

  it('setCrewLens attaches the lens; dropCrewMessage removes it', () => {
    useChatStore.getState().addCrewMessage(newCrewRun('c2', 't', 'parallel'))
    useChatStore.getState().setCrewLens('c2', {
      blastRadius: [], filesChanged: [], verification: { ran: [], filesWritten: [], testsRun: false }, uncertaintyFlags: []
    })
    expect(useChatStore.getState().messages.find((m) => m.crew?.crewId === 'c2')?.crew?.lens).toBeTruthy()

    useChatStore.getState().dropCrewMessage('c2')
    expect(useChatStore.getState().messages.some((m) => m.crew?.crewId === 'c2')).toBe(false)
  })

  it('crew events for an unknown crewId are ignored', () => {
    useChatStore.getState().addCrewMessage(newCrewRun('c3', 't', 'sequential'))
    useChatStore.getState().applyCrewEvent({ type: 'agent-token', crewId: 'other', roleId: 'x', delta: 'z' })
    const msg = useChatStore.getState().messages.find((m) => m.crew?.crewId === 'c3')
    expect(msg?.crew?.phase).toBe('planning')
  })
})
