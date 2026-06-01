/**
 * Chat state store backed by Zustand.
 *
 * The store mirrors the IPC contract in `src/shared/types.ts`. Token deltas
 * are appended to the trailing assistant message, tool calls are nested
 * inline at their invocation point, and turn-end events flip the streaming
 * flags off and roll up token usage / cost.
 */

import { create } from 'zustand'
import type {
  ActivityEvent,
  ChangeLens,
  CrewEvent,
  CrewPlan,
  StateUpdate,
  StreamToken,
  ToolCallEvent,
  ToolResultEvent,
  TurnEndEvent
} from '../../shared/types'
import { reduceCrewView, withPlan, type CrewRunView } from '../../shared/crew-run'
import type { NightwatchSession } from '../../shared/nightwatch-session'

/** One inner tool invocation by a spawned sub-agent (observability trace). */
export interface SubagentStep {
  id: string
  name: string
  args?: string
  result?: string
  ok?: boolean
  startedAt: number
  endedAt?: number
}

export interface ToolCallDisplay {
  id: string
  toolName: string
  args: Record<string, unknown>
  result?: string
  isError?: boolean
  isExpanded?: boolean
  startedAt: number
  endedAt?: number
  /**
   * Identifier of the pending diff produced from this tool call's arguments
   * (write/edit tools). Cleared when the diff is accepted or rejected.
   */
  pendingDiffId?: string
  /**
   * Live trace of a `spawn_subagent` call: the sub-agent's own tool sequence,
   * streamed via subagent-* activity events. Renders as an expandable nested
   * trace so delegated work is observable, not a black box.
   */
  subagentSteps?: SubagentStep[]
  /** Sub-agent finished (subagent-end seen) — for the inline status chip. */
  subagentDone?: boolean
}

export interface PendingDiff {
  id: string
  /** Originating tool call so we can clear the link when the user decides. */
  toolCallId: string
  filePath: string
  originalContent: string
  newContent: string
  language: string
  /** Write preview approval ID (from main process WritePreview flow). */
  writePreviewId?: string
  status: 'pending' | 'accepted' | 'rejected'
}

export interface DroppedFile {
  id: string
  name: string
  path: string
  content: string
  size: number
}

export interface PastedImage {
  id: string
  dataUrl: string
  name: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallDisplay[]
  isStreaming?: boolean
  timestamp: number
  /** Present when this message is an inline crew run (Plan Gate → run → Lens). */
  crew?: CrewRunView
}

export interface TokenUsage {
  prompt: number
  completion: number
}

interface ChatState {
  /** Stable client-side session identifier (used as the kairo:* sessionId). */
  sessionId: string
  messages: ChatMessage[]
  isGenerating: boolean
  error: string | null
  tokenUsage: TokenUsage
  estimatedCost: number
  /** High-level lifecycle state mirrored from `kairo:stateUpdate`. */
  agentState: StateUpdate['state']
  agentStatusText?: string
  /** Token budget for the current turn (from StateUpdate). */
  tokenBudget?: { used: number; max: number; compacted?: boolean }
  /** Session context-window fullness 0..1 (measured at turn end). */
  contextRatio: number
  /** When the current autonomous (autopilot/nightwatch) run started; 0 if none. */
  autopilotStartedAt: number
  /** A persisted overnight run interrupted by a crash/close, awaiting resume. */
  resumableNightwatch: NightwatchSession | null
  /** Last-known model name (display-only). */
  modelName?: string
  /** Diff previews awaiting accept/reject from the user. */
  pendingDiffs: PendingDiff[]
  /** Files dragged into the chat, surfaced as chips in the input bar. */
  droppedFiles: DroppedFile[]
  /** Code selection sent from the editor via Cmd+L. */
  codeContext: string
  /** Images pasted into the input bar. */
  pastedImages: PastedImage[]
  /** True when messages were loaded from a saved session (not yet sent to LLM). */
  sessionLoaded: boolean
  /** Autopilot turns remaining in the current chain (-1 = not active). */
  autopilotTurnsRemaining: number

