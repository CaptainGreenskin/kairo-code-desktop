import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import { monaco } from '../../lib/monaco-env'
import { useEditorStore } from '../../stores/editor-store'
import { useChatStore } from '../../stores/chat-store'
import { EditorTabs } from './EditorTabs'
import { EditorStatusBar } from './EditorStatusBar'

loader.config({ monaco })

export function EditorPanel(): JSX.Element {
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFileId = useEditorStore((s) => s.activeFileId)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)
  const markFileSaved = useEditorStore((s) => s.markFileSaved)
  const pendingLine = useEditorStore((s) => s.pendingLine)
  const clearPendingLine = useEditorStore((s) => s.clearPendingLine)

  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)

  const [cursorLine, setCursorLine] = useState(1)
  const [cursorColumn, setCursorColumn] = useState(1)

  const activeFile = openFiles.find((f) => f.id === activeFileId)

  useEffect(() => {
    if (pendingLine && editorRef.current) {
      const editor = editorRef.current
      editor.revealLineInCenter(pendingLine)
      editor.setPosition({ lineNumber: pendingLine, column: 1 })
      editor.focus()
      clearPendingLine()
    }
  }, [pendingLine, activeFileId, clearPendingLine])

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor
      useEditorStore.getState().setEditorInstance(editor)

      const store = useEditorStore.getState()
      if (store.pendingLine) {
        editor.revealLineInCenter(store.pendingLine)
        editor.setPosition({ lineNumber: store.pendingLine, column: 1 })
        store.clearPendingLine()
      }

      editor.onDidChangeCursorPosition((e) => {
        setCursorLine(e.position.lineNumber)
        setCursorColumn(e.position.column)
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const store = useEditorStore.getState()
        const file = store.openFiles.find((f) => f.id === store.activeFileId)
        if (!file || !file.dirty) return
        void window.kairoAPI
          .applyDiff(file.path, file.content)
          .then((result) => {
            if (result.ok) markFileSaved(file.id)
          })
      })

      editor.addAction({
        id: 'kairo.sendToChat',
        label: 'Send Selection to Chat',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
        contextMenuGroupId: 'navigation',
        run: () => {
          const sel = useEditorStore.getState().getSelection()
          if (!sel) return
          const block = `[${sel.path}:${sel.startLine}-${sel.endLine}]\n\`\`\`\n${sel.text}\n\`\`\``
          useChatStore.getState().appendCodeContext(block)
        }
      })
    },
    [markFileSaved]
  )

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeFileId || value === undefined) return
      updateFileContent(activeFileId, value)
    },
    [activeFileId, updateFileContent]
  )

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface-0">
      <EditorTabs />

      <div className="flex-1 min-h-0">
        {activeFile ? (
          <Editor
            key={activeFile.id}
            language={activeFile.language}
            value={activeFile.content}
            onChange={handleChange}
            onMount={handleMount}
            theme="vs-dark"
            options={{
              fontSize: 13,
              fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace",
              minimap: { enabled: false },
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              tabSize: 2,
              automaticLayout: true,
              padding: { top: 8 }
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            Open a file from the sidebar or file tree
          </div>
        )}
      </div>

      <EditorStatusBar cursorLine={cursorLine} cursorColumn={cursorColumn} />
    </div>
  )
}
