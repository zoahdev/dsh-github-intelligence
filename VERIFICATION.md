# Verification Record

Date: 2026-08-15 · Environment: Windows, Node 24.19.0 (bundled runtime), pnpm 11.19.0, dsh CLI 0.1.0-rc.6

## 1. TypeScript build

```sh
pnpm run build
```

Result: `tsc -p tsconfig.json` exits 0, emits `lib/` with `index.js`, `github.js`, and type declarations.

## 2. Unit tests

```sh
pnpm test
```

Result: 3 test files, 27 tests, all passed. Coverage includes extended repo parsing, issue/PR filtering, contributors, commits, TTL caching, rate-limit/404 errors, registration of 140+ tools, the deep report, catalog completeness (unique names, 100+ tool floor), generated-tool execution (GitHub lists, npm search unwrapping, Hacker News item resolution, ecosystem stats), and input validation.

## 3. Package and install into a dsh profile

```sh
pnpm pack
dsh plugin --profile web add ./dsh-github-intelligence-1.0.0.tgz
```

Result: package added to the `web` profile; `dsh --profile web --dump-config` shows the `github-intelligence` layer after `@deepseek-ai/dsh-base`.

## 4. Boot the web app with the plugin loaded

```sh
dsh web --port 4111
```

Result: `dsh web: http://127.0.0.1:4111`; `GET /` returns HTTP 200. No plugin load errors. All seven tools register during `apply()`; a schema/registration failure would abort boot.
