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

  it('decodes file content from the contents endpoint', async () => {
    const fetch = fetcherMock(() => ({
      name: 'README.md',
      path: 'README.md',
      size: 5,
      content: Buffer.from('hello').toString('base64'),
      html_url: 'https://github.com/x/y/blob/main/README.md',
    }))
    const spec = catalog.find((s) => s.name === 'github_repo_file_content')
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({ owner: 'x', repo: 'y', path: 'README.md' }, exec())
    expect(result).toMatchObject({ item: { path: 'README.md', contentText: 'hello' } })
  })

  it('ships the v2.3.0 tool set (releases/issues/pulls lists, users, orgs, refs, punch card, advisories, search)', () => {
    for (const name of [
      'github_repo_releases', 'github_repo_issues', 'github_repo_pulls',
      'github_user_repos', 'github_user_social_accounts', 'github_repo_contributors',
      'github_repo_subscribers', 'github_repo_collaborators', 'github_repo_git_refs',
      'github_repo_punch_card', 'github_repo_security_advisories', 'github_search_repositories',
    ]) {
      expect(catalog.some((spec) => spec.name === name), `missing ${name}`).toBe(true)
    }
  })

  it('filters pull requests out of the repo issues list', async () => {
    const fetch = fetcherMock(() => [
      { number: 1, title: 'issue', state: 'open', user: { login: 'u' }, comments: 0, created_at: null, html_url: 'https://x/1' },
      { number: 2, title: 'pr', state: 'open', user: { login: 'u' }, comments: 0, created_at: null, html_url: 'https://x/2', pull_request: {} },
    ])
    const spec = catalog.find((s) => s.name === 'github_repo_issues')
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({ owner: 'a', repo: 'b' }, exec())
    expect(result).toMatchObject({ source: 'a/b', items: [{ number: 1, title: 'issue' }] })
    expect((result as { items: unknown[] }).items).toHaveLength(1)
  })

  it('parses repository search results through the items wrapper', async () => {
    const fetch = fetcherMock(() => ({
      items: [{ full_name: 'a/b', description: 'd', stargazers_count: 9, language: 'TS', updated_at: null, html_url: 'https://x/r' }],
    }))
    const spec = catalog.find((s) => s.name === 'github_search_repositories')
    const tool = buildCatalogTool(fetch, spec!)
    const result = await tool.execute({ q: 'harness' }, exec())
    expect(result).toMatchObject({ source: 'query: harness', items: [{ fullName: 'a/b', stars: 9 }] })
  })

  it('parses social accounts, collaborators, git refs, punch card and advisories', async () => {
    const cases: Array<{ name: string; args: Record<string, unknown>; fixture: unknown; expected: Record<string, unknown> }> = [
      {
        name: 'github_user_social_accounts', args: { username: 'z' },
        fixture: [{ provider: 'twitter', url: 'https://x/z' }],
        expected: { source: '@z', items: [{ provider: 'twitter', url: 'https://x/z' }] },
      },
      {
        name: 'github_repo_collaborators', args: { owner: 'a', repo: 'b' },
        fixture: [{ login: 'u', avatar_url: null, html_url: 'https://x/u', permissions: { push: true } }],
        expected: { items: [{ login: 'u', permission: 'push' }] },
      },
      {
        name: 'github_repo_git_refs', args: { owner: 'a', repo: 'b', ref: 'heads/main' },
        fixture: [{ ref: 'refs/heads/main', object: { type: 'commit', sha: 'abc' }, html_url: null }],
        expected: { items: [{ ref: 'refs/heads/main', type: 'commit', sha: 'abc' }] },
      },
      {
        name: 'github_repo_punch_card', args: { owner: 'a', repo: 'b' },
        fixture: [[0, 10, 5], [1, 9, 2]],
        expected: { items: [{ day: 0, hour: 10, count: 5 }, { day: 1, hour: 9, count: 2 }] },
      },
      {
        name: 'github_repo_security_advisories', args: { owner: 'a', repo: 'b' },
        fixture: [{ ghsa_id: 'GHSA-1', summary: 's', severity: 'high', published_at: '2026-01-01T00:00:00Z', updated_at: null, html_url: 'https://x/a' }],
        expected: { items: [{ ghsaId: 'GHSA-1', severity: 'high' }] },
      },
    ]
    for (const c of cases) {
      const fetch = fetcherMock(() => c.fixture)
      const spec = catalog.find((s) => s.name === c.name)
      const tool = buildCatalogTool(fetch, spec!)
      const result = await tool.execute(c.args, exec())
      expect(result).toMatchObject(c.expected)
    }
  })

  it('parses repo releases, pulls, contributors, subscribers and user repos', async () => {
    const cases: Array<{ name: string; args: Record<string, unknown>; fixture: unknown; expected: Record<string, unknown> }> = [
      {
        name: 'github_repo_releases', args: { owner: 'a', repo: 'b' },
        fixture: [{ tag_name: 'v2', name: null, published_at: '2026-02-01T00:00:00Z', prerelease: true, html_url: 'https://x/r' }],
        expected: { items: [{ tagName: 'v2', prerelease: true }] },
      },
      {
        name: 'github_repo_pulls', args: { owner: 'a', repo: 'b' },
        fixture: [{ number: 3, title: 'pr', state: 'open', user: { login: 'u' }, created_at: null, merged_at: null, html_url: 'https://x/p' }],
        expected: { items: [{ number: 3, title: 'pr', mergedAt: null }] },
      },
      {
        name: 'github_repo_contributors', args: { owner: 'a', repo: 'b' },
        fixture: [{ login: 'u', contributions: 5, avatar_url: null, html_url: 'https://x/u' }],
        expected: { items: [{ login: 'u', contributions: 5 }] },
      },
      {
        name: 'github_repo_subscribers', args: { owner: 'a', repo: 'b' },
        fixture: [{ login: 'w', name: null, avatar_url: null, html_url: 'https://x/w', type: 'User' }],
        expected: { items: [{ login: 'w', type: 'User' }] },
      },
      {
        name: 'github_user_repos', args: { username: 'z' },
        fixture: [{ full_name: 'z/r', description: 'd', stargazers_count: 1, language: 'TS', updated_at: null, html_url: 'https://x/r' }],
        expected: { source: '@z', items: [{ fullName: 'z/r', stars: 1 }] },
      },
    ]
    for (const c of cases) {
      const fetch = fetcherMock(() => c.fixture)
      const spec = catalog.find((s) => s.name === c.name)
      const tool = buildCatalogTool(fetch, spec!)
      const result = await tool.execute(c.args, exec())
      expect(result).toMatchObject(c.expected)
    }
  })
})
