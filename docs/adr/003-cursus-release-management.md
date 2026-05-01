# ADR-003: Cursus-managed release workflow for `zantarix/actions`

## Status

Accepted (2026-05-02)

## Context

`zantarix/actions` is currently pre-release: there are no git tags, no `CHANGELOG.md`, no release workflow under `.github/workflows/`, and no `.cursus/config.toml`. The repository ships one action ([ADR-001](001-setup-cursus-github-action.md)) under the monorepo layout codified in [ADR-002](002-actions-monorepo-layout.md), and consumers cannot yet pin a tagged version of `zantarix/actions/setup-cursus` because no tags exist. Before any external consumer adopts the action, the repository needs a defined release pipeline that produces immutable `vX.Y.Z` tags and matching GitHub Releases.

[ADR-002](002-actions-monorepo-layout.md) committed to repo-level shared tags of the form `vX.Y.Z` rather than path-prefixed tags (`setup-cursus/v1.0.0`). It also committed to the "two independent npm projects, not a workspace" rule: the root `package.json` carries dev tooling only and must not declare `workspaces`, while `setup-cursus/package.json` is the action's own manifest. That layout has a useful side-effect for release management: cursus's npm package-manager driver enumerates only the packages it discovers as workspace members, and with no `workspaces` field at the root only the root `@zantarix/actions` package is enumerated. The `setup-cursus/package.json` is invisible to cursus, which means a single tracked version naturally produces a single shared tag stream -- exactly the scheme [ADR-002](002-actions-monorepo-layout.md) chose.

