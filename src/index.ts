/**
 * dsh-github-intelligence — the most complete GitHub integration for
 * DeepSeek Harness.
 *
 * Seven model-facing tools over the public GitHub REST API: repo overview,
 * releases, issues, pull requests, contributors, repository search, and a
 * composite deep repo report. Optional token, cancellation, and a short TTL
 * cache keep the anonymous rate budget usable.
 * @module dsh-github-intelligence
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  GitHubClient,
  type GitHubClientOptions,
  type GitHubCommit,
  type GitHubContributor,
  type GitHubIssue,
  type GitHubPull,
  type GitHubRelease,
  type GitHubRepo,
  type GitHubRepoHit,
} from './github.js'
import { buildCatalogTool, buildHelpTool, catalog, type Fetcher } from './catalog.js'
import { EcosystemClient } from './ecosystems.js'

export const name = 'github-intelligence'

/** Services required by this plugin. */
export const inject = ['tools']

/** Plugin configuration supplied through cordis.yml. */
export interface Config {
  /** Optional GitHub token; raises the anonymous 60 requests/hour limit. */
  githubToken?: string
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number
  /** Default result count when the model omits `limit`. Defaults to 5. */
  defaultLimit?: number
  /** Maximum characters kept from a release body preview. Defaults to 500. */
  bodyPreviewChars?: number
  /** Response cache TTL in milliseconds. Defaults to 60000. */
  cacheTtlMs?: number
  /** User-Agent header sent to the GitHub API. */
  userAgent?: string
}

/** Schemastery schema with defaults for every configurable value. */
export const Config: Schema<Config> = Schema.object({
  githubToken: Schema.string(),
  timeoutMs: Schema.number().default(10_000),
  defaultLimit: Schema.number().default(5),
  bodyPreviewChars: Schema.number().default(500),
  cacheTtlMs: Schema.number().default(60_000),
  userAgent: Schema.string().default('dsh-github-intelligence/2.1.0'),
})

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`github-intelligence: ${name} must be a positive integer (got ${value})`)
  }
}

function assertOwnerRepo(owner: string, repo: string): void {
  if (owner.trim() === '' || repo.trim() === '') {
    throw new Error('github-intelligence: `owner` and `repo` must be non-empty strings')
  }
}

function clampLimit(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), 50)
}

function clientOptions(config: Config): GitHubClientOptions {
  const options: GitHubClientOptions = {
    userAgent: config.userAgent ?? 'dsh-github-intelligence/2.1.0',
    timeoutMs: config.timeoutMs ?? 10_000,
    bodyPreviewChars: config.bodyPreviewChars ?? 500,
    cacheTtlMs: config.cacheTtlMs ?? 60_000,
  }
  if (config.githubToken !== undefined && config.githubToken !== '') options.token = config.githubToken
  return options
}

function renderRepo(repo: GitHubRepo): string {
  const topics = repo.topics.length > 0 ? ` · Topics: ${repo.topics.slice(0, 8).join(', ')}` : ''
  const archived = repo.archived ? ' · ARCHIVED' : ''
  return [
    `${repo.fullName} — ${repo.description ?? 'no description'}${archived}`,
    `Stars: ${repo.stars} · Forks: ${repo.forks} · Open issues: ${repo.openIssues} · Default branch: ${repo.defaultBranch ?? 'n/a'}`,
    `Language: ${repo.language ?? 'n/a'} · License: ${repo.license ?? 'n/a'}`,
    `Created: ${repo.createdAt?.slice(0, 10) ?? 'n/a'} · Updated: ${repo.updatedAt?.slice(0, 10) ?? 'n/a'} · Pushed: ${repo.pushedAt?.slice(0, 10) ?? 'n/a'}${topics}`,
    repo.homepage ?? '',
    repo.htmlUrl,
  ].filter((line) => line !== '').join('\n')
}

function renderReleases(value: { fullName: string; releases: GitHubRelease[] }): string {
  if (value.releases.length === 0) return `No releases found for ${value.fullName}.`
  return `Recent releases for ${value.fullName}:\n` + value.releases.map((release) => {
    const date = release.publishedAt !== null ? release.publishedAt.slice(0, 10) : 'unknown date'
    const flag = release.prerelease ? ' [prerelease]' : ''
    return `- ${release.tagName} (${date})${flag} ${release.htmlUrl}`
  }).join('\n')
}

function renderSearch(value: { query: string; items: GitHubRepoHit[] }): string {
  if (value.items.length === 0) return `No repositories matched "${value.query}".`
  return `Top results for "${value.query}":\n` + value.items.map((item, index) => {
    return `${index + 1}. ${item.fullName} (★${item.stars}) — ${item.description ?? 'no description'} ${item.htmlUrl}`
  }).join('\n')
}

