/**
 * User-editable crew roster (roles + execution strategy), persisted to
 * localStorage. Drives what `runCrew` is invoked with from the UI. Defaults to
 * the built-in Planner→Coder→Reviewer sequential pipeline.
 */

import { create } from 'zustand'
import type { CrewRoleConfig, CrewStrategy } from '../../shared/types'
import { DEFAULT_CREW_ROLES as DEFAULT_ROLES, WRITER_TOOLS } from '../../shared/crew-roles'

export { WRITER_TOOLS }

const STORAGE_KEY = 'kairo:crew-roster'

interface Persisted {
  roles: CrewRoleConfig[]
  strategy: CrewStrategy
}

function load(): Persisted {
  if (typeof localStorage === 'undefined') return { roles: DEFAULT_ROLES, strategy: 'sequential' }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { roles: DEFAULT_ROLES, strategy: 'sequential' }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    const roles = Array.isArray(parsed.roles) && parsed.roles.length > 0 ? parsed.roles : DEFAULT_ROLES
    const strategy: CrewStrategy = parsed.strategy === 'parallel' ? 'parallel' : 'sequential'
    return { roles, strategy }
  } catch {
    return { roles: DEFAULT_ROLES, strategy: 'sequential' }
  }
}

export interface RoleDraft {
  id: string
  label: string
  systemPrompt: string
  canWrite: boolean
  /** Role ids this role runs after. */
  dependsOn: string[]
}

function toDraft(r: CrewRoleConfig): RoleDraft {
  return {
    id: r.id,
    label: r.label,
    systemPrompt: r.systemPrompt,
    canWrite: !!r.allowedTools?.length,
    dependsOn: r.dependsOn ?? []
  }
}

function fromDraft(d: RoleDraft): CrewRoleConfig {
  return {
    id: d.id,
    label: d.label,
    systemPrompt: d.systemPrompt,
    ...(d.canWrite ? { allowedTools: [...WRITER_TOOLS] } : {}),
    ...(d.dependsOn.length > 0 ? { dependsOn: d.dependsOn } : {})
  }
}

interface CrewRosterState {
  roles: CrewRoleConfig[]
  strategy: CrewStrategy
  setStrategy: (s: CrewStrategy) => void
  /** Replace the whole roster from editor drafts. */
  setRoles: (drafts: RoleDraft[]) => void
  resetToDefault: () => void
  /** Drafts for the editor UI. */
  drafts: () => RoleDraft[]
}

export const useCrewRosterStore = create<CrewRosterState>((set, get) => {
  const initial = load()
  const persist = (): void => {
    if (typeof localStorage === 'undefined') return
    try {
      const { roles, strategy } = get()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ roles, strategy }))
    } catch {
      /* ignore quota errors */
    }
  }
  return {
    roles: initial.roles,
    strategy: initial.strategy,
    setStrategy: (strategy) => {
      set({ strategy })
      persist()
    },
    setRoles: (drafts) => {
      const roles = drafts
        .filter((d) => d.label.trim().length > 0)
        .map((d) => fromDraft({ ...d, id: d.id || slug(d.label) }))
      if (roles.length === 0) return
      set({ roles })
      persist()
    },
    resetToDefault: () => {
      set({ roles: DEFAULT_ROLES, strategy: 'sequential' })
      persist()
    },
    drafts: () => get().roles.map(toDraft)
  }
})

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `role-${Date.now()}`
}
