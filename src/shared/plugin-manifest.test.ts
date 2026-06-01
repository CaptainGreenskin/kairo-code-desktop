import { describe, expect, it } from 'vitest'
import {
  parsePluginMetadata,
  parseCommandFile,
  parseAgentFile,
  pluginAgentToRole,
  derivePluginAgents,
  parseHooks,
  matchesTool,
  substituteArguments,
  httpDecisionFromResponse,
  parseGateRules,
  parseMcpServers,
  toMcpServerConfig,
  derivePluginContributions,
  type PluginManifest
} from '@kairo/plugin'
import { WRITER_TOOLS } from './crew-roles'

describe('parsePluginMetadata', () => {
  it('requires a name', () => {
    expect(parsePluginMetadata({ version: '1.0' })).toBeNull()
    expect(parsePluginMetadata(null)).toBeNull()
    expect(parsePluginMetadata({ name: 'x', version: '1.0', description: 'd' })).toEqual({ name: 'x', version: '1.0', description: 'd' })
  })
})

describe('parseCommandFile', () => {
  it('uses filename as name and body as prompt', () => {
    expect(parseCommandFile('review.md', 'Review the diff carefully.')).toEqual({
      name: 'review',
      description: undefined,
      prompt: 'Review the diff carefully.'
    })
  })
  it('reads description from frontmatter and strips it from the prompt', () => {
    const c = parseCommandFile('audit.md', '---\ndescription: Security audit\n---\nAudit for vulns.')
    expect(c).toEqual({ name: 'audit', description: 'Security audit', prompt: 'Audit for vulns.' })
  })
})

describe('parseGateRules', () => {
  it('parses kairo-code gate rule extensions, defaulting severity to review', () => {
    const rules = parseGateRules({ gateRules: [{ glob: '**/payment/**', message: 'money path' }, { glob: 'x', severity: 'auto' }, { bad: 1 }] })
    expect(rules).toEqual([
      { glob: '**/payment/**', severity: 'review', message: 'money path' },
      { glob: 'x', severity: 'auto', message: undefined }
    ])
  })
  it('returns [] when absent', () => {
    expect(parseGateRules({})).toEqual([])
  })
})

describe('parseMapAnnotations + parseDrills (comprehension components)', () => {
  it('parses map annotations (module + label required)', async () => {
    const { parseMapAnnotations } = await import('@kairo/plugin')
    expect(parseMapAnnotations({ mapAnnotations: [{ module: 'src/pay', label: '钱', note: '幂等' }, { label: 'x' }] })).toEqual([
      { module: 'src/pay', label: '钱', note: '幂等' }
    ])
  })
  it('parses authored drills (valid MC only)', async () => {
    const { parseDrills } = await import('@kairo/plugin')
    const d = parseDrills({ drills: [{ question: 'Q', options: ['a', 'b'], answerIndex: 1 }, { question: 'bad', options: ['x'], answerIndex: 0 }] })
    expect(d).toEqual([{ question: 'Q', options: ['a', 'b'], answerIndex: 1 }])
  })
})

describe('annotationsForModule', () => {
  it('matches by id or prefix', async () => {
    const { annotationsForModule } = await import('@kairo/plugin')
    const anns = [{ module: 'src/pay', label: 'A' }, { module: 'src/util', label: 'B' }]
    expect(annotationsForModule(anns, 'src/pay').map((a) => a.label)).toEqual(['A'])
    expect(annotationsForModule(anns, 'src/pay/sub').map((a) => a.label)).toEqual(['A'])
  })
})

describe('parseMcpServers', () => {
  it('merges plugin.json + .mcp.json (plugin.json wins)', () => {
    const m = parseMcpServers({ mcpServers: { a: { command: 'a' } } }, { mcpServers: { a: { command: 'old' }, b: { url: 'u' } } })
    expect(m).toEqual({ a: { command: 'a' }, b: { url: 'u' } })
  })
})

