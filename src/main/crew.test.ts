import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrewEvent, CrewRoleConfig } from '../shared/types'

// Shared, hoisted mock state so the vi.mock factories (hoisted above imports)
// can reference it. `scripts` holds the StreamEvent sequence each successive
// agent.stream() call should yield.
const h = vi.hoisted(() => {
  const capturedInputs: string[] = []
  const scripts: unknown[][] = []
  const st = { idx: 0, abortCount: 0 }
  const fakeAgent = {
    async *stream(input: string): AsyncGenerator<unknown> {
      capturedInputs.push(input)
      const evs = scripts[st.idx++] ?? []
      for (const e of evs) yield e
    },
    abort(): void {
      st.abortCount++
    }
  }
  const builder: unknown = new Proxy(
    {},
    { get: (_t, p) => (p === 'build' ? () => fakeAgent : () => builder) }
  )
  class FakeRegistry {
    list(): unknown[] {
      return []
    }
    get(): undefined {
      return undefined
    }
    getExecutor(): undefined {
      return undefined
    }
    register(): void {}
  }
  return { capturedInputs, scripts, st, fakeAgent, builder, FakeRegistry }
})

vi.mock('@kairo/core', () => ({
  AgentBuilder: { create: () => h.builder },
  DefaultToolRegistry: h.FakeRegistry
}))
vi.mock('./tools', () => ({ registerCodingTools: () => {} }))
vi.mock('./provider', () => ({
  buildProvider: () => ({ provider: { name: 'fake' }, modelName: 'fake-model' })
}))
// Hooks are out of scope for crew-orchestration tests; the real builder mocks
// `@kairo/core` (so DefaultHookRegistry is absent). Return an inert registry.
vi.mock('./hooks', () => ({ buildPluginHookRegistry: async () => ({}) }))

import { CrewCoordinator, DEFAULT_CREW_ROLES } from './crew'

const ROLES: CrewRoleConfig[] = [
  { id: 'planner', label: 'Planner', systemPrompt: 'plan it' },
  { id: 'reviewer', label: 'Reviewer', systemPrompt: 'review it' }
]

function makeCoordinator(): { coord: CrewCoordinator; events: CrewEvent[]; makeExecutor: ReturnType<typeof vi.fn> } {
  const events: CrewEvent[] = []
  const send = (channel: string, payload: unknown): void => {
    if (channel === 'kairo:crew') events.push(payload as CrewEvent)
  }
  const makeExecutor = vi.fn(() => ({}) as never)
  const coord = new CrewCoordinator(
    () => ({ apiKey: 'k', provider: 'openai' }),
    () => '/cwd',
    send,
    makeExecutor
  )
  return { coord, events, makeExecutor }
}

beforeEach(() => {
  h.capturedInputs.length = 0
  h.scripts.length = 0
  h.st.idx = 0
  h.st.abortCount = 0
})

