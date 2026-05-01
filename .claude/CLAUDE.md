# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`zantarix/actions` is a monorepo of independent GitHub Actions (see `docs/adr/002-actions-monorepo-layout.md`). Each action lives in its own subdirectory with its own `package.json` and vendored `node_modules/`. The root `package.json` is for dev tooling only and is **not** an npm workspace — the two projects are independent. It is also the single package tracked by cursus for release management (see `docs/adr/003-cursus-release-management.md`); `setup-cursus/package.json`'s `version` field is decorative and held at `0.0.0`.

### setup-cursus

`setup-cursus` is a GitHub Action (Node 24) that installs a verified version of the [cursus](https://github.com/zantarix/cursus) release-management CLI onto a GitHub Actions runner. It downloads the appropriate binary for the runner platform, verifies its Sigstore attestation via `gh attestation verify`, caches it in `RUNNER_TOOL_CACHE`, and adds it to `PATH`.

## Development Commands

```sh
# Run all tests (from repo root)
npm test

# Run a single test file
cd setup-cursus && node --test tests/platform.test.js
```

There is no build step. The action runs directly from source (`setup-cursus/main.js` + `setup-cursus/src/`).

## Architecture

The action entry point is `setup-cursus/main.js`, which orchestrates these steps in order: resolve version → detect platform → check tool cache → download artifact → verify attestation → install. Each step is a module in `setup-cursus/src/`:

- `version.js` — reads `INPUT_VERSION` or `INPUT_VERSION_FILE`; the two inputs are mutually exclusive
- `platform.js` — maps `RUNNER_OS` × `RUNNER_ARCH` to artifact filenames
- `parsers/cargo-toml.js` — resolves cursus version from `[package.metadata.bin.cursus]`, `[workspace.metadata.bin.cursus]`, or `[dependencies.cursus]`
- `parsers/package-json.js` — resolves from `@zantarix/cursus` in any dependency field
- `download.js` — fetches the artifact from GitHub Releases using the `fetch()` API
- `verify.js` — invokes `gh attestation verify` (mandatory; never skipped, even on cache hits)
- `install.js` — sets the executable bit (Unix) and appends the bin dir to `GITHUB_PATH`

## Key Constraints

- **No TypeScript, no bundler, no build step.** Plain ESM JavaScript targeting Node 24.
- **`smol-toml` is the only dependency** and is vendored in `setup-cursus/node_modules/` (not `.gitignore`d). Do not add new dependencies.
- **Attestation verification is mandatory** and must never be bypassed, even on cache hits.
- **No `@actions/*` packages.** GitHub Actions integration is done directly via `process.env`, filesystem APIs, and `GITHUB_PATH`.
- **Root `package.json` must not declare `workspaces`.** The two npm projects are independent.
- Tool cache path: `${RUNNER_TOOL_CACHE}/setup-cursus/${version}/${platform}/bin/`
