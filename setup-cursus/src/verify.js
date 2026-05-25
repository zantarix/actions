import { spawnSync } from 'node:child_process';

const OWNER = 'zantarix';
const WORKFLOW = 'https://github.com/zantarix/cursus/.github/workflows/release-artifacts.yml';

// Builds the `gh attestation verify` argv. When `bundlePath` is supplied, `--bundle`
// makes verification a local, offline operation against the downloaded Sigstore bundle;
// without it, `gh` discovers the attestation via the public attestations API (the legacy
// path retained for pre-0.9.0 releases that publish no bundle). The pinned SAN is the
// same in both cases (ADR-004).
export function buildVerifyArgs(filePath, version, bundlePath = null) {
	const certIdentity = `${WORKFLOW}@refs/tags/cursus@${version}`;
	const args = [
		'attestation', 'verify',
		filePath,
		'--owner', OWNER,
		'--cert-identity', certIdentity,
	];
	if (bundlePath) {
		args.push('--bundle', bundlePath);
	}
	return args;
}

export function verifyArtifact(filePath, version, bundlePath = null) {
	const result = spawnSync(
		'gh',
		buildVerifyArgs(filePath, version, bundlePath),
		{ encoding: 'utf8' },
	);

	if (result.status !== 0) {
		process.stderr.write(`gh attestation verify failed:\n${result.stderr ?? ''}\n`);
		return false;
	}
	return true;
}
