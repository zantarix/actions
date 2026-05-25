# ADR-004: Verify `setup-cursus` downloads against a Release-asset Sigstore bundle

## Status

Accepted (2026-05-25)

## Context

The `setup-cursus` action verifies each cursus release binary before installing it by invoking `gh attestation verify <file> --owner zantarix --cert-identity <SAN>`, where the SAN pins the canonical cursus release workflow and the specific release tag ref ([ADR-001](001-setup-cursus-github-action.md)). That command performs *discovery by digest* against GitHub's public attestations API: given the binary's digest, `gh` queries the attestations REST endpoint to locate and download the matching Sigstore bundle, then verifies it. The trust anchor is the bundle itself -- an ephemeral Fulcio certificate whose SAN pins the workflow and tag, a signature, and a Rekor inclusion proof -- but the *transport* by which the action obtains that bundle is a GitHub API call.

That API transport is the fragile part. The attestations endpoint is part of the GitHub REST API, which is rate-limited to 60 requests per hour per source IP when unauthenticated and 5000 per hour authenticated. On shared-IP CI runners the action competes with every other consumer behind the same egress for that budget, and even on GitHub-hosted runners the install path takes a hard dependency on the attestations API being reachable on every run -- including tool-cache hits, where verification is still mandatory ([ADR-001](001-setup-cursus-github-action.md)).

Cursus has now removed the need for this discovery step. [Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) (Accepted 2026-05-25) publishes the self-contained Sigstore bundle as a GitHub Release asset alongside each binary -- for example `cursus-linux-x86_64.sigstore.json` beside `cursus-linux-x86_64`. Because the bundle carries the Fulcio certificate (and therefore the pinned SAN), the signature, and the Rekor inclusion proof, and because its trust root is distributed out-of-band via TUF rather than fetched from GitHub, the bundle can be verified entirely offline once the verifier holds both the binary and the bundle bytes. Both reach the runner over the same un-rate-limited Release-asset CDN path the binary already uses. Cursus ADR-061 directs the `setup-cursus` action to stop hitting the attestations API and instead verify the downloaded bundle. This ADR amends only the verification *source* established in [ADR-001](001-setup-cursus-github-action.md) -- where the bundle comes from -- not its trust model: the same Fulcio/Rekor/OIDC trust root, the same pinned SAN, and the same hard-fail philosophy all carry over unchanged.

[Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) names `cosign` as the canonical token-free verifier and, in the same decision, keeps `sigstore-js` for the npm channel -- it deliberately chooses a verifier per environment rather than mandating one tool everywhere. This action's environment selects its own verifier under that same principle, and the choice is `gh` rather than cosign, for the reasons set out in the Decision below.

A further nuance is the bundle's availability window. Cursus 0.9.0 is the first release that publishes `.sigstore.json` assets; releases before 0.9.0 have no bundle to download. The action therefore cannot assume a bundle exists for every version a consumer might pin, and must remain able to verify older releases through the path that does not depend on a co-located bundle.

## References

