# Changelog

## 1.0.0 - 2026-05-02

### Breaking Changes

- Initial release. Ships the `setup-cursus` action, which installs a verified version of the cursus release-management CLI on GitHub Actions runners via binary download and Sigstore attestation verification. [50e3916]

### Bug Fixes

- Fixes action download failing when the action is used from another repository. [e5f8863]

