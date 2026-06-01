/**
 * Cross-repo service map, visualized. Nodes are services (sized by how many
 * cross-service contracts they expose); edges link services that share an event
 * topic or HTTP route. Deterministic force layout so the same set of services
 * always lays out the same way. Pure view — data comes from `buildServiceGraph`.
 */

import { forceLayout } from '../lib/force-layout'
import type { ServiceGraph } from '../../shared/service-graph'

interface Props {
  graph: ServiceGraph
  width?: number
  height?: number
}

export function ServiceGraphView({ graph, width = 360, height = 240 }: Props): JSX.Element {
  const pos = forceLayout(
    graph.nodes.map((n) => ({ id: n.name, weight: 1 + n.contracts })),
    graph.edges.map((e) => ({ from: e.from, to: e.to })),
    { width, height, padding: 40 }
  )
  const maxC = Math.max(1, ...graph.nodes.map((n) => n.contracts))
  const radius = (c: number): number => 10 + Math.sqrt(c / maxC) * 14

  return (
    <svg width={width} height={height} role="img" aria-label="Cross-repo service map" data-testid="service-graph-svg">
      {graph.edges.map((e, i) => {
        const a = pos[e.from]
        const b = pos[e.to]
        if (!a || !b) return null
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={e.kind === 'event' ? 'var(--color-accent)' : 'var(--color-warning)'}
            strokeWidth={1.4}
            strokeOpacity={0.55}
            strokeDasharray={e.kind === 'event' ? undefined : '4 2'}
          />
        )
      })}
      {graph.nodes.map((n) => {
        const p = pos[n.name]
        if (!p) return null
        return (
          <g key={n.name} data-testid={`service-node-${n.name}`}>
            <circle cx={p.x} cy={p.y} r={radius(n.contracts)} fill="var(--color-surface-3)" stroke="var(--color-border)" strokeWidth={1.5} />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={9} fill="var(--color-text-primary)">
              {n.contracts}
            </text>
            <text x={p.x} y={p.y + radius(n.contracts) + 10} textAnchor="middle" fontSize={10} fill="var(--color-text-secondary)">
              {n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
