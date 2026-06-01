/**
 * CrewGraph — The Bridge: renders a crew as a real dependency-graph diagram
 * (nodes = roles, edges = dependencies), laid out by topological waves. During
 * execution it colors nodes by live status, turning the plan into a command
 * surface you can read at a glance.
 */

import { effectiveDeps, computeWaves } from '../../shared/crew-dag'
import type { CrewRoleConfig, CrewStrategy } from '../../shared/types'

export type CrewNodeStatus = 'pending' | 'running' | 'done'

const NODE_W = 118
const NODE_H = 34
const GAP_X = 46
const GAP_Y = 12
const PAD = 10

function colorFor(status: CrewNodeStatus | undefined): { fill: string; stroke: string; text: string } {
  switch (status) {
    case 'running':
      return { fill: 'var(--color-success)', stroke: 'var(--color-success)', text: '#fff' }
    case 'done':
      return { fill: 'var(--color-accent)', stroke: 'var(--color-accent)', text: '#fff' }
    default:
      return { fill: 'var(--color-surface-3)', stroke: 'var(--color-border)', text: 'var(--color-text-secondary)' }
  }
}

export function CrewGraph({
  roles,
  strategy = 'sequential',
  status
}: {
  roles: CrewRoleConfig[]
  strategy?: CrewStrategy
  status?: Record<string, CrewNodeStatus>
}): JSX.Element | null {
  if (roles.length === 0) return null
  const deps = effectiveDeps(roles, strategy)
  const { waves } = computeWaves(roles, deps)
  const labelById = new Map(roles.map((r) => [r.id, r.label]))

  const pos = new Map<string, { x: number; y: number }>()
  waves.forEach((wave, wi) => {
    wave.forEach((id, ri) => {
      pos.set(id, { x: PAD + wi * (NODE_W + GAP_X), y: PAD + ri * (NODE_H + GAP_Y) })
    })
  })

  const maxRows = Math.max(1, ...waves.map((w) => w.length))
  const width = PAD * 2 + waves.length * (NODE_W + GAP_X) - GAP_X
  const height = PAD * 2 + maxRows * (NODE_H + GAP_Y) - GAP_Y

  return (
    <div className="overflow-x-auto" data-testid="crew-graph">
      <svg width={width} height={height} className="block" role="img" aria-label="Crew dependency graph">
        {/* edges */}
        {roles.map((r) =>
          (deps.get(r.id) ?? []).map((d) => {
            const from = pos.get(d)
            const to = pos.get(r.id)
            if (!from || !to) return null
            const x1 = from.x + NODE_W
            const y1 = from.y + NODE_H / 2
            const x2 = to.x
            const y2 = to.y + NODE_H / 2
            const mx = (x1 + x2) / 2
            return (
              <path
                key={`${d}->${r.id}`}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth={1.5}
              />
            )
          })
        )}
        {/* nodes */}
        {roles.map((r) => {
          const p = pos.get(r.id)
          if (!p) return null
          const c = colorFor(status?.[r.id])
          const isPlain = !status?.[r.id] || status[r.id] === 'pending'
          return (
            <g key={r.id}>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={7}
                fill={isPlain ? 'var(--color-surface-2)' : c.fill}
                stroke={c.stroke}
                strokeWidth={1.5}
              />
              <text
                x={p.x + NODE_W / 2}
                y={p.y + NODE_H / 2}
                dominantBaseline="central"
                textAnchor="middle"
                fontSize={12}
                fill={isPlain ? 'var(--color-text-primary)' : c.text}
              >
                {labelById.get(r.id) ?? r.id}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
