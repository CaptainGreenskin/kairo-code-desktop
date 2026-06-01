/**
 * Crew coordinator — a sequential pipeline of role-specialized agents.
 *
 * A crew runs several agents in order (default: Planner → Coder → Reviewer),
 * threading each agent's output into the next as shared context. It mirrors the
 * single-agent streaming pattern in `subagent.ts`, but surfaces per-role
 * activity to the renderer over the `kairo:crew` channel so the UI can show
 * each teammate working live.
 *
 * This is the concrete, desktop-side implementation of the `TeamCoordinator`
 * concept from `@kairo/api` (sequential strategy; parallel/A2A come later).
 */

import { AgentBuilder, DefaultToolRegistry } from '@kairo/core'
import type { DefaultToolExecutor } from '@kairo/core'
import type {
  Agent,
  StreamEvent
} from '@kairo/api'
import type { AgentConfig } from './agent'
import type { ChangeLens, CrewEvent, CrewPlan, CrewRoleConfig, CrewStrategy } from '../shared/types'
import { registerCodingTools } from './tools'
import { buildProvider } from './provider'
import { buildPluginHookRegistry } from './hooks'
import { buildChangeLens, parseUncertaintyFlags, type CrewToolRecord } from './change-lens'
import { getCachedCodeMap } from './code-map-scan'
import { parseCrewPlan } from './crew-plan'
import { computeWaves, effectiveDeps, sinkRoleIds } from '../shared/crew-dag'
import { DEFAULT_CREW_ROLES, ROLE_LIBRARY } from '../shared/crew-roles'

export interface CrewRunResult {
  summary: string
  reason: 'completed' | 'aborted' | 'error'
  error?: string
  lens: ChangeLens
}

/** Builds a tool executor that routes approvals through the permission dialog. */
export type CrewExecutorFactory = (
  registry: DefaultToolRegistry,
  workingDirectory: string,
  sessionId: string,
  turnId: string
) => DefaultToolExecutor

const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_directory', 'grep', 'git_status', 'git_diff', 'git_log', 'memory_read'
])

function buildReadOnlyRegistry(): DefaultToolRegistry {
  const full = new DefaultToolRegistry()
  registerCodingTools(full)
  const readOnly = new DefaultToolRegistry()
  for (const tool of full.list()) {
    if (READ_ONLY_TOOLS.has(tool.name)) {
      readOnly.register(tool, full.getExecutor(tool.name)!)
    }
  }
  return readOnly
}

function buildFilteredRegistry(allowedTools: string[]): DefaultToolRegistry {
  const full = new DefaultToolRegistry()
  registerCodingTools(full)
  const filtered = new DefaultToolRegistry()
  for (const name of allowedTools) {
    const def = full.get(name)
    const exec = full.getExecutor(name)
    if (def && exec) filtered.register(def, exec)
  }
  return filtered
}

// Re-export so existing importers (and tests) keep working.
export { DEFAULT_CREW_ROLES }

type SendFn = (channel: string, payload: unknown) => void

export interface CrewRun {
  abort(): void
}

interface CrewRunState {
  aborted: boolean
  /** All agents currently streaming (>1 under the parallel strategy). */
  agents: Set<Agent>
  /** Tool invocations across all roles, used to build the Change Lens. */
  records: CrewToolRecord[]
}

export class CrewCoordinator {
  private readonly active = new Map<string, CrewRunState>()

  constructor(
    private readonly config: () => AgentConfig,
    private readonly workingDirectory: () => string,
    private readonly send: SendFn,
    private readonly makeExecutor: CrewExecutorFactory
  ) {}

  abort(crewId: string): boolean {
    const run = this.active.get(crewId)
    if (!run) return false
    run.aborted = true
    for (const agent of run.agents) {
      try {
        agent.abort()
      } catch {
        // best-effort
      }
    }
    return true
  }

  private emit(event: CrewEvent): void {
    this.send('kairo:crew', event)
  }

