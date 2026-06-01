/**
 * Crew run state. Mirrors the `kairo:crew` event stream from the main process:
 * one active run with a list of role-agents, each accumulating live output.
 */

import { create } from 'zustand'
import type { ChangeLens, CrewEvent } from '../../shared/types'
import { dirOf } from '../../shared/code-map'

export type CrewAgentStatus = 'pending' | 'running' | 'done'

export interface CrewAgent {
  id: string
  label: string
  status: CrewAgentStatus
  output: string
  tools: string[]
  tokensUsed?: number
  /** Code-map module this agent last touched (for the live World overlay). */
  currentModule?: string
}

interface CrewState {
  crewId: string | null
  task: string
  running: boolean
  reason: 'completed' | 'aborted' | 'error' | null
  error?: string
  agents: CrewAgent[]
  /** Change Lens for the finished run (from the runCrew result, not events). */
  lens: ChangeLens | null

  apply: (event: CrewEvent) => void
  setLens: (lens: ChangeLens | null) => void
  reset: () => void
}

export const useCrewStore = create<CrewState>((set) => ({
  crewId: null,
  task: '',
  running: false,
  reason: null,
  error: undefined,
  agents: [],
  lens: null,

  setLens: (lens) => set({ lens }),

  apply: (event) =>
    set((s) => {
      switch (event.type) {
        case 'crew-start':
          return {
            crewId: event.crewId,
            task: event.task,
            running: true,
            reason: null,
            error: undefined,
            agents: event.roles.map((r) => ({
              id: r.id,
              label: r.label,
              status: 'pending' as CrewAgentStatus,
              output: '',
              tools: []
            }))
          }
        case 'agent-start':
          return {
            agents: s.agents.map((a) =>
              a.id === event.roleId ? { ...a, status: 'running' as CrewAgentStatus } : a
            )
          }
        case 'agent-token':
          return {
            agents: s.agents.map((a) =>
              a.id === event.roleId ? { ...a, output: a.output + event.delta } : a
            )
          }
        case 'agent-tool':
          return {
            agents: s.agents.map((a) =>
              a.id === event.roleId
                ? {
                    ...a,
                    tools: [...a.tools, event.toolName],
                    ...(event.path ? { currentModule: dirOf(event.path) } : {})
                  }
                : a
            )
          }
        case 'agent-end':
          return {
            agents: s.agents.map((a) =>
              a.id === event.roleId
                ? { ...a, status: 'done' as CrewAgentStatus, tokensUsed: event.tokensUsed }
                : a
            )
          }
        case 'crew-end':
          return {
            running: false,
            reason: event.reason,
            error: event.error,
            agents: s.agents.map((a) =>
              a.status === 'running' ? { ...a, status: 'done' as CrewAgentStatus } : a
            )
          }
        default:
          return {}
      }
    }),

  reset: () =>
    set({ crewId: null, task: '', running: false, reason: null, error: undefined, agents: [], lens: null })
}))
