/**
 * Agent integration layer.
 *
 * Wires `@kairo/core`'s agent runtime into the Electron main process and
 * forwards stream events to the renderer via the IPC contract defined in
 * `src/preload/index.ts` (`kairo:*` channels). This module is intentionally
 * kept thin — it does not reimplement reasoning, tool execution, or the
 * ReAct loop; those live in `@kairo/core`.
 */

import { randomUUID } from 'node:crypto'
import { promises as fsPromises } from 'node:fs'
import * as nodePath from 'node:path'
import { homedir } from 'node:os'
import { BrowserWindow } from 'electron'
import {
  AgentBuilder,
  DefaultToolExecutor,
  DefaultToolRegistry
} from '@kairo/core'
import { buildProvider } from './provider'
import { BRAIN_QA_SYSTEM, buildQaPrompt, type Evidence } from '../shared/brain-qa'
import { routeToolCall, DEFAULT_PROTECTED_GLOBS } from '../shared/comprehension-router'
import { KairoError } from '@kairo/api'
import type {
  Agent,
  ApprovalHandler,
  PermissionGuard,
  PermissionResult,
  StreamEvent,
  TokenUsage,
  ToolCall,
  ToolContext,
  ToolExecutionResult,
  ToolRegistry
} from '@kairo/api'
import type {
  AgentConfig as ClientAgentConfig,
  StateUpdate,
  StreamToken,
  ToolCallEvent,
  ToolResultEvent,
  TurnEndEvent,
  TurnEndReason,
  WritePreviewEvent
} from '../shared/types'
import { DesktopApprovalHandler } from './permissions'
import { registerCodingTools, registerMcpTools, registerSubagentTool, registerComprehensionTool } from './tools'
import { loadSession } from './sessions'
import { buildSystemPrompt } from './prompts'
import { buildPluginHookRegistry } from './hooks'
import { SubagentFactory } from './subagent'
import { CrewCoordinator, type CrewRunResult } from './crew'
import type { McpManager } from './mcp-manager'
import type { CrewPlan, CrewRoleConfig, CrewStrategy } from '../shared/types'

// ─── Configuration ───────────────────────────────────────────────────────────

export interface AgentConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  /** Model backend. Defaults to 'openai' (OpenAI-compatible: GLM/OpenAI/etc.). */
  provider?: 'openai' | 'anthropic'
  /** Anthropic API key (used when provider === 'anthropic'). */
  anthropicApiKey?: string
  /** Optional Anthropic base URL override. */
  anthropicBaseUrl?: string
  /** Path globs the crew must ask before writing to (invariant regions). */
  protectedGlobs?: string[]
  /** Plugin names the user has trusted to run code (enables their hooks). */
  trustedPlugins?: string[]
  /** Plugin names the user has disabled. */
  disabledPlugins?: string[]
}

const DEFAULT_MODEL = 'glm-5.1'

// Conservative default cost rates (USD per 1K tokens) used as an order-of-
// magnitude estimate only. Callers that need accurate billing should plug in
// their own pricing table later.
const DEFAULT_PROMPT_COST_PER_1K = 0.00015
const DEFAULT_COMPLETION_COST_PER_1K = 0.0006

// ─── Manager ─────────────────────────────────────────────────────────────────

interface ActiveTurn {
  turnId: string
  agent: Agent
  /** Reflects whether the user requested abort for this turn. */
  aborted: boolean
}

