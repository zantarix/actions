import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleVerificationSupported, BUNDLE_MIN_VERSION } from '../src/bundle.js';

test('BUNDLE_MIN_VERSION is 0.9.0', () => {
	assert.equal(BUNDLE_MIN_VERSION, '0.9.0');
});

const CASES = [
	{ version: '0.8.0', supported: false },
	{ version: '0.8.9', supported: false },
	{ version: '0.5.1', supported: false },
	{ version: '0.9.0', supported: true },
	{ version: '0.9.1', supported: true },
	{ version: '0.10.0', supported: true },
	{ version: '1.0.0', supported: true },
];

for (const { version, supported } of CASES) {
	test(`bundleVerificationSupported(${version}) === ${supported}`, () => {
		assert.equal(bundleVerificationSupported(version), supported);
	});
}

test('prerelease/build suffix on the patch component is ignored', () => {
	assert.equal(bundleVerificationSupported('0.9.0-rc.1'), true);
});
