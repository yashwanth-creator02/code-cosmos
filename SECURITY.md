# Security Policy

## Supported Versions

| Version | Supported              |
| ------- | ---------------------- |
| 0.3.x   | ✅ Active              |
| 0.2.x   | ⚠️ Critical fixes only |
| 0.1.x   | ❌ No longer supported |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a security issue in Code Cosmos, report it privately:

1. Go to the [Security tab](https://github.com/yashwanth-creator02/code-cosmos/security/advisories/new) on GitHub and open a private advisory, or
2. Email directly with the subject line `[SECURITY] Code Cosmos — <brief description>`

Include:

- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fix if you have one

You will receive a response within 48 hours acknowledging receipt. We aim to release a fix within 14 days for confirmed issues.

## Scope

Code Cosmos is a VS Code extension that runs locally. It:

- Reads files from your workspace (via VS Code APIs, not raw filesystem)
- Reads git history via the VS Code git extension API
- Writes two files to your workspace root: `.cosmos` and `.cosmos.cache`
- Makes no network requests

Issues relevant to this scope:

- **In scope:** Malicious `.cosmosignore` or `.cosmos` files causing unexpected behaviour, path traversal issues in the file walker, WebView Content Security Policy bypasses, unsafe handling of file content during AST parsing
- **Out of scope:** Issues in VS Code itself, issues in Three.js or other dependencies (report those upstream), issues requiring physical access to the machine

## Dependency Security

Dependencies are pinned in `package-lock.json`. Run `npm audit` to check for known vulnerabilities in the current dependency tree. The extension uses a strict Content Security Policy in the WebView (`default-src 'none'`) which prevents script injection from external sources.