  /**
   * Run the crew. In `sequential` mode each role's output is threaded into the
   * next (Planner→Coder→Reviewer); in `parallel` mode all roles run at once on
   * the same task (fan-out) and their outputs are combined. Streams progress
   * over `kairo:crew`; resolves with the final summary.
   */
  /**
   * Team Lead planning pass: one model call that COMPOSES a crew for the task —
   * it picks the right roles from the library (research tasks get Researcher/
   * Analyst/Synthesizer, not Coder) and assigns each a brief. Best-effort — any
   * failure falls back to the default build pipeline.
   */
  async plan(task: string, extraRoles: CrewRoleConfig[] = []): Promise<CrewPlan> {
    // buildProvider throws a clear "Missing … API key" if unconfigured — let it
    // propagate so the UI can route the user to Settings instead of hanging.
    const { provider, modelName } = buildProvider(this.config())
    // The pool the Team Lead may draw from: built-in archetypes + any custom roles.
    const library = [...ROLE_LIBRARY]
    for (const r of extraRoles) if (!library.some((x) => x.id === r.id)) library.push(r)
    const roleList = library.map((r) => `- ${r.id}: ${r.label} — ${r.systemPrompt.split('.')[0]}`).join('\n')
    const stream = (async (): Promise<CrewPlan> => {
      let text = ''
      for await (const ev of provider.stream({
        messages: [
          {
            role: 'user',
            content: `Task: ${task}\n\nRole library (pick the ones that fit THIS task):\n${roleList}\n\nCompose the crew and plan.`
          }
        ],
        systemPrompt:
          'You are the Team Lead. Choose the roles that fit the task — a research/analysis ' +
          'task should use researcher/analyst/synthesizer, NOT coder. Output ONLY JSON of the form ' +
          '{"approach": string, "steps": [{"roleId": string, "brief": string, "dependsOn": string[]}]} ' +
          'where each step is a chosen role with a concrete brief for THIS task, and dependsOn lists ' +
          'the roleIds that must finish before it (empty for the first step). Use dependsOn to express ' +
          'parallelism: independent steps share no dependency and run concurrently. Use ONLY roleIds ' +
          'from the library. No prose outside the JSON.',
        config: { model: modelName, maxTokens: 900 }
      }) as AsyncIterable<StreamEvent>) {
        if (ev.type === 'text_delta') text += ev.text
        else if (ev.type === 'error') throw ev.error
      }
      return parseCrewPlan(text, task, library)
    })()
    // Hard timeout so a slow/unreachable endpoint can't hang "Planning…" for the
    // model SDK's 10-minute default.
    return withTimeout(stream, 60_000, 'Planning timed out — check your model/API key and network.')
  }

