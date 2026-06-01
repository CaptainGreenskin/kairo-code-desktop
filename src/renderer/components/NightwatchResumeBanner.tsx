/**
 * Resume banner for an overnight run that was interrupted by an app crash/close.
 * On launch, useAgentEvents detects a fresh, in-flight nightwatch record and
 * stashes it; this offers one-click resume — switch back to that run's session,
 * re-enable autopilot, and continue where it left off — so an unattended job is
 * never silently lost. Closes the durability loop end-to-end.
 */

import { useChatStore } from '../stores/chat-store'
import { useAppStore } from '../stores/app-store'
import { useToastStore } from '../stores/toast-store'
import { fromSessionMessage } from '../lib/session-message'

export function NightwatchResumeBanner(): JSX.Element | null {
  const record = useChatStore((s) => s.resumableNightwatch)
  if (!record) return null

  const dismiss = (): void => {
    useChatStore.getState().setResumableNightwatch(null)
    void window.kairoAPI.clearNightwatch?.(useAppStore.getState().workspacePath ?? undefined).catch(() => {})
  }

  const resume = async (): Promise<void> => {
    const ws = useAppStore.getState().workspacePath ?? undefined
    try {
      // Switch back to the run's session so the conversation view is correct.
      const file = await window.kairoAPI.loadSession(record.sessionId)
      if (file) {
        useChatStore.getState().setSessionId(file.id)
        useChatStore.getState().setMessages(file.messages.map(fromSessionMessage))
        useAppStore.getState().setActiveSession(file.id)
      }
    } catch {
      /* if the session can't load, still try to continue by id */
    }
    useChatStore.getState().setResumableNightwatch(null)
    useAppStore.getState().setAutopilotEnabled(true) // also re-arms safe-bash auto-approve in main
    useChatStore.getState().startAutopilot(record.turnsRemaining)
    useChatStore.getState().addUserMessage('[Autopilot: continue]')
    void window.kairoAPI.sendPrompt(record.sessionId, '[Autopilot: continue]').catch(() => {})
    useToastStore.getState().addToast({ type: 'info', message: `🌙 继续隔夜任务（剩 ${record.turnsRemaining} 轮）` })
  }

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-accent/10 text-[12px]"
      data-testid="nightwatch-resume-banner"
    >
      <span className="text-text-primary">
        🌙 检测到中断的隔夜任务（剩 <span className="font-semibold text-accent">{record.turnsRemaining}</span> 轮）
      </span>
      <button
        type="button"
        onClick={() => void resume()}
        data-testid="nightwatch-resume"
        className="ml-auto shrink-0 px-2 py-0.5 rounded bg-accent text-white hover:bg-accent-hover text-[11px]"
      >
        恢复续跑
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 px-2 py-0.5 rounded border border-border text-text-muted hover:text-text-primary text-[11px]"
      >
        忽略
      </button>
    </div>
  )
}
