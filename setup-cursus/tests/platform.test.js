import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/platform.js';

const SUPPORTED = [
	{ os: 'Linux', arch: 'X64', artifact: 'cursus-linux-x86_64', isWindows: false },
	{ os: 'Linux', arch: 'ARM64', artifact: 'cursus-linux-aarch64', isWindows: false },
	{ os: 'macOS', arch: 'X64', artifact: 'cursus-osx-x86_64', isWindows: false },
	{ os: 'macOS', arch: 'ARM64', artifact: 'cursus-osx-aarch64', isWindows: false },
	{ os: 'Windows', arch: 'X64', artifact: 'cursus-windows-x86_64.exe', isWindows: true },
	{ os: 'Windows', arch: 'ARM64', artifact: 'cursus-windows-aarch64.exe', isWindows: true },
];

for (const { os, arch, artifact, isWindows } of SUPPORTED) {
	test(`detectPlatform: ${os}/${arch} → ${artifact}`, () => {
		const result = detectPlatform(os, arch);
		assert.equal(result.artifact, artifact);
		assert.equal(result.bundle, `${artifact}.sigstore.json`);
		assert.equal(result.isWindows, isWindows);
	});
}

test('detectPlatform: Windows bundle name keeps the .exe suffix', () => {
	// Confirmed against cursus@0.9.0: cursus-windows-x86_64.exe.sigstore.json
	assert.equal(
		detectPlatform('Windows', 'X64').bundle,
		'cursus-windows-x86_64.exe.sigstore.json',
	);
});

test('detectPlatform: unsupported platform throws', () => {
	assert.throws(
		() => detectPlatform('Linux', 'ARM'),
		/Unsupported platform/,
	);
});
