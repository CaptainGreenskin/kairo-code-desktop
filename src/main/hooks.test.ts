import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { HookPoint } from '@kairo/api'
import { buildPluginHookRegistry } from './hooks'

let ws: string

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'kairo-hooks-'))
})
afterEach(() => rmSync(ws, { recursive: true, force: true }))

async function writeHookPlugin(name: string): Promise<void> {
  const dir = path.join(ws, '.kairo', 'plugins', name)
  await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true })
  await fs.writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }), 'utf-8')
  await fs.mkdir(path.join(dir, 'hooks'), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'hooks', 'hooks.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'exit 0' }] }] } }),
    'utf-8'
  )
}

const ctx = (): { sessionId: string; turnId: string } => ({ sessionId: 's', turnId: 't' })

describe('buildPluginHookRegistry', () => {
  it('registers a trusted plugin hook alongside the desktop hooks', async () => {
    await writeHookPlugin('p')
    const reg = await buildPluginHookRegistry({ trustedPlugins: ['p'] }, ws, undefined, ctx)
    const pre = reg.getHooksForPoint(HookPoint.PRE_TOOL)
    expect(pre.some((h) => h.name.startsWith('plugin:p:'))).toBe(true)
    // The always-on desktop pre-tool hook is still there.
    expect(pre.some((h) => h.name === 'desktop-pre-tool')).toBe(true)
  })

  it('registers no plugin hooks when nothing is trusted', async () => {
    await writeHookPlugin('p')
    const reg = await buildPluginHookRegistry({ trustedPlugins: [] }, ws, undefined, ctx)
    const pre = reg.getHooksForPoint(HookPoint.PRE_TOOL)
    expect(pre.some((h) => h.name.startsWith('plugin:'))).toBe(false)
    expect(pre.some((h) => h.name === 'desktop-pre-tool')).toBe(true)
  })

  it('skips a trusted-but-disabled plugin', async () => {
    await writeHookPlugin('p')
    const reg = await buildPluginHookRegistry({ trustedPlugins: ['p'], disabledPlugins: ['p'] }, ws, undefined, ctx)
    expect(reg.getHooksForPoint(HookPoint.PRE_TOOL).some((h) => h.name.startsWith('plugin:'))).toBe(false)
  })
})
