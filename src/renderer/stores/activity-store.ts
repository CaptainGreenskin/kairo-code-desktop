import { create } from 'zustand'
import type { ActivityEvent } from '../../shared/types'

interface ActivityState {
  events: ActivityEvent[]
  panelVisible: boolean

  addEvent: (event: ActivityEvent) => void
  clearEvents: () => void
  togglePanel: () => void
  setPanelVisible: (visible: boolean) => void
}

const MAX_EVENTS = 500

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  panelVisible: false,

  addEvent: (event) =>
    set((s) => ({
      events: [...s.events.slice(-(MAX_EVENTS - 1)), event]
    })),

  clearEvents: () => set({ events: [] }),
  togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),
  setPanelVisible: (visible) => set({ panelVisible: visible })
}))
