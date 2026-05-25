+++
"@zantarix/actions" = "minor"
+++

Verifies cursus 0.9.0 and newer offline against the release's Sigstore bundle asset rather than the GitHub attestations API. Workflows installing cursus >= 0.9.0 no longer require the `attestations: read` permission and no longer fail when the attestations API is rate-limited or unavailable. Versions before 0.9.0 continue to verify via the attestations API.
