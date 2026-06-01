/**
 * Git as a Brain source. The Comprehension Gate only records crew changes, so
 * the Living Map is blind to manual edits, external commits, and Agent-mode work
 * — the bulk of real history. This module turns `git log` into structured
 * commits and hangs them on modules, so the map's history is finally *complete*
 * and "why is X like this" can be answered from commit messages, not just gate
 * decisions. Pure + browser-safe; the raw `git log` read lives in main.
 */

import { dirOf } from './code-map'

export interface GitCommit {
  hash: string
  /** Author/commit time, ms epoch. */
  at: number
  author: string
  /** First line of the commit message — the "why". */
  subject: string
  /** Relative paths touched by the commit. */
  files: string[]
}

/**
 * Delimiters for the `git log` format main uses:
 *   --pretty=format:%x01%H%x1f%at%x1f%an%x1f%s   (records start with \x01,
 *   fields separated by \x1f), followed by --name-only file paths per commit.
 */
const REC = '\x01'
const FIELD = '\x1f'

/** Parse the delimited `git log` output into structured commits. */
export function parseGitLog(raw: string): GitCommit[] {
  const out: GitCommit[] = []
  for (const chunk of raw.split(REC)) {
    if (!chunk.trim()) continue
    const nl = chunk.indexOf('\n')
    const header = nl === -1 ? chunk : chunk.slice(0, nl)
    const rest = nl === -1 ? '' : chunk.slice(nl + 1)
    const [hash, at, author, subject] = header.split(FIELD)
    if (!hash) continue
    const files = rest
      .split('\n')
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean)
    out.push({
      hash,
      at: (Number(at) || 0) * 1000,
      author: author ?? '',
      subject: subject ?? '',
      files
    })
  }
  return out
}

/** Does a relative file path live inside (or as) the given module directory? */
function fileInModule(file: string, moduleId: string): boolean {
  const d = dirOf(file)
  return d === moduleId || d.startsWith(`${moduleId}/`) || moduleId.startsWith(`${d}/`)
}

/** Commits that touched a module, newest first (git log is already ordered). */
export function commitsForModule(commits: GitCommit[], moduleId: string): GitCommit[] {
  return commits.filter((c) => c.files.some((f) => fileInModule(f, moduleId)))
}

/** Distinct module dirs touched by commits after `since` (ms epoch). */
export function gitModulesSince(commits: GitCommit[], since: number): string[] {
  const mods = new Set<string>()
  for (const c of commits) {
    if (c.at <= since) continue
    for (const f of c.files) mods.add(dirOf(f))
  }
  return [...mods]
}
