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
# Cargo.toml — reads [package.metadata.bin.cursus].version
#              or [workspace.metadata.bin.cursus].version
#              or [dependencies.cursus]
- uses: zantarix/actions/setup-cursus@<sha>
  with:
    version-file: Cargo.toml

# package.json — reads @zantarix/cursus from dependencies / devDependencies / optionalDependencies
- uses: zantarix/actions/setup-cursus@<sha>
  with:
    version-file: package.json
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `version` | one of | Exact cursus version string (e.g. `1.5.0`). No semver ranges. |
| `version-file` | one of | Path to a `Cargo.toml` or `package.json` that already pins cursus. |

Exactly one of `version` or `version-file` must be provided.

## Required workflow permissions

```yaml
permissions:
  contents: read       # artifact download from the cursus GitHub release
  attestations: read   # gh attestation verify fetches the attestation bundle
```

The action also requires `GH_TOKEN` to be set so `gh attestation verify` can authenticate. Pass `github.token` via the step's `env:`:

```yaml
- uses: zantarix/actions/setup-cursus@<sha>
  with:
    version: '0.5.1'
  env:
    GH_TOKEN: ${{ github.token }}
```

## Pinning the action by SHA (recommended)

Only immutable version tags (e.g. `v1.0.0`) are released. Pin the action by commit SHA and let Dependabot or Renovate keep it current — this is the only way to guarantee the tag you reference cannot be retargeted:

```yaml
- uses: zantarix/actions/setup-cursus@<sha>  # vX.Y.Z
```

## Known limitations

- **`gh` must be preinstalled.** This action uses `gh attestation verify` to check the cursus binary's provenance. GitHub-hosted runners ship `gh` by default. Self-hosted runners without `gh` preinstalled cannot use this action without first installing it.
- **Verification runs on every invocation.** The attestation check is mandatory and unconditional — it cannot be disabled. An outage of the GitHub attestations API will cause the action to fail.

## How it works

1. Detects the current runner platform (`RUNNER_OS` × `RUNNER_ARCH`).
2. Resolves the cursus version from `version` or `version-file`.
3. Checks the tool cache (`RUNNER_TOOL_CACHE/setup-cursus/<version>/<platform>/bin/`). On a cache hit, verification still runs; a failed verify treats the cache as poisoned and falls through to a fresh download.
4. Downloads the artifact from the cursus GitHub release if not cached.
5. Runs `gh attestation verify` with `--owner zantarix` and `--signer-workflow zantarix/cursus/.github/workflows/release-artifacts.yml`. Any failure is unrecoverable.
6. Makes the binary executable and appends its directory to `GITHUB_PATH`.