export interface AgentManager {
  /**
   * Run the agent for a single user prompt. Streams tokens, tool calls,
   * tool results, and a turn-end event to the renderer. Resolves once the
   * stream is fully drained.
   */
  runQuery(
    sessionId: string,
    prompt: string,
    overrides?: Partial<AgentConfig>,
    clientConfig?: ClientAgentConfig
  ): Promise<{ turnId: string }>
  /** Cancel the in-flight turn for a session (no-op if none). */
  abort(sessionId: string): void
  getConfig(): AgentConfig
  updateConfig(config: Partial<AgentConfig>): void
  /** Set the currently-open workspace root (used as the default tool cwd). */
  setWorkspace(root: string | null): void
  /** Toggle unattended mode — auto-approves allowlisted safe bash overnight. */
  setAutopilotMode(enabled: boolean): void
  /** Whether a usable model credential exists for the current provider. */
  getConfigStatus(): { hasModel: boolean; provider: 'openai' | 'anthropic' }
  /** Resolve a pending write preview (Accept/Reject from the renderer). */
  resolveWrite(toolCallId: string, accepted: boolean): boolean
  /** Grounded Q&A: answer a question using ONLY the supplied Brain evidence. */
  askBrain(question: string, evidence: Evidence): Promise<string>
  /** Team Lead planning pass — returns a human-approvable plan for the task. */
  planCrew(task: string, roles?: CrewRoleConfig[]): Promise<CrewPlan>
  /** Run a multi-agent crew pipeline for a task. Streams over `kairo:crew`. */
  runCrew(
    crewId: string,
    sessionId: string,
    task: string,
    roles?: CrewRoleConfig[],
    strategy?: CrewStrategy,
    plan?: CrewPlan
  ): Promise<CrewRunResult>
  /** Abort an in-flight crew run. */
  abortCrew(crewId: string): boolean
  /** Approval handler for permission decisions from the renderer. */
  readonly approvalHandler: DesktopApprovalHandler
}

/** Tools that go through the WritePreview flow instead of the generic permission dialog. */
const WRITE_PREVIEW_TOOLS = new Set(['write_file', 'edit'])

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  json: 'json', md: 'markdown', py: 'python', sh: 'bash',
  yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css',
  go: 'go', rs: 'rust', java: 'java', rb: 'ruby',
  php: 'php', c: 'c', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp'
}

function langFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'text'
  return EXT_TO_LANG[filePath.slice(dot + 1).toLowerCase()] ?? 'text'
}

/** Auto-approve timeout for write previews (ms). */
const WRITE_PREVIEW_TIMEOUT_MS = 120_000

/**
 * Permission guard that defers to each tool's declared {@link ToolPermission}.
 * Read-only tools execute silently; write-preview tools (write_file, edit) are
 * auto-approved here because the WritePreview flow handles user approval;
 * system tools require explicit user approval through the
 * {@link DesktopApprovalHandler}.
 */
class CategoryPermissionGuard implements PermissionGuard {
  constructor(private readonly registry: ToolRegistry) {}

  async check(toolName: string, _args: Record<string, unknown>): Promise<PermissionResult> {
    const def = this.registry.get(toolName)
    if (!def) return { allowed: true }
    if (def.permission === 'read') return { allowed: true }
    if (WRITE_PREVIEW_TOOLS.has(toolName)) return { allowed: true }
    return {
      allowed: 'ask',
      question: `Approve invocation of '${toolName}' (${def.permission} tool)?`
    }
  }
}

/**
 * Permission guard for crew agents: read tools run freely, every other tool
 * (write, edit, bash, git_commit, …) requires explicit user approval via the
 * permission dialog. Crew runs in a modal, so the inline diff-preview flow is
 * bypassed (usePreview=false) and writes are gated here instead.
 */
class CrewPermissionGuard implements PermissionGuard {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly protectedGlobs: string[]
  ) {}

  async check(toolName: string, args: Record<string, unknown>): Promise<PermissionResult> {
    const def = this.registry.get(toolName)
    if (!def) return { allowed: true }
    // Comprehension routing: auto-run the safe/reversible majority; escalate
    // only where the human's judgment matters (protected regions / irreversible).
    const routed = routeToolCall(toolName, args, { protectedGlobs: this.protectedGlobs })
    if (routed.decision === 'auto') return { allowed: true }
    return {
      allowed: 'ask',
      question: `[Crew] ${routed.reason ?? `Approve '${toolName}'?`}`
    }
  }
}

/**
 * Wraps {@link DefaultToolExecutor} so each `execute` call carries the desktop
 * {@link ApprovalHandler} through the {@link ToolContext}. For write-preview
 * tools (write_file, edit), the executor intercepts execution to show a diff
 * preview and wait for user approval before writing to disk.
 */
