import { DefaultHookRegistry } from '@kairo/core'
import { HookPoint } from '@kairo/api'
import type { HookDecision, HookEvent } from '@kairo/api'
import type { ActivityEvent } from '../shared/types'
import { DenialTracker, denialKey } from './denial-tracker'
import { scanPlugins } from './plugins'
import { registerPluginHooks, type PluginHookCallbacks } from './plugin-hooks'

type SendFn = (channel: string, payload: unknown) => void

interface DesktopHookContext {
  sessionId: string
  turnId: string
}

/**
 * Build the hook registry an agent runs with: the always-on desktop hooks plus
 * any TRUSTED + ENABLED plugins' lifecycle hooks. Shared by the main agent,
 * the crew roles, and subagents so plugin hooks fire in all three. `send` may be
 * undefined (subagents); `callbacks` provides prompt/agent hook execution (only
 * the main agent supplies `runAgent`). Never throws — a plugin scan failure must
 * not block the agent.
 */
export async function buildPluginHookRegistry(
  config: { trustedPlugins?: string[]; disabledPlugins?: string[] },
  workingDirectory: string,
  send: SendFn | undefined,
  getContext: () => DesktopHookContext,
  callbacks: PluginHookCallbacks = {}
): Promise<DefaultHookRegistry> {
  const registry = createDesktopHooks(send ?? (() => {}), getContext)
  if (config.trustedPlugins?.length) {
    try {
      const plugins = await scanPlugins(workingDirectory)
      registerPluginHooks(registry, plugins, {
        workingDirectory,
        trusted: config.trustedPlugins,
        disabled: config.disabledPlugins ?? [],
        send,
        getContext,
        ...callbacks
      })
    } catch {
      /* plugin scan / hook setup failure must not block the agent */
    }
  }
  return registry
}

const toolTimers = new Map<string, number>()

export function createDesktopHooks(
  send: SendFn,
  getContext: () => DesktopHookContext
): DefaultHookRegistry {
  const registry = new DefaultHookRegistry()
  // Loop guard: nudge the model to change strategy when it keeps retrying the
  // same failing/denied operation (autopilot/crew otherwise burns turns).
  const denials = new DenialTracker()

  registry.register({
    name: 'desktop-pre-tool',
    points: [HookPoint.PRE_TOOL],
    priority: 10,
    async execute(event: HookEvent): Promise<HookDecision> {
      const ctx = getContext()
      const toolName = event.toolCalls?.[0]?.name ?? 'unknown'
      const toolCallId = event.toolCalls?.[0]?.id ?? ''
      if (toolCallId) toolTimers.set(toolCallId, Date.now())
      const activity: ActivityEvent = {
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        type: 'tool-start',
        toolName,
        toolCallId,
        timestamp: Date.now()
      }
      send('kairo:activity', activity)
      return { action: 'CONTINUE' }
    }
  })

  registry.register({
    name: 'desktop-post-tool',
    points: [HookPoint.POST_TOOL],
    priority: 10,
    async execute(event: HookEvent): Promise<HookDecision> {
      const ctx = getContext()
      const toolName = event.toolCalls?.[0]?.name ?? 'unknown'
      const toolCallId = event.toolCalls?.[0]?.id ?? ''
      const startTime = toolTimers.get(toolCallId)
      const durationMs = startTime ? Date.now() - startTime : undefined
      if (toolCallId) toolTimers.delete(toolCallId)
      const isError = event.toolResults?.[0]?.isError ?? false
      const activity: ActivityEvent = {
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        type: 'tool-end',
        toolName,
        toolCallId,
        durationMs,
        isError,
        timestamp: Date.now()
      }
      send('kairo:activity', activity)

      // Track repeated failures of the same op; inject a strategy-change nudge
      // when the model is looping instead of letting it retry forever.
      const key = denialKey(toolName, event.toolCalls?.[0]?.arguments)
      const nudge = denials.record(key, isError)
      if (nudge) {
        send('kairo:activity', {
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          type: 'error',
          message: `循环守卫：${nudge}`,
          timestamp: Date.now()
        } satisfies ActivityEvent)
        return { action: 'INJECT', messages: [{ role: 'user', content: nudge }] }
      }
      return { action: 'CONTINUE' }
    }
  })

  registry.register({
    name: 'desktop-on-error',
    points: [HookPoint.ON_ERROR],
    priority: 10,
    async execute(event: HookEvent): Promise<HookDecision> {
      const ctx = getContext()
      const activity: ActivityEvent = {
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        type: 'error',
        message: event.error?.message ?? 'Unknown error',
        timestamp: Date.now()
      }
      send('kairo:activity', activity)
      return { action: 'CONTINUE' }
    }
  })

  registry.register({
    name: 'desktop-compaction',
    points: [HookPoint.POST_COMPACTION],
    priority: 10,
    async execute(_event: HookEvent): Promise<HookDecision> {
      const ctx = getContext()
      const activity: ActivityEvent = {
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        type: 'compaction',
        message: 'Context compacted',
        timestamp: Date.now()
      }
      send('kairo:activity', activity)
      return { action: 'CONTINUE' }
    }
  })

  return registry
}
