# Security Policy

## Reporting a vulnerability

If you find a security issue in this project, report it **privately**:

1. Open this repository on GitHub → **Security** → **Report a vulnerability**
   (private vulnerability reporting), or
2. Open a **draft security advisory** with details.

Please include:

- Affected version(s)
- Minimal, reproducible steps (a script or PoC is ideal)
- Impact (what an attacker gains, who is affected)
- Suggested fix, if you have one

We aim to respond within 7 days and to publish a fix + advisory with credit
to the reporter.

## Scope and expectations

- Community-maintained project; there is **no bug bounty**.
- Reports are handled on a best-effort basis; valid reports receive credit in
  the published advisory.
- For dsh-poison-guard specifically: it is a **review aid, not a security
  boundary** — see the README threat model before relying on it.
- The real boundary for untrusted code is the harness sandbox
  (`workspace-write`, never `danger-full-access`).