class ApprovalAwareExecutor extends DefaultToolExecutor {
  private readonly approvalHandler: ApprovalHandler
  private workingDirectory: string
  private readonly sendFn: (channel: string, payload: unknown) => void
  private readonly pendingWrites: Map<string, { resolve: (accepted: boolean) => void }>
  private readonly usePreview: boolean
  private currentSessionId = ''
  private currentTurnId = ''

  constructor(args: {
    registry: DefaultToolRegistry
    permissionGuard: PermissionGuard
    approvalHandler: ApprovalHandler
    workingDirectory: string
    send: (channel: string, payload: unknown) => void
    pendingWrites: Map<string, { resolve: (accepted: boolean) => void }>
    /** When false, write tools go through the permission guard instead of the
     *  inline diff-preview flow (used by crew, whose modal hides inline diffs). */
    usePreview?: boolean
  }) {
    super({ registry: args.registry, permissionGuard: args.permissionGuard, options: { timeout: 180_000 } })
    this.approvalHandler = args.approvalHandler
    this.workingDirectory = args.workingDirectory
    this.sendFn = args.send
    this.pendingWrites = args.pendingWrites
    this.usePreview = args.usePreview ?? true
  }

  setWorkingDirectory(dir: string): void {
    this.workingDirectory = dir
  }

  setActiveTurn(sessionId: string, turnId: string): void {
    this.currentSessionId = sessionId
    this.currentTurnId = turnId
  }

  override async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolExecutionResult> {
    const enriched: ToolContext = {
      ...ctx,
      workingDirectory: this.workingDirectory,
      approvalHandler: this.approvalHandler
    }

    if (this.usePreview && WRITE_PREVIEW_TOOLS.has(toolName)) {
      return this.executeWithPreview(toolName, args, enriched)
    }

    return super.execute(toolName, args, enriched)
  }

  private async executeWithPreview(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolExecutionResult> {
    const rawPath = typeof args.path === 'string' ? args.path : ''
    if (!rawPath) {
      return { content: "Missing required argument 'path'.", isError: true }
    }
    const filePath = nodePath.isAbsolute(rawPath)
      ? rawPath
      : nodePath.resolve(this.workingDirectory, rawPath)

    let originalContent = ''
    try {
      originalContent = await fsPromises.readFile(filePath, 'utf-8')
    } catch {
      // File doesn't exist yet — that's fine for write_file (new file)
    }

    let newContent: string
    if (toolName === 'edit') {
      const replacements = Array.isArray(args.replacements) ? args.replacements : []
      if (replacements.length === 0) {
        return { content: "Missing required argument 'replacements'.", isError: true }
      }
      let result = originalContent
      for (let i = 0; i < replacements.length; i++) {
        const r = replacements[i] as { oldText?: string; newText?: string }
        const oldText = typeof r.oldText === 'string' ? r.oldText : ''
        const newText = typeof r.newText === 'string' ? r.newText : ''
        if (!oldText) {
          return { content: `Replacement #${i + 1} has empty oldText.`, isError: true }
        }
        const idx = result.indexOf(oldText)
        if (idx === -1) {
          return { content: `oldText not found for replacement #${i + 1}`, isError: true }
        }
        const secondIdx = result.indexOf(oldText, idx + oldText.length)
        if (secondIdx !== -1) {
          return { content: `oldText for replacement #${i + 1} matches multiple times; must be unique.`, isError: true }
        }
        result = result.slice(0, idx) + newText + result.slice(idx + oldText.length)
      }
      newContent = result
    } else {
      newContent = typeof args.content === 'string' ? args.content : ''
    }

    if (originalContent === newContent) {
      return {
        content: `No changes to ${filePath}`,
        metadata: { path: filePath }
      }
    }

    const previewId = randomUUID()
    const language = langFromPath(filePath)

    const preview: WritePreviewEvent = {
      sessionId: this.currentSessionId,
      turnId: this.currentTurnId,
      toolCallId: previewId,
      filePath,
      originalContent,
      newContent,
      language
    }
    this.sendFn('kairo:writePreview', preview)

    const accepted = await new Promise<boolean>((resolve) => {
      this.pendingWrites.set(previewId, { resolve })
      setTimeout(() => {
        if (this.pendingWrites.has(previewId)) {
          this.pendingWrites.get(previewId)!.resolve(false)
          this.pendingWrites.delete(previewId)
        }
      }, WRITE_PREVIEW_TIMEOUT_MS)
    })

    if (!accepted) {
      return {
        content: `User rejected the change to ${filePath}`,
        isError: true
      }
    }

    try {
      await fsPromises.mkdir(nodePath.dirname(filePath), { recursive: true })
      await fsPromises.writeFile(filePath, newContent, 'utf-8')
      const verb = toolName === 'edit' ? 'Applied edits to' : 'Wrote'
      return {
        content: `${verb} ${filePath}`,
        metadata: { path: filePath, bytes: newContent.length }
      }
    } catch (err) {
      return {
        content: `Failed to write '${filePath}': ${(err as Error).message}`,
        isError: true
      }
    }
  }
}

export function createAgentManager(mainWindow: BrowserWindow, mcpManager?: McpManager): AgentManager {
  const approvalHandler = new DesktopApprovalHandler(mainWindow)
  const pendingWrites = new Map<string, { resolve: (accepted: boolean) => void }>()

  const hookContext = { sessionId: '', turnId: '' }

  const envProvider = process.env.KAIRO_PROVIDER === 'anthropic' ? 'anthropic' : 'openai'
  let config: AgentConfig = {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
    provider: envProvider,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL
  }

  // Cumulative usage / cost across the lifetime of the manager. Pushed to
  // the renderer on every turn end via `kairo:stateUpdate`.
  const totalTokens = { prompt: 0, completion: 0 }
  let totalCost = 0

  const activeTurns = new Map<string, ActiveTurn>()

  const send = (channel: string, payload: unknown): void => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
  }

