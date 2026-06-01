import { create } from 'zustand'
import type { PermissionRequest, PermissionVerdict } from '../../shared/types'

interface PermissionStore {
  /** FIFO queue of pending requests; the head is presented to the user. */
  queue: PermissionRequest[]
  enqueue(request: PermissionRequest): void
  /**
   * Resolve the head of the queue with the given verdict and forward the
   * decision over the IPC bridge.
   */
  resolve(verdict: PermissionVerdict): Promise<void>
  clear(): void
}

export const usePermissionStore = create<PermissionStore>((set, get) => ({
  queue: [],

  enqueue: (request) => {
    set((state) => {
      // Defensive de-dup against IPC retries.
      if (state.queue.some((r) => r.toolCallId === request.toolCallId)) {
        return state
      }
      return { queue: [...state.queue, request] }
    })
  },

  resolve: async (verdict) => {
    const head = get().queue[0]
    if (!head) return
    // Optimistically pop so the next request (if any) becomes visible.
    set((state) => ({ queue: state.queue.slice(1) }))
    try {
      await window.kairoAPI.approveToolCall({
        sessionId: head.sessionId,
        toolCallId: head.toolCallId,
        verdict
      })
    } catch (err) {
      // Re-queue at the head so the user can retry; the main process timeout
      // will eventually unblock the agent regardless.
      set((state) => ({ queue: [head, ...state.queue] }))
      throw err
    }
  },

  clear: () => set({ queue: [] })
}))