function renderTrending(value: { period: string; language: string | null; items: GitHubRepoHit[] }): string {
  if (value.items.length === 0) return `No trending repositories found for the last ${value.period}.`
  const filter = value.language !== null ? ` (language: ${value.language})` : ''
  return `Trending repositories created in the last ${value.period}${filter}:\n` + value.items.map((item, index) => {
    return `${index + 1}. ${item.fullName} (★${item.stars}, ${item.language ?? 'n/a'}) — ${item.description ?? 'no description'} ${item.htmlUrl}`
  }).join('\n')
}

function renderUserRepos(value: { username: string; repos: GitHubRepoHit[] }): string {
  if (value.repos.length === 0) return `No repositories found for ${value.username}.`
  return `Top repositories of ${value.username}:\n` + value.repos.map((item, index) => {
    return `${index + 1}. ${item.fullName} (★${item.stars}) — ${item.description ?? 'no description'} ${item.htmlUrl}`
  }).join('\n')
}

function renderCompare(value: {
  first: { fullName: string; stars: number; forks: number; openIssues: number; language: string | null; license: string | null; pushedAt: string | null }
  second: { fullName: string; stars: number; forks: number; openIssues: number; language: string | null; license: string | null; pushedAt: string | null }
  deltas: { stars: number; forks: number; openIssues: number }
}): string {
  return [
    `Comparing ${value.first.fullName} vs ${value.second.fullName}:`,
    `Stars: ${value.first.stars} vs ${value.second.stars} (${value.deltas.stars >= 0 ? '+' : ''}${value.deltas.stars})`,
    `Forks: ${value.first.forks} vs ${value.second.forks} (${value.deltas.forks >= 0 ? '+' : ''}${value.deltas.forks})`,
    `Open issues: ${value.first.openIssues} vs ${value.second.openIssues} (${value.deltas.openIssues >= 0 ? '+' : ''}${value.deltas.openIssues})`,
    `Language: ${value.first.language ?? 'n/a'} vs ${value.second.language ?? 'n/a'}`,
    `License: ${value.first.license ?? 'n/a'} vs ${value.second.license ?? 'n/a'}`,
    `Last push: ${value.first.pushedAt?.slice(0, 10) ?? 'n/a'} vs ${value.second.pushedAt?.slice(0, 10) ?? 'n/a'}`,
  ].join('\n')
}

function renderIssues(value: { fullName: string; state: string; issues: GitHubIssue[] }): string {
  if (value.issues.length === 0) return `No ${value.state} issues for ${value.fullName}.`
  return `${value.state === 'open' ? 'Open' : 'Closed'} issues for ${value.fullName}:\n` + value.issues.map((issue) => {
    return `- #${issue.number} ${issue.title} (@${issue.user}, ${issue.comments} comments) ${issue.htmlUrl}`
  }).join('\n')
}

function renderPulls(value: { fullName: string; state: string; pulls: GitHubPull[] }): string {
  if (value.pulls.length === 0) return `No ${value.state} pull requests for ${value.fullName}.`
  return `${value.state === 'open' ? 'Open' : 'Closed'} pull requests for ${value.fullName}:\n` + value.pulls.map((pull) => {
    const merged = pull.mergedAt !== null ? ' [merged]' : ''
    return `- #${pull.number} ${pull.title} (@${pull.user})${merged} ${pull.htmlUrl}`
  }).join('\n')
}

function renderContributors(value: { fullName: string; contributors: GitHubContributor[] }): string {
  if (value.contributors.length === 0) return `No contributor data for ${value.fullName}.`
  return `Top contributors of ${value.fullName}:\n` + value.contributors.map((contributor, index) => {
    return `${index + 1}. ${contributor.login} — ${contributor.contributions} contributions`
  }).join('\n')
}

