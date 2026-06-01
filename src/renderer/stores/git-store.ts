import { create } from 'zustand'
import { useAppStore } from './app-store'

export interface GitFileEntry {
  path: string
  status: string
}

interface GitState {
  branch: string
  staged: GitFileEntry[]
  modified: GitFileEntry[]
  untracked: GitFileEntry[]
  loading: boolean
  error: string | null

  refresh: () => Promise<void>
  clear: () => void
}

export const useGitStore = create<GitState>((set) => ({
  branch: '',
  staged: [],
  modified: [],
  untracked: [],
  loading: false,
  error: null,

  refresh: async () => {
    const wp = useAppStore.getState().workspacePath
    if (!wp) {
      set({ error: 'No workspace folder set', loading: false })
      return
    }
    set({ loading: true, error: null })
    try {
      const result = await window.kairoAPI.gitStatus(wp)
      if (!result.ok) {
        set({ loading: false, error: result.error ?? 'Failed to get git status' })
        return
      }
      set({
        branch: result.branch ?? '',
        staged: result.staged ?? [],
        modified: result.modified ?? [],
        untracked: result.untracked ?? [],
        loading: false
      })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  },

  clear: () =>
    set({
      branch: '',
      staged: [],
      modified: [],
      untracked: [],
      loading: false,
      error: null
    })
}))
