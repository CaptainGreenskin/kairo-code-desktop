/**
 * Shared IPC contract types between main and renderer processes.
 */

import type { BehaviorSignal } from './behavior-delta'
import type { DeviationSignal } from './architecture-deviation'
import type { CrewRunView } from './crew-run'

export type { BehaviorSignal } from './behavior-delta'
export type { DeviationSignal } from './architecture-deviation'

export interface StreamToken {
  sessionId: string
  turnId: string
  /** Incremental text delta produced by the model. */
  delta: string
  /** Monotonically increasing token index within the turn. */
  index: number
}

export interface ToolCallEvent {
  sessionId: string
  turnId: string
  toolCallId: string
  name: string
  args: Record<string, unknown>
  /** Wall-clock timestamp (ms) when the tool was invoked. */
  startedAt: number
}

export interface ToolResultEvent {
  sessionId: string
  turnId: string
  toolCallId: string
  /** True for normal completion, false if the tool errored or was rejected. */
  ok: boolean
  /** Result payload (for ok=true) or error message (for ok=false). */
  result?: unknown
  error?: string
  /** Wall-clock timestamp (ms) when the tool completed. */
  endedAt: number
}

export type TurnEndReason =
  | 'completed'
  | 'aborted'
  | 'error'
  | 'budget-exhausted'
  | 'permission-denied'

export interface TurnEndEvent {
  sessionId: string
  turnId: string
  reason: TurnEndReason
  /** Total tokens used (input + output) within the turn, if known. */
  tokensUsed?: number
  /** Optional final assistant message rendered for this turn. */
  finalMessage?: string
}

export interface PermissionRequest {
  sessionId: string
  turnId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  /** Human-readable reason or summary shown to the user. */
  reason?: string
}

export type PermissionVerdict = 'allow' | 'deny' | 'allow-session'

export interface PermissionDecision {
  sessionId: string
  toolCallId: string
  verdict: PermissionVerdict
  /** Optional user-provided note (e.g., why denied). */
  note?: string
}

export interface WritePreviewEvent {
  sessionId: string
  turnId: string
  /** Unique identifier for this write preview (correlates with approveWrite). */
  toolCallId: string
  filePath: string
  originalContent: string
  newContent: string
  language: string
}

export interface FileChangeEvent {
  /**
   * Session this change is associated with. Optional because file-system
   * watchers are workspace-level and not bound to a specific turn.
   */
  sessionId?: string
  path: string
  changeType: 'created' | 'modified' | 'deleted'
  /** Wall-clock timestamp (ms). */
  at: number
}

export interface StateUpdate {
  sessionId: string
  /** Coarse high-level lifecycle state surfaced to the UI. */
  state: 'idle' | 'thinking' | 'tool-running' | 'awaiting-permission' | 'error'
  /** Optional human-readable status (e.g., current tool name). */
  statusText?: string
  /** Token budget tracking for the current session. */
  tokenBudget?: {
    used: number
    max: number
    compacted?: boolean
  }
}

export interface SessionMeta {
  id: string
  /** Display name; auto-generated from first prompt or user-set. */
  name: string
  createdAt: number
  updatedAt: number
  /** Number of messages currently persisted for the session. */
  messageCount: number
  /** First few characters of the first user message. */
  preview: string
  /** Workspace root path the session is bound to. */
  workspaceRoot?: string
  /** Optional model identifier captured at session creation. */
  model?: string
}

/** Persisted session record including full message history. */
/** A sub-agent's inner tool invocation, persisted with its parent tool call. */
export interface SubagentStepData {
  id: string
  name: string
  args?: string
  result?: string
  ok?: boolean
  startedAt: number
  endedAt?: number
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{
    id: string
    toolName: string
    args: Record<string, unknown>
    result?: string
    isError?: boolean
    startedAt: number
    endedAt?: number
    /** Sub-agent trace, so delegated work stays observable after reopen. */
    subagentSteps?: SubagentStepData[]
    subagentDone?: boolean
  }>
  timestamp: number
  /** Persisted inline crew run, so it survives reopen / restart. */
  crew?: CrewRunView
}

