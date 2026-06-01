import { create } from 'zustand'

export interface TerminalLine {
  id: string
  type: 'input' | 'stdout' | 'stderr' | 'system'
  text: string
  timestamp: number
}

interface TerminalState {
  visible: boolean
  lines: TerminalLine[]
  running: boolean

  toggleVisible: () => void
  setVisible: (visible: boolean) => void
  addLine: (line: Omit<TerminalLine, 'id' | 'timestamp'>) => void
  clearLines: () => void
  setRunning: (running: boolean) => void
}

const MAX_LINES = 2000

export const useTerminalStore = create<TerminalState>((set) => ({
  visible: false,
  lines: [],
  running: false,

  toggleVisible: () => set((s) => ({ visible: !s.visible })),
  setVisible: (visible) => set({ visible }),

  addLine: (line) =>
    set((s) => ({
      lines: [
        ...s.lines.slice(-(MAX_LINES - 1)),
        {
          ...line,
          id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now()
        }
      ]
    })),

  clearLines: () => set({ lines: [] }),
  setRunning: (running) => set({ running })
}))
