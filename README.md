# dsh-github-intelligence

[English](#english) · [中文](#中文)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![CI](https://img.shields.io/github/actions/workflow/status/zoahdev/dsh-github-intelligence/ci.yml?branch=main)](https://github.com/zoahdev/dsh-github-intelligence/actions)
[![Release](https://img.shields.io/github/v/release/zoahdev/dsh-github-intelligence)](https://github.com/zoahdev/dsh-github-intelligence/releases)

**The most comprehensive developer-intelligence integration for DeepSeek Harness: 170+ read-only tools across 11 external ecosystems plus the dsh registry itself** — GitHub, GitLab, Gitee, npm, PyPI, crates.io, Docker Hub, Hugging Face, Hacker News, Stack Overflow, and Reddit. No API key required, rate-limit-friendly TTL caching, cancellation, and UI cards.

> Topic: [`dsh-plugin`](https://github.com/topics/dsh-plugin) · Tested with `dsh` 0.1.0-rc.6 · Node 24 / pnpm 11

## Tools

| Tool | What it does |
|---|---|
| `github_repo` | Full repo overview: stars, forks, issues, language, license, topics, default branch, archived status, activity dates |
| `github_releases` | Recent releases with tag, date, pre-release flag, URL, body preview |
| `github_issues` | Recent issues by state (open/closed/all) — pull requests excluded automatically |
| `github_pulls` | Recent pull requests by state, including merge status |
| `github_contributors` | Top contributors by commit count |
| `github_search` | Repository search sorted by stars or last update |
| `github_repo_report` | One-shot deep report: overview + latest release + open issues + recent commits + top contributors |
| `github_compare` | Side-by-side comparison of two repositories with numeric deltas |
| `github_trending` | Recently created repositories sorted by stars (optional language filter) |
| `github_user_repos` | A user's top repositories by stars |
| `github_help` | Catalog of all 140+ tools — call it when unsure which tool to use |

Beyond GitHub, the catalog also covers **GitLab, Gitee, npm, PyPI, crates.io, Docker Hub, Hugging Face, Hacker News, Stack Overflow, Reddit**, and the **dsh plugin ecosystem itself** (registry stats) — one install, one consistent tool style, one cache.

Example prompts:

- "Give me a full report on `deepseek-ai/deepseek-harness`."
- "What open issues does `ollama/ollama` have right now?"
- "Who are the top contributors of `openai/openai-python`?"
- "Find the top 5 TypeScript agent frameworks and compare their stars."

## Install

```sh
dsh plugin --profile web add github:zoahdev/dsh-github-intelligence
# or from tarball:
dsh plugin --profile web add ./dsh-github-intelligence-1.0.0.tgz
```

Then restart `dsh web` and ask your agent to use the tools above.

## Configuration

All values are optional and set in `cordis.yml`:

| Key | Type | Default | Description |
|---|---|---|---|
| `githubToken` | string | *(none)* | GitHub token to raise the anonymous 60 requests/hour limit. Never commit it. |
| `timeoutMs` | number | `10000` | Request timeout in milliseconds. |
| `defaultLimit` | number | `5` | Default result count when the model omits `limit`. |
| `bodyPreviewChars` | number | `500` | Maximum characters kept from a release body preview. |
| `cacheTtlMs` | number | `60000` | In-memory response cache TTL, so composed calls stay cheap. |
| `userAgent` | string | `dsh-github-intelligence/2.3.0` | User-Agent header sent to the GitHub API. |

## Why "most complete"

- **Breadth**: 170+ tools across 11 external developer ecosystems plus the dsh registry — not just one endpoint.
- **Depth**: `github_repo_report` composes repo facts into one canonical answer; `github_help` makes the catalog self-discoverable.
- **Rate-limit friendly**: every endpoint is wrapped in a short TTL cache; the deep report reuses cached sub-calls (4 HTTP requests, not 4+ per repetition).
- **Correctness**: issues are filtered to exclude pull requests; every request honors `exec.signal`; anonymous rate limits and 429s produce actionable errors.
- **Verified**: 35 tests, plus a real-network smoke for every v2.3.0 tool, CI that installs the bundle into `dsh web` and boots it (see [VERIFICATION.md](./VERIFICATION.md)).

> ⭐ If this helps your agent, a star helps the ecosystem find it. Feedback and issues are equally welcome.

## What's new in v2.3.0

- Plain list tools: `github_repo_releases`, `github_repo_issues` (pull requests filtered out), `github_repo_pulls`.
- People & social: `github_user_repos`, `github_user_social_accounts`, `github_repo_contributors`, `github_repo_subscribers`, `github_repo_collaborators` (with effective permission, requires push access).
- Git, security & search: `github_repo_git_refs` (matching refs), `github_repo_punch_card`, `github_repo_security_advisories`, `github_search_repositories`.

## Development

```sh
pnpm install
pnpm run build
pnpm test
pnpm pack
```

## Demo (real output, 2026-08-15)

`github_repo_report` on `deepseek-ai/deepseek-harness`:

```text
# deepseek-ai/deepseek-harness
deepseek-ai/deepseek-harness — DeepSeek Harness: Everything is a Plugin.
Stars: 98472 · Forks: 9214 · Open issues: 0 · Default branch: master
Language: TypeScript · License: MIT · Pushed: 2026-08-13
https://github.com/deepseek-ai/deepseek-harness

Latest release: none
Open issues: 0

Recent commits:
- 47f9438 Merge pull request #2519 from deepseek-harness/feat/npm-public (imccyu)
- abe560f release(dsh): 0.1.0-rc.5 (imccyu)
- 8c1e8d9 build(release): publish the dsh family publicly (imccyu)
- f26a6f6 Merge pull request #2520 from deepseek-harness/docs/paper (Tianyi Cui)
- 124aa5f Merge pull request #2521 from deepseek-harness/release/dsh-0.1.0-rc.3 (imccyu)

Top contributors: 1. tianyicui (5235) · 2. LegGasai (1361) · 3. imccyu (1168) · 4. Chinesezjc (587) · 5. turtle1999 (585)
```

One question answers: what is this repo, what did it ship, who maintains it, and is it alive.

## License

MIT © 2026 zoahdev

---

## 中文

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![CI](https://img.shields.io/github/actions/workflow/status/zoahdev/dsh-github-intelligence/ci.yml?branch=main)](https://github.com/zoahdev/dsh-github-intelligence/actions)
[![Release](https://img.shields.io/github/v/release/zoahdev/dsh-github-intelligence)](https://github.com/zoahdev/dsh-github-intelligence/releases)

**dsh-github-intelligence —— DeepSeek Harness 上最全面的开发者情报整合：170+ 只读工具，横跨 11 大外部生态 + dsh 注册表**（GitHub、GitLab、Gitee、npm、PyPI、crates.io、Docker Hub、Hugging Face、Hacker News、Stack Overflow、Reddit）。无需 API Key，内置 60 秒缓存，支持取消与 UI 卡片。

> 话题：[`dsh-plugin`](https://github.com/topics/dsh-plugin) · 已在 `dsh` 0.1.0-rc.6 / Node 24 / pnpm 11 实测

## 工具

| 工具 | 功能 |
|---|---|
| `github_repo` | 仓库全景：星标、fork、issues、语言、许可证、话题、默认分支、归档状态、活跃时间 |
| `github_releases` | 最近 Release（tag、日期、预发布、链接、正文预览） |
| `github_issues` | 按状态查 Issue（open/closed/all），自动排除 PR |
| `github_pulls` | 按状态查 PR，含合并状态 |
| `github_contributors` | 按提交数排名的贡献者 |
| `github_search` | 按星标/更新时间搜索仓库 |
| `github_repo_report` | 深度报告：概览 + 最新 Release + open issues + 最近提交 + 头部贡献者 |
| `github_compare` | 两个仓库并排对比（含数值差量） |
| `github_trending` | 近期新建仓库按星标排序（可按语言过滤） |
| `github_user_repos` | 某用户星标最高的仓库 |
| `github_help` | 全部 140+ 工具目录，不确定时先问它 |

GitHub 之外，目录还覆盖 **GitLab、Gitee、npm、PyPI、crates.io、Docker Hub、Hugging Face、Hacker News、Stack Overflow、Reddit** 以及 **dsh 插件生态自身**（注册表统计）——一次安装，统一风格，统一缓存。

示例提问：

- "给我一份 deepseek-ai/deepseek-harness 的完整报告"
- "ollama/ollama 现在有哪些 open issue？"
- "openai/openai-python 的头部贡献者是谁？"
- "找 5 个 TypeScript agent 框架并按星标对比"

## 安装

```sh
dsh plugin --profile web add github:zoahdev/dsh-github-intelligence
dsh plugin --profile web add ./dsh-github-intelligence-1.0.0.tgz
```

## 为什么说"最完整"

- **覆盖面**：170+ 工具、11 大外部生态 + dsh 注册表，不是单点工具；
- **深度**：`github_repo_report` 一次回答"这个仓库到底怎么样"；`github_help` 让目录自发现；
- **省配额**：所有接口带短 TTL 缓存，深度报告复用缓存子调用，一次只发 4 个请求；
- **正确性**：Issue 自动排除 PR、全部请求支持取消、匿名限流/429 有明确提示；
- **验证**：35 个测试 + v2.3.0 全部新工具真实网络冒烟 + CI 真实安装进 `dsh web` 并启动（见 [VERIFICATION.md](./VERIFICATION.md)）。

> ⭐ 如果它帮到了你的 agent，一个 star 就能让整个生态更容易发现它。反馈和 issue 同样欢迎。

## v2.3.0 新增

- 平铺列表工具：`github_repo_releases`、`github_repo_issues`（自动排除 PR）、`github_repo_pulls`；
- 人与社交：`github_user_repos`、`github_user_social_accounts`、`github_repo_contributors`、`github_repo_subscribers`、`github_repo_collaborators`（含实际权限，需 push 权限 token）；
- Git、安全与搜索：`github_repo_git_refs`（ref 前缀匹配）、`github_repo_punch_card`、`github_repo_security_advisories`、`github_search_repositories`。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
pnpm pack
```

## 演示（真实输出，2026-08-15）

`github_repo_report` 对 `deepseek-ai/deepseek-harness` 的实际结果：

```text
# deepseek-ai/deepseek-harness
deepseek-ai/deepseek-harness — DeepSeek Harness: Everything is a Plugin.
Stars: 98472 · Forks: 9214 · Open issues: 0 · Default branch: master
Language: TypeScript · License: MIT · Pushed: 2026-08-13
https://github.com/deepseek-ai/deepseek-harness

Latest release: none
Open issues: 0

Recent commits:
- 47f9438 Merge pull request #2519 from deepseek-harness/feat/npm-public (imccyu)
- abe560f release(dsh): 0.1.0-rc.5 (imccyu)
- 8c1e8d9 build(release): publish the dsh family publicly (imccyu)
- f26a6f6 Merge pull request #2520 from deepseek-harness/docs/paper (Tianyi Cui)
- 124aa5f Merge pull request #2521 from deepseek-harness/release/dsh-0.1.0-rc.3 (imccyu)

Top contributors: 1. tianyicui (5235) · 2. LegGasai (1361) · 3. imccyu (1168) · 4. Chinesezjc (587) · 5. turtle1999 (585)
```

一次提问回答三件事：这仓库是什么、最近发了什么、谁在维护、还活着吗。

## 许可证

MIT © 2026 zoahdev