  const emitState = (sessionId: string, state: StateUpdate['state'], statusText?: string): void => {
    const update: StateUpdate = { sessionId, state, ...(statusText ? { statusText } : {}) }
    send('kairo:stateUpdate', update)
  }

  let currentWorkingDirectory = process.cwd()
  // The workspace the user has opened (from the renderer). Source of truth for
  // tool working directories when a session isn't bound to its own root.
  let currentWorkspaceRoot: string | null = null

  // Never let tools run at the filesystem root: when launched from Finder the
  // packaged app's process.cwd() is "/", which makes the agent roam the whole
  // disk. Fall back to the opened workspace, then a sane non-root directory.
  const defaultWorkingDir = (): string => {
    if (currentWorkspaceRoot) return currentWorkspaceRoot
    const cwd = process.cwd()
    return cwd && cwd !== '/' ? cwd : homedir()
  }

  // Resolve the working directory for a turn/crew: a session bound to its own
  // project wins; otherwise the currently-open workspace; never "/".
  const resolveWorkingDir = async (sessionId: string): Promise<string> => {
    try {
      const session = await loadSession(sessionId)
      if (session?.workspaceRoot) return session.workspaceRoot
    } catch {
      // best-effort; fall through to the live workspace / safe default
    }
    return defaultWorkingDir()
  }

  const subagentFactory = new SubagentFactory(
    () => config,
    () => currentWorkingDirectory,
    send
  )

  const crewCoordinator = new CrewCoordinator(
    () => config,
    () => currentWorkingDirectory,
    send,
    (registry, workingDirectory, sessionId, turnId) => {
      const executor = new ApprovalAwareExecutor({
        registry,
        permissionGuard: new CrewPermissionGuard(registry, config.protectedGlobs ?? DEFAULT_PROTECTED_GLOBS),
        approvalHandler,
        workingDirectory,
        send,
        pendingWrites,
        usePreview: false
      })
      executor.setActiveTurn(sessionId, turnId)
      approvalHandler.setActiveTurn(sessionId, turnId)
      return executor
    }
  )

