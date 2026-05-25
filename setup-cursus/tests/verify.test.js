import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerifyArgs } from '../src/verify.js';

const SAN = 'https://github.com/zantarix/cursus/.github/workflows/release-artifacts.yml@refs/tags/cursus@0.9.0';

test('legacy path: no --bundle, pins owner and cert-identity', () => {
	const args = buildVerifyArgs('/bin/cursus', '0.9.0');
	assert.deepEqual(args, [
		'attestation', 'verify',
		'/bin/cursus',
		'--owner', 'zantarix',
		'--cert-identity', SAN,
	]);
	assert.ok(!args.includes('--bundle'));
});

test('bundle path: appends --bundle with the bundle path', () => {
	const args = buildVerifyArgs('/bin/cursus', '0.9.0', '/tmp/cursus-linux-x86_64.sigstore.json');
	assert.deepEqual(args, [
		'attestation', 'verify',
		'/bin/cursus',
		'--owner', 'zantarix',
		'--cert-identity', SAN,
		'--bundle', '/tmp/cursus-linux-x86_64.sigstore.json',
	]);
});

test('cert-identity pins the resolved version tag', () => {
	const args = buildVerifyArgs('/bin/cursus', '1.2.3');
	const idx = args.indexOf('--cert-identity');
	assert.match(args[idx + 1], /@refs\/tags\/cursus@1\.2\.3$/);
});
