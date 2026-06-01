/**
 * Desktop approval handler.
 *
 * Bridges the @kairo/api ApprovalHandler contract to the Electron renderer.
 * When `DefaultToolExecutor` encounters a permission guard verdict of
 * `'ask'`, it calls `requestApproval(...)` here, which:
 *   1. Returns immediately if the user previously chose "always allow"
 *      for this tool name in the current session.
 *   2. Otherwise emits a `kairo:permissionRequest` event to the renderer
 *      and parks the call until the renderer replies via
 *      `kairo:approveToolCall`, with a 30-second auto-deny fallback so the
 *      main process can never deadlock.
 */

import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type {
  ApprovalDecision,
  ApprovalHandler,
  ApprovalRequest
} from '@kairo/api'
import type { PermissionRequest } from '../shared/types'
import { isAutopilotSafeCommand } from '../shared/autopilot-safe-command'

/** Wall-clock timeout (ms) before an unanswered approval auto-denies. */
export const APPROVAL_TIMEOUT_MS = 30_000

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void
  toolName: string
}

export class DesktopApprovalHandler implements ApprovalHandler {
  private readonly mainWindow: BrowserWindow
  private readonly pending = new Map<string, PendingApproval>()
  /** Tool names the user has approved with `'always'` for this session. */
  private readonly alwaysAllowed = new Set<string>()
  /** Latest known session/turn — included verbatim in outbound requests. */
  private currentSessionId = ''
  private currentTurnId = ''
  /** Whether an unattended (autopilot/overnight) run is active. */
  private autopilotMode = false

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  /** Toggle unattended mode — enables auto-approval of allowlisted safe bash. */
  setAutopilotMode(enabled: boolean): void {
    this.autopilotMode = enabled
  }

  /** Track which session/turn is currently driving the agent. */
  setActiveTurn(sessionId: string, turnId: string): void {
    this.currentSessionId = sessionId
    this.currentTurnId = turnId
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (this.alwaysAllowed.has(request.toolName)) {
      return 'allow'
    }

    // Unattended runs: auto-approve a narrow allowlist of safe bash (build/test/
    // read), so an overnight crew can actually work without a human at the
    // keyboard. The bash executor still hard-blocks catastrophic commands, and
    // anything off the allowlist falls through to the normal ask→timeout-deny.
    if (this.autopilotMode && request.toolName === 'bash') {
      const command = typeof request.args?.command === 'string' ? request.args.command : ''
      if (isAutopilotSafeCommand(command)) return 'allow'
    }

    if (this.mainWindow.isDestroyed()) {
      return 'deny'
    }

    // Generate a unique correlation id; ctx.toolCallId from the executor
    // can be `'unknown'` and is therefore unsafe as a map key.
    const id = randomUUID()

    const decisionPromise = new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(id, { resolve, toolName: request.toolName })

      const payload: PermissionRequest = {
        sessionId: this.currentSessionId,
        turnId: this.currentTurnId,
        toolCallId: id,
        toolName: request.toolName,
        args: request.args,
        ...(request.message ? { reason: request.message } : { reason: request.reason })
      }
      this.mainWindow.webContents.send('kairo:permissionRequest', payload)
    })

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<ApprovalDecision>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('deny'), APPROVAL_TIMEOUT_MS)
    })

    let decision: ApprovalDecision
    try {
      decision = await Promise.race([decisionPromise, timeoutPromise])
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      this.pending.delete(id)
    }

    if (decision === 'always') {
      this.alwaysAllowed.add(request.toolName)
    }

    return decision
  }

  /** Resolve a pending approval from the renderer-side decision. */
  resolveApproval(toolCallId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(toolCallId)
    if (!entry) return false
    entry.resolve(decision)
    this.pending.delete(toolCallId)
    return true
  }

  /**
   * Reset session state. Clears the always-allowed set and rejects any
   * still-pending approvals with `'deny'` so callers can unblock cleanly.
   */
  resetSession(): void {
    this.alwaysAllowed.clear()
    for (const [, entry] of this.pending) {
      entry.resolve('deny')
    }
    this.pending.clear()
  }
}
