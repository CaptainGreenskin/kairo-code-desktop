/**
 * Orchestrates an inline crew turn that lives in the chat thread: plan (Team
 * Lead) → human review gate → run → Change Lens, all persisted on a single
 * chat message. Replaces the separate Crew modal's lifecycle so there's one
 * continuous, durable conversation.
 */

import { useAppStore } from '../stores/app-store'
import { buildChangeStoryFallback } from '../../shared/change-story'
import { useChatStore } from '../stores/chat-store'
import { useCrewRosterStore } from '../stores/crew-roster-store'
import { useCrewStore } from '../stores/crew-store'
import { useToastStore } from '../stores/toast-store'
import { newCrewRun } from '../../shared/crew-run'
import { evaluateGate } from '../../shared/comprehension-gate'
import type { ChangeLens, CrewPlan } from '../../shared/types'

function fail(crewId: string, message: string): void {
  useChatStore.getState().updateCrewMessage(crewId, (v) => ({ ...v, phase: 'done', reason: 'error', error: message }))
  useToastStore.getState().addToast({ type: 'error', message })
}

/**
 * Append this crew change to the workspace change log (Map Delta's source of
 * truth), tagging it with the Comprehension Gate verdict so "since you last
 * looked" can separate FYI changes from the ones that need your judgment.
 */
function recordWhy(task: string, filesChanged: string[]): void {
  if (typeof window.kairoAPI?.recordWhy !== 'function' || filesChanged.length === 0) return
  const ws = useAppStore.getState().workspacePath ?? undefined
  const records = filesChanged.map((file) => ({ file, why: task, task, at: Date.now() }))
  void window.kairoAPI.recordWhy(records, ws).catch(() => {})
}

function recordChange(task: string, lens: ChangeLens): void {
  if (typeof window.kairoAPI?.recordChange !== 'function') return
  const ws = useAppStore.getState().workspacePath ?? undefined
  const risk = evaluateGate(lens, useAppStore.getState().protectedGlobs).risk
  void window.kairoAPI
    .recordChange(
      {
        at: Date.now(),
        task: task.slice(0, 200),
        modules: lens.blastRadius.map((b) => b.module),
        filesChanged: lens.filesChanged,
        risk,
        verified: lens.verification.testsRun
      },
      ws
    )
    .then(() => useAppStore.getState().bumpDecisions())
    .catch(() => {})
}

export interface CrewRunControls {
  /** Kick off planning for a task; renders an inline crew message. */
  start: (task: string) => void
  /** Approve the (possibly edited) plan and run the crew. */
  approve: (crewId: string, plan?: CrewPlan) => void
  /** Cancel at the plan gate — removes the inline message. */
  cancel: (crewId: string) => void
  /** Abort an in-flight run. */
  abort: (crewId: string) => void
}

export function useCrewRun(): CrewRunControls {
  const start = (task: string): void => {
    const t = task.trim()
    if (!t) return
    const roles = useCrewRosterStore.getState().roles
    const strategy = useCrewRosterStore.getState().strategy
    // Offer the Team Lead the user roster PLUS trusted plugins' agents.
    const library = [...roles, ...useAppStore.getState().pluginAgents]
    const crewId = `crew-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    useChatStore.getState().addCrewMessage(newCrewRun(crewId, t, strategy))
    void window.kairoAPI
      .planCrew(t, library)
      .then((res) => {
        if (res.ok && res.plan) useChatStore.getState().setCrewPlan(crewId, res.plan)
        else fail(crewId, res.error ?? 'Planning failed')
      })
      .catch((e: unknown) => fail(crewId, e instanceof Error ? e.message : String(e)))
  }

  const approve = (crewId: string, plan?: CrewPlan): void => {
    const view = useChatStore.getState().messages.find((m) => m.crew?.crewId === crewId)?.crew
    if (!view) return
    const sessionId = useChatStore.getState().sessionId
    const roster = useCrewRosterStore.getState().roles
    const crewRoles = plan?.roles?.length ? plan.roles : roster
    // crew-store drives the live System Map overlay; reset it for this run.
    useCrewStore.getState().reset()
    // Watch the system while commanding: surface the docked Code Map so live
    // agents light up the modules they touch during the run.
    useAppStore.getState().setCodeMapOpen(true)
    useChatStore.getState().updateCrewMessage(crewId, (v) => ({ ...v, phase: 'running', plan }))
    void window.kairoAPI
      .runCrew(crewId, sessionId, view.task, crewRoles, view.strategy, plan)
      .then((res) => {
        if (res.lens) {
          useChatStore.getState().setCrewLens(crewId, res.lens)
          recordChange(view.task, res.lens)
          recordWhy(view.task, res.lens.filesChanged)
          // Generate a human-readable change story (template fallback if no model)
          const story = buildChangeStoryFallback({ task: view.task, lens: res.lens })
          useChatStore.getState().setCrewStory(crewId, story)
        }
        if (!res.ok) fail(crewId, res.error ?? 'Crew failed')
      })
      .catch((e: unknown) => fail(crewId, e instanceof Error ? e.message : String(e)))
  }

  const cancel = (crewId: string): void => {
    useChatStore.getState().dropCrewMessage(crewId)
  }

  const abort = (crewId: string): void => {
    void window.kairoAPI.abortCrew?.(crewId)
  }

  return { start, approve, cancel, abort }
}