  const buildAgentAsync = async (
    workingDirectory: string,
    clientConfig?: ClientAgentConfig
  ): Promise<{ agent: Agent; executor: ApprovalAwareExecutor }> => {
    currentWorkingDirectory = workingDirectory

    const { provider, modelName: defaultModel } = buildProvider(config)
    const registry = new DefaultToolRegistry()
    registerCodingTools(registry)
    if (mcpManager) registerMcpTools(registry, mcpManager)
    registerSubagentTool(registry, subagentFactory, () => hookContext)
    registerComprehensionTool(registry, () => currentWorkingDirectory)
    const guard = new CategoryPermissionGuard(registry)
    const executor = new ApprovalAwareExecutor({
      registry,
      permissionGuard: guard,
      approvalHandler,
      workingDirectory,
      send,
      pendingWrites
    })

    const systemPrompt = await buildSystemPrompt(workingDirectory)
    // Desktop hooks + TRUSTED plugins' lifecycle hooks. The main agent also
    // supplies prompt/agent hook execution (provider gate + verifier subagent).
    const hookRegistry = await buildPluginHookRegistry(config, workingDirectory, send, () => hookContext, {
      runPrompt: (prompt, model) => runPromptGate(prompt, model),
      runAgent: (prompt) => runAgentGate(prompt)
    })

    const builder = AgentBuilder.create()
      .name('kairo-code')
      .model(provider)
      .modelName(clientConfig?.model ?? config.model ?? defaultModel)
      .tools(registry)
      .toolExecutor(executor)
      .systemPrompt(systemPrompt)
      .streaming(true)
      .hooks(hookRegistry)

    if (clientConfig?.maxIterations !== undefined) {
      builder.maxIterations(clientConfig.maxIterations)
    }

    builder.context({
      maxTokens: clientConfig?.tokenBudget ?? 128_000,
      compactionThreshold: 0.85
    })

    return { agent: builder.build(), executor }
  }

  const classifyError = (err: unknown): { code: string; message: string; retryAfter?: number } => {
    if (err instanceof KairoError) {
      const meta = (err.metadata ?? {}) as { status?: number; retryAfter?: number }
      if (meta.status === 429 || /rate.?limit/i.test(err.message)) {
        return {
          code: 'rate_limit',
          message: err.message,
          ...(meta.retryAfter !== undefined ? { retryAfter: meta.retryAfter } : {})
        }
      }
      if (
        meta.status !== undefined &&
        (meta.status >= 500 || meta.status === 408 || meta.status === 0)
      ) {
        return { code: 'network', message: err.message }
      }
      if (/denied|approval|permission/i.test(err.message)) {
        return { code: 'tool_denied', message: err.message }
      }
      return { code: err.code.toLowerCase(), message: err.message }
    }
    if (err instanceof Error) {
      if (/ECONN|ENETWORK|ETIMEDOUT|fetch failed|network/i.test(err.message)) {
        return { code: 'network', message: err.message }
      }
      return { code: 'unknown', message: err.message }
    }
    return { code: 'unknown', message: String(err) }
  }

