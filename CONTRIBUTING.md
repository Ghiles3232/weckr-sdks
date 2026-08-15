# Contributing to Weckr

Thanks for wanting to help. This repo holds the Weckr SDKs (TypeScript and Python), the MCP server, and the Claude Skills.

## How to contribute

1. **Bugs and feature requests**: open a [GitHub issue](https://github.com/Ghiles3232/weckr-sdks/issues). For questions, use [Discussions](https://github.com/Ghiles3232/weckr-sdks/discussions).
2. **Code changes**: fork the repo, create a branch, and open a **pull request** against `main`. Small, focused PRs are reviewed fastest. The maintainer reviews every PR; discussion happens on the PR itself.
3. **Security issues**: do NOT open a public issue. See [SECURITY.md](./SECURITY.md).

## Requirements for acceptable contributions

- **TypeScript SDK** (`typescript/`): `npm run typecheck` and `npm run test` must pass. Match the existing code style; no new runtime dependencies without prior discussion in an issue.
- **Python SDK** (`python/`): keep the SDK dependency free (it uses only the standard library at runtime). Tests must pass.
- **Both SDKs stay wire compatible**: a change to what one SDK sends must be mirrored in the other, and in the shared behavior described in each package README.
- **Pricing tables** (`typescript/src/pricing.ts`, `python/weckr/pricing.py`, `skills/*/`): keep all copies in sync, cite the provider pricing page and verification date in the comment. A weekly watcher diffs these against published rates, so undocumented edits will be flagged.
- **Privacy invariant**: the SDKs must never transmit prompt or completion text, only metadata (model, token counts, latency, user id, feature, plan). PRs that break this invariant will not be merged.
- **No dashes in user facing copy**, and keep English for code, comments, and docs.

## Commit messages

Short imperative summary, lowercase type prefix when it fits (`fix:`, `docs:`, `pricing:`, `skills:`).

## Release process

Releases are made by the maintainer: version bump in `typescript/package.json` and `python/pyproject.toml` (+ `__init__.py`), tests green, then publish to npm and PyPI. Release notes land in the changelog at https://useweckr.com/changelog.
