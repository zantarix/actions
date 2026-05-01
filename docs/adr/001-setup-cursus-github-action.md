# ADR-001: `setup-cursus` GitHub Action

## Status

Proposed (2026-05-01)

## Context

[Cursus](https://github.com/zantarix/cursus) is a release-management CLI distributed as static binaries for seven OS/architecture targets ([Cursus ADR-022](https://github.com/zantarix/cursus/blob/main/docs/adr/022-distribution-strategy.md)) and signed with identity-pinned Sigstore attestations produced by `release-artifacts.yml` in the cursus repository ([Cursus ADR-049](https://github.com/zantarix/cursus/blob/main/docs/adr/049-signed-release-artifacts.md)). Rust-based consumer projects currently install cursus from source via `cargo-bin` for local development. The same source-build path is used in CI, where it costs several minutes per workflow run.

Those minutes are pure dead weight for any consumer that does not customise the cursus build itself. The binaries that the source build would produce already exist on every cursus GitHub Release, signed and attestable in seconds. What is missing is a turnkey way for a consumer's GitHub Actions workflow to (1) pick the right artifact for the current runner, (2) download it, (3) verify its provenance against the canonical cursus release workflow, and (4) put it on `PATH` -- without each consumer re-implementing the verification logic.

The cursus repository is not the right home for this glue. Its tag scheme is `cursus@x.y.z` (governed by the cursus monorepo's own `prepare`/`publish` flow), which produces awkward consumer syntax (`uses: zantarix/cursus@cursus@1.5.0`) and signals that cursus is primarily a GitHub Action when it is not. The `actions/setup-*` ecosystem (`setup-node`, `setup-go`, `setup-python`) has established the pattern of a small, separately-versioned action repository whose surface is "install the tool and add it to `PATH`" and nothing more. Following that pattern lets the action evolve independently of the cursus binary it installs, and lets a single action release work for any past or future cursus release that conforms to the standard `release-artifacts.yml` output.

The action also has its own trust-chain question. The action's code itself runs in the consumer's workflow before any cursus verification has happened, so a compromise of the action's source can bypass the cursus attestation check entirely. The action repository must therefore produce its own build-provenance attestations, and consumers must be steered toward pinning the action by SHA so a mutable tag cannot be retargeted. This is the same posture cursus has already taken for its own distribution surface ([Cursus ADR-049](https://github.com/zantarix/cursus/blob/main/docs/adr/049-signed-release-artifacts.md), [Cursus ADR-051](https://github.com/zantarix/cursus/blob/main/docs/adr/051-bundle-sigstore-deps-via-workspace-removal.md)) -- this ADR extends it to the action layer.

A final design constraint: the verifier itself must be code that the consumer can audit and that is already trusted by the runner. GitHub-hosted runners ship with `gh` preinstalled, and `gh attestation verify` is the GitHub-audited reference implementation of the same Sigstore verification cursus's own npm postinstall performs. Re-implementing that verifier (in JavaScript, in shell, or in a vendored binary) would expand the trust boundary for no security gain.

## Decision

We will create a new repository at `zantarix/setup-cursus`, separate from the cursus monorepo, containing a GitHub Action whose sole responsibility is to install a verified cursus binary and add it to `PATH`. The action will be invoked as `uses: zantarix/setup-cursus@<ref>` and will surface a single action -- `setup-cursus` -- with no bundled wrapper actions for cursus subcommands.

### Action surface

The action's `action.yml` will live at the root of the `zantarix/setup-cursus` repository. The action exposes only the install-and-add-to-PATH step; consumers invoke cursus subcommands themselves in subsequent workflow steps (e.g. `run: cursus ci --no-interactive`). This mirrors the `actions/setup-node`, `actions/setup-go`, and `actions/setup-python` pattern. No `cursus-ci` wrapper action will be shipped in this iteration.

### Action type

The action will be a JavaScript action targeting the `node24` runtime (`runs.using: node24` in `action.yml`). There will be no TypeScript, no build step, no bundler (ncc/esbuild/webpack), no transpile step, and no `dist/` directory. The action's logic is hand-written plain JavaScript committed as-is, using ESM (`"type": "module"` in `package.json`) and Node 24 built-in modules.

The only runtime dependency is `smol-toml`, a TOML parser used to read `Cargo.toml` in the `version-file` path. It is committed to the repository via `node_modules/` and declared under `bundleDependencies` in `package.json` -- the same posture Cursus uses for its own npm distribution ([Cursus ADR-051](https://github.com/zantarix/cursus/blob/main/docs/adr/051-bundle-sigstore-deps-via-workspace-removal.md)). No `@actions/core`, `@actions/exec`, `@actions/tool-cache`, or any other `@actions/*` package is taken. All interaction with the Actions runner (reading inputs, appending to `PATH`, signalling failure) is done directly against the runner contract using Node built-ins:

- Inputs read from `process.env.INPUT_VERSION` / `process.env.INPUT_VERSION_FILE` (GitHub Actions sets these automatically from `with:` keys).
- PATH additions written via `fs.appendFileSync(process.env.GITHUB_PATH, binDir + os.EOL)`.
- Failures signalled by writing to stderr and calling `process.exit(1)`.
- Artifact downloads performed with the global `fetch()` API built into Node 24.
- `gh attestation verify` invoked via `child_process.spawnSync`.

Node 24 is the LTS runtime the GitHub Actions runtime surfaces as `node24`. When Node 24 itself approaches EOL, a future ADR will update the runtime target.

### Action steps

1. **Detect platform** -- read `process.env.RUNNER_OS` and `process.env.RUNNER_ARCH` and map the pair to one of the seven artifact filenames produced by the cursus `release-artifacts.yml` workflow:
   - `cursus-linux-x86_64`, `cursus-linux-aarch64`, `cursus-linux-riscv64gc`
   - `cursus-osx-x86_64`, `cursus-osx-aarch64`
   - `cursus-windows-x86_64.exe`, `cursus-windows-aarch64.exe`
   An unsupported `RUNNER_OS` × `RUNNER_ARCH` combination fails the step with a clear error listing the supported platforms.

2. **Resolve the version** -- determine the exact cursus version to install (see "Version selection" below).

3. **Locate or download** -- compute the stable target path `${RUNNER_TOOL_CACHE}/setup-cursus/${version}/${platform}/bin/cursus[.exe]`. If the binary already exists at that path (a cache hit from a prior job on the same self-hosted runner), attempt verification (step 4) against it. If verification succeeds, proceed to install (step 5). If verification fails against the cached copy, delete the cached binary (treat the cache as poisoned) and fall through to download. If no cached binary exists (or was just deleted as poisoned), fetch the artifact from `https://github.com/zantarix/cursus/releases/download/cursus@${version}/${artifact}` into that path and proceed to verification.

4. **Verify before exec** -- invoke `spawnSync('gh', ['attestation', 'verify', file, '--owner', 'zantarix', '--signer-workflow', 'zantarix/cursus/.github/workflows/release-artifacts.yml'])` against the binary at the target path. This step runs on **every** invocation, including cache hits -- the cache shortens the network path only, never the trust path. A verification failure after a fresh download (not a cache hit) is unrecoverable: delete the file and hard-fail with a clear error surfacing `gh`'s stderr. A verification failure against a cached file (poison recovery path) deletes the cached binary and falls through to the download path above; a subsequent verification failure after the re-download is then unrecoverable.

5. **Install** -- `chmod +x` the binary (no-op on Windows runners). The binary is already at its stable tool-cache path from step 3, so no move is needed. Append the bin directory to the file at `process.env.GITHUB_PATH` (`fs.appendFileSync(process.env.GITHUB_PATH, binDir + os.EOL)`); the runner reads this file at step end and prepends its contents to `PATH` for all subsequent steps in the job.

### Consumer workflow permissions

Consumers must grant the workflow `contents: read`, `attestations: read`, and `id-token: read`. The first allows the artifact download from the cursus public-release endpoint, the second allows `gh attestation verify` to fetch the attestation bundle from the GitHub attestations API, and the third is required by `gh` for the OIDC handshake the verifier performs. The action's documentation shall state these three permissions explicitly.

### Version selection

The action shall expose two mutually-exclusive inputs. Exactly one must be set; setting both, or neither, shall hard-fail the step with a clear error.

- **`version`** -- an exact version string (for example, `1.5.0`). No semver ranges, no `latest`, no floating channels (`stable`, `beta`). The action does no version arithmetic and performs no registry lookup; the string given is the string used in the artifact URL after the `cursus@` prefix.
- **`version-file`** -- a path to an existing developer-tooling file in the consumer repository that already pins cursus for local development. The action shall detect the file format from its filename and parse the appropriate field:
  - `Cargo.toml`: attempt resolution in this order:
    1. `[package.metadata.bin.cursus].version` -- the cargo-bin declaration for a per-package project.
    2. `[workspace.metadata.bin.cursus].version` -- the cargo-bin declaration for a workspace root.
    3. `[dependencies].cursus` -- a regular Cargo dependency on the cursus crate. This fallback supports projects that consume cursus as a Cargo dependency rather than via cargo-bin.

    The step hard-fails if both locations 1 and 2 are present (ambiguity). For location 3, the version value must be an exact pin; semver ranges (`^1.0.0`, `~1.0.0`, `>=1.0.0`, `1.x`, `*`) hard-fail the step, applying the same rule used for `package.json`. Location 3 is only consulted if neither location 1 nor location 2 is present.
  - `package.json`: read the version associated with `@zantarix/cursus` from `dependencies`, `devDependencies`, or `optionalDependencies`. The version must be an exact pin; semver ranges (`^1.0.0`, `~1.0.0`, `>=1.0.0`, `1.x`, `*`) shall hard-fail the step.

The two-input design exists so that consumer projects which already pin cursus for local development -- via `cargo-bin` in a `Cargo.toml` or via `@zantarix/cursus` in a `package.json` -- get CI version updates automatically when Dependabot or Renovate bumps the local-dev pin. No bespoke version file needs to be invented or maintained alongside the existing pin.

### Caching policy

The action installs the verified binary to a stable path within `RUNNER_TOOL_CACHE`: `${RUNNER_TOOL_CACHE}/setup-cursus/${version}/${platform}/bin/cursus[.exe]`. On GitHub-hosted runners, `RUNNER_TOOL_CACHE` is ephemeral per VM (each job starts on a fresh machine), so the cache provides no cross-job reuse there; on self-hosted runners with persistent storage it avoids re-downloading the same artifact version on successive jobs.

Regardless of whether a cached binary exists, **`gh attestation verify` runs on every job invocation**. The cache shortens the artifact-download network round-trip; it never short-circuits the trust anchor. A verification failure against a cached binary causes the action to delete the cache entry and attempt a fresh download, giving the action one automatic recovery from a poisoned or corrupted cache before hard-failing. A verification failure against a freshly-downloaded artifact is treated as unrecoverable.

No `cache: true` input is exposed to consumers; the above behaviour is fixed. Consumers cannot disable verification.

The original ADR-001 draft took a "no caching at all" position on the grounds that caching would short-circuit the verifier. This section revises that position: mandatory re-verification on cache hits preserves the verifier as the trust anchor while allowing bandwidth savings on self-hosted infrastructure.

### Action versioning and trust model for the action itself

The `zantarix/setup-cursus` repository shall be versioned independently of cursus, on its own semver track. A new cursus release shall not require a new action release; conversely, action bug-fixes or feature additions shall not be tied to the cursus release cadence. Action `v1` shall work for every cursus release whose `release-artifacts.yml` workflow produces the seven standard artifacts and signs them with the standard identity.

Each action release shall publish a build-provenance attestation via `actions/attest-build-provenance`, signed by the same GitHub Actions OIDC trust root cursus already relies on. The action's `README.md` shall strongly recommend that consumers pin the action by SHA -- `uses: zantarix/setup-cursus@<sha>` -- and configure Dependabot to keep that SHA current. Mutable `v1` and `v1.x` tags shall be maintained for consumers who prefer ergonomics over the strongest pin, but shall be documented as second-best.

### Binary trust model

The trust model for the cursus binary the action installs is identical to the model established by [Cursus ADR-049](https://github.com/zantarix/cursus/blob/main/docs/adr/049-signed-release-artifacts.md) and [Cursus ADR-051](https://github.com/zantarix/cursus/blob/main/docs/adr/051-bundle-sigstore-deps-via-workspace-removal.md): identity-pinned Sigstore verification, hard-fail on any failure, no checksum-file fallback. The verifier is `gh attestation verify` -- the GitHub-audited CLI -- not a re-implementation. The `--signer-workflow` flag pins the expected workflow file path; the `--owner` flag pins the expected repository owner. Any artifact whose attestation does not satisfy both constraints shall be rejected.

### Out of scope

- A `cursus-ci` wrapper action that automatically runs `cursus ci`.
- Wrapper actions for any other cursus subcommand (`cursus verify`, `cursus prepare`, etc.).
- Self-hosted runners that do not have `gh` preinstalled. The action shall document this as a known limitation. A future ADR may revisit the verifier choice if there is sufficient demand.

## Consequences

### Positive

- CI time for consumer projects without a custom cursus build drops from minutes (source build via `cargo-bin`) to seconds (artifact download plus attestation verification).
- The action's trust chain is end-to-end and unbroken: the action itself is provenance-attested, the action invokes a GitHub-audited verifier, and the verifier identity-pins the cursus release workflow. There is no point where a non-attested step or a hand-rolled verifier sits on the trust path.
- Independent semver for the action means cursus's release cadence is not coupled to the action's. A cursus patch release does not require an action release; an action documentation fix does not require a cursus release.
- The two-input version-selection design (`version` and `version-file`) produces zero new files for consumers to maintain. Projects that already pin cursus locally via `cargo-bin` or `@zantarix/cursus` get Dependabot/Renovate updates flowing into CI for free.
- JavaScript action with no build step means there is no `dist/` directory to commit, no bundler to maintain, and no transitive npm tree beyond the single vendored dependency (`smol-toml`, committed to `node_modules/` via the same bundleDependencies pattern as [Cursus ADR-051](https://github.com/zantarix/cursus/blob/main/docs/adr/051-bundle-sigstore-deps-via-workspace-removal.md)). The action's audit surface is `action.yml` + the JavaScript source files + the contents of `node_modules/smol-toml/`.
- Putting `setup-cursus` in its own repository under the `actions/setup-*` naming convention makes the action discoverable to consumers searching the GitHub Marketplace and aligns with established workflow ergonomics.

### Negative

- Self-hosted runners without `gh` preinstalled cannot use this action. There is no fallback verifier shipped in the action. This must be documented as a known limitation, and consumers running on bare self-hosted infrastructure must either preinstall `gh` or continue to use the source-build path.
- The action's trust chain depends on the GitHub attestations API being available at every workflow run. An attestations API outage will hard-fail every CI job that uses the action, even though the cursus binary itself is fine. This is the deliberate consequence of choosing security over availability for the install path -- the same trade-off [Cursus ADR-049](https://github.com/zantarix/cursus/blob/main/docs/adr/049-signed-release-artifacts.md) made for the npm postinstall.
- Every workflow run still pays the `gh attestation verify` cost: the verifier runs unconditionally on every job invocation, including cache hits, so verification time is never amortised across runs. Cache-hit runs on self-hosted runners do avoid the artifact-download network round-trip, but on GitHub-hosted runners the tool cache is ephemeral per VM, so caching provides no cross-job benefit there and every job pays the full download-plus-verify cost.
- The action's JavaScript runtime target (`node24`) will need to be bumped in a future ADR when Node 24 reaches EOL. This is a new maintenance concern that the original composite-bash approach would not have had.
- The vendored `node_modules/smol-toml/` must be reviewed and updated when a new smol-toml release is consumed. This is a light but real periodic-review cadence.
- The hard pin on `--signer-workflow zantarix/cursus/.github/workflows/release-artifacts.yml` couples the action's identity policy to that specific workflow filename in the cursus repository. If cursus ever renames or moves that workflow, the action must be released with a new identity expectation, and consumers pinning by SHA will need to bump. This is the same coupling [Cursus ADR-049](https://github.com/zantarix/cursus/blob/main/docs/adr/049-signed-release-artifacts.md) acknowledges between cursus's npm postinstall and its workflow path.
- The two version-selection inputs each have parsing logic the action must own (`Cargo.toml` TOML parsing, `package.json` JSON parsing, semver-range rejection). Any bug in that parsing logic could mis-pin the version installed in CI. The mitigation is that the resolved version flows through the same `cursus@${version}` artifact URL and the same attestation verification regardless of how it was resolved -- a parser bug cannot turn into a binary-substitution attack, only a wrong-version install.
- The "exactly one of `version` or `version-file`" contract requires consumers to think about which input they want. This is friction compared to a single mandatory `version` input, but it is the cost of supporting both pinning styles without inventing a third one.

### Neutral

- This ADR establishes a posture but not a Marketplace listing. Whether the action is published to the GitHub Marketplace is a separate decision and does not affect the security or functional properties of the action.
- The action's repository is intentionally small (one `action.yml`, a `README.md`, a `LICENSE`, and the workflows that release the action and produce its provenance). This is a feature, not a bug; the action's surface is precisely what `actions/setup-*` actions look like in their pure form.
- Future cursus releases that add an eighth or ninth artifact target will require an action release that extends the platform mapping in step 1. This is a minor coordination cost between the two repositories. Dropping a target would be similar.
- Pinning consumer workflows by SHA is a recommendation, not an enforcement. Consumers who pin by `v1` retain the existing GitHub Actions trust model for mutable tags. The recommendation in `README.md` is the strongest enforcement mechanism this ADR contemplates; tooling-level enforcement (for example, requiring SHA pins via `actions: read` policy) is a consumer-side choice outside the scope of this action.
- The `version-file` input's `Cargo.toml` parsing supports three resolution paths (cargo-bin package metadata, cargo-bin workspace metadata, and regular `[dependencies]`). This is slightly more surface than the original two-path design but handles the full range of ways a Rust project might pin cursus.

## Alternatives Considered

### Same-repository subdirectory in `zantarix/cursus`

Place the action at `zantarix/cursus/actions/setup-cursus/` and have consumers reference it as `uses: zantarix/cursus/actions/setup-cursus@<ref>`. The action would then be versioned in lockstep with cursus itself.

Rejected for two reasons. First, cursus's tag scheme is `cursus@x.y.z` (driven by its own monorepo `prepare`/`publish` flow), which produces an awkward consumer syntax (`uses: zantarix/cursus/actions/setup-cursus@cursus@1.5.0`) and signals to a casual reader of `zantarix/cursus` that the repository is primarily an action -- which it is not. Second, the action's release cadence and the cursus binary's release cadence have no inherent coupling; tying them together would either force a cursus release every time the action README is fixed or force a no-op action "release" every time cursus ships a patch. A separate repository decouples the two cadences cleanly.

### JavaScript action reusing `sigstore-js` from the cursus npm postinstall

Implement the action's verifier in JavaScript using the `sigstore` library directly to verify the attestation -- the same code path the cursus npm postinstall uses ([Cursus ADR-049](https://github.com/zantarix/cursus/blob/main/docs/adr/049-signed-release-artifacts.md)) -- rather than shelling out to `gh attestation verify`.

Rejected because `gh attestation verify` is already shipped on every GitHub-hosted runner, is audited and maintained by GitHub, and verifies the same primitives. Replacing it with a vendored `sigstore-js` would mean owning a Dependabot surface for sigstore-js's transitive tree (the very surface [Cursus ADR-051](https://github.com/zantarix/cursus/blob/main/docs/adr/051-bundle-sigstore-deps-via-workspace-removal.md) had to lock down with `bundleDependencies`) for zero security gain over the GitHub-native verifier. Keeping `gh` as the verifier also collapses two of the three original objections to a JavaScript action -- no `dist/` bundle is needed (the action ships plain JS with no build step) and no `sigstore-js` transitive tree needs to be audited -- leaving only the Node runtime drift concern, which `runs.using: node24` addresses by pinning the runtime through the Actions runtime contract.

### Docker container action

Distribute the action as a Docker container action that bundles `gh` (or a custom Sigstore verifier) and the cursus binary itself.

Rejected because Docker container actions only run on Linux runners. The cursus binary is supported on macOS and Windows runners as well, and excluding those audiences contradicts the seven-target distribution promise of [Cursus ADR-022](https://github.com/zantarix/cursus/blob/main/docs/adr/022-distribution-strategy.md). A container-based action also shifts the trust boundary to the container image registry, which adds a new attestable surface (the image's own provenance) without retiring any existing one.

### Single `cursus-ci` action that runs `cursus ci` end-to-end

Ship a single action whose surface is "run cursus ci in the consumer repository" -- bundling install, verification, and invocation into one step.

Rejected on flexibility grounds. Future cursus subcommands (`cursus verify`, `cursus prepare`, ad-hoc `cursus change` invocations) would each need their own wrapper action, multiplying the surface to maintain. The `actions/setup-*` pattern -- install the tool, then let the consumer invoke whichever subcommand they want in a subsequent `run:` step -- handles every present and future cursus subcommand with no additional action releases. A `cursus-ci` wrapper may be revisited as a separate ADR if a sufficiently common usage pattern emerges, but it is not the right primitive to ship first.

### Lockstep action versioning tied to cursus releases

Release a new `setup-cursus` version for every cursus release, with matching version numbers.

Rejected because it ties two repositories' release pipelines together with no benefit to consumers. The action's logic does not change when cursus releases a patch; forcing an action release in lockstep produces noisy release notes and forces Dependabot bumps on consumer workflows that gain nothing. Independent semver lets `setup-cursus@v1` work for every conforming cursus release until the action's own surface needs to change.

### Default `version: latest`

Make `version` optional, default to `latest`, and have the action resolve the latest cursus release from the GitHub API at workflow run time.

Rejected because cursus is a release-management tool: a regression in cursus could break every consumer's CI overnight if those consumers had not pinned a version. The cursus distribution philosophy already hard-fails rather than silently degrades ([Cursus ADR-022](https://github.com/zantarix/cursus/blob/main/docs/adr/022-distribution-strategy.md), [Cursus ADR-049](https://github.com/zantarix/cursus/blob/main/docs/adr/049-signed-release-artifacts.md)); silent "use whatever shipped most recently" semantics on the install side run counter to that posture. Consumers who want fast updates have Dependabot and Renovate; consumers who want reproducible CI pin an exact version. There is no audience served by `latest` that is not better served by one of those two paths.

### Composite bash action + on-the-fly TOML parser install

Keep the composite bash approach and install a TOML parser (taplo, dasel, or yq/tomlq) as a step before parsing. Rejected because installing any tool before `gh attestation verify` has run expands the pre-verification trust surface: the installed parser runs under the same job identity as the cursus binary we are about to verify, and the parser's own provenance is unverifiable at that point in the workflow.

### Composite bash action + hand-rolled TOML subset parser

Keep composite bash and implement a minimal TOML parser in bash using pattern matching and awk, handling only the subset of TOML needed to extract `metadata.bin.cursus.version`. Rejected because TOML is not safely parseable with a bash subset: multi-line strings, inline tables, dotted keys, and quoted table headers can all produce incorrect extractions from a regex-based parser, and a parser bug here silently installs the wrong cursus version in CI rather than failing loudly.

### Composite bash action + small JS step using runner-preinstalled Node

Keep composite bash for all steps except parsing, and add a `run: node scripts/resolve-version.js` step that uses whichever Node version the runner ships with. Rejected because the runner-preinstalled Node version is not guaranteed -- it varies across runner image vintages and can lag significantly -- and the action would need to hard-fail with a version-too-old error on some runners. Using `runs.using: node24` pins the runtime explicitly through the GitHub Actions runtime contract.

### Deferring `version-file` support to a later release

Ship v1 with the `version` input only and revisit `version-file` under a future ADR once a parsing-runtime story was settled. Rejected because the `version-file` ergonomic is the primary value proposition for projects that already pin cursus locally via cargo-bin or `@zantarix/cursus`: it lets Dependabot/Renovate bumps flow into CI for free. Deferring it would require every initial consumer to set up a separate bespoke pin file for CI, exactly the churn the input was designed to avoid.

### No caching -- re-download and re-verify on every job

(Considered as the "keep the original ADR-001 posture" alternative for the caching section.) Every job fetches the artifact from GitHub Releases and verifies it; no tool-cache path is involved. This was the original position and is a valid security stance. Revised because mandatory re-verification on cache hits achieves the same trust guarantee (the verifier runs on every job invocation) while allowing self-hosted runners to avoid redundant downloads of the same artifact version. The revised policy is strictly no weaker than the original.
