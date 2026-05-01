import { spawnSync } from 'node:child_process';

const OWNER = 'zantarix';
const WORKFLOW = 'https://github.com/zantarix/cursus/.github/workflows/release-artifacts.yml';

export function verifyArtifact(filePath, version) {
	const certIdentity = `${WORKFLOW}@refs/tags/cursus@${version}`;

	const result = spawnSync(
		'gh',
		[
			'attestation', 'verify',
			filePath,
			'--owner', OWNER,
			'--cert-identity', certIdentity,
		],
		{ encoding: 'utf8' },
	);

	if (result.status !== 0) {
		process.stderr.write(`gh attestation verify failed:\n${result.stderr ?? ''}\n`);
		return false;
	}
	return true;
}