- [Cursus ADR-061: Token-Free Cross-Platform Artifact Verification](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md)
- [gh attestation verify manual](https://cli.github.com/manual/gh_attestation_verify)
- [Verifying artifact attestations offline](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/verifying-attestations-offline)
- [cli/cli#11803: allow attestation verification without a token for public repositories](https://github.com/cli/cli/issues/11803)
- [GitHub REST API: artifact attestations endpoints](https://docs.github.com/en/rest/users/attestations)
- [GitHub-hosted runner image: Ubuntu 24.04 README](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)

## Decision

We will migrate the `setup-cursus` action's verification source from attestations-API discovery to a Sigstore bundle downloaded as a GitHub Release asset, verified offline against the local bundle. The verifier remains `gh attestation verify`, now invoked with the `--bundle` flag pointing at the downloaded bundle. The action is version-gated so that releases that predate the bundle assets continue to verify through the existing API-discovery path.

### Verify against a downloaded bundle with `gh ... --bundle`

For a resolved version that publishes a bundle (see "Version cutover at 0.9.0" below), the action will download the matching `<binary>.sigstore.json` asset from the same `cursus@<version>` GitHub Release as the binary, then verify offline with:

```
gh attestation verify <binary> --owner zantarix --cert-identity <SAN> --bundle <bundle-path>
```

The SAN is unchanged from [ADR-001](001-setup-cursus-github-action.md): `https://github.com/zantarix/cursus/.github/workflows/release-artifacts.yml@refs/tags/cursus@<version>`. Passing `--bundle` makes verification a local, offline operation: `gh` reads the bundle from disk rather than querying the attestations API for it, and the subject digest, the Fulcio certificate chain plus Rekor inclusion proof, and the pinned SAN are all checked against the local bytes. An attacker who substitutes either the binary or the bundle cannot satisfy all three checks. This is the offline-verification path GitHub documents for `gh attestation verify`.

### Keep `gh`; do not adopt cosign

[Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) names cosign as its canonical verifier, but the GitHub Actions environment chooses `gh`. This is a deliberate divergence from the letter of ADR-061, made under ADR-061's own per-environment-verifier principle:

- `gh` is preinstalled on GitHub-hosted runners; cosign is not. Selecting cosign would force the action either to download and pin cosign at runtime -- a bootstrapping problem, since nothing on the runner would then verify cosign itself -- or to ship cosign in some other way, expanding the trust surface the action is responsible for.
- `setup-cursus` is a `node24` JavaScript action ([ADR-001](001-setup-cursus-github-action.md)). It cannot consume `uses: sigstore/cosign-installer`; reaching for that step would require restructuring the action into a composite action, reversing the JavaScript-action premise [ADR-001](001-setup-cursus-github-action.md) deliberately chose.
- `gh` is GitHub's own audited verifier, already trusted by the runner, and supports offline local-bundle verification via `--bundle`. It enforces the same identity policy the cosign path enforces; only the implementation differs, chosen per environment exactly as ADR-061 chose `sigstore-js` for npm and cosign for the Node-free GitLab component.

### Token requirement: a `gh` quirk, not a true token-free path

[Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) describes the GitHub action as dropping its requirement for a GitHub token for verification. With `gh ... --bundle` that is not literally true, and the difference must be stated honestly. `gh attestation verify` constructs an authenticated GitHub API client at startup and insists a token be present in its environment even when `--bundle` is supplied and no discovery call is made (a known `gh` limitation -- see cli/cli#11803). The token is used only to fetch the public Sigstore trusted root; it is never used for signing and, on the `--bundle` path, never to fetch the attestation. On GitHub-hosted runners the ambient `GITHUB_TOKEN` is always available, so this costs the action nothing. And because cursus is a public repository, verifying its attestations requires no `permissions:` scopes on the consumer side: the attestations REST endpoint serves public resources without authentication, and `attestations: read` is only needed for private repositories.

The substantive change is therefore the elimination of the attestations-API *discovery* dependency and its per-IP rate limits, not the elimination of the token. The action verifies the bundle offline; a residual ambient-token requirement remains as a `gh` implementation quirk. Cursus may choose to record an erratum against the relevant bullet of [Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md), but that is cursus's decision to make in its own repository; this ADR does not amend it.

### Version cutover at 0.9.0

Cursus 0.9.0 is the first release that publishes `.sigstore.json` bundle assets; earlier releases have none. The action is version-gated on the resolved version:

- Resolved version **>= 0.9.0** takes the bundle path: download the `<binary>.sigstore.json` asset and verify offline with `gh ... --bundle`.
- Resolved version **< 0.9.0** retains the legacy path: today's `gh attestation verify` against the attestations API, with no `--bundle` flag and no bundle download.

Both paths use the same `gh` verifier, the same pinned SAN, and the same hard-fail behaviour; they differ only in whether a bundle is downloaded and whether `--bundle` is passed. Version-gating avoids hard-failing a legitimate older pin that simply has no bundle to verify against.

### Cache behaviour

Verification remains mandatory on every invocation, including tool-cache hits ([ADR-001](001-setup-cursus-github-action.md)). On the bundle path the bundle must therefore be present locally even when the binary is already cached. The action will download the (small) bundle fresh into `RUNNER_TEMP` on every run and verify the cached binary against it. The bundle is deliberately kept out of `RUNNER_TOOL_CACHE`: it is not part of the installed tool, and keeping it out of the cache keeps it off the cache-poisoning surface the [ADR-001](001-setup-cursus-github-action.md) poison-recovery logic guards. A missing or misnamed bundle on the bundle path hard-fails verification even when the binary itself is sound -- the same hard-fail trade [Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) accepts, applied here to the action's bundle download.

### Out of scope

- The cursus npm postinstall verifier and the new GitLab CI/CD component are the domain of [Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) and are not changed here. This ADR concerns only the GitHub `setup-cursus` action's verification source.
- The trust model, pinned SAN, OIDC issuer, and hard-fail philosophy established by [ADR-001](001-setup-cursus-github-action.md) are unchanged; only where the bundle bytes come from is amended.

## Consequences

### Positive

- The action no longer depends on the rate-limited attestations-API discovery path for versions >= 0.9.0. The bundle arrives over the same un-rate-limited Release-asset CDN path as the binary, removing the shared-IP rate-limit fragility on the install path.
- Verification on the bundle path is offline: once the binary and the bundle are on disk, no GitHub API call is needed to verify them. An attestations-API outage no longer hard-fails verification for bundle-publishing versions.
- The trust posture is unchanged. The same Fulcio/Rekor/OIDC trust root, the same per-version pinned SAN, and the same hard-fail behaviour established in [ADR-001](001-setup-cursus-github-action.md) carry over; the change is confined to bundle transport.
- The verifier stays `gh` -- preinstalled, GitHub-audited, already on the trust path -- with no new tool to download, pin, or bootstrap, and no restructuring of the JavaScript action.
- For consumers, verifying a public-repo (cursus) attestation needs no `permissions:` scopes; `attestations: read` is no longer required on the bundle path.

### Negative

- The token requirement is not removed. `gh attestation verify` still insists on an ambient token even with `--bundle` (cli/cli#11803), so the action cannot truthfully claim token-free verification despite [Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md)'s framing. The cost is nil on GitHub-hosted runners but the residual dependency is real.
- The action carries two verification paths gated on version. Until pre-0.9.0 cursus pins are no longer in use, both the bundle path and the legacy API-discovery path must be maintained and tested.
- Correct verification on the bundle path now depends on the bundle asset being present and correctly named on the Release. A missing or misnamed bundle hard-fails even when the binary is fine.
- On the bundle path the action downloads the bundle on every run -- including cache hits -- since verification is mandatory and the bundle is kept out of the tool cache. This is a small extra download relative to the binary, but it means cache-hit runs are no longer fully network-free on that path.
- This action diverges from the cosign verifier [Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) names, so a reader comparing the two documents must understand the per-environment-verifier reasoning rather than expecting a single tool across all channels.

### Neutral

- The pinned SAN remains encoded in this action exactly as in [ADR-001](001-setup-cursus-github-action.md); a cursus workflow rename or tag-scheme change still requires an action release, unchanged by this decision.
- The bundle lives in `RUNNER_TEMP`, not `RUNNER_TOOL_CACHE`; it is treated as transient verification input, not part of the installed tool.
- The legacy API-discovery path is retained, not removed, so the action's behaviour for pre-0.9.0 pins is identical to [ADR-001](001-setup-cursus-github-action.md).

## Alternatives Considered

### Adopt cosign, downloading and pinning it at runtime

Match the letter of [Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) by using `cosign verify-blob-attestation` against the bundle. Rejected: cosign is not preinstalled on GitHub-hosted runners, so the action would have to download and pin it at runtime, which is a bootstrapping and trust problem -- nothing on the runner verifies the downloaded cosign -- and adds a new download for no security gain over the preinstalled, GitHub-audited `gh`.

### Convert to a composite action using `sigstore/cosign-installer`

Restructure `setup-cursus` into a composite action so it can install cosign via `uses: sigstore/cosign-installer` and then verify with cosign. Rejected: this is a large restructure that reverses the JavaScript-action premise [ADR-001](001-setup-cursus-github-action.md) deliberately chose, for no security benefit over the preinstalled `gh`, and it would not eliminate the action's own bootstrapping concerns.

### Keep attestations-API discovery (status quo)

Leave the action on `gh attestation verify` with API discovery for all versions. Rejected: this retains exactly the rate-limited attestations-API dependency on the install path that [Cursus ADR-061](https://github.com/zantarix/cursus/blob/main/docs/adr/061-token-free-cross-platform-artifact-verification.md) set out to remove, and forgoes the offline-verification benefit available for versions >= 0.9.0.