  async function runQuery(
    sessionId: string,
    prompt: string,
    overrides?: Partial<AgentConfig>,
    clientConfig?: ClientAgentConfig
  ): Promise<{ turnId: string }> {
    if (overrides) updateConfig(overrides)

    // If a turn for this session is already in flight, abort it before
    // starting a new one. This keeps the "one turn per session" invariant
    // the renderer relies on.
    const existing = activeTurns.get(sessionId)
    if (existing) {
      existing.aborted = true
      try {
        existing.agent.abort()
      } catch {
        // best-effort abort
      }
    }

    // Resolve the workspace root so tools operate on the user's project, not
    // the Electron process CWD (which is "/" for a Finder-launched app).
    const workingDirectory = await resolveWorkingDir(sessionId)

    let agent: Agent
    let executor: ApprovalAwareExecutor
    try {
      const built = await buildAgentAsync(workingDirectory, clientConfig)
      agent = built.agent
      executor = built.executor
    } catch (err) {
      const classified = classifyError(err)
      send('kairo:error', { code: classified.code, message: classified.message })
      throw err
    }

    const turnId = randomUUID()
    const turn: ActiveTurn = { turnId, agent, aborted: false }
    activeTurns.set(sessionId, turn)
    approvalHandler.setActiveTurn(sessionId, turnId)
    executor.setActiveTurn(sessionId, turnId)
    hookContext.sessionId = sessionId
    hookContext.turnId = turnId
    emitState(sessionId, 'thinking')

    // Streaming bookkeeping
    let tokenIndex = 0
    let assistantText = ''
    let usage: TokenUsage | undefined
    /**
     * `tool_use_start` from the OpenAI provider yields a mutable ToolCall
     * reference whose `arguments` are filled in only by the time
     * `tool_use_end` fires. We hold the reference and emit our renderer
     * event on `tool_use_end`.
     */
    const inFlightToolCalls = new Map<
      string,
      { ref: ToolCall; startedAt: number }
    >()
    let endReason: TurnEndReason = 'completed'
    let errorPayload: { code: string; message: string; retryAfter?: number } | null = null

    try {
      for await (const event of agent.stream(prompt) as AsyncIterable<StreamEvent>) {
        if (turn.aborted) {
          endReason = 'aborted'
          break
        }

        switch (event.type) {
          case 'text_delta': {
            assistantText += event.text
            const payload: StreamToken = {
              sessionId,
              turnId,
              delta: event.text,
              index: tokenIndex++
            }
            send('kairo:token', payload)
            break
          }

          case 'tool_use_start': {
            inFlightToolCalls.set(event.toolCall.id, {
              ref: event.toolCall,
              startedAt: Date.now()
            })
            emitState(sessionId, 'tool-running', event.toolCall.name)
            break
          }

          case 'tool_use_end': {
            const inflight = inFlightToolCalls.get(event.toolCallId)
            if (inflight) {
              const callPayload: ToolCallEvent = {
                sessionId,
                turnId,
                toolCallId: inflight.ref.id,
                name: inflight.ref.name,
                args: parseToolArgs(inflight.ref.arguments),
                startedAt: inflight.startedAt
              }
              send('kairo:toolCall', callPayload)
            }
            break
          }

          case 'tool_result': {
            const result = event.result
            const inflight = inFlightToolCalls.get(result.toolCallId)
            const resultPayload: ToolResultEvent = {
              sessionId,
              turnId,
              toolCallId: result.toolCallId,
              ok: !result.isError,
              ...(result.isError
                ? { error: result.content }
                : { result: result.content }),
              endedAt: Date.now()
            }
            send('kairo:toolResult', resultPayload)
            if (inflight) inFlightToolCalls.delete(result.toolCallId)
            emitState(sessionId, 'thinking')
            break
          }

          case 'message_end': {
            const u = (event as unknown as { usage?: TokenUsage }).usage
            if (u) {
              usage = u
              const totalUsed = u.inputTokens + u.outputTokens
              send('kairo:stateUpdate', {
                sessionId,
                state: 'thinking',
                tokenBudget: {
                  used: totalUsed,
                  max: clientConfig?.tokenBudget ?? 128_000
                }
              } satisfies StateUpdate)
            }
            break
          }

          case 'error': {
            errorPayload = classifyError(event.error)
            endReason = 'error'
            break
          }

          case 'done':
            break

          // 'message_start' / 'thinking_delta' currently have no UI mapping.
          default:
            break
        }
      }
    } catch (err) {
      errorPayload = classifyError(err)
      endReason = 'error'
    } finally {
      activeTurns.delete(sessionId)

      if (turn.aborted && endReason !== 'error') endReason = 'aborted'

      if (errorPayload) {
        send('kairo:error', errorPayload)
        emitState(sessionId, 'error', errorPayload.message)
      } else {
        emitState(sessionId, 'idle')
      }

      const turnEnd: TurnEndEvent = {
        sessionId,
        turnId,
        reason: endReason,
        ...(usage !== undefined
          ? { tokensUsed: usage.inputTokens + usage.outputTokens }
          : {}),
        ...(assistantText ? { finalMessage: assistantText } : {})
      }
      send('kairo:turnEnd', turnEnd)

      if (usage) {
        totalTokens.prompt += usage.inputTokens
        totalTokens.completion += usage.outputTokens
        totalCost +=
          (usage.inputTokens / 1000) * DEFAULT_PROMPT_COST_PER_1K +
          (usage.outputTokens / 1000) * DEFAULT_COMPLETION_COST_PER_1K
        // Coarse usage broadcast on the same channel; richer payloads are
        // future work and will be additive on this contract.
        send('kairo:stateUpdate', {
          sessionId,
          state: 'idle',
          statusText: `tokens: ${totalTokens.prompt + totalTokens.completion} • est $${totalCost.toFixed(4)}`
        } satisfies StateUpdate)
      }
    }

    return { turnId }
  }

