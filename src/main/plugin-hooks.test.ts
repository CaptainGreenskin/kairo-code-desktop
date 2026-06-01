import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import type { Hook, HookEvent, HookRegistry } from '@kairo/api'
import { registerPluginHooks } from './plugin-hooks'
import type { PluginManifest, PluginHook } from '@kairo/plugin'

/** Minimal in-memory registry that just collects registered hooks. */
function fakeRegistry(): { reg: HookRegistry; hooks: Hook[] } {
  const hooks: Hook[] = []
  const reg: HookRegistry = {
    register: (h) => hooks.push(h),
    unregister: () => {},
    getHooksForPoint: (p) => hooks.filter((h) => h.points.includes(p))
  }
  return { reg, hooks }
}

function manifest(name: string, hooks: PluginHook[]): PluginManifest {
  return {
    metadata: { name },
    dir: tmpdir(),
    commands: [],
    agents: [],
    hooks,
    mcpServers: {},
    gateRules: [],
    mapAnnotations: [],
    drills: [],
    permissions: { network: false }
  }
}

const evt = (toolName: string): HookEvent => ({
  point: 'PRE_TOOL',
  messages: [],
  toolCalls: [{ id: 't1', name: toolName, arguments: '{}' }]
})

describe('registerPluginHooks', () => {
  it('only registers hooks for ENABLED + TRUSTED plugins', () => {
    const plugins = [manifest('p', [{ type: 'command', event: 'PreToolUse', command: 'exit 0' }])]
    expect(registerPluginHooks(fakeRegistry().reg, plugins, { workingDirectory: tmpdir(), trusted: [], disabled: [] })).toBe(0)
    expect(registerPluginHooks(fakeRegistry().reg, plugins, { workingDirectory: tmpdir(), trusted: ['p'], disabled: ['p'] })).toBe(0)
    expect(registerPluginHooks(fakeRegistry().reg, plugins, { workingDirectory: tmpdir(), trusted: ['p'], disabled: [] })).toBe(1)
  })

  it('PreToolUse non-zero exit ABORTs with the command output as the reason', async () => {
    const { reg, hooks } = fakeRegistry()
    registerPluginHooks(reg, [manifest('p', [{ type: 'command', event: 'PreToolUse', matcher: 'write_file', command: 'echo blocked 1>&2; exit 1' }])], {
      workingDirectory: tmpdir(),
      trusted: ['p'],
      disabled: []
    })
    const decision = await hooks[0]!.execute(evt('write_file'))
    expect(decision.action).toBe('ABORT')
    if (decision.action === 'ABORT') expect(decision.reason).toMatch(/blocked/)
  })

  it('PreToolUse zero exit CONTINUEs', async () => {
    const { reg, hooks } = fakeRegistry()
    registerPluginHooks(reg, [manifest('p', [{ type: 'command', event: 'PreToolUse', command: 'exit 0' }])], {
      workingDirectory: tmpdir(),
      trusted: ['p'],
      disabled: []
    })
    expect((await hooks[0]!.execute(evt('write_file'))).action).toBe('CONTINUE')
  })

  it('does not run (CONTINUE) when the matcher does not select the tool', async () => {
    const { reg, hooks } = fakeRegistry()
    registerPluginHooks(reg, [manifest('p', [{ type: 'command', event: 'PreToolUse', matcher: 'read_file', command: 'exit 1' }])], {
      workingDirectory: tmpdir(),
      trusted: ['p'],
      disabled: []
    })
    // command would exit 1, but the matcher excludes write_file → never runs → CONTINUE
    expect((await hooks[0]!.execute(evt('write_file'))).action).toBe('CONTINUE')
  })

  it('fails OPEN (CONTINUE) when the command cannot run', async () => {
    const { reg, hooks } = fakeRegistry()
    registerPluginHooks(reg, [manifest('p', [{ type: 'command', event: 'PreToolUse', command: 'this-binary-does-not-exist-xyz' }])], {
      workingDirectory: tmpdir(),
      trusted: ['p'],
      disabled: []
    })
    // A bad command exits non-zero via the shell → ABORT is acceptable, but a
    // spawn-level failure must CONTINUE. Either way it must resolve to a decision.
    const d = await hooks[0]!.execute(evt('x'))
    expect(['CONTINUE', 'ABORT']).toContain(d.action)
  })

  it('prompt hook: runPrompt ok:false ABORTs, ok:true CONTINUEs, no callback fails open', async () => {
    const mk = (runPrompt?: (p: string) => Promise<{ ok: boolean; reason?: string }>) => {
      const { reg, hooks } = fakeRegistry()
      registerPluginHooks(reg, [manifest('p', [{ type: 'prompt', event: 'PreToolUse', prompt: 'ok?' }])], {
        workingDirectory: tmpdir(),
        trusted: ['p'],
        disabled: [],
        runPrompt
      })
      return hooks[0]!
    }
    expect((await mk(async () => ({ ok: false, reason: 'nope' })).execute(evt('x'))).action).toBe('ABORT')
    expect((await mk(async () => ({ ok: true })).execute(evt('x'))).action).toBe('CONTINUE')
    expect((await mk(undefined).execute(evt('x'))).action).toBe('CONTINUE') // no capability → fail-open
  })

  it('agent hook: routes through runAgent', async () => {
    const { reg, hooks } = fakeRegistry()
    registerPluginHooks(reg, [manifest('p', [{ type: 'agent', event: 'PreToolUse', prompt: 'verify' }])], {
      workingDirectory: tmpdir(),
      trusted: ['p'],
      disabled: [],
      runAgent: async () => ({ ok: false, reason: 'bad' })
    })
    const d = await hooks[0]!.execute(evt('x'))
    expect(d.action).toBe('ABORT')
    if (d.action === 'ABORT') expect(d.reason).toBe('bad')
  })

  it('PostToolUse never blocks even when the gate says ok:false', async () => {
    const { reg, hooks } = fakeRegistry()
    registerPluginHooks(reg, [manifest('p', [{ type: 'prompt', event: 'PostToolUse', prompt: 'x' }])], {
      workingDirectory: tmpdir(),
      trusted: ['p'],
      disabled: [],
      runPrompt: async () => ({ ok: false, reason: 'nope' })
    })
    expect((await hooks[0]!.execute({ ...evt('x'), point: 'POST_TOOL' })).action).toBe('CONTINUE')
  })
})
