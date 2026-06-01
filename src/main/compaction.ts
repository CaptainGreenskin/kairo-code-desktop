import { defaultTokenEstimator } from '@kairo/core'
import { buildProvider } from './provider'
import { loadSession, saveSession } from './sessions'
import { contextUsage, selectRecentWindow, type ContextUsage } from './compaction-budget'
import type { AgentManager } from './agent'
import type { SessionMessage } from '../shared/types'

/** Minimum trailing messages always kept verbatim through a compaction. */
const MIN_KEEP = 4
/** Default model context budget (tokens) when the true window is unknown. */
const DEFAULT_CONTEXT_TOKENS = 128_000
const est = (text: string): number => defaultTokenEstimator.estimate(text)

/** Current context usage for a session (for the UI + auto-compaction trigger). */
export async function getContextUsage(
  sessionId: string,
  maxTokens: number = DEFAULT_CONTEXT_TOKENS
): Promise<ContextUsage> {
  const session = await loadSession(sessionId)
  if (!session) return { tokens: 0, maxTokens, ratio: 0, shouldCompact: false }
  return contextUsage(session.messages, maxTokens, est)
}

const SUMMARY_PROMPT = `Summarize the following conversation context concisely. Preserve:
- Key decisions and outcomes
- File paths and code changes mentioned
- Tool invocations and their results (briefly)
- Any important constraints or requirements discussed

Be concise but thorough. Output only the summary, no preamble.`

export interface CompactionResult {
  removedCount: number
  summaryLength: number
  totalBefore: number
  totalAfter: number
}

export async function compactSession(
  sessionId: string,
  agentManager: AgentManager,
  maxTokens: number = DEFAULT_CONTEXT_TOKENS
): Promise<CompactionResult> {
  const session = await loadSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  if (session.messages.length <= MIN_KEEP) {
    return { removedCount: 0, summaryLength: 0, totalBefore: session.messages.length, totalAfter: session.messages.length }
  }

  // Keep a token-bounded recent window (~30% of the budget) rather than a magic
  // message count, so compaction tracks how full the context actually is.
  const keepFrom = selectRecentWindow(session.messages, Math.floor(maxTokens * 0.3), est, MIN_KEEP)
  if (keepFrom === 0) {
    return { removedCount: 0, summaryLength: 0, totalBefore: session.messages.length, totalAfter: session.messages.length }
  }
  const oldMessages = session.messages.slice(0, keepFrom)
  const recentMessages = session.messages.slice(keepFrom)

  const contextText = oldMessages
    .map((m) => {
      let text = `[${m.role}]: ${m.content}`
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          text += `\n  [tool: ${tc.toolName}]`
          if (tc.result) text += ` → ${tc.result.slice(0, 200)}`
        }
      }
      return text
    })
    .join('\n\n')

  const config = agentManager.getConfig()
  const { provider, modelName } = buildProvider(config)

  let summary = ''
  try {
    const stream = provider.stream({
      messages: [{ role: 'user', content: contextText }],
      systemPrompt: SUMMARY_PROMPT,
      config: { model: modelName, maxTokens: 2048 }
    })
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        summary += event.text
      } else if (event.type === 'error') {
        throw event.error
      }
    }
  } catch (err) {
    throw new Error(`Compaction LLM call failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!summary.trim()) {
    throw new Error('Compaction produced empty summary')
  }

  const compactedMessage: SessionMessage = {
    id: `compacted-${Date.now()}`,
    role: 'assistant',
    content: `## Previous Context (Compacted)\n\n${summary.trim()}`,
    timestamp: Date.now()
  }

  session.messages = [compactedMessage, ...recentMessages]
  session.updatedAt = Date.now()
  await saveSession(session)

  return {
    removedCount: oldMessages.length,
    summaryLength: summary.length,
    totalBefore: oldMessages.length + recentMessages.length,
    totalAfter: session.messages.length
  }
}
