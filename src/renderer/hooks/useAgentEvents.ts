/**
 * Subscribes the renderer to all `kairo:*` IPC events and routes them
 * into the chat store. Mounted once at the App root.
 */

import { useEffect } from 'react'
import { useChatStore } from '../stores/chat-store'
import { useAppStore } from '../stores/app-store'
import { useEditorStore } from '../stores/editor-store'
import { useActivityStore } from '../stores/activity-store'
import { useCrewStore } from '../stores/crew-store'
import type { PendingDiff } from '../stores/chat-store'
import { maybeTriggerPendingDiff } from '../lib/diff-trigger'
import { useToastStore } from '../stores/toast-store'
import { planTurnEnd } from '../../shared/turn-end-policy'

let lastComprehensionBump: number | null = null
import { shouldResume } from '../../shared/nightwatch-session'
import { personalDrift } from '../../shared/personal-drift'
import { loadBriefing } from '../lib/briefing-loader'

export function useAgentEvents(): void {
  useEffect(() => {
    const api = window.kairoAPI
    if (!api) {
      // Preload bridge missing — surface the issue instead of failing
      // silently. (Unit tests / SSR contexts can stub this out.)
      useChatStore.getState().setError(
        'kairoAPI bridge is not available. The preload script may have failed to load.'
      )
      return
    }

    const store = useChatStore

    // Targeted drift: alert ONCE per module when something you understood drifts.
    const alertedDrift = new Set<string>()
    const checkPersonalDrift = (): void => {
      const ws = useAppStore.getState().workspacePath ?? undefined
      const a = window.kairoAPI
      if (typeof a.getChanges !== 'function') return
      void Promise.all([
        a.getChanges(ws),
        typeof a.getGateDecisions === 'function' ? a.getGateDecisions(ws) : Promise.resolve({ ok: true as const, decisions: [] }),
        typeof a.getGitHistory === 'function' ? a.getGitHistory(ws) : Promise.resolve({ ok: true as const, commits: [] })
      ])
        .then(([ch, dec, gh]) => {
          const drift = personalDrift({
            changes: ch.ok ? ch.changes : [],
            decisions: dec.ok ? dec.decisions : [],
            commits: gh.ok ? gh.commits : []
          })
          const fresh = drift.filter((d) => !alertedDrift.has(d.id))
          if (fresh.length === 0) return
          for (const d of fresh) alertedDrift.add(d.id)
          const names = fresh.slice(0, 3).map((d) => d.id.split('/').slice(-1)[0]).join('、')
          useToastStore.getState().addToast({
            type: 'info',
            message: `🔔 你理解过的 ${names}${fresh.length > 3 ? ` 等 ${fresh.length} 处` : ''} 已被改动 — 回去重看`
          })
        })
        .catch(() => {})
    }

    /**
     * Execute the composed turn-end plan: context compaction, then the
     * nightwatch continue/stop decision (with SleepTool pacing + morning
     * briefing). Decision logic is the pure planTurnEnd; this only runs effects.
     */
    const applyTurnEndPlan = (contextRatio: number): void => {
      const chat = store.getState()
      const app = useAppStore.getState()
      const last = chat.messages[chat.messages.length - 1]
      const modelWantsMore = last?.role === 'assistant' && last.content.includes('[CONTINUE]')
      const plan = planTurnEnd({
        autopilotEnabled: app.autopilotEnabled,
        contextRatio,
        turnsRemaining: chat.autopilotTurnsRemaining,
        modelWantsMore,
        startedAt: chat.autopilotStartedAt || Date.now(),
        now: Date.now(),
        tokensUsed: chat.tokenUsage.prompt + chat.tokenUsage.completion,
        lastToolCalls: last?.toolCalls
      })

      const pct = Math.round(contextRatio * 100)
      if (plan.compact === 'auto') {
        useToastStore.getState().addToast({ type: 'info', message: `上下文 ${pct}% — 自动压缩中…` })
        void window.kairoAPI.executeCommand(chat.sessionId, 'compact').then(() => store.getState().setContextRatio(0)).catch(() => {})
      } else if (plan.compact === 'suggest') {
        useToastStore.getState().addToast({ type: 'info', message: `上下文已用 ${pct}% — 可输入 /compact 压缩` })
      }

      const ws = useAppStore.getState().workspacePath ?? undefined
      if (plan.autonomy?.action === 'continue') {
        const remaining = chat.decrementAutopilot()
        // Heartbeat the durable record so a crash mid-run can resume.
        void window.kairoAPI.saveNightwatch?.(
          { active: true, sessionId: chat.sessionId, turnsRemaining: remaining, startedAt: chat.autopilotStartedAt || Date.now(), updatedAt: Date.now(), workspacePath: ws },
          ws
        ).catch(() => {})
        const delay = plan.autonomy.delayMs
        if (delay >= 3000) {
          useToastStore.getState().addToast({ type: 'info', message: `💤 等待 ${Math.round(delay / 1000)}s 后继续` })
        }
        setTimeout(() => {
          const s = store.getState()
          if (!useAppStore.getState().autopilotEnabled) return // stopped mid-sleep
          s.addUserMessage('[Autopilot: continue]')
          void window.kairoAPI.sendPrompt(s.sessionId, '[Autopilot: continue]').catch(() => {})
        }, delay)
      } else if (plan.autonomy?.action === 'stop') {
        chat.stopAutopilot()
        void window.kairoAPI.clearNightwatch?.(ws).catch(() => {}) // run done — no resume
        void loadBriefing(plan.autonomy.reason, ws)
          .then((briefing) => {
            useToastStore.getState().addToast({ type: 'info', message: `🌙 ${briefing.headline}` })
            for (const line of briefing.lines.slice(0, 3)) {
              useToastStore.getState().addToast({ type: 'info', message: line })
            }
            if (briefing.hasContent) useAppStore.getState().setCodeMapOpen(true)
          })
          .catch(() => {})
      }
    }

    // On launch, detect an overnight run interrupted by a crash/close and tell
    // the user it survived (so an unattended job is never silently lost).
    if (typeof api.loadNightwatch === 'function') {
      const ws = useAppStore.getState().workspacePath ?? undefined
      void api
        .loadNightwatch(ws)
        .then((res) => {
          const decision = shouldResume(res?.record ?? null, Date.now(), ws)
          if (decision.resume && res.record) {
            // Drives the resume banner (one-click continue back in its session).
            store.getState().setResumableNightwatch(res.record)
          }
        })
        .catch(() => {})
    }
    checkPersonalDrift() // surface drift accumulated while the app was closed

    const unsubs = [
      api.onToken((token) => store.getState().appendToken(token)),
      api.onToolCall((event) => {
        store.getState().addToolCall(event)
        // Best-effort: surface a diff preview for write-style tools.
        // Failures are swallowed so an unrelated tool call never breaks
        // the chat stream.
        void maybeTriggerPendingDiff(event).catch(() => undefined)
      }),
      api.onToolResult((event) => {
        store.getState().updateToolResult(event)
        if (event.ok) {
          const msgs = store.getState().messages
          for (const msg of msgs) {
            const tc = msg.toolCalls?.find((t) => t.id === event.toolCallId)
            if (tc && (tc.toolName === 'write_file' || tc.toolName === 'edit')) {
              const filePath = typeof tc.args.path === 'string' ? tc.args.path : ''
              if (filePath) {
                void window.kairoAPI.readFile(filePath).then((r) => {
                  if (r.ok && r.content !== undefined) {
                    const es = useEditorStore.getState()
                    es.openFile({ path: filePath, name: filePath.split('/').pop() ?? filePath, content: r.content })
                    es.setEditorVisible(true)
                  }
                }).catch(() => {})
              }
              break
            }
          }
        }
      }),
      api.onTurnEnd((event) => {
        store.getState().finalizeTurn(event)

        if (event.reason === 'completed') {
          checkPersonalDrift() // a change this turn may have drifted your understanding
          // Measure context fullness, then apply the composed turn-end plan
          // (compaction + nightwatch + SleepTool pacing). Decision logic lives in
          // the pure planTurnEnd; this branch only executes the resulting plan.
          if (typeof window.kairoAPI.contextUsage === 'function') {
            void window.kairoAPI
              .contextUsage(store.getState().sessionId)
              .then((res) => {
                const ratio = res?.ok && res.usage ? res.usage.ratio : 0
                if (res?.ok && res.usage) store.getState().setContextRatio(ratio)
                applyTurnEndPlan(ratio)
              })
              .catch(() => applyTurnEndPlan(0))
          } else {
            applyTurnEndPlan(0)
          }
        }
      }),
      api.onError((err) => store.getState().setError(err.message)),
      api.onStateUpdate((update) => store.getState().applyStateUpdate(update)),
      ...(typeof api.onFileChange === 'function'
        ? [
            api.onFileChange((event) => {
              const es = useEditorStore.getState()
              const openFile = es.openFiles.find((f) => f.path === event.path)
              if (openFile && !openFile.dirty) {
                void window.kairoAPI.readFile(event.path).then((r) => {
                  if (r.ok && r.content !== undefined) {
                    es.refreshFileContent(event.path, r.content)
                  }
                }).catch(() => {})
              }
            })
          ]
        : []),
      ...(typeof api.onActivity === 'function'
        ? [
            api.onActivity((event) => {
              useActivityStore.getState().addEvent(event)
              // Sub-agent steps also stream inline under the spawn_subagent tool
              // block, so delegated work is observable in the conversation.
              if (event.parentToolCallId && event.type.startsWith('subagent')) {
                store.getState().applySubagentActivity(event)
              }
              // Implicit comprehension: using the agent = engaging with the code.
              // Debounced bump of lastSeen (every 5 min) so the health score
              // naturally improves through normal interaction, not manual clicks.
              if (event.type === 'tool-end' && (event.toolName === 'read_file' || event.toolName === 'grep' || event.toolName === 'list_directory') && !event.isError) {
                const now = Date.now()
                if (!lastComprehensionBump || now - lastComprehensionBump > 5 * 60 * 1000) {
                  lastComprehensionBump = now
                  const ws = useAppStore.getState().workspacePath ?? undefined
                  void window.kairoAPI?.markSeen?.(now, ws)?.catch(() => {})
                }
              }
            })
          ]
        : []),
      ...(typeof api.onWritePreview === 'function'
        ? [
            api.onWritePreview((event) => {
              const diff: PendingDiff = {
                id: `wp-${event.toolCallId}`,
                toolCallId: event.toolCallId,
                filePath: event.filePath,
                originalContent: event.originalContent,
                newContent: event.newContent,
                language: event.language,
                writePreviewId: event.toolCallId,
                status: 'pending'
              }
              store.getState().addPendingDiff(diff)
            })
          ]
        : []),
      ...(typeof api.onCrewEvent === 'function'
        ? [
            api.onCrewEvent((event) => {
              // crew-store drives the live modal + map overlay; chat-store owns
              // the persisted inline crew turn in the conversation.
              useCrewStore.getState().apply(event)
              store.getState().applyCrewEvent(event)
            })
          ]
        : [])
    ]

    return () => {
      for (const unsubscribe of unsubs) unsubscribe()
    }
  }, [])
}
