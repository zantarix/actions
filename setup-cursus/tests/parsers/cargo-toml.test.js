import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parseCargoToml } from '../../src/parsers/cargo-toml.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function fixture(name) {
	return readFileSync(join(FIXTURES, name), 'utf8');
}

test('parseCargoToml: [package.metadata.bin.cursus-bin]', () => {
	assert.equal(parseCargoToml(fixture('cargo-pkg-bin.toml')), '0.5.1');
});

test('parseCargoToml: [package.metadata.bin.cursus-bin] with = prefix', () => {
	assert.equal(parseCargoToml(fixture('cargo-pkg-bin-eq.toml')), '0.5.1');
});

test('parseCargoToml: [workspace.metadata.bin.cursus-bin]', () => {
	assert.equal(parseCargoToml(fixture('cargo-ws-bin.toml')), '0.5.1');
});

test('parseCargoToml: [workspace.metadata.bin.cursus-bin] with = prefix', () => {
	assert.equal(parseCargoToml(fixture('cargo-ws-bin-eq.toml')), '0.5.1');
});

test('parseCargoToml: both metadata locations → throws ambiguity error', () => {
	assert.throws(
		() => parseCargoToml(fixture('cargo-both-bin.toml')),
		/ambiguous/,
	);
});

test('parseCargoToml: [dependencies] exact string', () => {
	assert.equal(parseCargoToml(fixture('cargo-deps-exact.toml')), '0.5.1');
});

test('parseCargoToml: [dependencies] exact string with = prefix', () => {
	assert.equal(parseCargoToml(fixture('cargo-deps-exact-eq.toml')), '0.5.1');
});

test('parseCargoToml: [dependencies] inline table with version', () => {
	assert.equal(parseCargoToml(fixture('cargo-deps-table.toml')), '0.5.1');
});

test('parseCargoToml: [dependencies] semver range → throws', () => {
	assert.throws(
		() => parseCargoToml(fixture('cargo-deps-range.toml')),
		/semver range/,
	);
});

test('parseCargoToml: cursus missing → throws', () => {
	assert.throws(
		() => parseCargoToml(fixture('cargo-missing.toml')),
		/cursus version not found/,
	);
});
