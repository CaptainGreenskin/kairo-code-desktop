/**
 * Drop zone overlay for the chat workspace.
 *
 * Wraps the chat area, intercepts native drag events, and surfaces a
 * dashed-border overlay while files are hovering. On drop, the host
 * Electron `path` property on each `File` is used to load the content
 * via the main-process `kairo:readFile` IPC handler so we can stream it
 * to the agent without requiring renderer-side filesystem access.
 *
 * Multiple files are supported. Reads run in parallel and silently
 * skip on error; the caller is notified for every successfully-read
 * file via `onFilesDropped`.
 */

import { useCallback, useRef, useState } from 'react'

export interface DroppedFilePayload {
  name: string
  path: string
  content: string
  size: number
}

export interface FileDropZoneProps {
  onFilesDropped: (files: DroppedFilePayload[]) => void
  children: React.ReactNode
  className?: string
}

// Electron exposes the absolute file path on dropped File objects via
// non-standard `path` and (newer Electron) `webUtils.getPathForFile`.
type ElectronFile = File & { path?: string }

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB safety cap per file

export function FileDropZone({
  onFilesDropped,
  children,
  className
}: FileDropZoneProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  // Drag enter/leave fires for every nested element. We track a counter
  // so the overlay is only hidden when the cursor truly leaves the zone.
  const dragDepthRef = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    dragDepthRef.current += 1
    setDragging(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault()
      dragDepthRef.current = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer.files) as ElectronFile[]
      if (files.length === 0) return

      const reads = await Promise.all(
        files.map((file) => readDroppedFile(file))
      )
      const successful = reads.filter((r): r is DroppedFilePayload => r !== null)
      if (successful.length > 0) onFilesDropped(successful)
    },
    [onFilesDropped]
  )

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative ${className ?? ''}`}
    >
      {children}
      {dragging && <DropOverlay />}
    </div>
  )
}

function DropOverlay(): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent/80 bg-accent/10 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-2 text-accent">
        <UploadIcon />
        <div className="text-sm font-medium">Drop files here</div>
        <div className="text-xs text-accent/80">
          They'll be attached to your next message
        </div>
      </div>
    </div>
  )
}

function UploadIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-8 h-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V4M6 10l6-6 6 6" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

function hasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types).some((t) => t === 'Files' || t === 'application/x-moz-file')
}

async function readDroppedFile(file: ElectronFile): Promise<DroppedFilePayload | null> {
  if (file.size > MAX_FILE_BYTES) return null
  const path = resolveFilePath(file)
  if (path) {
    try {
      const result = await window.kairoAPI.readFile(path)
      if (result.ok && typeof result.content === 'string') {
        return {
          name: file.name,
          path,
          content: result.content,
          size: file.size
        }
      }
    } catch {
      // fall through to the browser-side reader
    }
  }
  // Fallback: read in the renderer (path-less drops, e.g. from a browser).
  try {
    const content = await file.text()
    return {
      name: file.name,
      path: path ?? file.name,
      content,
      size: file.size
    }
  } catch {
    return null
  }
}

function resolveFilePath(file: ElectronFile): string | undefined {
  // Older Electron versions expose `file.path`. Newer ones have moved it
  // behind `webUtils.getPathForFile`; we try the legacy field first and
  // fall back to the modern API if available on `window`.
  if (typeof file.path === 'string' && file.path.length > 0) return file.path
  const webUtils = (window as unknown as {
    electron?: { webUtils?: { getPathForFile: (f: File) => string } }
  }).electron?.webUtils
  if (webUtils && typeof webUtils.getPathForFile === 'function') {
    try {
      const resolved = webUtils.getPathForFile(file)
      if (resolved) return resolved
    } catch {
      // ignore
    }
  }
  return undefined
}
