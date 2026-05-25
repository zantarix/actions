# setup-cursus

GitHub Action that installs the [cursus](https://github.com/zantarix/cursus) release-management CLI, verifies its provenance, and adds it to `PATH`.

## Usage

### Pin by version

```yaml
- uses: zantarix/actions/setup-cursus@<sha>  # replace with a pinned SHA (recommended)
  with:
    version: '0.5.1'
```

### Read version from an existing pin file

```yaml
# Cargo.toml — reads [package.metadata.bin.cursus-bin].version
#              or [workspace.metadata.bin.cursus-bin].version
#              or [dependencies.cursus]
- uses: zantarix/actions/setup-cursus@<sha>
  with:
    version-file: Cargo.toml

# package.json — reads @zantarix/cursus from dependencies / devDependencies / optionalDependencies
- uses: zantarix/actions/setup-cursus@<sha>
  with:
    version-file: package.json
```

## Example: cursus release workflow

The primary use case for this action is installing cursus so that `cursus ci` can manage releases. The workflow below runs on every push to `main` and uses a GitHub App token for all write operations — the default `GITHUB_TOKEN` is kept to read-only.

```yaml
name: Cursus

on:
  push:
    branches: [main]

concurrency:
  group: cursus-release
  cancel-in-progress: false

# GITHUB_TOKEN is not used for writes in this workflow; all git operations
# other than tag creation (branch push, PR creation, GitHub Release) go
# through the App token minted in the first step. The default token needs
# read access only for setup-cursus to download and verify the cursus binary.
permissions:
  contents: read
  # For cursus < 0.9.0 verification requires the `attestations: read` permission.
  # attestations: read

jobs:
  cursus:
    name: Cursus CI
    runs-on: ubuntu-latest

    steps:
      - uses: zantarix/actions/setup-cursus@908a0f4b5fdd2d9656a3c593ce3ccec5f67288c9 # v1.0.0
        with:
          version-file: package.json  # use Cargo.toml for Rust projects
        env:
          GH_TOKEN: ${{ github.token }}

      - name: Generate GitHub App token
        id: app-token
        uses: actions/create-github-app-token@1b10c78c7865c340bc4f6099eb2f838309f1e8c3 # v3.1.1
        with:
          client-id: ${{ vars.GITHUB_APP_CLIENT_ID }}
          private-key: ${{ secrets.GITHUB_APP_PRIVATE_KEY }}

      # Full history is required so that `cursus ci` can detect existing git tags
      # when determining whether to release or publish. App token is needed to push
      # git tags
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          token: ${{ steps.app-token.outputs.token }}
          fetch-depth: 0

      # Use the GitHub App bot as the git committer so tags
      # are attributed to the App rather than to a personal account.
      - name: Configure git identity
        env:
          APP_SLUG: ${{ steps.app-token.outputs.app-slug }}
          APP_USER_ID: ${{ vars.GITHUB_APP_USER_ID }}
        run: |
          git config user.name "${APP_SLUG}[bot]"
          git config user.email "${APP_USER_ID}+${APP_SLUG}[bot]@users.noreply.github.com"

      - name: Run cursus ci
        env:
          GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
        run: cursus ci --no-interactive
```

**Why a GitHub App token?** `cursus ci` pushes commits (the release PR branch), creates tags, and creates GitHub Releases. The default `GITHUB_TOKEN` can do these things, but commits and tags authored by it do not trigger other workflows (a GitHub platform restriction). A GitHub App token bypasses this restriction and also carries a clear bot identity in the audit log. GitHub App tokens are also necessary for generating signed commits.

**`version-file` options:** Point `version-file` at whatever file already pins cursus in your project — `package.json` (reads `@zantarix/cursus` from any dependency field) or `Cargo.toml` (reads `[package.metadata.bin.cursus]`, `[workspace.metadata.bin.cursus]`, or `[dependencies.cursus]`).

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `version` | one of | Exact cursus version string (e.g. `1.5.0`). No semver ranges. |
| `version-file` | one of | Path to a `Cargo.toml` or `package.json` that already pins cursus. |

Exactly one of `version` or `version-file` must be provided.

## Required workflow permissions

```yaml
permissions:
  contents: read       # artifact (and bundle) download from the cursus GitHub release
```

For cursus **>= 0.9.0** the action downloads the release's Sigstore bundle asset and verifies it offline — no attestations-API call is made, so no `attestations: read` permission is required (cursus is a public repository). The legacy `attestations: read` permission is only relevant when resolving a **pre-0.9.0** version, where verification still discovers the attestation via the GitHub attestations API.

The action still requires `GH_TOKEN` to be set: `gh attestation verify` constructs an authenticated client at startup even on the offline `--bundle` path. The ambient `github.token` is sufficient and needs no special scopes for the public cursus repo. Pass it via the step's `env:`:

```yaml
- uses: zantarix/actions/setup-cursus@<sha>
  with:
    version: '0.5.1'
  env:
    GH_TOKEN: ${{ github.token }}
```

## Pinning the action by SHA (recommended)

Releases use immutable version tags (e.g. `v1.0.0`). Pin the action by commit SHA and let Dependabot or Renovate keep it current — this is the only way to guarantee the tag you reference cannot be retargeted:

```yaml
- uses: zantarix/actions/setup-cursus@<sha>  # vX.Y.Z
```

## Known limitations

- **`gh` must be preinstalled.** This action uses `gh attestation verify` to check the cursus binary's provenance. GitHub-hosted runners ship `gh` by default. Self-hosted runners without `gh` preinstalled cannot use this action without first installing it.
- **Verification runs on every invocation.** The attestation check is mandatory and unconditional — it cannot be disabled. For cursus >= 0.9.0 the check is offline (it reads the downloaded bundle), so it no longer depends on the attestations API being reachable; for pre-0.9.0 versions an attestations-API outage will still cause the action to fail.

## How it works

1. Detects the current runner platform (`RUNNER_OS` × `RUNNER_ARCH`).
2. Resolves the cursus version from `version` or `version-file`.
3. Checks the tool cache (`RUNNER_TOOL_CACHE/setup-cursus/<version>/<platform>/bin/`). On a cache hit, verification still runs; a failed verify treats the cache as poisoned and falls through to a fresh download.
4. Downloads the artifact from the cursus GitHub release if not cached.
5. Verifies the binary against the per-version pinned SAN `https://github.com/zantarix/cursus/.github/workflows/release-artifacts.yml@refs/tags/cursus@<version>` (with `--owner zantarix`). Any failure is unrecoverable.
   - **cursus >= 0.9.0:** downloads the matching `<binary>.sigstore.json` bundle asset into `RUNNER_TEMP` and verifies offline via `gh attestation verify … --bundle <bundle>` — no attestations-API call. The bundle is downloaded fresh on every run (including cache hits) and is kept out of the tool cache.
   - **cursus < 0.9.0:** verifies via `gh attestation verify` against the GitHub attestations API (no bundle asset exists for these releases).
6. Makes the binary executable and appends its directory to `GITHUB_PATH`.
