// Cursus 0.9.0 is the first release that publishes a self-contained `.sigstore.json`
// bundle asset alongside each binary (cursus ADR-061 / this repo's ADR-004). Releases
// before 0.9.0 have no bundle, so they must continue to verify via gh attestation-API
// discovery rather than the offline `--bundle` path.
export const BUNDLE_MIN_VERSION = '0.9.0';

// Returns true when the resolved version publishes a bundle asset and therefore takes
// the offline bundle-verification path. Versions are always exact pins (no ranges), so a
// numeric major.minor.patch comparison is sufficient; any prerelease/build suffix on a
// component is ignored.
export function bundleVerificationSupported(version, min = BUNDLE_MIN_VERSION) {
	return compareVersions(version, min) >= 0;
}

function compareVersions(a, b) {
	for (let i = 0; i < 3; i++) {
		const da = part(a, i);
		const db = part(b, i);
		if (da !== db) return da < db ? -1 : 1;
	}
	return 0;
}

function part(version, index) {
	const segment = version.split('.')[index] ?? '0';
	const n = Number.parseInt(segment, 10);
	return Number.isNaN(n) ? 0 : n;
}
