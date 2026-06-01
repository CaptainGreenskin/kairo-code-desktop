/**
 * Cross-repo service map — system of systems. A single Living Map stops at the
 * repo boundary, but real change crosses services: one service emits an event or
 * defines an HTTP route, another consumes it. Reusing the hidden-coupling
 * signals (events + routes) across repos, we infer cross-service edges so
 * "change X here breaks service Y there" is finally answerable. Pure +
 * browser-safe; each service's signals are scanned in main.
 */

import type { CouplingSignal } from './code-map'

export interface ServiceInput {
  name: string
  /** All coupling signals found anywhere in the service's source. */
  signals: CouplingSignal[]
}

export interface ServiceNode {
  name: string
  /** Distinct HTTP routes + event topics this service references. */
  contracts: number
}

export interface ServiceEdge {
  from: string
  to: string
  kind: 'event' | 'http'
  key: string
}

export interface ServiceGraph {
  nodes: ServiceNode[]
  edges: ServiceEdge[]
}

/**
 * Build the cross-service graph: two services are linked when they share an
 * event topic or HTTP route (the cross-service contracts). Tables/flags are
 * intra-service and ignored here. A contract shared by every service (> 6) is
 * treated as generic and skipped. Undirected pairs, deduped. Pure.
 */
export function buildServiceGraph(services: ServiceInput[]): ServiceGraph {
  const nodes: ServiceNode[] = services.map((s) => ({
    name: s.name,
    contracts: new Set(
      s.signals.filter((g) => g.kind === 'event' || g.kind === 'http').map((g) => `${g.kind}|${g.key}`)
    ).size
  }))

  // (kind|key) → services referencing it.
  const byKey = new Map<string, { kind: 'event' | 'http'; key: string; svc: Set<string> }>()
  for (const s of services) {
    for (const g of s.signals) {
      if (g.kind !== 'event' && g.kind !== 'http') continue
      const id = `${g.kind}|${g.key}`
      let entry = byKey.get(id)
      if (!entry) {
        entry = { kind: g.kind, key: g.key, svc: new Set() }
        byKey.set(id, entry)
      }
      entry.svc.add(s.name)
    }
  }

  const seen = new Set<string>()
  const edges: ServiceEdge[] = []
  for (const { kind, key, svc } of byKey.values()) {
    const list = [...svc].sort()
    if (list.length < 2 || list.length > 6) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dedup = `${list[i]}|${list[j]}|${kind}|${key}`
        if (seen.has(dedup)) continue
        seen.add(dedup)
        edges.push({ from: list[i]!, to: list[j]!, kind, key })
      }
    }
  }
  return { nodes, edges }
}
