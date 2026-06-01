import { describe, expect, it } from 'vitest'
import { parseMarketplace, entrySourceToSpec, parseMarketplaceRegistry } from '@kairo/plugin'

describe('entrySourceToSpec', () => {
  it('passes through a string source', () => {
    expect(entrySourceToSpec('./plugins/a')).toBe('./plugins/a')
    expect(entrySourceToSpec('github:o/r')).toBe('github:o/r')
  })
  it('normalizes github objects (with optional ref)', () => {
    expect(entrySourceToSpec({ source: 'github', repo: 'o/r' })).toBe('github:o/r')
    expect(entrySourceToSpec({ source: 'github', repo: 'o/r', ref: 'v2' })).toBe('github:o/r#v2')
  })
  it('returns the url for git/url objects, and normalizes npm/pip objects', () => {
    expect(entrySourceToSpec({ source: 'git', url: 'https://x/y.git' })).toBe('https://x/y.git')
    expect(entrySourceToSpec({ source: 'npm', package: 'p' })).toBe('npm:p')
    expect(entrySourceToSpec({ source: 'npm', package: 'p', version: '1.0' })).toBe('npm:p@1.0')
    expect(entrySourceToSpec({ source: 'pip', package: 'q', version: '2.0' })).toBe('pip:q==2.0')
    expect(entrySourceToSpec(42)).toBeNull()
  })
})

describe('parseMarketplace', () => {
  it('parses name/owner/plugins and drops entries without a usable source', () => {
    const mp = parseMarketplace({
      name: 'mkt',
      owner: { name: 'Acme', url: 'https://acme' },
      description: 'd',
      plugins: [
        { name: 'good', source: './p/good', description: 'g', category: 'fmt', tags: ['x'] },
        { name: 'gh', source: { source: 'github', repo: 'o/r', ref: 'v1' }, version: '1.0' },
        { name: 'bad' }, // no source → dropped
        { source: './nameless' } // no name → dropped
      ]
    })
    expect(mp).not.toBeNull()
    expect(mp!.name).toBe('mkt')
    expect(mp!.owner).toBe('Acme')
    expect(mp!.plugins).toEqual([
      { name: 'good', source: './p/good', description: 'g', category: 'fmt', version: undefined, tags: ['x'] },
      { name: 'gh', source: 'github:o/r#v1', description: undefined, category: undefined, version: '1.0' }
    ])
  })

  it('requires a name', () => {
    expect(parseMarketplace({ plugins: [] })).toBeNull()
    expect(parseMarketplace(null)).toBeNull()
  })
})

describe('parseMarketplaceRegistry', () => {
  it('accepts string arrays, {marketplaces} wrappers, and {source} objects; dedups', () => {
    expect(parseMarketplaceRegistry(['a', 'a', 'b'])).toEqual(['a', 'b'])
    expect(parseMarketplaceRegistry({ marketplaces: ['x'] })).toEqual(['x'])
    expect(parseMarketplaceRegistry([{ source: 's1' }, 's2'])).toEqual(['s1', 's2'])
    expect(parseMarketplaceRegistry(null)).toEqual([])
  })
})