The release-management tooling is cursus itself ([Cursus ADR-015](https://github.com/zantarix/cursus/blob/main/docs/adr/015-ci-managed-release-workflow.md)), which offers two CI-friendly strategies. The `branch` strategy creates release commits on a separate branch, opens a PR, and only creates tags and GitHub Releases once the PR merges; the `push` strategy commits release changes directly to the current branch. Both strategies are driven by `cursus ci`, which inspects repository state on each invocation: if pending changesets exist it runs the release flow, and if the repository is in a post-release state (manifest version not yet tagged) it runs the publish flow.

A cursus complication is that `@zantarix/actions` is `private: true` in `package.json`. Under [Cursus ADR-007](https://github.com/zantarix/cursus/blob/main/docs/adr/007-honor-private-packages-during-publish.md) private packages are silently skipped by `cursus publish`, which would mean no tag and no GitHub Release are ever created -- defeating the purpose of running cursus here at all. [Cursus ADR-043](https://github.com/zantarix/cursus/blob/main/docs/adr/043-publish-private-packages-to-github-releases.md) introduced the `[git].publish_private_packages` opt-in list for exactly this case: private packages named in that list receive git tags and GitHub Releases (but no registry push) during `cursus publish`. GitHub Actions repositories are the canonical use case ADR-043 was built for.

The release workflow also has its own trust posture to define. `cursus ci` running on GitHub Actions creates the release commit via the GitHub Git Data API ([Cursus ADR-050](https://github.com/zantarix/cursus/blob/main/docs/adr/050-verified-release-commits-via-git-data-api.md)) rather than via local `git commit`/`git push`, which produces a Verified commit when authenticated as a GitHub App installation token. This is the same trust posture the cursus repository's own release workflow uses. In practical terms it means the workflow needs an App installation token (the `zantarix-ci` App, used elsewhere in the Zantarix project family) for the `cursus ci` step, and it means the `actions/checkout` step does not need write access to the repository -- the writes happen over the GitHub API under the App's identity, not over the local working copy's push channel.

Finally, this repository has the unusual property that the action it releases is the very tool it would naturally use to install cursus inside its own release workflow. That creates a question of bootstrapping. Reaching for `npx cursus` from the root devDependency would work mechanically, but it would also bypass the action that this repository exists to deliver: a regression in `setup-cursus` could ship to consumers while the release pipeline -- using a different install path -- continues to pass green. Using `./setup-cursus` from within the same repository instead exercises the action exactly as a consumer would, and any breakage in the action manifests immediately during its own release. That coupling is uncomfortable in normal software design (a tool should not be its own only test) but is precisely the property a release pipeline for a release-engineering action should have.

[ADR-001](001-setup-cursus-github-action.md) further requires that each action release publish a build-provenance attestation via `actions/attest-build-provenance`, signed by the same GitHub Actions OIDC trust root. The exact artifact to attest, the integration with cursus's `[github.artifacts]` configuration, and the workflow steps that produce and verify those attestations are non-trivial design questions in their own right and are deferred to a follow-up ADR rather than mixed into the release-orchestration decision here.

## Decision

We will adopt cursus as the release-management tool for `zantarix/actions`, configured to run under a GitHub Actions release workflow that uses the `branch` strategy via `cursus ci`. The shared `vX.Y.Z` tag scheme from [ADR-002](002-actions-monorepo-layout.md) is preserved unchanged; only the root `@zantarix/actions` package is tracked by cursus, so a single tracked version naturally produces single tags. The release workflow will install cursus by invoking the in-repo `./setup-cursus` action, dogfooding the action this repository exists to ship. Build-provenance attestation per [ADR-001](001-setup-cursus-github-action.md) is acknowledged here as a known follow-up but is deferred to a separate ADR.

### Tag scheme and tracked package set

The repository will continue to use the shared `vX.Y.Z` tag scheme committed in [ADR-002](002-actions-monorepo-layout.md). Cursus's npm package-manager driver enumerates packages from npm workspace membership, and because the root `package.json` declares no `workspaces` field (per [ADR-002](002-actions-monorepo-layout.md)) only the root `@zantarix/actions` package is enumerated. The `setup-cursus/package.json` is invisible to cursus's enumeration and its `version` field is decorative; it will be held at `0.0.0` and is not part of the release surface.

The root `package.json` will begin at `0.0.0`. The first release will be driven by an initial major-bump changeset, producing `v1.0.0` as the first published tag.

### CI strategy: `branch` via `cursus ci`

The release workflow will run `cursus ci` on every push to `main`. Cursus will be configured with `[git].strategy = "branch"` ([Cursus ADR-015](https://github.com/zantarix/cursus/blob/main/docs/adr/015-ci-managed-release-workflow.md)). Behaviour follows directly from cursus's state-detection rules:

- When pending changesets exist under `.cursus/`, `cursus ci` will run the release flow: bump the version, generate the changelog, consume the changesets, create a release commit on a release branch, push that branch, and open a release pull request against `main`.
- When no pending changesets exist and the current `@zantarix/actions` version is not yet tagged, `cursus ci` will run the publish flow: create the `vX.Y.Z` annotated tag, push it, and create the matching GitHub Release.
- When neither condition holds, `cursus ci` exits successfully with no work done.

The branch strategy gives a human gate -- the release PR -- between the proposed release and the immutable tag/Release artifacts on `main`. This is the appropriate default whenever GitHub integration is active, and matches the default cursus itself derives when `[github].enabled = true` ([Cursus ADR-015](https://github.com/zantarix/cursus/blob/main/docs/adr/015-ci-managed-release-workflow.md)).

### Changeset authorship

Changesets in this repository will be authored manually via `npx cursus change`. The repository will **not** wire `cursus verify` or `cursus change --auto` into its own CI:

- PR-side changeset verification (ensuring user-authored PRs include a changeset where required) is provided by external tooling that runs across all Zantarix repositories with consistent UX. Re-implementing that verification inside this repository's own CI would diverge from that infrastructure and duplicate policy.
- Automatic changeset generation for dependency-update PRs (Renovate, Dependabot) is likewise handled by external tooling outside this repository.

This repository's CI surface for changesets is therefore zero: contributors run `npx cursus change` locally, the external tooling polices PRs, and `cursus ci` consumes the resulting changesets at release time.

### Cursus install in the release workflow: `./setup-cursus`

The release workflow will install cursus by invoking the in-repo `./setup-cursus` action with `version-file: package.json`, reading the cursus version from the root `package.json` devDependency. This is the same install pattern the existing smoke test uses, and it dogfoods the action that this repository exists to deliver.

This is a deliberate forcing function. A regression in `setup-cursus` -- whether in version resolution, platform detection, download, attestation verification, or install -- will surface immediately during the release of `setup-cursus` itself, before it can ship to external consumers. Reaching for `npx cursus` from the root devDependency would be mechanically simpler but would silently mask such a regression by taking a different install path than the one consumers see.

### Private-package publishing via `[git].publish_private_packages`

The root `@zantarix/actions` package is `private: true` and not published to any registry ([ADR-002](002-actions-monorepo-layout.md)). To make `cursus publish` produce the desired outputs (a `vX.Y.Z` git tag and a matching GitHub Release) without attempting an npm publish, `@zantarix/actions` will be listed in `[git].publish_private_packages` per [Cursus ADR-043](https://github.com/zantarix/cursus/blob/main/docs/adr/043-publish-private-packages-to-github-releases.md):

```toml
[git]
enabled = true
strategy = "branch"
publish_private_packages = ["@zantarix/actions"]
```

This is the canonical use case [Cursus ADR-043](https://github.com/zantarix/cursus/blob/main/docs/adr/043-publish-private-packages-to-github-releases.md) was designed for: a private package whose distribution surface is git tags plus GitHub Releases rather than a registry.

### Release workflow token model

The release workflow will mint an installation token from the `zantarix-ci` GitHub App via `actions/create-github-app-token` and pass it as the `GITHUB_TOKEN` environment variable to the `cursus ci` step only. Three properties of cursus's behaviour and the action's install path determine the rest of the token model:

- The `cursus ci` step performs all repository writes (release commits, branch pushes, PR creation, tag creation, tag pushes, GitHub Release creation) via the GitHub API under the App's identity, including verified release commits via the Git Data API ([Cursus ADR-050](https://github.com/zantarix/cursus/blob/main/docs/adr/050-verified-release-commits-via-git-data-api.md)). The local `git` binary on the runner is not used to push commits or tags during the release flow.
- Because no local `git push` happens, the `actions/checkout` step does not need a token with write permissions. It uses the default workflow token (`${{ github.token }}`) with read permissions only.
- The `./setup-cursus` step needs `GH_TOKEN` solely for `gh attestation verify` to fetch attestation bundles from the GitHub attestations API ([ADR-001](001-setup-cursus-github-action.md)). It uses the default workflow token, which is sufficient for the attestations API.

Scoping the App installation token to the `cursus ci` step alone keeps its blast radius minimal: the elevated token never enters checkout, never enters the action under release, and is never on `PATH` for any later step that does not need it.

### Configuration file (`/.cursus/config.toml`)

Cursus reads `[git]`, `[github]`, and package-manager configuration from `.cursus/config.toml`. The shape of the file follows from the decisions above:

```toml
[npm]
enabled = true

[git]
enabled = true
strategy = "branch"
publish_private_packages = ["@zantarix/actions"]

[github]
enabled = true

[github.artifacts]
# Empty pending the build-provenance attestation follow-up (ADR-001).
```

The `[npm]` block enables cursus's npm package-manager driver, which is what enumerates the root `@zantarix/actions` package as the single tracked package per the "tag scheme and tracked package set" section above.

The `[git].signed_commits` field defaults to `"auto"` ([Cursus ADR-050](https://github.com/zantarix/cursus/blob/main/docs/adr/050-verified-release-commits-via-git-data-api.md)) and does not need to be set explicitly.

### Out of scope

- **Build-provenance attestation per release.** [ADR-001](001-setup-cursus-github-action.md) requires the action repository to publish build-provenance attestations via `actions/attest-build-provenance` so that consumers can pin by SHA and verify against the action's own OIDC trust root. The specific artifact to attest (the `setup-cursus/` directory contents, a tarball, the resolved `action.yml`, or some combination), the integration with cursus's `[github.artifacts]` table for attaching that artifact to the GitHub Release, and the workflow steps to produce and verify the attestation are deferred to a future ADR. The `[github.artifacts]` table is intentionally left empty in this ADR's configuration as a placeholder for that follow-up.
- **A second action's release cycle.** [ADR-002](002-actions-monorepo-layout.md) acknowledged that adding a second action would require revisiting the tag scheme. This ADR does not address that hypothetical; it inherits [ADR-002](002-actions-monorepo-layout.md)'s shared-tag commitment for the single-action case.

## Consequences

### Positive

- The release pipeline matches the established Zantarix posture: cursus drives the release, `cursus ci` runs on `main`, the `branch` strategy gates tags behind a PR review, and verified release commits land on `main` via the Git Data API ([Cursus ADR-050](https://github.com/zantarix/cursus/blob/main/docs/adr/050-verified-release-commits-via-git-data-api.md)).
- The single tracked package (`@zantarix/actions`) maps cleanly onto the shared `vX.Y.Z` tag scheme committed in [ADR-002](002-actions-monorepo-layout.md). No path-prefixed tag scheme is needed, and there is no enumeration ambiguity between the root and `setup-cursus/` packages because the latter is invisible to cursus.
- `[git].publish_private_packages` is the right primitive for a `private: true` action repository: it produces a tag and a GitHub Release without ever attempting an npm publish, exactly the shape this repository needs.
- The release workflow exercises `setup-cursus` in production conditions on every release. A breaking regression in the action surfaces during its own release rather than slipping into a tagged version that consumers then pull.
- The token model is minimal and well-scoped. The App installation token is exposed only to `cursus ci`; checkout and the action under release run with the default workflow token. No long-lived credentials or write-scoped checkout tokens are required.
- Changeset infrastructure stays consistent with the rest of the Zantarix project family. PR-side `cursus verify` and dependency-bot changesets are provided by the same external tooling other repositories use, with no duplication or divergence here.
- Verified release commits via [Cursus ADR-050](https://github.com/zantarix/cursus/blob/main/docs/adr/050-verified-release-commits-via-git-data-api.md) extend the keyless trust posture from the artifact layer ([ADR-001](001-setup-cursus-github-action.md)) into the git history layer, with no new signing key to manage.

### Negative

- The release pipeline has a bootstrap dependency on `./setup-cursus`. If the action is sufficiently broken that it cannot install cursus for its own release workflow, no new releases can be cut until the breakage is repaired by some out-of-band mechanism (a manual `npm install`-and-`npx cursus` invocation in a one-off branch, a hot-fix release that bypasses the standard pipeline, or human intervention on the runner). This is a deliberate forcing function -- it ensures the action is exercised before it ships -- but it is a real coupling that future maintainers must understand. The escape hatch is that the action's source is plain JavaScript with no build step, and the cursus binary can always be installed manually via `npx cursus` from the root devDependency for emergency releases.
- Adopting the `branch` strategy means every release passes through a pull request, adding latency between "changesets are present" and "tag exists." This is the cost of the human gate; it is the right trade-off for a repository whose tags become consumer-visible references.
- Cursus must be present on the runner before `cursus ci` can run, which forces the workflow to resolve a cursus version from `package.json` before the cursus-managed pipeline itself has been invoked. The version pinned in the root devDependency is the source of truth for which cursus runs the release, and that pin must be kept current via dependency updates -- the very flow the action's own `version-file` design supports.
- `[git].publish_private_packages` adds a Cursus-specific configuration field that partially overlaps with the upstream `private: true` marker; per [Cursus ADR-043](https://github.com/zantarix/cursus/blob/main/docs/adr/043-publish-private-packages-to-github-releases.md), this is an accepted exception to the "upstream manifest is the single source of truth" principle, made specifically for git-tag-distributed packages.
- The release workflow depends on the GitHub API being available not only for the artifact-download path the action already needs ([ADR-001](001-setup-cursus-github-action.md)) but also for commit creation, ref updates, tag creation, and Release creation. An attestations-API or Git-Data-API outage hard-fails releases, even when the local working copy and the cursus binary are fine. This is the same security-over-availability trade-off [ADR-001](001-setup-cursus-github-action.md) made for the install path.

### Neutral

- The `[github.artifacts]` table is intentionally left empty in `.cursus/config.toml` pending the build-provenance follow-up ADR called for by [ADR-001](001-setup-cursus-github-action.md). Until that ADR lands, GitHub Releases produced by `cursus publish` will contain release notes derived from the changelog but no attached release artifacts and no provenance attestation. This is a known interim state, not a permanent decision.
- The `setup-cursus/package.json` `version` field is decorative under cursus's enumeration. It will be held at `0.0.0` indefinitely; tooling or contributors that look there for the shipped version will need to consult the repository's git tags or the root `package.json` instead. This is a consequence of the [ADR-002](002-actions-monorepo-layout.md) layout choice, not a new constraint introduced here.
- The first release will be `v1.0.0`, produced by an initial major-bump changeset on top of a `0.0.0` root `package.json`. There is no `v0.x` pre-release stream.
- `cursus ci` runs on every push to `main`. Pushes that change neither `.cursus/*.md` changesets nor the published-version state result in a no-op exit, so the cost of the always-on workflow is one cursus invocation per merge -- minor relative to the rest of CI.
- The release workflow does not need any cross-job state, caching, or matrix configuration: it is a single linear job (checkout, install cursus via `./setup-cursus`, mint App token, run `cursus ci`).

## Alternatives Considered

### Path-prefixed tags (`setup-cursus/v1.0.0`)

Adopt path-prefixed tags from day one so that the tag namespace is keyed to the action rather than to the repository. This would future-proof the layout against a hypothetical second action.

Rejected. [ADR-002](002-actions-monorepo-layout.md) already chose shared `vX.Y.Z` tags for the single-action case, and because cursus enumerates only the root package under the no-workspaces layout there is exactly one tracked version stream. Path-prefixed tags would solve a problem that does not exist today (two actions sharing a tag namespace) at the cost of more complex consumer pin syntax and a divergence from [ADR-002](002-actions-monorepo-layout.md). If a second action is ever added, the tag scheme can be revisited under a new ADR exactly as [ADR-002](002-actions-monorepo-layout.md) anticipated.

### `push` strategy instead of `branch`

Configure `[git].strategy = "push"`, so that `cursus ci` commits release changes directly to `main` and immediately creates the tag and GitHub Release on the same workflow run.

Rejected. The `branch` strategy with PR review is the appropriate default whenever GitHub integration is active, and it matches the default cursus itself derives in that environment ([Cursus ADR-015](https://github.com/zantarix/cursus/blob/main/docs/adr/015-ci-managed-release-workflow.md)). The PR step provides a human gate before tags and GitHub Releases -- which become public, immutable references the moment they are created -- come into existence. Skipping that gate would speed releases up but would also remove the only reviewable artifact between "changesets accumulated on `main`" and "consumers can pin a new version."

### `npx cursus` from the root devDependency instead of `./setup-cursus`

Install cursus in the release workflow by running `npx cursus` against the version pinned in the root `package.json` devDependency, rather than going through the `./setup-cursus` action.

Rejected. Using `./setup-cursus` dogfoods the action and exercises the install path real consumers will see -- platform detection, artifact download, attestation verification, tool-cache placement, and `PATH` management -- on every single release. It also creates a feedback loop: a regression in `setup-cursus` immediately surfaces during its own release, rather than silently passing while the npm-installed cursus invocation in CI continues to work. The `npx cursus` path remains available as an emergency escape hatch (see "bootstrap dependency" under Negative consequences), but the routine release path should be the one consumers see.

### Wiring `cursus verify` and `cursus change --auto` into this repository's CI

Add CI jobs in this repository to run `cursus verify` on PRs (ensuring contributor PRs include a changeset where required) and `cursus change --auto` on dependency-update PRs (generating an automatic changeset for Dependabot/Renovate bumps).

Rejected. PR-side changeset verification and automatic changesets for dependency-update PRs are already provided by external tooling that runs with consistent UX across the Zantarix project family. Re-implementing that policy inside this repository's CI would diverge from the shared infrastructure, force this repository to maintain its own changeset-policy logic, and create the very kind of drift the shared tooling exists to prevent. This repository's CI surface for changesets is intentionally zero: contributors run `npx cursus change` locally, the external tooling polices PRs, and `cursus ci` consumes the changesets at release time.