function renderReport(value: {
  fullName: string
  overview: Pick<GitHubRepo, 'fullName' | 'description' | 'stars' | 'forks' | 'openIssues' | 'language' | 'license' | 'htmlUrl'>
  latestRelease: Pick<GitHubRelease, 'tagName' | 'publishedAt' | 'htmlUrl'> | null
  openIssues: number
  recentCommits: GitHubCommit[]
  topContributors: Pick<GitHubContributor, 'login' | 'contributions'>[]
}): string {
  const release = value.latestRelease
    ? `${value.latestRelease.tagName} (${value.latestRelease.publishedAt?.slice(0, 10) ?? 'unknown date'})`
    : 'none'
  const commits = value.recentCommits.slice(0, 5).map((commit) => {
    return `- ${commit.sha.slice(0, 7)} ${commit.message} (${commit.author ?? 'unknown'})`
  }).join('\n')
  const contributors = value.topContributors.slice(0, 5).map((contributor, index) => {
    return `${index + 1}. ${contributor.login} (${contributor.contributions})`
  }).join(' · ')
  return [
    `# ${value.fullName}`,
    `${value.overview.fullName} — ${value.overview.description ?? 'no description'}`,
    `Stars: ${value.overview.stars} · Forks: ${value.overview.forks} · Open issues: ${value.overview.openIssues}`,
    `Language: ${value.overview.language ?? 'n/a'} · License: ${value.overview.license ?? 'n/a'}`,
    value.overview.htmlUrl,
    '',
    `Latest release: ${release}`,
    `Open issues: ${value.openIssues}`,
    '',
    'Recent commits:',
    commits || '- none',
    '',
    `Top contributors: ${contributors || 'n/a'}`,
  ].join('\n')
}

/**
 * Build the seven tool definitions for a configured client.
 * Exported separately so tests can exercise the definitions without a Context.
 */
