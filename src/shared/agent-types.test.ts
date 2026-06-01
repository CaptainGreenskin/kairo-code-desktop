import { describe, expect, it } from 'vitest'
import { resolveAgentType, agentTypeDescriptions, BUILTIN_AGENT_TYPES, type AgentType } from './agent-types'

describe('resolveAgentType', () => {
  it('resolves built-in types by id', () => {
    expect(resolveAgentType('explore').id).toBe('explore')
    expect(resolveAgentType('analyze').maxIterations).toBe(15)
    expect(resolveAgentType('worker').canWrite).toBe(true)
  })

  it('falls back to explore for unknown types', () => {
    expect(resolveAgentType('nonexistent').id).toBe('explore')
    expect(resolveAgentType(undefined).id).toBe('explore')
  })

  it('resolves extra (plugin) types', () => {
    const custom: AgentType = {
      id: 'security-scanner',
      label: 'Security',
      description: 'Scan for vulns',
      systemPrompt: 'Find vulnerabilities',
      tools: ['read_file', 'grep'],
      canWrite: false,
      maxIterations: 10
    }
    expect(resolveAgentType('security-scanner', [custom]).id).toBe('security-scanner')
  })
})

describe('agentTypeDescriptions', () => {
  it('lists all built-in types', () => {
    const desc = agentTypeDescriptions()
    expect(desc).toContain('"explore"')
    expect(desc).toContain('"analyze"')
    expect(desc).toContain('"worker"')
  })
})

describe('BUILTIN_AGENT_TYPES', () => {
  it('explore and analyze are read-only, worker can write', () => {
    const explore = BUILTIN_AGENT_TYPES.find((t) => t.id === 'explore')!
    const analyze = BUILTIN_AGENT_TYPES.find((t) => t.id === 'analyze')!
    const worker = BUILTIN_AGENT_TYPES.find((t) => t.id === 'worker')!
    expect(explore.canWrite).toBe(false)
    expect(analyze.canWrite).toBe(false)
    expect(worker.canWrite).toBe(true)
    expect(worker.tools).toContain('write_file')
    expect(explore.tools).not.toContain('write_file')
  })
})
