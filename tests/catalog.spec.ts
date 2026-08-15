import { describe, expect, it, vi } from 'vitest'
import { buildCatalogTool, buildHelpTool, catalog } from '../src/catalog.js'

function fetcherMock(handler: (path: string) => unknown) {
  return vi.fn(async (path: string) => handler(path))
}

function exec() {
  return { signal: new AbortController().signal } as never
}

describe('catalog completeness', () => {
  it('ships 100+ tools in total (flagship + catalog)', () => {
    expect(catalog.length + 10).toBeGreaterThanOrEqual(100)
  })

  it('has unique tool names', () => {
    const names = catalog.map((spec) => spec.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('builds every catalog tool without throwing', () => {
    const fetch = fetcherMock(() => [])
    for (const spec of catalog) {
      expect(() => buildCatalogTool(fetch, spec)).not.toThrow()
    }
  })
})

describe('generated tools', () => {
  it('executes a GitHub list tool through the fetcher', async () => {
    const fetch = fetcherMock(() => [
      { name: 'main', commit: { sha: 'abc' }, protected: false },
      { name: 'dev', commit: { sha: 'def' }, protected: true },
    ])
    const spec = catalog.find((s) => s.name === 'github_repo_branches')
    expect(spec).toBeDefined()
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({ owner: 'a', repo: 'b' }, exec())
    expect(result).toMatchObject({ source: 'a/b' })
    expect((result as { items: unknown[] }).items).toHaveLength(2)
    expect((result as { items: Array<Record<string, unknown>> }).items[0]).toMatchObject({ name: 'main', sha: 'abc' })
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/repos/a/b/branches')
  })

  it('unwraps npm search results', async () => {
    const fetch = fetcherMock(() => ({
      objects: [{ package: { name: 'zod', version: '4.0.0', description: 'schema', author: { name: 'colinhacks' }, license: 'MIT' } }],
    }))
    const spec = catalog.find((s) => s.name === 'npm_search')
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({ q: 'schema' }, exec())
    expect(result).toMatchObject({ source: 'query: schema', items: [{ name: 'zod', version: '4.0.0' }] })
  })

  it('resolves Hacker News top stories by fetching each item', async () => {
    const fetch = fetcherMock((path) => {
      if (path.startsWith('/topstories.json')) return [1, 2]
      if (path === '/item/1.json') return { id: 1, type: 'story', title: 'One', by: 'u1', score: 10, descendants: 2 }
      return { id: 2, type: 'story', title: 'Two', by: 'u2', score: 5, descendants: 0 }
    })
    const spec = catalog.find((s) => s.name === 'hn_top')
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({}, exec())
    expect(result).toMatchObject({ source: 'hn_top', items: [{ title: 'One' }, { title: 'Two' }] })
  })

  it('parses dsh ecosystem stats', async () => {
    const fetch = fetcherMock(() => ({ count: 1701 }))
    const spec = catalog.find((s) => s.name === 'dsh_ecosystem_stats')
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({}, exec())
    expect(result).toMatchObject({ item: { pluginCount: 1701 } })
  })

  it('help tool reports the total tool count', async () => {
    const help = buildHelpTool(catalog.length + 10)
    const result = await help.execute({}, exec())
    expect(result).toMatchObject({ total: catalog.length + 10 })
  })

  it('executes a GitLab search tool', async () => {
    const fetch = fetcherMock(() => [
      { id: 1, name: 'harness', path_with_namespace: 'deepseek-ai/harness', description: 'd', star_count: 9, forks_count: 2, last_activity_at: '2026-08-01T00:00:00Z', web_url: 'https://gitlab.com/x' },
    ])
    const spec = catalog.find((s) => s.name === 'gitlab_search')
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({ q: 'harness' }, exec())
    expect(result).toMatchObject({ source: 'query: harness', items: [{ name: 'harness', stars: 9 }] })
  })

  it('executes a Gitee repo tool', async () => {
    const fetch = fetcherMock(() => ({
      full_name: 'gitee/harness',
      description: 'd',
      stargazers_count: 7,
      forks_count: 1,
      language: 'Go',
      license: { name: 'MIT' },
      html_url: 'https://gitee.com/x',
      updated_at: '2026-08-01T00:00:00Z',
    }))
    const spec = catalog.find((s) => s.name === 'gitee_repo')
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({ owner: 'gitee', repo: 'harness' }, exec())
    expect(result).toMatchObject({ item: { fullName: 'gitee/harness', stars: 7, license: 'MIT' } })
  })
})
