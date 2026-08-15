#!/usr/bin/env node
/**
 * Real-network smoke for the 12 new v2.3.0 catalog tools.
 * Uses the public GitHub API (optionally authenticated via GH_TOKEN).
 */

import { buildCatalogTool, catalog } from '../lib/catalog.js'

const API_ROOT = 'https://api.github.com'
const token = process.env.GH_TOKEN

async function fetcher(path, signal) {
  const headers = {
    'User-Agent': 'dsh-github-intelligence/2.3.0-smoke',
    Accept: 'application/vnd.github+json',
  }
  if (token !== undefined && token !== '') headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API_ROOT}${path}`, { headers, signal })
  if (!response.ok) {
    throw new Error(`GET ${path} -> HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }
  return await response.json()
}

const cases = [
  ['github_user_repositories', { username: 'zoahdev' }],
  ['github_user_social_accounts', { username: 'zoahdev' }],
  ['github_repo_releases', { owner: 'deepseek-ai', repo: 'deepseek-harness' }],
  ['github_repo_issues', { owner: 'deepseek-ai', repo: 'deepseek-harness', state: 'open' }],
  ['github_repo_pulls', { owner: 'zoahdev', repo: 'dsh-plugin-doctor', state: 'open' }],
  ['github_repo_contributors', { owner: 'deepseek-ai', repo: 'deepseek-harness' }],
  ['github_repo_subscribers', { owner: 'zoahdev', repo: 'dsh-plugin-doctor' }],
  ['github_repo_collaborators', { owner: 'zoahdev', repo: 'dsh-plugin-doctor' }],
  ['github_repo_git_refs', { owner: 'deepseek-ai', repo: 'deepseek-harness', ref: 'heads/main' }],
  ['github_repo_punch_card', { owner: 'deepseek-ai', repo: 'deepseek-harness' }],
  ['github_repo_security_advisories', { owner: 'deepseek-ai', repo: 'deepseek-harness' }],
  ['github_search_repositories', { q: 'dsh' }],
]

let failed = 0
for (const [name, args] of cases) {
  const spec = catalog.find((s) => s.name === name)
  if (spec === undefined) throw new Error(`catalog missing ${name}`)
  try {
    const tool = buildCatalogTool(fetcher, spec)
    const result = await tool.execute(args, { signal: new AbortController().signal })
    const itemCount = Array.isArray(result.items) ? result.items.length : 'object'
    console.log(`PASS ${name}: ${itemCount} item(s)`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}: ${String(error instanceof Error ? error.message : error)}`)
  }
}
console.log(failed === 0 ? 'ALL V2.3.0 NETWORK SMOKE PASSED' : `${failed} TOOL(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
