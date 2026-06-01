import { describe, expect, it } from 'vitest'
import { fromSessionMessage, toSessionMessage } from './session-message'
import type { ChatMessage } from '../stores/chat-store'

describe('session-message round-trip', () => {
  it('preserves a sub-agent trace through persist → reload', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'done',
      timestamp: 1,
      toolCalls: [
        {
          id: 'parent-1',
          toolName: 'spawn_subagent',
          args: { task: 'find usages' },
          result: 'Found 3.',
          startedAt: 10,
          endedAt: 99,
          isExpanded: true,
          subagentDone: true,
          subagentSteps: [
            { id: 's1', name: 'grep', args: '{"pattern":"X"}', result: 'a.ts:1', ok: true, startedAt: 11, endedAt: 20 }
          ]
        }
      ]
    }

    const persisted = toSessionMessage(msg)
    // The trace is written to the session model…
    expect(persisted.toolCalls?.[0]?.subagentSteps).toHaveLength(1)
    expect(persisted.toolCalls?.[0]?.subagentDone).toBe(true)

    // …survives a JSON round-trip (what saveSession/loadSession does)…
    const reloaded = fromSessionMessage(JSON.parse(JSON.stringify(persisted)))
    const tc = reloaded.toolCalls?.[0]
    expect(tc?.subagentSteps).toEqual([
      { id: 's1', name: 'grep', args: '{"pattern":"X"}', result: 'a.ts:1', ok: true, startedAt: 11, endedAt: 20 }
    ])
    expect(tc?.subagentDone).toBe(true)
  })

  it('omits sub-agent fields when there is no trace', () => {
    const msg: ChatMessage = {
      id: 'm2',
      role: 'assistant',
      content: 'x',
      timestamp: 1,
      toolCalls: [{ id: 't', toolName: 'read_file', args: {}, startedAt: 1, isExpanded: false }]
    }
    const persisted = toSessionMessage(msg)
    expect(persisted.toolCalls?.[0]).not.toHaveProperty('subagentSteps')
    expect(persisted.toolCalls?.[0]).not.toHaveProperty('subagentDone')
  })
})
