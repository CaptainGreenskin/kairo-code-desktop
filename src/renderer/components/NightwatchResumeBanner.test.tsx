// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { NightwatchResumeBanner } from './NightwatchResumeBanner'
import { useChatStore } from '../stores/chat-store'
import { useAppStore } from '../stores/app-store'
import type { NightwatchSession } from '../../shared/nightwatch-session'

const record: NightwatchSession = {
  active: true,
  sessionId: 'run-1',
  turnsRemaining: 4,
  startedAt: 0,
  updatedAt: Date.now(),
  workspacePath: '/ws'
}

beforeEach(() => {
  ;(window as unknown as { kairoAPI: unknown }).kairoAPI = {
    loadSession: vi.fn().mockResolvedValue({ id: 'run-1', messages: [] }),
    sendPrompt: vi.fn().mockResolvedValue({ turnId: 't' }),
    clearNightwatch: vi.fn().mockResolvedValue({ ok: true }),
    setAutopilotMode: vi.fn().mockResolvedValue({ ok: true }),
    updateConfig: vi.fn().mockResolvedValue({ ok: true })
  }
  useChatStore.getState().setResumableNightwatch(null)
  useAppStore.getState().setWorkspacePath('/ws')
})
afterEach(() => cleanup())

describe('NightwatchResumeBanner', () => {
  it('renders nothing when there is no resumable run', () => {
    const { container } = render(<NightwatchResumeBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the remaining turns and resumes on click', async () => {
    useChatStore.getState().setResumableNightwatch(record)
    const { getByTestId, findByTestId } = render(<NightwatchResumeBanner />)
    const banner = await findByTestId('nightwatch-resume-banner')
    expect(banner.textContent).toMatch(/4/)
    fireEvent.click(getByTestId('nightwatch-resume'))
    const api = (window as unknown as { kairoAPI: { sendPrompt: ReturnType<typeof vi.fn>; loadSession: ReturnType<typeof vi.fn> } }).kairoAPI
    await waitFor(() => expect(api.loadSession).toHaveBeenCalledWith('run-1'))
    await waitFor(() => expect(api.sendPrompt).toHaveBeenCalledWith('run-1', '[Autopilot: continue]'))
    // Banner cleared + autopilot re-armed + run resumed.
    expect(useChatStore.getState().resumableNightwatch).toBeNull()
    expect(useAppStore.getState().autopilotEnabled).toBe(true)
    expect(useChatStore.getState().autopilotTurnsRemaining).toBe(4)
  })

  it('dismiss clears the record and the persisted run', async () => {
    useChatStore.getState().setResumableNightwatch(record)
    const { getByText } = render(<NightwatchResumeBanner />)
    fireEvent.click(getByText('忽略'))
    expect(useChatStore.getState().resumableNightwatch).toBeNull()
    const api = (window as unknown as { kairoAPI: { clearNightwatch: ReturnType<typeof vi.fn> } }).kairoAPI
    await waitFor(() => expect(api.clearNightwatch).toHaveBeenCalled())
  })
})