  // ── Actions ────────────────────────────────────────────────────────────
  addUserMessage: (content: string) => void
  appendToken: (event: StreamToken) => void
  addToolCall: (event: ToolCallEvent) => void
  updateToolResult: (event: ToolResultEvent) => void
  /** Apply a subagent-* activity event to the parent spawn_subagent tool call. */
  applySubagentActivity: (event: ActivityEvent) => void
  finalizeTurn: (event: TurnEndEvent) => void
  /** Append an inline crew-run message and return its message id. */
  addCrewMessage: (view: CrewRunView) => string
  /** Patch the crew view on the message owning `crewId`. */
  updateCrewMessage: (crewId: string, updater: (view: CrewRunView) => CrewRunView) => void
  /** Apply a streamed crew event to the matching inline crew message. */
  applyCrewEvent: (event: CrewEvent) => void
  /** Attach the Team-Lead plan and move the crew message to the review gate. */
  setCrewPlan: (crewId: string, plan: CrewPlan) => void
  /** Attach the Change Lens to a finished crew message. */
  setCrewLens: (crewId: string, lens: ChangeLens) => void
  /** Set the modules the human expects this run to touch (plan gate). */
  setCrewExpected: (crewId: string, modules: string[]) => void
  /** Remove a crew message (e.g. the user cancels at the plan gate). */
  dropCrewMessage: (crewId: string) => void
  setError: (error: string | null) => void
  applyStateUpdate: (update: StateUpdate) => void
  clearMessages: () => void
  toggleToolCallExpand: (toolCallId: string) => void
  setModelName: (model: string | undefined) => void
  /** Set the measured session context fullness (0..1). */
  setContextRatio: (ratio: number) => void
  /** Set/clear the resumable overnight run record. */
  setResumableNightwatch: (record: NightwatchSession | null) => void
  addPendingDiff: (diff: PendingDiff) => void
  removePendingDiff: (id: string) => void
  updatePendingDiffStatus: (id: string, status: 'accepted' | 'rejected') => void
  addDroppedFile: (file: DroppedFile) => void
  removeDroppedFile: (id: string) => void
  clearDroppedFiles: () => void
  appendCodeContext: (block: string) => void
  clearCodeContext: () => void
  addPastedImage: (img: PastedImage) => void
  removePastedImage: (id: string) => void
  clearPastedImages: () => void
  /** Switch the chat to a new session id (does not clear messages). */
  setSessionId: (id: string) => void
  /** Replace the entire message list (used when loading a saved session). */
  setMessages: (messages: ChatMessage[]) => void
  /** Reset to a fresh conversation under the given session id. */
  resetForSession: (id: string) => void
  /** Start autopilot countdown. */
  startAutopilot: (maxTurns: number) => void
  /** Decrement autopilot counter; returns new remaining count. */
  decrementAutopilot: () => number
  /** Stop autopilot. */
  stopAutopilot: () => void
}

const newId = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// Conservative cost rates (USD per 1K tokens). Mirrors the main-process
// defaults so the renderer can show an estimate before turn end completes.
const PROMPT_COST_PER_1K = 0.00015
const COMPLETION_COST_PER_1K = 0.0006

