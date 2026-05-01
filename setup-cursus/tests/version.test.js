import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVersion } from '../src/version.js';

const CARGO_TOML = `
[package]
name = "my-crate"
version = "0.1.0"

[package.metadata.bin]
cursus-bin = { version = "0.5.1", bins = ["cursus"] }
`;

const PACKAGE_JSON = JSON.stringify({
	dependencies: { '@zantarix/cursus': '0.5.1' },
});

test('resolveVersion: version input returns as-is', () => {
	assert.equal(resolveVersion('1.2.3', ''), '1.2.3');
});

test('resolveVersion: both set → throws', () => {
	assert.throws(
		() => resolveVersion('1.2.3', 'Cargo.toml'),
		/both are set/,
	);
});

test('resolveVersion: neither set → throws', () => {
	assert.throws(
		() => resolveVersion('', ''),
		/neither is set/,
	);
});

test('resolveVersion: version-file Cargo.toml', () => {
	const result = resolveVersion('', '/repo/Cargo.toml', () => CARGO_TOML);
	assert.equal(result, '0.5.1');
});

test('resolveVersion: version-file package.json', () => {
	const result = resolveVersion('', '/repo/package.json', () => PACKAGE_JSON);
	assert.equal(result, '0.5.1');
});

test('resolveVersion: unrecognised version-file → throws', () => {
	assert.throws(
		() => resolveVersion('', '/repo/pyproject.toml', () => ''),
		/Unrecognised version-file format/,
	);
});
