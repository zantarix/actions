# Changelog

## 1.1.0 - 2026-05-26

### Features

- Verifies cursus 0.9.0 and newer offline against the release's Sigstore bundle asset rather than the GitHub attestations API. Workflows installing cursus >= 0.9.0 no longer require the `attestations: read` permission and no longer fail when the attestations API is rate-limited or unavailable. Versions before 0.9.0 continue to verify via the attestations API. [ab4219b]

## 1.0.0 - 2026-05-02

### Breaking Changes

- Initial release. Ships the `setup-cursus` action, which installs a verified version of the cursus release-management CLI on GitHub Actions runners via binary download and Sigstore attestation verification. [50e3916]

### Bug Fixes

- Fixes action download failing when the action is used from another repository. [e5f8863]

