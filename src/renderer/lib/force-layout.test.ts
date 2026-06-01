import { describe, expect, it } from 'vitest'
import { forceLayout, type LayoutEdge, type LayoutNode } from './force-layout'

const W = 760
const H = 460
const PAD = 56

const nodes: LayoutNode[] = [
  { id: 'a', weight: 30 },
  { id: 'b', weight: 28 },
  { id: 'c', weight: 11 },
  { id: 'd', weight: 9 },
  { id: 'e', weight: 5 }
]
const edges: LayoutEdge[] = [
  { from: 'a', to: 'c' },
  { from: 'a', to: 'd' },
  { from: 'b', to: 'd' },
  { from: 'c', to: 'e' }
]

describe('forceLayout', () => {
  it('places every node within bounds', () => {
    const pos = forceLayout(nodes, edges, { width: W, height: H })
    for (const n of nodes) {
      const p = pos[n.id]!
      expect(p.x).toBeGreaterThanOrEqual(PAD - 0.001)
      expect(p.x).toBeLessThanOrEqual(W - PAD + 0.001)
      expect(p.y).toBeGreaterThanOrEqual(PAD - 0.001)
      expect(p.y).toBeLessThanOrEqual(H - PAD + 0.001)
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('is deterministic (same input → identical output)', () => {
    const a = forceLayout(nodes, edges, { width: W, height: H })
    const b = forceLayout(nodes, edges, { width: W, height: H })
    expect(a).toEqual(b)
  })

  it('separates nodes (no two share a position; min spacing respected)', () => {
    const pos = forceLayout(nodes, edges, { width: W, height: H })
    const pts = nodes.map((n) => pos[n.id]!)
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)
        expect(d).toBeGreaterThan(30)
      }
    }
  })

  it('handles 0 and 1 node', () => {
    expect(forceLayout([], [], { width: W, height: H })).toEqual({})
    const one = forceLayout([{ id: 'x' }], [], { width: W, height: H })
    expect(one.x).toEqual({ x: W / 2, y: H / 2 })
  })
})
