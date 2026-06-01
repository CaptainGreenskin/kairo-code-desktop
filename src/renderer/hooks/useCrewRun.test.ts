// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCrewRun } from './useCrewRun'
import { useAppStore } from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'
import { newCrewRun } from '../../shared/crew-run'

beforeEach(() => {
  ;(window as unknown as { kairoAPI: unknown }).kairoAPI = {
    runCrew: vi.fn().mockResolvedValue({ ok: true }),
    planCrew: vi.fn().mockResolvedValue({ ok: true, plan: { approach: 'x', roles: [] } })
  }
  useChatStore.getState().resetForSession('s1')
  useAppStore.getState().setCodeMapOpen(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCrewRun', () => {
  it('opens the docked Code Map when a run is approved (watch while commanding)', () => {
    const { result } = renderHook(() => useCrewRun())
    // Seed an inline crew message at the review gate.
    act(() => useChatStore.getState().addCrewMessage(newCrewRun('c1', 'do it', 'sequential')))
    expect(useAppStore.getState().codeMapOpen).toBe(false)
    act(() => result.current.approve('c1'))
    expect(useAppStore.getState().codeMapOpen).toBe(true)
    expect((window.kairoAPI as unknown as { runCrew: ReturnType<typeof vi.fn> }).runCrew).toHaveBeenCalled()
  })

  it('does nothing when approving an unknown crew id', () => {
    const { result } = renderHook(() => useCrewRun())
    act(() => result.current.approve('missing'))
    expect(useAppStore.getState().codeMapOpen).toBe(false)
    expect((window.kairoAPI as unknown as { runCrew: ReturnType<typeof vi.fn> }).runCrew).not.toHaveBeenCalled()
  })
})
