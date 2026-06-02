/**
 * Crew run view model + pure reducer, shared so a crew run can live as an inline
 * turn in the chat thread (persisted with the session) rather than only inside
 * an ephemeral modal. The reducer mirrors the `kairo:crew` event stream.
 */

import { dirOf } from './code-map'
import type { ChangeLens, CrewEvent, CrewPlan, CrewStrategy } from './types'

export type CrewAgentStatus = 'pending' | 'running' | 'done'

/** A single tool invocation by a crew agent — auditable (args + result). */
export interface CrewToolCall {
  id: string
  name: string
  args?: Record<string, unknown>
  result?: string
  ok?: boolean
}

export interface CrewRunAgent {
  id: string
  label: string
  status: CrewAgentStatus
  output: string
  toolCalls: CrewToolCall[]
  tokensUsed?: number
  /** Code-map module this agent last touched (for the live World overlay). */
  currentModule?: string
}

export type CrewPhase = 'planning' | 'reviewing' | 'running' | 'done'

export interface CrewRunRole {
  id: string
  label: string
  dependsOn?: string[]
}

/** A complete crew run as it appears inline in the conversation. */
export interface CrewRunView {
  crewId: string
  task: string
  strategy: CrewStrategy
  phase: CrewPhase
  /** Team-Lead plan, present from the 'reviewing' phase onward. */
  plan?: CrewPlan
  /** The roster actually executing (carries the DAG for the live graph). */
  roles: CrewRunRole[]
  agents: CrewRunAgent[]
  lens?: ChangeLens | null
  reason?: 'completed' | 'aborted' | 'error' | null
  error?: string
  /** Human-readable change story (generated after completion). */
  story?: string
  /** Modules the human expected this run to touch (set at the plan gate). */
  expectedModules?: string[]
}

/** Create a fresh view for a task that's about to be planned. */
export function newCrewRun(crewId: string, task: string, strategy: CrewStrategy): CrewRunView {
  return { crewId, task, strategy, phase: 'planning', roles: [], agents: [] }
}

/**
 * Apply one crew event to a view, returning a new view. Pure + deterministic.
 * `crew-start` seeds the agent list and flips to the running phase; `crew-end`
 * finalizes. Unknown events return the view unchanged.
 */
export function reduceCrewView(view: CrewRunView, event: CrewEvent): CrewRunView {
  switch (event.type) {
    case 'crew-start':
      return {
        ...view,
        crewId: event.crewId,
        task: event.task,
        strategy: event.strategy,
        phase: 'running',
        reason: null,
        error: undefined,
        roles: event.roles.map((r) => ({ id: r.id, label: r.label })),
        agents: event.roles.map((r) => ({
          id: r.id,
          label: r.label,
          status: 'pending' as CrewAgentStatus,
          output: '',
          toolCalls: []
        }))
      }
    case 'agent-start':
      return {
        ...view,
        agents: view.agents.map((a) =>
          a.id === event.roleId ? { ...a, status: 'running' as CrewAgentStatus } : a
        )
      }
    case 'agent-token':
      return {
        ...view,
        agents: view.agents.map((a) =>
          a.id === event.roleId ? { ...a, output: a.output + event.delta } : a
        )
      }
    case 'agent-tool':
      return {
        ...view,
        agents: view.agents.map((a) =>
          a.id === event.roleId
            ? {
                ...a,
                toolCalls: [
                  ...a.toolCalls,
                  {
                    id: event.toolCallId ?? `${event.toolName}-${a.toolCalls.length}`,
                    name: event.toolName,
                    ...(event.args ? { args: event.args } : {})
                  }
                ],
                ...(event.path ? { currentModule: dirOf(event.path) } : {})
              }
            : a
        )
      }
    case 'agent-tool-result':
      return {
        ...view,
        agents: view.agents.map((a) =>
          a.id === event.roleId
            ? {
                ...a,
                toolCalls: a.toolCalls.map((tc) =>
                  tc.id === event.toolCallId
                    ? { ...tc, ok: event.ok, ...(event.result !== undefined ? { result: event.result } : {}) }
                    : tc
                )
              }
            : a
        )
      }
    case 'agent-end':
      return {
        ...view,
        agents: view.agents.map((a) =>
          a.id === event.roleId
            ? { ...a, status: 'done' as CrewAgentStatus, tokensUsed: event.tokensUsed }
            : a
        )
      }
    case 'crew-end':
      return {
        ...view,
        phase: 'done',
        reason: event.reason,
        error: event.error,
        agents: view.agents.map((a) =>
          a.status === 'running' ? { ...a, status: 'done' as CrewAgentStatus } : a
        )
      }
    default:
      return view
  }
}

/** Set the plan and advance to the review gate. */
export function withPlan(view: CrewRunView, plan: CrewPlan): CrewRunView {
  const roles = (plan.roles ?? []).map((r) => ({ id: r.id, label: r.label, dependsOn: r.dependsOn }))
  return { ...view, plan, phase: 'reviewing', ...(roles.length ? { roles } : {}) }
}