const computeCost = (usage: TokenUsage): number =>
  (usage.prompt / 1000) * PROMPT_COST_PER_1K +
  (usage.completion / 1000) * COMPLETION_COST_PER_1K

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: newId(),
  messages: [],
  isGenerating: false,
  error: null,
  tokenUsage: { prompt: 0, completion: 0 },
  estimatedCost: 0,
  agentState: 'idle',
  agentStatusText: undefined,
  tokenBudget: undefined,
  contextRatio: 0,
  autopilotStartedAt: 0,
  resumableNightwatch: null,
  modelName: undefined,
  pendingDiffs: [],
  droppedFiles: [],
  codeContext: '',
  pastedImages: [],
  sessionLoaded: false,
  autopilotTurnsRemaining: -1,

  addUserMessage: (content) => {
    const now = Date.now()
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: newId(),
          role: 'user',
          content,
          timestamp: now
        },
        {
          id: newId(),
          role: 'assistant',
          content: '',
          toolCalls: [],
          isStreaming: true,
          timestamp: now
        }
      ],
      isGenerating: true,
      error: null
    }))
  },

  appendToken: (event) => {
    set((s) => {
      const msgs = s.messages
      if (msgs.length === 0) return {}
      const last = msgs[msgs.length - 1]
      if (!last || last.role !== 'assistant') return {}
      const updated: ChatMessage = {
        ...last,
        content: last.content + event.delta
      }
      return { messages: [...msgs.slice(0, -1), updated] }
    })
  },

  addToolCall: (event) => {
    set((s) => {
      const msgs = s.messages
      // Find the trailing assistant message; if none, create one. This
      // shouldn't normally happen because `addUserMessage` seeds an
      // assistant placeholder, but we stay defensive.
      let target = msgs.length > 0 ? msgs[msgs.length - 1] : undefined
      const display: ToolCallDisplay = {
        id: event.toolCallId,
        toolName: event.name,
        args: event.args,
        startedAt: event.startedAt,
        isExpanded: false
      }
      if (!target || target.role !== 'assistant') {
        target = {
          id: newId(),
          role: 'assistant',
          content: '',
          toolCalls: [display],
          isStreaming: true,
          timestamp: Date.now()
        }
        return { messages: [...msgs, target] }
      }
      const updated: ChatMessage = {
        ...target,
        toolCalls: [...(target.toolCalls ?? []), display]
      }
      return { messages: [...msgs.slice(0, -1), updated] }
    })
  },

  updateToolResult: (event) => {
    set((s) => {
      const messages = s.messages.map((m) => {
        if (!m.toolCalls?.length) return m
        let touched = false
        const nextCalls = m.toolCalls.map((tc) => {
          if (tc.id !== event.toolCallId) return tc
          touched = true
          const text =
            event.ok
              ? stringifyResult(event.result)
              : event.error ?? 'Tool call failed'
          return {
            ...tc,
            result: text,
            isError: !event.ok,
            endedAt: event.endedAt
          }
        })
        return touched ? { ...m, toolCalls: nextCalls } : m
      })
      return { messages }
    })
  },

  applySubagentActivity: (event) => {
    const parent = event.parentToolCallId
    if (!parent) return
    set((s) => {
      let touched = false
      const messages = s.messages.map((m) => {
        if (!m.toolCalls?.length) return m
        const nextCalls = m.toolCalls.map((tc) => {
          if (tc.id !== parent) return tc
          touched = true
          const steps = [...(tc.subagentSteps ?? [])]
          switch (event.type) {
            case 'subagent-tool':
              if (event.toolCallId) {
                steps.push({
                  id: event.toolCallId,
                  name: event.toolName ?? 'tool',
                  ...(event.args ? { args: event.args } : {}),
                  startedAt: event.timestamp
                })
              }
              return { ...tc, subagentSteps: steps }
            case 'subagent-tool-result': {
              const idx = steps.findIndex((st) => st.id === event.toolCallId)
              if (idx >= 0) {
                steps[idx] = {
                  ...steps[idx]!,
                  ok: event.ok,
                  ...(event.message ? { result: event.message } : {}),
                  endedAt: event.timestamp
                }
              }
              return { ...tc, subagentSteps: steps }
            }
            case 'subagent-end':
              return { ...tc, subagentSteps: steps, subagentDone: true }
            default:
              return { ...tc, subagentSteps: steps }
          }
        })
        return { ...m, toolCalls: nextCalls }
      })
      return touched ? { messages } : {}
    })
  },

  finalizeTurn: (event) => {
    set((s) => {
      const msgs = s.messages
      let nextMessages = msgs
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant') {
          nextMessages = [...msgs.slice(0, -1), { ...last, isStreaming: false }]
        }
      }
      // The main process reports `tokensUsed` as a combined total; without
      // a per-direction breakdown we attribute the increment to completion
      // tokens (the renderer cares about the headline number, not the
      // split). Replace this once the contract carries `inputTokens` /
      // `outputTokens` separately.
      let tokenUsage = s.tokenUsage
      let estimatedCost = s.estimatedCost
      if (event.tokensUsed !== undefined) {
        tokenUsage = {
          prompt: s.tokenUsage.prompt,
          completion: s.tokenUsage.completion + event.tokensUsed
        }
        estimatedCost = computeCost(tokenUsage)
      }
      const errorState =
        event.reason === 'error'
          ? s.error ?? 'Turn ended with an error'
          : event.reason === 'aborted'
            ? null
            : s.error
      return {
        messages: nextMessages,
        isGenerating: false,
        tokenUsage,
        estimatedCost,
        error: errorState
      }
    })
  },

  addCrewMessage: (view) => {
    const id = newId()
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: 'assistant', content: '', timestamp: Date.now(), crew: view }
      ]
    }))
    return id
  },

  updateCrewMessage: (crewId, updater) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.crew && m.crew.crewId === crewId ? { ...m, crew: updater(m.crew) } : m
      )
    }))
  },

  applyCrewEvent: (event) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.crew && m.crew.crewId === event.crewId ? { ...m, crew: reduceCrewView(m.crew, event) } : m
      )
    }))
  },

  setCrewPlan: (crewId, plan) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.crew && m.crew.crewId === crewId ? { ...m, crew: withPlan(m.crew, plan) } : m
      )
    }))
  },

  setCrewLens: (crewId, lens) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.crew && m.crew.crewId === crewId ? { ...m, crew: { ...m.crew, lens } } : m
      )
    }))
  },

  setCrewExpected: (crewId, modules) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.crew && m.crew.crewId === crewId ? { ...m, crew: { ...m.crew, expectedModules: modules } } : m
      )
    }))
  },

  dropCrewMessage: (crewId) => {
    set((s) => ({ messages: s.messages.filter((m) => m.crew?.crewId !== crewId) }))
  },

  setError: (error) => set({ error }),

  applyStateUpdate: (update) => {
    set({
      agentState: update.state,
      agentStatusText: update.statusText,
      ...(update.tokenBudget ? { tokenBudget: update.tokenBudget } : {}),
      isGenerating:
        update.state === 'thinking' ||
        update.state === 'tool-running' ||
        update.state === 'awaiting-permission'
    })
  },

  clearMessages: () =>
    set({
      messages: [],
      error: null,
      isGenerating: false
    }),

  toggleToolCallExpand: (toolCallId) => {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (!m.toolCalls?.length) return m
        const calls = m.toolCalls.map((tc) =>
          tc.id === toolCallId ? { ...tc, isExpanded: !tc.isExpanded } : tc
        )
        return { ...m, toolCalls: calls }
      })
    }))
  },

  setModelName: (model) => set({ modelName: model }),
  setContextRatio: (ratio) => set({ contextRatio: ratio }),
  setResumableNightwatch: (record) => set({ resumableNightwatch: record }),

  addPendingDiff: (diff) =>
    set((s) => {
      // Tag the originating tool call so the UI can render the diff inline.
      const messages = s.messages.map((m) => {
        if (!m.toolCalls?.length) return m
        const calls = m.toolCalls.map((tc) =>
          tc.id === diff.toolCallId ? { ...tc, pendingDiffId: diff.id } : tc
        )
        return { ...m, toolCalls: calls }
      })
      const existing = s.pendingDiffs.filter((d) => d.id !== diff.id)
      return { messages, pendingDiffs: [...existing, diff] }
    }),

  removePendingDiff: (id) =>
    set((s) => {
      const target = s.pendingDiffs.find((d) => d.id === id)
      const messages = target
        ? s.messages.map((m) => {
            if (!m.toolCalls?.length) return m
            const calls = m.toolCalls.map((tc) =>
              tc.pendingDiffId === id ? { ...tc, pendingDiffId: undefined } : tc
            )
            return { ...m, toolCalls: calls }
          })
        : s.messages
      return {
        messages,
        pendingDiffs: s.pendingDiffs.filter((d) => d.id !== id)
      }
    }),

  updatePendingDiffStatus: (id, status) =>
    set((s) => ({
      pendingDiffs: s.pendingDiffs.map((d) =>
        d.id === id ? { ...d, status } : d
      )
    })),

  addDroppedFile: (file) =>
    set((s) => {
      // De-duplicate by absolute path so dropping the same file twice
      // refreshes its content rather than producing a second chip.
      const filtered = s.droppedFiles.filter((f) => f.path !== file.path)
      return { droppedFiles: [...filtered, file] }
    }),

  removeDroppedFile: (id) =>
    set((s) => ({
      droppedFiles: s.droppedFiles.filter((f) => f.id !== id)
    })),

  clearDroppedFiles: () => set({ droppedFiles: [] }),

  appendCodeContext: (block) =>
    set((s) => ({ codeContext: s.codeContext ? s.codeContext + '\n\n' + block : block })),

  clearCodeContext: () => set({ codeContext: '' }),

  addPastedImage: (img) =>
    set((s) => ({ pastedImages: [...s.pastedImages, img] })),

  removePastedImage: (id) =>
    set((s) => ({ pastedImages: s.pastedImages.filter((i) => i.id !== id) })),

  clearPastedImages: () => set({ pastedImages: [] }),

  setSessionId: (id) => set({ sessionId: id }),

  setMessages: (messages) =>
    set({
      messages,
      isGenerating: false,
      error: null,
      agentState: 'idle',
      agentStatusText: undefined,
      sessionLoaded: true
    }),

  resetForSession: (id) =>
    set({
      sessionId: id,
      messages: [],
      isGenerating: false,
      error: null,
      tokenUsage: { prompt: 0, completion: 0 },
      estimatedCost: 0,
      agentState: 'idle',
      agentStatusText: undefined,
      codeContext: '',
      autopilotTurnsRemaining: -1
    }),

  startAutopilot: (maxTurns) => set({ autopilotTurnsRemaining: maxTurns, autopilotStartedAt: Date.now() }),

  decrementAutopilot: () => {
    const next = get().autopilotTurnsRemaining - 1
    set({ autopilotTurnsRemaining: next })
    return next
  },

  stopAutopilot: () => set({ autopilotTurnsRemaining: -1 })
}))

// ── helpers ────────────────────────────────────────────────────────────────

function stringifyResult(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// Used by tests / future code that needs read-only access without
// subscribing.
export const getChatStore = (): ChatState => useChatStore.getState()