export interface SessionFile {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  workspaceRoot?: string
  model?: string
  messages: SessionMessage[]
}

export interface ActivityEvent {
  sessionId: string
  turnId: string
  type:
    | 'tool-start'
    | 'tool-end'
    | 'error'
    | 'compaction'
    | 'subagent-start'
    | 'subagent-end'
    | 'subagent-tool'
    | 'subagent-tool-result'
  toolName?: string
  toolCallId?: string
  /**
   * The parent `spawn_subagent` tool-call id, set on every subagent-* event so
   * the renderer can attach the sub-agent's trace inline under the tool block
   * that launched it (observability for delegated work).
   */
  parentToolCallId?: string
  /** Sub-agent inner tool arguments (JSON string), on subagent-tool. */
  args?: string
  /** Inner tool success, on subagent-tool-result. */
  ok?: boolean
  durationMs?: number
  isError?: boolean
  message?: string
  timestamp: number
}

export type ThemeMode = 'dark' | 'light' | 'system'
export type PermissionMode = 'ask-every-time' | 'auto-approve-read'

// ─── Crew (multi-agent pipeline) ─────────────────────────────────────────────

/** How the crew executes its roles. */
export type CrewStrategy = 'sequential' | 'parallel'

/** A Team-Lead-generated, human-approvable plan: a concrete brief per role. */
export interface CrewPlanStep {
  roleId: string
  /** What this role should do for THIS task (the Team Lead's brief). */
  brief: string
  /** Role ids this step runs after (the Team Lead's dependency graph). */
  dependsOn?: string[]
}

export interface CrewPlan {
  /** One-line overall approach. */
  approach: string
  /** The crew the Team Lead composed for this task (materialized from the library). */
  roles: CrewRoleConfig[]
  steps: CrewPlanStep[]
}

/** A single role in a crew pipeline (e.g. Planner, Coder, Reviewer). */
export interface CrewRoleConfig {
  /** Unique role id, e.g. 'planner'. */
  id: string
  /** Display label, e.g. 'Planner'. */
  label: string
  /** System prompt that specializes this agent. */
  systemPrompt: string
  /** Tool names this role may use. Empty/omitted → read-only toolset. */
  allowedTools?: string[]
  /** Role ids this role runs after (its dependencies). Enables DAG execution;
   *  when no role declares deps, the crew strategy derives them. */
  dependsOn?: string[]
}

/**
 * Change Lens — a comprehension-first view of a crew's changes. Optimized for
 * the human to UNDERSTAND (blast radius, what was/wasn't verified, where the
 * agent was unsure) rather than to re-read a diff.
 */
export interface ChangeLensModule {
  /** Top-level module/region (e.g. 'src/main') the files belong to. */
  module: string
  files: string[]
}

export interface VerificationRun {
  /** The command/test the crew actually executed. */
  command: string
  ok: boolean
}

export interface ChangeLensVerification {
  /** Commands/tests the crew actually ran, with pass/fail. */
  ran: VerificationRun[]
  /** Files the crew wrote or edited. */
  filesWritten: string[]
  /** Whether any executed command looked like a test run. */
  testsRun: boolean
  /** Anti-rubber-stamp punch line, e.g. "No tests were run for 4 changed files." */
  warning?: string
}

export interface ChangeLens {
  /** Files the crew changed, grouped by module (blast radius v0). */
  blastRadius: ChangeLensModule[]
  filesChanged: string[]
  verification: ChangeLensVerification
  /** ≤3 things the agent was least sure about / where it diverged. May be empty. */
  uncertaintyFlags: string[]
  /** Observable behavior changes (export surface / side effects / routes). */
  behaviorDelta?: BehaviorSignal[]
  /** Architecture deviations: newly introduced cross-module deps / cycles. */
  deviations?: DeviationSignal[]
  /** Modules transitively downstream of the change (impacted, not edited). */
  downstreamModules?: string[]
}

