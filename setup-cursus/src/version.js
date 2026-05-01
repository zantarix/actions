import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseCargoToml } from './parsers/cargo-toml.js';
import { parsePackageJson } from './parsers/package-json.js';

export function resolveVersion(
	inputVersion = (process.env.INPUT_VERSION ?? '').trim(),
	inputVersionFile = (process.env['INPUT_VERSION-FILE'] ?? '').trim(),
	readFile = (path) => readFileSync(path, 'utf8'),
) {
	const hasVersion = inputVersion.length > 0;
	const hasVersionFile = inputVersionFile.length > 0;

	if (hasVersion && hasVersionFile) {
		throw new Error(
			'Exactly one of `version` or `version-file` must be set; both are set.',
		);
	}
	if (!hasVersion && !hasVersionFile) {
		throw new Error(
			'Exactly one of `version` or `version-file` must be set; neither is set.',
		);
	}

	if (hasVersion) {
		return inputVersion;
	}

	const content = readFile(inputVersionFile);
	const filename = basename(inputVersionFile);

	if (filename === 'Cargo.toml') {
		return parseCargoToml(content);
	}
	if (filename === 'package.json') {
		return parsePackageJson(content);
	}

	throw new Error(
		`Unrecognised version-file format: "${filename}". ` +
		'Supported files: Cargo.toml, package.json',
	);
}