describe('parseAgentFile', () => {
  it('parses frontmatter (name/description/tools/model) and uses the body as the prompt', () => {
    const a = parseAgentFile('runner.md', '---\nname: test-runner\ndescription: runs tests\ntools: Bash, Read\nmodel: claude-sonnet-4-6\n---\nYou run the suite.')
    expect(a).toMatchObject({
      name: 'test-runner',
      description: 'runs tests',
      tools: ['Bash', 'Read'],
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You run the suite.',
      canWrite: true // Bash implies write-capable
    })
  })

  it('falls back to the filename and stays read-only when no write tools declared', () => {
    const a = parseAgentFile('analyst.md', 'Just analyze. No frontmatter.')
    expect(a.name).toBe('analyst')
    expect(a.tools).toEqual([])
    expect(a.canWrite).toBe(false)
    expect(a.systemPrompt).toBe('Just analyze. No frontmatter.')
  })

  it('treats Read/Grep-only agents as read-only', () => {
    const a = parseAgentFile('r.md', '---\ntools: Read, Grep\n---\nbody')
    expect(a.canWrite).toBe(false)
  })
})

describe('pluginAgentToRole + derivePluginAgents', () => {
  const withAgent: PluginManifest = {
    metadata: { name: 'pack' },
    dir: '/p',
    commands: [],
    agents: [
      { name: 'writer', systemPrompt: 'w', tools: ['write_file'], canWrite: true },
      { name: 'reader', systemPrompt: 'r', tools: ['read_file'], canWrite: false }
    ],
    hooks: [],
    mcpServers: {},
    gateRules: [],
    mapAnnotations: [],
    drills: [],
    permissions: { network: false }
  }

  it('namespaces the id and grants writer tools only to write-capable agents', () => {
    const w = pluginAgentToRole('pack', withAgent.agents[0]!, WRITER_TOOLS)
    expect(w.id).toBe('pack:writer')
    expect(w.allowedTools).toEqual([...WRITER_TOOLS])
    const r = pluginAgentToRole('pack', withAgent.agents[1]!, WRITER_TOOLS)
    expect(r.id).toBe('pack:reader')
    expect(r.allowedTools).toBeUndefined() // read-only
  })

  it('contributes agents only for ENABLED + TRUSTED plugins', () => {
    expect(derivePluginAgents([withAgent], [], [], WRITER_TOOLS)).toEqual([]) // untrusted → none
    expect(derivePluginAgents([withAgent], ['pack'], ['pack'], WRITER_TOOLS)).toEqual([]) // disabled → none
    const roles = derivePluginAgents([withAgent], [], ['pack'], WRITER_TOOLS)
    expect(roles.map((r) => r.id)).toEqual(['pack:writer', 'pack:reader'])
  })
})

describe('parseHooks', () => {
  it('parses a hooks/hooks.json wrapper (command type, supported events)', () => {
    const hooksJson = {
      description: 'd',
      hooks: {
        PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: './guard.sh', timeout: 10 }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command: './fmt.sh' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: './ignored.sh' }] }] // unsupported event
      }
    }
    expect(parseHooks(undefined, hooksJson)).toEqual([
      { type: 'command', event: 'PreToolUse', matcher: 'Write|Edit', command: './guard.sh', timeout: 10 },
      { type: 'command', event: 'PostToolUse', command: './fmt.sh' }
    ])
  })

  it('parses all four hook types and skips malformed ones', () => {
    const pj = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: 'command', command: 'a' },
              { type: 'prompt', prompt: 'p?', model: 'm' },
              { type: 'agent', prompt: 'verify' },
              { type: 'http', url: 'https://h/x' },
              { type: 'command' } // no command → dropped
            ]
          }
        ]
      }
    }
    expect(parseHooks(pj)).toEqual([
      { type: 'command', event: 'PreToolUse', command: 'a' },
      { type: 'prompt', event: 'PreToolUse', prompt: 'p?', model: 'm' },
      { type: 'agent', event: 'PreToolUse', prompt: 'verify' },
      { type: 'http', event: 'PreToolUse', url: 'https://h/x' }
    ])
  })

  it('treats a typeless entry with a command as a command hook (back-compat)', () => {
    const pj = { hooks: { PreToolUse: [{ hooks: [{ command: 'legacy' }] }] } }
    expect(parseHooks(pj)).toEqual([{ type: 'command', event: 'PreToolUse', command: 'legacy' }])
  })

  it('returns [] when nothing usable', () => {
    expect(parseHooks(undefined, undefined)).toEqual([])
    expect(parseHooks({ hooks: './path.json' })).toEqual([]) // path form not supported in pure parser
  })
})