export function defineTools(config: Config) {
  const client = new GitHubClient(clientOptions(config))

  const repo = defineTool({
    name: 'github_repo',
    description:
      'Get the current overview of a public GitHub repository: stars, forks, open issues, language, '
      + 'license, topics, default branch, archived status, and activity dates. Use it to evaluate '
      + 'a project or answer questions about repository health.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          homepage: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          stars: { type: 'integer', required: true },
          forks: { type: 'integer', required: true },
          openIssues: { type: 'integer', required: true },
          language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          license: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          topics: { type: 'array', required: true, items: { type: 'string' } },
          defaultBranch: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          archived: { type: 'boolean', required: true },
          createdAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          pushedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          htmlUrl: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderRepo(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      return await client.getRepo(args.owner, args.repo, exec.signal)
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub repo: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const releases = defineTool({
    name: 'github_releases',
    description:
      'List the most recent releases of a public GitHub repository. Use it for release notes, '
      + 'version checks, upgrade planning, and dependency updates.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
      limit: { type: 'number', description: 'How many releases to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          releases: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tagName: { type: 'string', required: true },
                name: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                publishedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                prerelease: { type: 'boolean', required: true },
                htmlUrl: { type: 'string', required: true },
                bodyPreview: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderReleases(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const releasesList = await client.listReleases(args.owner, args.repo, clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { fullName: `${args.owner}/${args.repo}`, releases: releasesList }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub releases: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const search = defineTool({
    name: 'github_search',
    description:
      'Search public GitHub repositories with GitHub search syntax (for example `agent framework language:typescript`). '
      + 'Returns repositories sorted by stars or last update.',
    parameters: {
      query: { type: 'string', required: true, description: 'GitHub search query, e.g. `deepseek harness`.' },
      limit: { type: 'number', description: 'How many results to return (1-50). Defaults to the configured defaultLimit (5).' },
      sort: { type: 'string', enum: ['stars', 'updated'], description: 'Sort criterion; defaults to stars.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fullName: { type: 'string', required: true },
                description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                stars: { type: 'integer', required: true },
                language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
    },
    async execute(args, exec) {
      if (args.query.trim() === '') throw new Error('github-intelligence: `query` must be a non-empty string')
      const items = await client.searchRepos(args.query, clampLimit(args.limit ?? config.defaultLimit ?? 5), args.sort ?? 'stars', exec.signal)
      return { query: args.query, items }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub search: ${args.query}`, kind: 'search', rawInput: args }),
  })

  const issues = defineTool({
    name: 'github_issues',
    description:
      'List recent issues of a public GitHub repository, filtered by state (open, closed, or all). '
      + 'Pull requests are excluded automatically. Use it for triage, bug research, and project health.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state; defaults to open.' },
      limit: { type: 'number', description: 'How many issues to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          state: { type: 'string', required: true },
          issues: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                title: { type: 'string', required: true },
                state: { type: 'string', enum: ['open', 'closed'], required: true },
                user: { type: 'string', required: true },
                comments: { type: 'integer', required: true },
                createdAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderIssues(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const state = args.state ?? 'open'
      const list = await client.listIssues(args.owner, args.repo, state, clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { fullName: `${args.owner}/${args.repo}`, state, issues: list }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub issues: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const pulls = defineTool({
    name: 'github_pulls',
    description:
      'List recent pull requests of a public GitHub repository, filtered by state (open, closed, or all). '
      + 'Use it to monitor contributions, review queues, and merge activity.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Pull request state; defaults to open.' },
      limit: { type: 'number', description: 'How many pull requests to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          state: { type: 'string', required: true },
          pulls: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                title: { type: 'string', required: true },
                state: { type: 'string', enum: ['open', 'closed'], required: true },
                user: { type: 'string', required: true },
                createdAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                mergedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPulls(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const state = args.state ?? 'open'
      const list = await client.listPulls(args.owner, args.repo, state, clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { fullName: `${args.owner}/${args.repo}`, state, pulls: list }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub pulls: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const contributors = defineTool({
    name: 'github_contributors',
    description:
      'List the top contributors of a public GitHub repository by commit count. '
      + 'Use it to identify maintainers, assess community activity, or find who to credit.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
      limit: { type: 'number', description: 'How many contributors to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          contributors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                login: { type: 'string', required: true },
                contributions: { type: 'integer', required: true },
                avatarUrl: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderContributors(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const list = await client.listContributors(args.owner, args.repo, clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { fullName: `${args.owner}/${args.repo}`, contributors: list }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub contributors: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const report = defineTool({
    name: 'github_repo_report',
    description:
      'Produce a deep one-shot report about a public GitHub repository: overview, latest release, '
      + 'open issue count, recent commits, and top contributors. Use it when the user asks for a '
      + 'quick but complete picture of a project. Cached sub-calls keep the rate budget low.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          overview: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              fullName: { type: 'string', required: true },
              description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              stars: { type: 'integer', required: true },
              forks: { type: 'integer', required: true },
              openIssues: { type: 'integer', required: true },
              language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              license: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              htmlUrl: { type: 'string', required: true },
            },
          },
          latestRelease: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  tagName: { type: 'string', required: true },
                  publishedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                  htmlUrl: { type: 'string', required: true },
                },
              },
              { type: 'null' },
            ],
            required: true,
          },
          openIssues: { type: 'integer', required: true },
          recentCommits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sha: { type: 'string', required: true },
                message: { type: 'string', required: true },
                author: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                date: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
          topContributors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                login: { type: 'string', required: true },
                contributions: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const limit = config.defaultLimit ?? 5
      const overview = await client.getRepo(args.owner, args.repo, exec.signal)
      const [releaseList, commits, contributorsList] = await Promise.all([
        client.listReleases(args.owner, args.repo, 1, exec.signal),
        client.recentCommits(args.owner, args.repo, 5, exec.signal),
        client.listContributors(args.owner, args.repo, limit, exec.signal),
      ])
      const latestRelease = releaseList[0] ?? null
      return {
        fullName: `${args.owner}/${args.repo}`,
        overview: {
          fullName: overview.fullName,
          description: overview.description,
          stars: overview.stars,
          forks: overview.forks,
          openIssues: overview.openIssues,
          language: overview.language,
          license: overview.license,
          htmlUrl: overview.htmlUrl,
        },
        latestRelease: latestRelease === null ? null : {
          tagName: latestRelease.tagName,
          publishedAt: latestRelease.publishedAt,
          htmlUrl: latestRelease.htmlUrl,
        },
        openIssues: overview.openIssues,
        recentCommits: commits,
        topContributors: contributorsList.map((contributor) => ({
          login: contributor.login,
          contributions: contributor.contributions,
        })),
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub report: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const compare = defineTool({
    name: 'github_compare',
    description:
      'Compare two public GitHub repositories side by side: stars, forks, open issues, language, '
      + 'license, and last push time, with numeric deltas. Use it for "which project is healthier" '
      + 'questions and framework bake-offs. Sub-calls reuse the cache.',
    parameters: {
      ownerA: { type: 'string', required: true, description: 'Owner of the first repository.' },
      repoA: { type: 'string', required: true, description: 'Name of the first repository.' },
      ownerB: { type: 'string', required: true, description: 'Owner of the second repository.' },
      repoB: { type: 'string', required: true, description: 'Name of the second repository.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          first: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              fullName: { type: 'string', required: true },
              stars: { type: 'integer', required: true },
              forks: { type: 'integer', required: true },
              openIssues: { type: 'integer', required: true },
              language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              license: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              pushedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            },
          },
          second: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              fullName: { type: 'string', required: true },
              stars: { type: 'integer', required: true },
              forks: { type: 'integer', required: true },
              openIssues: { type: 'integer', required: true },
              language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              license: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              pushedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            },
          },
          deltas: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              stars: { type: 'integer', required: true },
              forks: { type: 'integer', required: true },
              openIssues: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderCompare(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.ownerA, args.repoA)
      assertOwnerRepo(args.ownerB, args.repoB)
      const [first, second] = await Promise.all([
        client.getRepo(args.ownerA, args.repoA, exec.signal),
        client.getRepo(args.ownerB, args.repoB, exec.signal),
      ])
      return {
        first: {
          fullName: first.fullName,
          stars: first.stars,
          forks: first.forks,
          openIssues: first.openIssues,
          language: first.language,
          license: first.license,
          pushedAt: first.pushedAt,
        },
        second: {
          fullName: second.fullName,
          stars: second.stars,
          forks: second.forks,
          openIssues: second.openIssues,
          language: second.language,
          license: second.license,
          pushedAt: second.pushedAt,
        },
        deltas: {
          stars: first.stars - second.stars,
          forks: first.forks - second.forks,
          openIssues: first.openIssues - second.openIssues,
        },
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `GitHub compare: ${args.ownerA}/${args.repoA} vs ${args.ownerB}/${args.repoB}`,
      kind: 'search',
      rawInput: args,
    }),
  })

  const trending = defineTool({
    name: 'github_trending',
    description:
      'Find recently trending public repositories: repositories created within the last few days, '
      + 'sorted by stars. Optionally filter by language. Use it for "what is hot right now" questions.',
    parameters: {
      limit: { type: 'number', description: 'How many repositories to return (1-50). Defaults to the configured defaultLimit (5).' },
      language: { type: 'string', description: 'Optional language filter, e.g. TypeScript.' },
      sinceDays: { type: 'number', description: 'Look back window in days (1-30). Defaults to 7.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          period: { type: 'string', required: true },
          language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fullName: { type: 'string', required: true },
                description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                stars: { type: 'integer', required: true },
                language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderTrending(value) }],
    },
    async execute(args, exec) {
      const days = Math.min(Math.max(Math.trunc(args.sinceDays ?? 7), 1), 30)
      const language = args.language !== undefined && args.language.trim() !== '' ? args.language.trim() : null
      const items = await client.trending(clampLimit(args.limit ?? config.defaultLimit ?? 5), language ?? undefined, days, exec.signal)
      return { period: `${days} days`, language, items }
    },
    presentCall: (args) => ({ card: 'generic', title: 'GitHub trending', kind: 'search', rawInput: args }),
  })

  const userRepos = defineTool({
    name: 'github_user_repos',
    description:
      'List the top repositories of a GitHub user or organization, sorted by stars, excluding forks. '
      + 'Use it to explore a developer\'s portfolio or an organization\'s most important projects.',
    parameters: {
      username: { type: 'string', required: true, description: 'GitHub username or organization, e.g. deepseek-ai.' },
      limit: { type: 'number', description: 'How many repositories to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          username: { type: 'string', required: true },
          repos: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fullName: { type: 'string', required: true },
                description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                stars: { type: 'integer', required: true },
                language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderUserRepos(value) }],
    },
    async execute(args, exec) {
      if (args.username.trim() === '') throw new Error('github-intelligence: `username` must be a non-empty string')
      const repos = await client.listUserRepos(args.username.trim(), clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { username: args.username.trim(), repos }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub repos: ${args.username}`, kind: 'search', rawInput: args }),
  })

  return [repo, releases, search, issues, pulls, contributors, report, compare, trending, userRepos] as const
}

/**
 * Register all plugin tools on the tool registry.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertPositiveInteger('timeoutMs', config.timeoutMs ?? 10_000)
  assertPositiveInteger('defaultLimit', config.defaultLimit ?? 5)
  assertPositiveInteger('bodyPreviewChars', config.bodyPreviewChars ?? 500)
  assertPositiveInteger('cacheTtlMs', config.cacheTtlMs ?? 60_000)
  for (const tool of defineTools(config)) {
    ctx.tools.register(tool)
  }
  const githubClient = new GitHubClient(clientOptions(config))
  const options = clientOptions(config)
  const ecosystemClient = new EcosystemClient({
    userAgent: options.userAgent,
    timeoutMs: options.timeoutMs,
    cacheTtlMs: options.cacheTtlMs,
  })
  const githubFetcher: Fetcher = (path, signal, cacheKey) => githubClient.raw(path, signal, cacheKey)
  for (const spec of catalog) {
    const fetcher: Fetcher = spec.baseUrl !== undefined
      ? (path, signal, cacheKey) => ecosystemClient.raw(`${spec.baseUrl}${path}`, signal, cacheKey)
      : githubFetcher
    ctx.tools.register(buildCatalogTool(fetcher, spec))
  }
  ctx.tools.register(buildHelpTool(catalog.length + 10))
}
