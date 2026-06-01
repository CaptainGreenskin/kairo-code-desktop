import { loadSession } from './sessions'
import type { SessionMessage } from '../shared/types'

export async function exportSessionToMarkdown(sessionId: string): Promise<string> {
  const session = await loadSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const lines: string[] = []

  lines.push('---')
  lines.push(`title: "${escapeMdString(session.name)}"`)
  lines.push(`date: ${new Date(session.createdAt).toISOString()}`)
  if (session.model) lines.push(`model: ${session.model}`)
  if (session.workspaceRoot) lines.push(`workspace: ${session.workspaceRoot}`)
  lines.push(`messages: ${session.messages.length}`)
  lines.push('---')
  lines.push('')

  for (const msg of session.messages) {
    lines.push(`### ${msg.role === 'user' ? 'User' : 'Assistant'}`)
    lines.push('')
    lines.push(msg.content)
    lines.push('')

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        lines.push(`<details>`)
        lines.push(`<summary>Tool: ${tc.toolName}</summary>`)
        lines.push('')
        lines.push('**Arguments:**')
        lines.push('```json')
        lines.push(JSON.stringify(tc.args, null, 2))
        lines.push('```')
        if (tc.result !== undefined) {
          lines.push('')
          lines.push(`**Result${tc.isError ? ' (error)' : ''}:**`)
          lines.push('```')
          lines.push(tc.result)
          lines.push('```')
        }
        lines.push('</details>')
        lines.push('')
      }
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

function escapeMdString(s: string): string {
  return s.replace(/"/g, '\\"')
}
