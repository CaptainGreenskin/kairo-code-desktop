import { create } from 'zustand'
import type { editor as monacoEditor } from 'monaco-editor'

export interface OpenFile {
  id: string
  path: string
  name: string
  language: string
  content: string
  originalContent: string
  dirty: boolean
}

export interface CodeSelection {
  path: string
  text: string
  startLine: number
  endLine: number
}

interface EditorState {
  openFiles: OpenFile[]
  activeFileId: string | null
  editorVisible: boolean
  pendingLine: number | null
  editorInstance: monacoEditor.IStandaloneCodeEditor | null

  openFile: (file: { path: string; name: string; content: string; line?: number }) => void
  clearPendingLine: () => void
  closeFile: (id: string) => void
  setActiveFile: (id: string) => void
  updateFileContent: (id: string, content: string) => void
  markFileSaved: (id: string) => void
  refreshFileContent: (path: string, content: string) => void
  toggleEditor: () => void
  setEditorVisible: (visible: boolean) => void
  setEditorInstance: (editor: monacoEditor.IStandaloneCodeEditor | null) => void
  getSelection: () => CodeSelection | null
  nextTab: () => void
  prevTab: () => void
  closeActiveTab: () => void
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  json: 'json', md: 'markdown', py: 'python', sh: 'shell',
  yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css',
  scss: 'scss', less: 'less', go: 'go', rs: 'rust',
  java: 'java', rb: 'ruby', php: 'php', c: 'c', cpp: 'cpp',
  h: 'cpp', hpp: 'cpp', xml: 'xml', sql: 'sql',
  toml: 'toml', ini: 'ini', dockerfile: 'dockerfile',
  makefile: 'makefile', graphql: 'graphql', vue: 'vue', svelte: 'svelte'
}

function langFromPath(filePath: string): string {
  const name = filePath.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  return EXT_TO_LANG[name.slice(dot + 1)] ?? 'plaintext'
}

function fileId(path: string): string {
  return `file-${path}`
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFileId: null,
  editorVisible: false,
  pendingLine: null,
  editorInstance: null,

  clearPendingLine: () => set({ pendingLine: null }),

  openFile: ({ path, name, content, line }) => {
    const id = fileId(path)
    const existing = get().openFiles.find((f) => f.id === id)
    if (existing) {
      set({ activeFileId: id, editorVisible: true, pendingLine: line ?? null })
      return
    }
    const file: OpenFile = {
      id,
      path,
      name,
      language: langFromPath(path),
      content,
      originalContent: content,
      dirty: false
    }
    set((s) => ({
      openFiles: [...s.openFiles, file],
      activeFileId: id,
      editorVisible: true,
      pendingLine: line ?? null
    }))
  },

  closeFile: (id) => {
    set((s) => {
      const idx = s.openFiles.findIndex((f) => f.id === id)
      const next = s.openFiles.filter((f) => f.id !== id)
      let activeFileId = s.activeFileId
      if (activeFileId === id) {
        activeFileId = next.length > 0
          ? next[Math.min(idx, next.length - 1)]!.id
          : null
      }
      return { openFiles: next, activeFileId }
    })
  },

  setActiveFile: (id) => set({ activeFileId: id }),

  updateFileContent: (id, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.id === id ? { ...f, content, dirty: content !== f.originalContent } : f
      )
    }))
  },

  markFileSaved: (id) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.id === id ? { ...f, originalContent: f.content, dirty: false } : f
      )
    }))
  },

  refreshFileContent: (path, content) => {
    const id = fileId(path)
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.id === id && !f.dirty
          ? { ...f, content, originalContent: content }
          : f
      )
    }))
  },

  toggleEditor: () => set((s) => ({ editorVisible: !s.editorVisible })),
  setEditorVisible: (visible) => set({ editorVisible: visible }),

  setEditorInstance: (editor) => set({ editorInstance: editor }),

  getSelection: () => {
    const { editorInstance, openFiles, activeFileId } = get()
    if (!editorInstance) return null
    const sel = editorInstance.getSelection()
    if (!sel || sel.isEmpty()) return null
    const text = editorInstance.getModel()?.getValueInRange(sel)
    if (!text) return null
    const file = openFiles.find((f) => f.id === activeFileId)
    if (!file) return null
    return {
      path: file.path,
      text,
      startLine: sel.startLineNumber,
      endLine: sel.endLineNumber
    }
  },

  nextTab: () => {
    const { openFiles, activeFileId } = get()
    if (openFiles.length < 2) return
    const idx = openFiles.findIndex((f) => f.id === activeFileId)
    const next = openFiles[(idx + 1) % openFiles.length]!
    set({ activeFileId: next.id })
  },

  prevTab: () => {
    const { openFiles, activeFileId } = get()
    if (openFiles.length < 2) return
    const idx = openFiles.findIndex((f) => f.id === activeFileId)
    const prev = openFiles[(idx - 1 + openFiles.length) % openFiles.length]!
    set({ activeFileId: prev.id })
  },

  closeActiveTab: () => {
    const { activeFileId } = get()
    if (activeFileId) get().closeFile(activeFileId)
  }
}))
