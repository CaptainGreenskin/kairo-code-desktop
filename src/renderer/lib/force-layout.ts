/**
 * Tiny deterministic force-directed layout for the Code Map. Repulsion between
 * all nodes + spring attraction along edges + gentle centering, run for a fixed
 * number of iterations. Deterministic (seeded from a circle, no randomness) so
 * the same graph always lays out the same way and is unit-testable.
 */

export interface LayoutNode {
  id: string
  /** Relative weight (e.g. file count) — heavier nodes repel a bit more. */
  weight?: number
}

export interface LayoutEdge {
  from: string
  to: string
}

export interface LayoutOpts {
  width: number
  height: number
  iterations?: number
  padding?: number
}

export type Positions = Record<string, { x: number; y: number }>

export function forceLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts: LayoutOpts): Positions {
  const { width, height, iterations = 220, padding = 56 } = opts
  const n = nodes.length
  const pos: Positions = {}
  if (n === 0) return pos
  const cx = width / 2
  const cy = height / 2

  // Seed deterministically on a circle.
  const seedR = Math.min(width, height) / 2 - padding
  nodes.forEach((node, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    pos[node.id] = { x: cx + Math.cos(a) * seedR, y: cy + Math.sin(a) * seedR }
  })
  if (n === 1) {
    pos[nodes[0]!.id] = { x: cx, y: cy }
    return pos
  }

  const ids = nodes.map((nd) => nd.id)
  const weightOf = new Map(nodes.map((nd) => [nd.id, Math.max(1, nd.weight ?? 1)]))
  const kRep = Math.min(width, height) * 9 // repulsion strength
  const kAttr = 0.018 // spring strength
  const idealLen = Math.min(width, height) / 3.2

  for (let iter = 0; iter < iterations; iter++) {
    const disp: Record<string, { x: number; y: number }> = {}
    for (const id of ids) disp[id] = { x: 0, y: 0 }

    // Repulsion (all pairs).
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[ids[i]!]!
        const b = pos[ids[j]!]!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = (i - j) * 0.5 + 0.1
          dy = (i + j) * 0.3 + 0.1
          d2 = dx * dx + dy * dy
        }
        const wMul = (weightOf.get(ids[i]!)! + weightOf.get(ids[j]!)!) / 2
        const f = (kRep * wMul) / d2
        const d = Math.sqrt(d2)
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        disp[ids[i]!]!.x += fx
        disp[ids[i]!]!.y += fy
        disp[ids[j]!]!.x -= fx
        disp[ids[j]!]!.y -= fy
      }
    }

    // Attraction along edges.
    for (const e of edges) {
      const a = pos[e.from]
      const b = pos[e.to]
      if (!a || !b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = kAttr * (d - idealLen)
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      disp[e.from]!.x -= fx
      disp[e.from]!.y -= fy
      disp[e.to]!.x += fx
      disp[e.to]!.y += fy
    }

    // Gentle centering + integrate with cooling.
    const cool = 1 - iter / iterations
    const maxStep = 18 * cool + 2
    for (const id of ids) {
      const p = pos[id]!
      disp[id]!.x += (cx - p.x) * 0.012
      disp[id]!.y += (cy - p.y) * 0.012
      let mx = disp[id]!.x
      let my = disp[id]!.y
      const ml = Math.sqrt(mx * mx + my * my) || 1
      if (ml > maxStep) {
        mx = (mx / ml) * maxStep
        my = (my / ml) * maxStep
      }
      p.x = Math.max(padding, Math.min(width - padding, p.x + mx))
      p.y = Math.max(padding, Math.min(height - padding, p.y + my))
    }
  }

  return pos
}
