import { describe, expect, it } from 'vitest'
import { buildServiceGraph, type ServiceInput } from './service-graph'

const services: ServiceInput[] = [
  { name: 'checkout', signals: [{ kind: 'event', key: 'order.paid' }, { kind: 'http', key: '/api/pay' }, { kind: 'table', key: 'orders' }] },
  { name: 'fulfillment', signals: [{ kind: 'event', key: 'order.paid' }] },
  { name: 'billing', signals: [{ kind: 'http', key: '/api/pay' }] },
  { name: 'lonely', signals: [{ kind: 'event', key: 'nobody.listens' }] }
]

describe('buildServiceGraph', () => {
  it('links services that share an event topic or HTTP route', () => {
    const g = buildServiceGraph(services)
    const has = (a: string, b: string, kind: string, key: string): boolean =>
      g.edges.some(
        (e) => e.kind === kind && e.key === key && ((e.from === a && e.to === b) || (e.from === b && e.to === a))
      )
    expect(has('checkout', 'fulfillment', 'event', 'order.paid')).toBe(true)
    expect(has('billing', 'checkout', 'http', '/api/pay')).toBe(true)
  })

  it('ignores intra-service signals (tables/flags) and unshared contracts', () => {
    const g = buildServiceGraph(services)
    // The shared 'orders' table does NOT create a cross-service edge.
    expect(g.edges.every((e) => e.key !== 'orders')).toBe(true)
    // 'lonely' shares nothing → no edges touch it.
    expect(g.edges.every((e) => e.from !== 'lonely' && e.to !== 'lonely')).toBe(true)
  })

  it('counts each service distinct cross-service contracts', () => {
    const g = buildServiceGraph(services)
    expect(g.nodes.find((n) => n.name === 'checkout')!.contracts).toBe(2) // event + http (table excluded)
    expect(g.nodes.find((n) => n.name === 'lonely')!.contracts).toBe(1)
  })
})