  function abort(sessionId: string): void {
    const turn = activeTurns.get(sessionId)
    if (!turn) return
    turn.aborted = true
    try {
      turn.agent.abort()
    } catch {
      // best-effort abort
    }
  }

  function getConfig(): AgentConfig {
    return { ...config }
  }

  function setWorkspace(root: string | null): void {
    currentWorkspaceRoot = root && root.trim() ? root : null
    if (currentWorkspaceRoot) currentWorkingDirectory = currentWorkspaceRoot
  }

  function updateConfig(next: Partial<AgentConfig>): void {
    config = { ...config, ...next }
  }

  function setAutopilotMode(enabled: boolean): void {
    approvalHandler.setAutopilotMode(enabled)
  }

  function getConfigStatus(): { hasModel: boolean; provider: 'openai' | 'anthropic' } {
    const provider = config.provider ?? 'openai'
    const hasModel =
      provider === 'anthropic'
        ? !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY)
        : !!(config.apiKey || process.env.OPENAI_API_KEY)
    return { hasModel, provider }
  }

  function resolveWrite(toolCallId: string, accepted: boolean): boolean {
    const entry = pendingWrites.get(toolCallId)
    if (!entry) return false
    entry.resolve(accepted)
    pendingWrites.delete(toolCallId)
    return true
  }

  function planCrew(task: string, roles?: CrewRoleConfig[]): Promise<CrewPlan> {
    return crewCoordinator.plan(task, roles)
  }

  /**
   * Grounded Q&A — one-shot completion constrained to the supplied evidence, so
   * the model answers "why is X like this" from the Brain, never from thin air.
   * Throws "Missing … API key" (let the UI fall back to showing evidence only).
   */
  /**
   * Tool-augmented comprehension chat. The LLM can call read_file, grep,
   * list_directory, git_log (the read-only coding tools) + the evidence
   * gathered by gatherEvidence. Max 5 iterations keeps it snappy.
   */
  function askBrain(question: string, evidence: Evidence): Promise<string> {
    const { provider, modelName } = buildProvider(config)
    const cwd = currentWorkingDirectory

    const registry = new DefaultToolRegistry()
    registerCodingTools(registry)
    // Filter to read-only tools only (no writes from the comprehension agent).
    const BRAIN_READ_TOOLS = new Set(['read_file', 'list_directory', 'grep', 'git_status', 'git_diff', 'git_log'])
    const readRegistry = new DefaultToolRegistry()
    for (const tool of registry.list()) {
      if (BRAIN_READ_TOOLS.has(tool.name)) readRegistry.register(tool, registry.getExecutor(tool.name)!)
    }
    const executor = new DefaultToolExecutor({
      registry: readRegistry,
      permissionGuard: { check: () => ({ allowed: true }) } as never
    })

    const evidenceBlock = evidence.items.length > 0
      ? '\n\nBrain evidence (pre-gathered, reference with [E#]):\n' +
        evidence.items.map((e) => `[${e.id}] (${e.kind}) ${e.text}`).join('\n')
      : ''

    const agent = AgentBuilder.create()
      .name('kairo-brain')
      .model(provider)
      .modelName(modelName)
      .tools(readRegistry)
      .toolExecutor(executor)
      .systemPrompt(
        BRAIN_QA_SYSTEM +
        '\n\nYou have tools to read files and search the codebase. Use them to answer the question thoroughly.' +
        '\nFor flow questions ("how does X work"), trace the call chain by reading the entry file and following calls.' +
        '\nFor why questions ("why is this like that"), check git_log for the file and explain the history.' +
        '\nAlways cite evidence: use [E#] for pre-gathered evidence and quote file paths for code you read.' +
        '\nIf uncertain, say so rather than guessing.' +
        '\nWorking directory: ' + cwd
      )
      .streaming(true)
      .maxIterations(5)
      .context({ maxTokens: 32_000, compactionThreshold: 0.85 })
      .build()

    const prompt = buildQaPrompt(question, evidence) + evidenceBlock

    // Try tool-augmented agent first; fall back to simple one-shot if the model
    // doesn't support tool use (e.g., some GLM versions).
    const runAgent = async (): Promise<string> => {
      let text = ''
      for await (const ev of agent.stream(prompt) as AsyncIterable<StreamEvent>) {
        if (ev.type === 'text_delta') text += ev.text
        else if (ev.type === 'error') throw ev.error
      }
      return text.trim()
    }

    const runSimple = async (): Promise<string> => {
      let text = ''
      for await (const ev of provider.stream({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: BRAIN_QA_SYSTEM,
        config: { model: modelName, maxTokens: 4000 }
      }) as AsyncIterable<StreamEvent>) {
        if (ev.type === 'text_delta') text += ev.text
        else if (ev.type === 'error') throw ev.error
      }
      return text.trim()
    }

    const run = runAgent().catch(() => runSimple())
    return Promise.race([
      run,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('问系统超时 — 检查模型/网络')), 120_000))
    ])
  }

  // ── Plugin hook gates (prompt / agent hook types) ──────────────────────
  // Parse a gate verdict from model/agent text: explicit JSON {ok,reason} wins;
  // otherwise fail-open (ok:true) so an ambiguous answer never blocks.
  function parseGateText(text: string): { ok: boolean; reason?: string } {
    const m = /\{[\s\S]*\}/.exec(text)
    if (m) {
      try {
        const o = JSON.parse(m[0]) as Record<string, unknown>
        if (typeof o.ok === 'boolean') return { ok: o.ok, reason: typeof o.reason === 'string' ? o.reason : undefined }
      } catch {
        /* fall through to fail-open */
      }
    }
    return { ok: true }
  }

  const GATE_SYSTEM =
    'You are evaluating a Claude Code plugin hook condition. Respond with ONLY a JSON object: ' +
    '{"ok":true} if the action should proceed, or {"ok":false,"reason":"..."} if it must be blocked.'

  // `prompt` hook: one-shot LLM yes/no gate.
  async function runPromptGate(prompt: string, model?: string): Promise<{ ok: boolean; reason?: string }> {
    const { provider, modelName } = buildProvider(config)
    let text = ''
    for await (const ev of provider.stream({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: GATE_SYSTEM,
      config: { model: model ?? modelName, maxTokens: 300 }
    }) as AsyncIterable<StreamEvent>) {
      if (ev.type === 'text_delta') text += ev.text
      else if (ev.type === 'error') throw ev.error
    }
    return parseGateText(text)
  }

  // `agent` hook: verifier subagent yes/no gate.
  async function runAgentGate(prompt: string): Promise<{ ok: boolean; reason?: string }> {
    const res = await subagentFactory.spawn(`${prompt}\n\n${GATE_SYSTEM}`)
    return parseGateText(res.text ?? '')
  }

  async function runCrew(
    crewId: string,
    sessionId: string,
    task: string,
    roles?: CrewRoleConfig[],
    strategy?: CrewStrategy,
    plan?: CrewPlan
  ): Promise<CrewRunResult> {
    // Resolve workspace root so crew tools operate on the user's project,
    // mirroring runQuery's resolution (never the filesystem root).
    currentWorkingDirectory = await resolveWorkingDir(sessionId)
    return crewCoordinator.run(crewId, sessionId, task, roles, strategy, plan)
  }

  function abortCrew(crewId: string): boolean {
    return crewCoordinator.abort(crewId)
  }

  return { runQuery, abort, getConfig, updateConfig, setWorkspace, setAutopilotMode, getConfigStatus, askBrain, planCrew, runCrew, abortCrew, resolveWrite, approvalHandler }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed }
  } catch {
    return { _raw: raw }
  }
}
