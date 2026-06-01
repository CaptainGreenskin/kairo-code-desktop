/**
 * Browser-safe Change Lens formatting (shared by main + renderer). No node
 * deps so the renderer can import it. The lens *builder* lives in
 * `src/main/change-lens.ts`; this is only presentation.
 */

import type { ChangeLens } from './types'

/** Last path segment without node:path. */
function basename(p: string): string {
  const segs = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return segs[segs.length - 1] ?? p
}

/** Compact, non-prose markdown summary of a lens for the chat write-back. */
export function lensToMarkdown(lens: ChangeLens): string {
  const lines: string[] = ['### Change Lens']

  if (lens.blastRadius.length > 0) {
    lines.push('', '**Blast radius**')
    for (const m of lens.blastRadius) {
      lines.push(`- \`${m.module}\` — ${m.files.length} file(s): ${m.files.map((f) => basename(f)).join(', ')}`)
    }
  } else {
    lines.push('', '**Blast radius:** no files changed.')
  }

  lines.push('', '**Verification**')
  if (lens.verification.ran.length > 0) {
    for (const r of lens.verification.ran) {
      lines.push(`- ${r.ok ? '✓' : '✗'} \`${r.command}\``)
    }
  } else {
    lines.push('- (nothing executed)')
  }
  if (lens.verification.warning) lines.push(`- ⚠ ${lens.verification.warning}`)

  if (lens.behaviorDelta && lens.behaviorDelta.length > 0) {
    lines.push('', '**Behavior delta**')
    for (const s of lens.behaviorDelta) {
      lines.push(`- ${s.detail} (\`${basename(s.file)}\`)`)
    }
  }

  if (lens.uncertaintyFlags.length > 0) {
    lines.push('', '**Where the crew was unsure**')
    for (const f of lens.uncertaintyFlags) lines.push(`- ${f}`)
  }

  return lines.join('\n')
}