  async run(
    crewId: string,
    sessionId: string,
    task: string,
    roles: CrewRoleConfig[] = DEFAULT_CREW_ROLES,
    strategy: CrewStrategy = 'sequential',
    plan?: CrewPlan
  ): Promise<CrewRunResult> {
    const state: CrewRunState = { aborted: false, agents: new Set(), records: [] }
    this.active.set(crewId, state)

    this.emit({
      type: 'crew-start',
      crewId,
      sessionId,
      task,
      strategy,
      roles: roles.map((r) => ({ id: r.id, label: r.label }))
    })

    try {
      const briefOf = (roleId: string): string =>
        plan?.steps.find((s) => s.roleId === roleId)?.brief ?? ''

      // Resolve the dependency graph. sequential/parallel are special cases;
      // explicit role.dependsOn forms an arbitrary DAG. A cycle falls back to a
      // safe sequential chain.
      let deps = effectiveDeps(roles, strategy)
      if (computeWaves(roles, deps).hasCycle) {
        deps = effectiveDeps(roles, 'sequential')
      }

      // Promise-memoized topological execution: each role runs once its
      // dependencies finish; independent roles run concurrently; a role sees
      // only its dependencies' outputs as context.
      const byId = new Map(roles.map((r) => [r.id, r]))
      const outputs = new Map<string, string>()
      const memo = new Map<string, Promise<string>>()
      const runNode = (role: CrewRoleConfig): Promise<string> => {
        const existing = memo.get(role.id)
        if (existing) return existing
        const p = (async () => {
          if (state.aborted) return '(skipped)'
          const depIds = deps.get(role.id) ?? []
          const depOutputs = await Promise.all(depIds.map((d) => runNode(byId.get(d)!)))
          const priorContext = depIds
            .map((d, i) => `## ${byId.get(d)!.label} output\n${depOutputs[i]}`)
            .join('\n\n')
          const out = await this.runRole(crewId, sessionId, task, role, state, priorContext, briefOf(role.id))
          outputs.set(role.id, out)
          return out
        })()
        memo.set(role.id, p)
        return p
      }
      await Promise.all(roles.map(runNode))

      const sinks = sinkRoleIds(roles, deps)
      const summary =
        sinks.length === 1
          ? outputs.get(sinks[0]!) ?? ''
          : sinks.map((id) => `## ${byId.get(id)!.label}\n${outputs.get(id) ?? ''}`).join('\n\n')

      if (state.aborted) {
        this.emit({ type: 'crew-end', crewId, reason: 'aborted' })
        return { summary: '', reason: 'aborted', lens: buildChangeLens(state.records) }
      }
      const flags = await this.generateUncertaintyFlags(summary, state.records)
      // The current Code Map is the "established pattern" architecture deviation
      // is measured against (cycles, novel cross-module edges).
      const codeMap = getCachedCodeMap(this.workingDirectory())
      const lens = buildChangeLens(state.records, flags, codeMap)
      this.emit({ type: 'crew-end', crewId, reason: 'completed', summary })
      return { summary, reason: 'completed', lens }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'crew-end', crewId, reason: 'error', error: message })
      return { summary: '', reason: 'error', error: message, lens: buildChangeLens(state.records) }
    } finally {
      this.active.delete(crewId)
    }
  }

  /** Run a single role agent, streaming its events. Returns its text output. */
  private async runRole(
    crewId: string,
    sessionId: string,
    task: string,
    role: CrewRoleConfig,
    state: CrewRunState,
    priorContext: string,
    brief = ''
  ): Promise<string> {
    if (state.aborted) return '(skipped)'
    this.emit({ type: 'agent-start', crewId, roleId: role.id })

    const cfg = this.config()
    const cwd = this.workingDirectory()
    const { provider, modelName } = buildProvider(cfg)
    const registry: DefaultToolRegistry =
      role.allowedTools && role.allowedTools.length > 0
        ? buildFilteredRegistry(role.allowedTools)
        : buildReadOnlyRegistry()
    const executor = this.makeExecutor(registry, cwd, sessionId, `${crewId}:${role.id}`)
    // Each role is its own concurrent "turn" → its own hook registry (no shared
    // mutable context). Trusted plugins' lifecycle hooks fire for crew roles too.
    const hookRegistry = await buildPluginHookRegistry(cfg, cwd, this.send, () => ({
      sessionId,
      turnId: `${crewId}:${role.id}`
    }))

    const input =
      `Task: ${task}\n\n` +
      (brief ? `Your assignment (from the Team Lead): ${brief}\n\n` : '') +
      (priorContext ? `Context from earlier crew members:\n${priorContext}\n\n` : '') +
      `Now perform your role as ${role.label}.`

    const agent: Agent = AgentBuilder.create()
      .name(`kairo-crew-${role.id}`)
      .model(provider)
      .modelName(modelName)
      .tools(registry)
      .toolExecutor(executor)
      .systemPrompt(`${role.systemPrompt}\n\nWorking directory: ${cwd}`)
      .streaming(true)
      .hooks(hookRegistry)
      .maxIterations(role.allowedTools && role.allowedTools.length > 0 ? 20 : 10)
      .context({ maxTokens: 64_000, compactionThreshold: 0.85 })
      .build()
    state.agents.add(agent)

    let output = ''
    let tokensUsed: number | undefined
    // Pair tool_use_start with tool_result (by id) to record what ran + ok.
    const inFlight = new Map<string, { name: string; args: Record<string, unknown> }>()
    try {
      for await (const event of agent.stream(input) as AsyncIterable<StreamEvent>) {
        if (state.aborted) break
        switch (event.type) {
          case 'text_delta':
            output += event.text
            this.emit({ type: 'agent-token', crewId, roleId: role.id, delta: event.text })
            break
          case 'tool_use_start': {
            const a = parseArgs(event.toolCall.arguments)
            inFlight.set(event.toolCall.id, { name: event.toolCall.name, args: a })
            const path = typeof a.path === 'string' ? a.path : undefined
            this.emit({
              type: 'agent-tool',
              crewId,
              roleId: role.id,
              toolName: event.toolCall.name,
              toolCallId: event.toolCall.id,
              args: a,
              ...(path ? { path } : {})
            })
            break
          }
          case 'tool_result': {
            const started = inFlight.get(event.result.toolCallId)
            if (started) {
              state.records.push({
                toolName: started.name,
                args: started.args,
                ok: !event.result.isError
              })
              inFlight.delete(event.result.toolCallId)
            }
            // Surface what the tool actually did (truncated) so a crew run is
            // auditable inline, not just a list of tool names.
            const content = typeof event.result.content === 'string' ? event.result.content : ''
            this.emit({
              type: 'agent-tool-result',
              crewId,
              roleId: role.id,
              toolCallId: event.result.toolCallId,
              ok: !event.result.isError,
              ...(content ? { result: content.slice(0, 4000) } : {})
            })
            break
          }
          case 'message_end': {
            const u = (event as unknown as { usage?: { inputTokens: number; outputTokens: number } }).usage
            if (u) tokensUsed = (tokensUsed ?? 0) + u.inputTokens + u.outputTokens
            break
          }
          case 'error':
            output += `\n[${role.label} error: ${event.error.message}]`
            break
        }
      }
    } finally {
      state.agents.delete(agent)
    }

    this.emit({ type: 'agent-end', crewId, roleId: role.id, ...(tokensUsed !== undefined ? { tokensUsed } : {}) })
    return output || '(no output)'
  }

  /**
   * One small model call asking the crew to self-flag ≤3 things it's least sure
   * about. Best-effort: any failure (incl. no changes) yields no flags, so this
   * never breaks a run. Aligns with "surface uncertainty, not confidence".
   */
  private async generateUncertaintyFlags(summary: string, records: CrewToolRecord[]): Promise<string[]> {
    const changed = records.filter((r) => r.toolName === 'write_file' || r.toolName === 'edit')
    if (changed.length === 0) return []
    try {
      const { provider, modelName } = buildProvider(this.config())
      const files = changed
        .map((r) => (typeof r.args.path === 'string' ? r.args.path : ''))
        .filter(Boolean)
        .join(', ')
      const stream = (async (): Promise<string> => {
        let text = ''
        for await (const ev of provider.stream({
          messages: [
            {
              role: 'user',
              content:
                `You just made these changes.\nFiles: ${files}\nSummary: ${summary.slice(0, 1500)}\n\n` +
                `List at most 3 things you are LEAST certain about, or where you diverged from existing patterns.`
            }
          ],
          systemPrompt:
            'Output ONLY a JSON array of at most 3 short strings (each <= 14 words). ' +
            'No prose, no preamble. If fully confident, output [].',
          config: { model: modelName, maxTokens: 256 }
        }) as AsyncIterable<StreamEvent>) {
          if (ev.type === 'text_delta') text += ev.text
          else if (ev.type === 'error') throw ev.error
        }
        return text
      })()
      return parseUncertaintyFlags(await withTimeout(stream, 30_000, 'flags timed out'))
    } catch {
      return []
    }
  }
}

/** Reject a promise if it doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    )
  })
}

/** Parse a tool call's JSON argument string defensively. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
