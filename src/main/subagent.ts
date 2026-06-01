import {
  AgentBuilder,
  DefaultToolExecutor,
  DefaultToolRegistry
} from '@kairo/core'
import type {
  Agent,
  ModelProvider,
  PermissionGuard,
  PermissionResult,
  StreamEvent,
  ToolCall,
  ToolRegistry
} from '@kairo/api'
import type { AgentConfig } from './agent'
import type { ActivityEvent } from '../shared/types'
import { registerCodingTools } from './tools'
import { buildProvider } from './provider'
import { buildPluginHookRegistry } from './hooks'
import { resolveAgentType, type AgentType } from '../shared/agent-types'

const ALLOW_ALL: PermissionGuard = {
  async check(): Promise<PermissionResult> {
    return { allowed: true }
  }
}

function buildToolRegistry(toolNames: string[]): DefaultToolRegistry {
  const full = new DefaultToolRegistry()
  registerCodingTools(full)
  const toolSet = new Set(toolNames)
  const filtered = new DefaultToolRegistry()
  for (const tool of full.list()) {
    if (toolSet.has(tool.name)) filtered.register(tool, full.getExecutor(tool.name)!)
  }
  return filtered
}

export interface SubagentToolCall {
  name: string
  args: string
  result?: string
  durationMs?: number
}

export interface SubagentResult {
  text: string
  tokensUsed?: number
  toolCalls?: SubagentToolCall[]
  /** The agent type that was used. */
  agentType?: string
  /** Files the subagent read during execution. */
  filesRead?: string[]
  /** Files the subagent modified (Worker type only). */
  filesChanged?: string[]
}

type SendFn = (channel: string, payload: unknown) => void

export class SubagentFactory {
  constructor(
    private readonly config: () => AgentConfig,
    private readonly workingDirectory: () => string,
    private readonly sendFn?: SendFn
  ) {}

  private emitActivity(
    sessionId: string,
    turnId: string,
    type: ActivityEvent['type'],
    extra?: Partial<ActivityEvent>
  ): void {
    if (!this.sendFn) return
    const event: ActivityEvent = {
      sessionId,
      turnId,
      type,
      timestamp: Date.now(),
      ...extra
    }
    this.sendFn('kairo:activity', event)
  }

  async spawn(
    task: string,
    allowedTools?: string[],
    sessionId = '',
    turnId = '',
    parentToolCallId = '',
    agentTypeId?: string,
    extraTypes: AgentType[] = []
  ): Promise<SubagentResult> {
    const startedAt = Date.now()
    const cfg = this.config()
    let provider: ModelProvider
    let modelName: string
    try {
      ;({ provider, modelName } = buildProvider(cfg))
    } catch (err) {
      return { text: `Error: ${err instanceof Error ? err.message : String(err)}` }
    }

    // Resolve the agent type — determines tools, prompt, and iteration limit.
    const agentType = resolveAgentType(agentTypeId, extraTypes)

    this.emitActivity(sessionId, turnId, 'subagent-start', {
      message: `[${agentType.label}] ${task.slice(0, 200)}`,
      ...(parentToolCallId ? { parentToolCallId } : {})
    })

    const tools = allowedTools ?? agentType.tools
    const registry = buildToolRegistry(tools)
    const executor = new DefaultToolExecutor({ registry, permissionGuard: ALLOW_ALL })
    const cwd = this.workingDirectory()
    const hookRegistry = await buildPluginHookRegistry(cfg, cwd, this.sendFn, () => ({ sessionId, turnId }))

    const agent: Agent = AgentBuilder.create()
      .name(`kairo-${agentType.id}`)
      .model(provider)
      .modelName(modelName)
      .tools(registry)
      .toolExecutor(executor)
      .systemPrompt(
        `${agentType.systemPrompt}\n\nWorking directory: ${cwd}`
      )
      .streaming(true)
      .hooks(hookRegistry)
      .maxIterations(agentType.maxIterations)
      .context({ maxTokens: 32_000, compactionThreshold: 0.85 })
      .build()

    let text = ''
    let tokensUsed: number | undefined
    const collectedToolCalls: SubagentToolCall[] = []
    const inFlightTools = new Map<string, { ref: ToolCall; startedAt: number }>()

    try {
      for await (const event of agent.stream(task) as AsyncIterable<StreamEvent>) {
        switch (event.type) {
          case 'text_delta':
            text += event.text
            break

          case 'tool_use_start':
            inFlightTools.set(event.toolCall.id, {
              ref: event.toolCall,
              startedAt: Date.now()
            })
            this.emitActivity(sessionId, turnId, 'subagent-tool', {
              toolName: event.toolCall.name,
              toolCallId: event.toolCall.id,
              ...(parentToolCallId ? { parentToolCallId } : {}),
              ...(event.toolCall.arguments ? { args: event.toolCall.arguments.slice(0, 500) } : {})
            })
            break

          case 'tool_result': {
            const result = event.result
            const inflight = inFlightTools.get(result.toolCallId)
            const durationMs = inflight ? Date.now() - inflight.startedAt : undefined
            collectedToolCalls.push({
              name: inflight?.ref.name ?? 'unknown',
              args: inflight?.ref.arguments ?? '',
              result: result.content?.slice(0, 500),
              durationMs
            })
            this.emitActivity(sessionId, turnId, 'subagent-tool-result', {
              toolCallId: result.toolCallId,
              ok: !result.isError,
              ...(parentToolCallId ? { parentToolCallId } : {}),
              ...(result.content ? { message: result.content.slice(0, 500) } : {}),
              ...(durationMs !== undefined ? { durationMs } : {})
            })
            if (inflight) inFlightTools.delete(result.toolCallId)
            break
          }

          case 'message_end': {
            const u = (event as unknown as { usage?: { inputTokens: number; outputTokens: number } }).usage
            if (u) tokensUsed = (tokensUsed ?? 0) + u.inputTokens + u.outputTokens
            break
          }

          case 'error':
            text += `\n[Subagent error: ${event.error.message}]`
            break
        }
      }
    } catch (err) {
      text += `\n[Subagent failed: ${err instanceof Error ? err.message : String(err)}]`
    }

    this.emitActivity(sessionId, turnId, 'subagent-end', {
      message: `${collectedToolCalls.length} tool calls`,
      durationMs: Date.now() - startedAt,
      ...(parentToolCallId ? { parentToolCallId } : {})
    })

    // Extract files read/written from tool call arguments.
    const filesRead = new Set<string>()
    const filesChanged = new Set<string>()
    for (const tc of collectedToolCalls) {
      try {
        const a = JSON.parse(tc.args) as Record<string, unknown>
        const p = (a.path ?? a.file_path ?? a.filePath) as string | undefined
        if (p) {
          if (tc.name === 'write_file' || tc.name === 'edit') filesChanged.add(p)
          else if (tc.name === 'read_file') filesRead.add(p)
        }
      } catch { /* unparsable args */ }
    }

    return {
      text: text || '(no output)',
      tokensUsed,
      toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
      agentType: agentType.id,
      filesRead: filesRead.size > 0 ? [...filesRead] : undefined,
      filesChanged: filesChanged.size > 0 ? [...filesChanged] : undefined
    }
  }
}