/**
 * Events streamed from the main-process crew coordinator to the renderer over
 * the `kairo:crew` channel. One run is identified by `crewId`; each role's
 * activity is keyed by `roleId`.
 */
export type CrewEvent =
  | { type: 'crew-start'; crewId: string; sessionId: string; task: string; strategy: CrewStrategy; roles: Array<{ id: string; label: string }> }
  | { type: 'agent-start'; crewId: string; roleId: string }
  | { type: 'agent-token'; crewId: string; roleId: string; delta: string }
  | { type: 'agent-tool'; crewId: string; roleId: string; toolName: string; path?: string; toolCallId?: string; args?: Record<string, unknown> }
  | { type: 'agent-tool-result'; crewId: string; roleId: string; toolCallId: string; ok: boolean; result?: string }
  | { type: 'agent-end'; crewId: string; roleId: string; tokensUsed?: number }
  | { type: 'crew-end'; crewId: string; reason: 'completed' | 'aborted' | 'error'; summary?: string; error?: string }

export interface McpServerConfig {
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  enabled: boolean
  autoConnect?: boolean
}

export interface McpServerStatus {
  name: string
  transport: 'stdio' | 'sse'
  connected: boolean
  toolCount: number
  enabled: boolean
  error?: string
}

export interface McpToolInfo {
  serverName: string
  name: string
  qualifiedName: string
  description: string
  inputSchema: Record<string, unknown>
}

/** Which model backend to drive the agent with. */
export type ModelProviderKind = 'openai' | 'anthropic'

export interface AppSettings {
  model: string
  apiKey?: string
  baseUrl?: string
  /** Selected model backend. OpenAI-compatible (GLM/OpenAI/etc.) or Anthropic. */
  provider?: ModelProviderKind
  /** Anthropic API key (used when provider === 'anthropic'). */
  anthropicApiKey?: string
  /** Optional Anthropic base URL override (proxies/gateways). */
  anthropicBaseUrl?: string
  /** Crew "invariant regions": path globs that require approval to write. */
  protectedGlobs?: string[]
  theme: ThemeMode
  permissionMode: PermissionMode
  workspacePath?: string
  /** Registered sibling service folders for the cross-repo service map. */
  serviceRoots?: string[]
  /** Plugin names the user has disabled. */
  disabledPlugins?: string[]
  /** Plugin names the user has trusted to run code (MCP / hooks). */
  trustedPlugins?: string[]
  mcpServers?: McpServerConfig[]
}

/** A Comprehension Gate decision, logged to `.kairo/decisions.json` (the Brain). */
export interface GateDecision {
  at: number
  outcome: 'passed' | 'changes'
  question?: string
  /** The human's captured "why" at the gate — the rationale behind the verdict.
   * This is what lets the Brain answer "why is X the way it is", not just "who
   * looked at it". Optional (older decisions / quick confirmations omit it). */
  rationale?: string
  files: string[]
  /** Top-level modules the change touched (for hanging on the Living Map). */
  modules: string[]
  focus?: string
}

/** Cache-hit / timing stats returned by an incremental Code Map scan. */
export interface CodeMapScanStats {
  total: number
  reused: number
  read: number
  removed: number
  durationMs: number
  cached: boolean
  /** Scan was stopped early because MAX_FILES was reached. */
  truncated?: boolean
  /** Scan was stopped early because the 15s timeout was reached. */
  timedOut?: boolean
}

export interface AgentConfig {
  model?: string
  /** Selected model backend. */
  provider?: ModelProviderKind
  /** Maximum ReAct iterations for a single turn. */
  maxIterations?: number
  /** Maximum tokens budgeted for the turn (input + output). */
  tokenBudget?: number
  /** Toggle automatic permission grants for read-only tools. */
  autoApproveReadOnly?: boolean
  /** Free-form, provider-specific extra options. */
  extras?: Record<string, unknown>
}
