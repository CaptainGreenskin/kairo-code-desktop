import { promises as fs } from 'node:fs'
import * as path from 'node:path'

const MEMORY_DIR = '.kairo'
const MEMORY_FILE = 'memory.md'

function memoryPath(workingDir: string): string {
  return path.join(workingDir, MEMORY_DIR, MEMORY_FILE)
}

export class WorkspaceMemory {
  async read(workingDir: string): Promise<string> {
    try {
      return await fs.readFile(memoryPath(workingDir), 'utf-8')
    } catch {
      return ''
    }
  }

  async write(workingDir: string, content: string): Promise<void> {
    const filePath = memoryPath(workingDir)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
  }

  async append(workingDir: string, entry: string): Promise<void> {
    const filePath = memoryPath(workingDir)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const formatted = `\n\n### ${timestamp}\n\n${entry.trim()}`
    try {
      await fs.appendFile(filePath, formatted, 'utf-8')
    } catch {
      await fs.writeFile(filePath, `# Workspace Memory${formatted}`, 'utf-8')
    }
  }
}
