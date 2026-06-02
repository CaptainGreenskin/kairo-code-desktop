/**
 * Plugin lifecycle hooks → engine hooks. Registers each TRUSTED + ENABLED
 * plugin's `PreToolUse`/`PostToolUse` command hooks into the agent's hook
 * registry (the one from {@link createDesktopHooks}). A PreToolUse command that
 * exits non-zero ABORTs the turn with its message (the only block mechanism the
 * engine honours at PRE_TOOL); PostToolUse runs for its side effects.
 *
 * Security: shell strings come from the plugin folder on disk and only run for
 * plugins the user has trusted — the renderer only ships the trusted name set.
 * Trust-gating mirrors the MCP path. Broken hooks fail OPEN (timeout / spawn
 * error → CONTINUE) so a misconfigured hook can't brick the agent.
 */

import { spawn } from 'node:child_process'
import { HookPoint } from '@kairo/api'
import type { HookDecision, HookEvent, HookRegistry } from '@kairo/api'
import { matchesTool, substituteArguments, httpDecisionFromResponse, sanitizeEnv, buildSandboxWrapper, type PluginManifest } from '@kairo/plugin'
import type { ActivityEvent } from '../shared/types'

type SendFn = (channel: string, payload: unknown) => void

/** Verdict shape for prompt/agent hooks (LLM/agent yes-no gate). */
export interface HookGateResult {
  ok: boolean
  reason?: string
}

/** Capabilities the host injects so prompt/agent hooks can run (P2). */
export interface PluginHookCallbacks {
  /** One-shot LLM gate for `prompt` hooks. Absent → prompt hooks fail-open. */
  runPrompt?: (prompt: string, model?: string) => Promise<HookGateResult>
  /** Verifier-subagent gate for `agent` hooks. Absent → agent hooks fail-open. */
  runAgent?: (prompt: string, model?: string) => Promise<HookGateResult>
}

export interface PluginHookOptions extends PluginHookCallbacks {
  /** Where hook commands run (and `CLAUDE_PROJECT_DIR`). */
  workingDirectory: string
  /** Plugin names the user has trusted to run code. */
  trusted: string[]
  /** Plugin names the user has disabled. */
  disabled: string[]
  send?: SendFn
  getContext?: () => { sessionId: string; turnId: string }
}

const DEFAULT_TIMEOUT_SEC = 30

let _hasSandboxExec: boolean | null = null
function hasSandboxExec(): boolean {
  if (_hasSandboxExec === null) {
    // Lazy check — assume available on macOS, will fail gracefully if not
    _hasSandboxExec = process.platform === 'darwin'
  }
  return _hasSandboxExec
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Run a hook command with env sanitization and optional sandbox wrapping. */
function runHookCommand(
  command: string,
  cwd: string,
  pluginDir: string,
  timeoutMs: number,
  network = false
): Promise<RunResult | null> {
  return new Promise((resolve) => {
    const raw = command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginDir)
    const finalCmd = buildSandboxWrapper(raw, { network }, process.platform, hasSandboxExec())
    const cleanEnv = sanitizeEnv(
      { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir, CLAUDE_PROJECT_DIR: cwd } as Record<string, string>
    )
    let settled = false
    const done = (v: RunResult | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(finalCmd, {
        cwd,
        shell: true,
        env: cleanEnv
      })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done(null)
    }, timeoutMs)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', () => done(null))
    child.on('close', (code) => done({ code, stdout, stderr }))
  })
}

/**
 * Register the hooks of all trusted+enabled plugins into `registry`.
 * Returns the number of hooks registered (handy for logging/tests).
 */
export function registerPluginHooks(
  registry: HookRegistry,
  plugins: PluginManifest[],
  opts: PluginHookOptions
): number {
  const trusted = new Set(opts.trusted)
  const disabled = new Set(opts.disabled)
  let count = 0

  for (const p of plugins) {
    if (!trusted.has(p.metadata.name) || disabled.has(p.metadata.name)) continue
    p.hooks.forEach((hook, i) => {
      const isPre = hook.event === 'PreToolUse'
      registry.register({
        name: `plugin:${p.metadata.name}:${hook.event}:${hook.type}:${i}`,
        points: [isPre ? HookPoint.PRE_TOOL : HookPoint.POST_TOOL],
        priority: 50,
        async execute(event: HookEvent): Promise<HookDecision> {
          const toolName = event.toolCalls?.[0]?.name ?? ''
          if (!matchesTool(hook.matcher, toolName)) return { action: 'CONTINUE' }

          const eventJson = JSON.stringify({
            event: hook.event,
            tool: toolName,
            arguments: event.toolCalls?.[0]?.arguments
          })
          // A block only takes effect on PreToolUse (ABORT is the sole signal
          // the engine honours at PRE_TOOL); PostToolUse hooks run for effect.
          const block = (reason: string): HookDecision => {
            if (!isPre) return { action: 'CONTINUE' }
            emit(opts, `插件钩子拦截 ${toolName}：${reason}`)
            return { action: 'ABORT', reason }
          }
          const failOpen = (why: string): HookDecision => {
            emit(opts, `插件钩子跳过（${why}）：${p.metadata.name} (${hook.event}/${hook.type})`)
            return { action: 'CONTINUE' }
          }
          const timeoutMs = (hook.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000
          const fallbackReason = `插件 ${p.metadata.name} 的 ${hook.event} 钩子拒绝了 ${toolName}`

          try {
            switch (hook.type) {
              case 'command': {
                const res = await runHookCommand(substituteArguments(hook.command, eventJson), opts.workingDirectory, p.dir, timeoutMs, p.permissions.network)
                if (!res || res.code === null) return failOpen('command 超时/失败')
                return res.code !== 0 ? block((res.stderr || res.stdout).trim() || fallbackReason) : { action: 'CONTINUE' }
              }
              case 'http': {
                const body = await postHttp(hook.url, eventJson, timeoutMs)
                if (body === null) return failOpen('http 请求失败')
                const d = httpDecisionFromResponse(body)
                return d.block ? block(d.reason || fallbackReason) : { action: 'CONTINUE' }
              }
              case 'prompt': {
                if (!opts.runPrompt) return failOpen('无 prompt 执行能力')
                const r = await opts.runPrompt(substituteArguments(hook.prompt, eventJson), hook.model)
                return r.ok ? { action: 'CONTINUE' } : block(r.reason || fallbackReason)
              }
              case 'agent': {
                if (!opts.runAgent) return failOpen('无 agent 执行能力')
                const r = await opts.runAgent(substituteArguments(hook.prompt, eventJson), hook.model)
                return r.ok ? { action: 'CONTINUE' } : block(r.reason || fallbackReason)
              }
              default:
                return { action: 'CONTINUE' }
            }
          } catch {
            return failOpen('执行异常')
          }
        }
      })
      count++
    })
  }
  return count
}

/** POST the event JSON to an http hook's URL. Resolves null on error/timeout. */
async function postHttp(url: string, body: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function emit(opts: PluginHookOptions, message: string): void {
  if (!opts.send || !opts.getContext) return
  const ctx = opts.getContext()
  opts.send('kairo:activity', {
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    type: 'error',
    message,
    timestamp: Date.now()
  } satisfies ActivityEvent)
}
