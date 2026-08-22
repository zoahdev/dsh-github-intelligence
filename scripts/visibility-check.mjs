#!/usr/bin/env node
/**
 * Real-registry agent-visibility check.
 *
 * Mounts the REAL Cordis context + REAL dsh-tools ToolRuntime + a real scoped
 * agent context, applies the plugin through the real registration path, and
 * asserts representative tools (flagship, composite, catalog, help) are
 * visible in the agent's registry view. Catches the dual-instance shadowing
 * class (discussions #1697/#1782).
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { apply, name } from '../lib/index.js'

const ctx = new Context()
await ctx.plugin(SystemPrompt, { persona: '' })
await ctx.plugin(ToolRuntime)

apply(ctx, {
  githubToken: undefined,
  timeoutMs: 5_000,
  defaultLimit: 5,
  bodyPreviewChars: 200,
  cacheTtlMs: 60_000,
  userAgent: 'visibility-check',
})

const agent = createScope(ctx, 'agent-visibility')
const schemas = ctx.tools.schemas(scopeOf(agent.ctx))
const names = new Set(schemas.map((schema) => schema.name))
const required = ['github_repo_report', 'github_weekly_digest', 'github_notifications', 'github_repo_health', 'github_repo_languages', 'github_help']
const missing = required.filter((tool) => !names.has(tool))
if (missing.length > 0) {
  throw new Error(`plugin ${name}: tools invisible to a real agent scope: ${missing.join(', ')}`)
}
console.log(`PASS [visibility] plugin ${name}: ${required.length} representative tools visible to a real agent scope (${names.size} tools total)`)