describe('CrewCoordinator', () => {
  it('emits a well-formed event sequence and returns the last role output as summary', async () => {
    h.scripts.push(
      [
        { type: 'text_delta', text: 'PLAN' },
        { type: 'tool_use_start', toolCall: { name: 'read_file' } },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 5 } }
      ],
      [{ type: 'text_delta', text: 'REVIEW' }]
    )
    const { coord, events } = makeCoordinator()

    const result = await coord.run('crew1', 'sess', 'do the thing', ROLES)

    expect(result.summary).toBe('REVIEW')
    expect(result.reason).toBe('completed')
    expect(result.lens).toBeDefined()

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'crew-start',
      'agent-start',
      'agent-token',
      'agent-tool',
      'agent-end',
      'agent-start',
      'agent-token',
      'agent-end',
      'crew-end'
    ])

    const start = events[0]
    expect(start.type === 'crew-start' && start.roles.map((r) => r.id)).toEqual(['planner', 'reviewer'])

    const plannerEnd = events.find((e) => e.type === 'agent-end' && e.roleId === 'planner')
    expect(plannerEnd?.type === 'agent-end' && plannerEnd.tokensUsed).toBe(15)

    const tool = events.find((e) => e.type === 'agent-tool')
    expect(tool?.type === 'agent-tool' && tool.toolName).toBe('read_file')

    const end = events[events.length - 1]
    expect(end.type === 'crew-end' && end.reason).toBe('completed')
    expect(end.type === 'crew-end' && end.summary).toBe('REVIEW')
  })

  it("threads each role's output into the next role's input", async () => {
    h.scripts.push([{ type: 'text_delta', text: 'PLAN-OUTPUT' }], [{ type: 'text_delta', text: 'REVIEW' }])
    const { coord } = makeCoordinator()

    await coord.run('crew1', 'sess', 'task X', ROLES)

    // Planner sees the raw task; Reviewer sees the task + planner's output.
    expect(h.capturedInputs[0]).toContain('task X')
    expect(h.capturedInputs[1]).toContain('task X')
    expect(h.capturedInputs[1]).toContain('PLAN-OUTPUT')
    expect(h.capturedInputs[1]).toContain('Planner')
  })

  it('builds an approval-aware executor per role with the right turn id', async () => {
    h.scripts.push([{ type: 'text_delta', text: 'a' }], [{ type: 'text_delta', text: 'b' }])
    const { coord, makeExecutor } = makeCoordinator()

    await coord.run('crew9', 'sess7', 'x', ROLES)

    expect(makeExecutor).toHaveBeenCalledTimes(2)
    // (registry, workingDirectory, sessionId, turnId)
    expect(makeExecutor.mock.calls[0][1]).toBe('/cwd')
    expect(makeExecutor.mock.calls[0][2]).toBe('sess7')
    expect(makeExecutor.mock.calls[0][3]).toBe('crew9:planner')
    expect(makeExecutor.mock.calls[1][3]).toBe('crew9:reviewer')
  })

  it('captures a stream error into the role output without throwing', async () => {
    h.scripts.push([{ type: 'error', error: new Error('boom') }], [{ type: 'text_delta', text: 'ok' }])
    const { coord, events } = makeCoordinator()

    const result = await coord.run('crew1', 'sess', 'x', ROLES)

    expect(result.reason).toBe('completed')
    const end = events[events.length - 1]
    expect(end.type === 'crew-end').toBe(true)
  })

  it('captures tool records into a Change Lens (writes + verification)', async () => {
    h.scripts.push([
      {
        type: 'tool_use_start',
        toolCall: { id: 't1', name: 'write_file', arguments: JSON.stringify({ path: 'src/main/x.ts' }) }
      },
      { type: 'tool_result', result: { toolCallId: 't1', content: 'ok', isError: false } },
      {
        type: 'tool_use_start',
        toolCall: { id: 't2', name: 'bash', arguments: JSON.stringify({ command: 'npm test' }) }
      },
      { type: 'tool_result', result: { toolCallId: 't2', content: 'pass', isError: false } },
      { type: 'text_delta', text: 'done' }
    ])
    const { coord } = makeCoordinator()

    const result = await coord.run('crewL', 'sess', 'do it', [ROLES[0]!])

    expect(result.lens.filesChanged).toEqual(['src/main/x.ts'])
    expect(result.lens.blastRadius[0]?.module).toBe('src/main')
    expect(result.lens.verification.ran).toEqual([{ command: 'npm test', ok: true }])
    expect(result.lens.verification.testsRun).toBe(true)
  })

  it('parallel strategy runs all roles without threading and combines outputs', async () => {
    // Identical scripts so the assertion is independent of concurrent ordering.
    h.scripts.push([{ type: 'text_delta', text: 'OUT' }], [{ type: 'text_delta', text: 'OUT' }])
    const { coord, events } = makeCoordinator()

    const result = await coord.run('crewP', 'sess', 'task Y', ROLES, 'parallel')

    expect(result.reason).toBe('completed')
    // Both roles ran.
    expect(h.capturedInputs).toHaveLength(2)
    // Parallel = fan-out: no role sees another role's output.
    for (const input of h.capturedInputs) {
      expect(input).not.toContain('Context from earlier crew members')
    }
    // Summary combines every role's output under its label.
    const end = events[events.length - 1]
    expect(end.type === 'crew-end' && end.summary).toContain('## Planner')
    expect(end.type === 'crew-end' && end.summary).toContain('## Reviewer')
    // crew-start advertises the strategy.
    const start = events[0]
    expect(start.type === 'crew-start' && start.strategy).toBe('parallel')
  })

  it('abort() returns false for an unknown crew id', () => {
    const { coord } = makeCoordinator()
    expect(coord.abort('nope')).toBe(false)
  })

  it('ships a sensible default roster (plan → implement → review)', () => {
    expect(DEFAULT_CREW_ROLES.map((r) => r.id)).toEqual(['planner', 'coder', 'reviewer'])
    // Only the Coder may use write/exec tools; planner & reviewer are read-only.
    const coder = DEFAULT_CREW_ROLES.find((r) => r.id === 'coder')
    expect(coder?.allowedTools).toContain('edit')
    expect(coder?.allowedTools).toContain('bash')
    expect(coder?.allowedTools).not.toContain('edit_file')
    expect(coder?.allowedTools).not.toContain('run_command')
    expect(DEFAULT_CREW_ROLES.find((r) => r.id === 'planner')?.allowedTools).toBeUndefined()
  })
})
