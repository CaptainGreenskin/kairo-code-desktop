/**
 * Pure conversions between the live chat model (`ChatMessage`) and the persisted
 * session model (`SessionMessage`). Kept here (not inline in App) so the
 * round-trip — including the sub-agent trace that must survive reopen/restart —
 * is unit-testable.
 */

import type { ChatMessage, ToolCallDisplay } from '../stores/chat-store'
import type { SessionMessage } from '../../shared/types'

export function toSessionMessage(m: ChatMessage): SessionMessage {
  const tcs = m.toolCalls?.map((tc) => ({
    id: tc.id,
    toolName: tc.toolName,
    args: tc.args,
    ...(tc.result !== undefined ? { result: tc.result } : {}),
    ...(tc.isError !== undefined ? { isError: tc.isError } : {}),
    startedAt: tc.startedAt,
    ...(tc.endedAt !== undefined ? { endedAt: tc.endedAt } : {}),
    ...(tc.subagentSteps && tc.subagentSteps.length > 0 ? { subagentSteps: tc.subagentSteps } : {}),
    ...(tc.subagentDone !== undefined ? { subagentDone: tc.subagentDone } : {})
  }))
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(tcs && tcs.length > 0 ? { toolCalls: tcs } : {}),
    timestamp: m.timestamp,
    ...(m.crew ? { crew: m.crew } : {})
  }
}

export function fromSessionMessage(m: SessionMessage): ChatMessage {
  const tcs: ToolCallDisplay[] | undefined = m.toolCalls?.map((tc) => ({
    id: tc.id,
    toolName: tc.toolName,
    args: tc.args,
    ...(tc.result !== undefined ? { result: tc.result } : {}),
    ...(tc.isError !== undefined ? { isError: tc.isError } : {}),
    startedAt: tc.startedAt,
    ...(tc.endedAt !== undefined ? { endedAt: tc.endedAt } : {}),
    ...(tc.subagentSteps && tc.subagentSteps.length > 0 ? { subagentSteps: tc.subagentSteps } : {}),
    ...(tc.subagentDone !== undefined ? { subagentDone: tc.subagentDone } : {}),
    isExpanded: false
  }))
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(tcs && tcs.length > 0 ? { toolCalls: tcs } : {}),
    timestamp: m.timestamp,
    ...(m.crew ? { crew: m.crew } : {})
  }
}