describe('matchesTool', () => {
  it('matches all on empty/*, exact, pipe-OR, and regex', () => {
    expect(matchesTool(undefined, 'write_file')).toBe(true)
    expect(matchesTool('*', 'anything')).toBe(true)
    expect(matchesTool('write_file', 'write_file')).toBe(true)
    expect(matchesTool('write_file', 'read_file')).toBe(false)
    expect(matchesTool('write_file|edit', 'edit')).toBe(true)
    expect(matchesTool('^bash', 'bash')).toBe(true) // regex
  })
})

describe('substituteArguments', () => {
  it('replaces $ARGUMENTS, else appends the event JSON', () => {
    expect(substituteArguments('check $ARGUMENTS now', '{"t":1}')).toBe('check {"t":1} now')
    expect(substituteArguments('no placeholder', '{"t":1}')).toBe('no placeholder\n{"t":1}')
    expect(substituteArguments('plain')).toBe('plain')
  })
})

describe('httpDecisionFromResponse', () => {
  it('blocks on decision:block / permissionDecision:deny, else allows', () => {
    expect(httpDecisionFromResponse('{"decision":"block","reason":"no"}')).toEqual({ block: true, reason: 'no' })
    expect(httpDecisionFromResponse('{"permissionDecision":"deny"}')).toEqual({ block: true })
    expect(httpDecisionFromResponse('{"decision":"approve"}')).toEqual({ block: false })
    expect(httpDecisionFromResponse('not json')).toEqual({ block: false })
  })
})

describe('derivePluginContributions', () => {
  const manifests: PluginManifest[] = [
    { metadata: { name: 'a' }, dir: '/a', commands: [{ name: 'x', prompt: 'p' }], agents: [], hooks: [], mcpServers: {}, gateRules: [{ glob: 'g1', severity: 'review' }], mapAnnotations: [{ module: 'src/a', label: 'A' }], drills: [], permissions: { network: false } },
    { metadata: { name: 'b' }, dir: '/b', commands: [{ name: 'y', prompt: 'q' }], agents: [], hooks: [], mcpServers: {}, gateRules: [{ glob: 'g2', severity: 'auto' }], mapAnnotations: [], drills: [], permissions: { network: false } }
  ]
  it('aggregates enabled plugins commands + review globs', () => {
    const c = derivePluginContributions(manifests, [])
    expect(c.commands.map((x) => x.name)).toEqual(['x', 'y'])
    expect(c.protectedGlobs).toEqual(['g1']) // only 'review' severity becomes protected
  })
  it('excludes disabled plugins', () => {
    const c = derivePluginContributions(manifests, ['a'])
    expect(c.commands.map((x) => x.name)).toEqual(['y'])
    expect(c.protectedGlobs).toEqual([])
  })
})

describe('toMcpServerConfig', () => {
  it('maps stdio + sse forms', () => {
    expect(toMcpServerConfig('s', { command: 'node', args: ['x'] })).toMatchObject({ name: 's', transport: 'stdio', command: 'node', args: ['x'] })
    expect(toMcpServerConfig('w', { url: 'http://x' })).toMatchObject({ name: 'w', transport: 'sse', url: 'http://x' })
    expect(toMcpServerConfig('bad', {})).toBeNull()
  })
})
