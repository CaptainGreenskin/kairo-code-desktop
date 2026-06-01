import { describe, expect, it } from 'vitest'
import { parsePluginSource, githubTarballUrl } from '@kairo/plugin'

describe('parsePluginSource', () => {
  it('parses github:owner/repo with default ref', () => {
    expect(parsePluginSource('github:acme/my-plugin')).toEqual({ kind: 'github', owner: 'acme', repo: 'my-plugin', ref: 'HEAD' })
  })
  it('parses subdir (in path) + ref (after #)', () => {
    expect(parsePluginSource('github:acme/repo/plugins/sec#v1.2')).toEqual({
      kind: 'github', owner: 'acme', repo: 'repo', ref: 'v1.2', subdir: 'plugins/sec'
    })
  })
  it('parses a github.com URL with tree ref + subdir', () => {
    expect(parsePluginSource('https://github.com/acme/repo/tree/main/sub/dir')).toEqual({
      kind: 'github', owner: 'acme', repo: 'repo', ref: 'main', subdir: 'sub/dir'
    })
  })
  it('parses an absolute local path', () => {
    expect(parsePluginSource('/Users/x/my-plugin')).toEqual({ kind: 'local', path: '/Users/x/my-plugin' })
  })
  it('parses npm:package and npm:package@version', () => {
    expect(parsePluginSource('npm:my-plugin')).toEqual({ kind: 'npm', package: 'my-plugin' })
    expect(parsePluginSource('npm:@scope/plugin@2.1.0')).toEqual({ kind: 'npm', package: '@scope/plugin', version: '2.1.0' })
  })
  it('parses pip:package and pip:package==version', () => {
    expect(parsePluginSource('pip:my-plugin')).toEqual({ kind: 'pip', package: 'my-plugin' })
    expect(parsePluginSource('pip:my-plugin==1.0.0')).toEqual({ kind: 'pip', package: 'my-plugin', version: '1.0.0' })
  })
  it('rejects empty npm:/pip: specs', () => {
    expect(parsePluginSource('npm:')).toBeNull()
    expect(parsePluginSource('pip:')).toBeNull()
  })
  it('rejects junk', () => {
    expect(parsePluginSource('')).toBeNull()
    expect(parsePluginSource('github:onlyone')).toBeNull()
  })
})

describe('githubTarballUrl', () => {
  it('builds the codeload url', () => {
    expect(githubTarballUrl({ kind: 'github', owner: 'a', repo: 'b', ref: 'v1' })).toBe('https://codeload.github.com/a/b/tar.gz/v1')
  })
})
