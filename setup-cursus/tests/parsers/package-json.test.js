import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parsePackageJson } from '../../src/parsers/package-json.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function fixture(name) {
	return readFileSync(join(FIXTURES, name), 'utf8');
}

test('parsePackageJson: dependencies', () => {
	assert.equal(parsePackageJson(fixture('pkg-deps.json')), '0.5.1');
});

test('parsePackageJson: devDependencies', () => {
	assert.equal(parsePackageJson(fixture('pkg-dev.json')), '0.5.1');
});

test('parsePackageJson: optionalDependencies', () => {
	assert.equal(parsePackageJson(fixture('pkg-opt.json')), '0.5.1');
});

test('parsePackageJson: semver range → throws', () => {
	assert.throws(
		() => parsePackageJson(fixture('pkg-range.json')),
		/semver range/,
	);
});

test('parsePackageJson: @zantarix/cursus missing → throws', () => {
	assert.throws(
		() => parsePackageJson(fixture('pkg-missing.json')),
		/@zantarix\/cursus not found/,
	);
});

test('parsePackageJson: invalid JSON → throws', () => {
	assert.throws(
		() => parsePackageJson('not json'),
		/invalid JSON/,
	);
});
