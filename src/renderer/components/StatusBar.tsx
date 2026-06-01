/**
 * Footer status bar: model name, token usage, cost, streaming indicator.
 */

import { useChatStore } from '../stores/chat-store'
import { useAppStore } from '../stores/app-store'
import { ModelSwitcher } from './ModelSwitcher'

export function StatusBar(): JSX.Element {
  const isGenerating = useChatStore((s) => s.isGenerating)
  const tokenUsage = useChatStore((s) => s.tokenUsage)
  const estimatedCost = useChatStore((s) => s.estimatedCost)
  const agentState = useChatStore((s) => s.agentState)
  const agentStatusText = useChatStore((s) => s.agentStatusText)
  const tokenBudget = useChatStore((s) => s.tokenBudget)
  const contextRatio = useChatStore((s) => s.contextRatio)
  const codeMapOpen = useAppStore((s) => s.codeMapOpen)
  const autopilotEnabled = useAppStore((s) => s.autopilotEnabled)
  const autopilotMaxTurns = useAppStore((s) => s.autopilotMaxTurns)
  const autopilotRemaining = useChatStore((s) => s.autopilotTurnsRemaining)

  const stateLabel = labelForState(agentState)
  const budgetPercent = tokenBudget
    ? Math.min((tokenBudget.used / tokenBudget.max) * 100, 100)
    : 0
  const budgetColor = budgetPercent > 90 ? 'bg-danger' : budgetPercent > 70 ? 'bg-warning' : 'bg-accent'

  return (
    <div className="flex items-center gap-4 border-t border-border bg-surface-0 px-4 py-1.5 text-[11px] text-text-muted select-none">
      <div className="flex items-center gap-1.5">
        <span
          className={
            'w-2 h-2 rounded-full ' +
            (isGenerating
              ? 'bg-success animate-pulse'
              : agentState === 'error'
                ? 'bg-danger'
                : 'bg-success')
          }
        />
        <span>{stateLabel}</span>
      </div>

      <span className="text-text-muted/50">·</span>

      <ModelSwitcher />

      <span className="text-text-muted/50">·</span>

      <span className="font-mono">
        ↑{tokenUsage.prompt} ↓{tokenUsage.completion}
      </span>

      {contextRatio > 0 && (
        <>
          <span className="text-text-muted/50">·</span>
          <span
            className="font-mono"
            data-testid="context-ratio"
            title="会话上下文窗口占用（达 80% 提示压缩，autopilot 下自动压缩）"
            style={{ color: contextRatio >= 0.9 ? 'var(--color-danger)' : contextRatio >= 0.8 ? 'var(--color-warning)' : undefined }}
          >
            ctx {Math.round(contextRatio * 100)}%
          </span>
        </>
      )}

      {tokenBudget && (
        <>
          <span className="text-text-muted/50">·</span>
          <div className="flex items-center gap-1.5" title={`${formatTokens(tokenBudget.used)} / ${formatTokens(tokenBudget.max)} tokens`}>
            <div className="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${budgetColor}`}
                style={{ width: `${budgetPercent}%` }}
              />
            </div>
            <span className="font-mono">{Math.round(budgetPercent)}%</span>
            {tokenBudget.compacted && (
              <span className="text-accent text-[9px]">compacted</span>
            )}
          </div>
        </>
      )}

      <span className="text-text-muted/50">·</span>

      <span className="font-mono">${estimatedCost.toFixed(4)}</span>

      {autopilotEnabled && (
        <>
          <span className="text-text-muted/50">·</span>
          <span className="text-warning font-medium">
            Autopilot{autopilotRemaining >= 0 ? `: ${autopilotMaxTurns - autopilotRemaining}/${autopilotMaxTurns}` : ''}
          </span>
        </>
      )}

      {agentStatusText && (
        <>
          <span className="text-text-muted/50">·</span>
          <span className="truncate">{agentStatusText}</span>
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={() => useAppStore.getState().toggleCodeMap()}
          className={'transition-colors ' + (codeMapOpen ? 'text-accent' : 'text-text-muted hover:text-text-primary')}
          title="Code Map：系统依赖地图（⌘⇧M）"
        >
          ◫ Code Map
        </button>
        <button
          type="button"
          onClick={() => useAppStore.getState().setFeedbackOpen(true)}
          className="text-text-muted hover:text-text-primary transition-colors"
          title="发送反馈"
        >
          反馈
        </button>
      </div>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function labelForState(state: string): string {
  switch (state) {
    case 'thinking':
      return 'Thinking'
    case 'tool-running':
      return 'Tool running'
    case 'awaiting-permission':
      return 'Awaiting permission'
    case 'error':
      return 'Error'
    case 'idle':
    default:
      return 'Ready'
  }
}
