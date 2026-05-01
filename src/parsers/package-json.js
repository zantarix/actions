const EXACT_VERSION_RE = /^\d+\.\d+\.\d+$/;

function isExactVersion(v) {
	return EXACT_VERSION_RE.test(v);
}

export function parsePackageJson(content) {
	let pkg;
	try {
		pkg = JSON.parse(content);
	} catch (err) {
		throw new Error(`package.json: invalid JSON: ${err.message}`);
	}

	const sections = ['dependencies', 'devDependencies', 'optionalDependencies'];

	for (const section of sections) {
		const version = pkg[section]?.['@zantarix/cursus'];
		if (version !== undefined) {
			if (!isExactVersion(String(version))) {
				throw new Error(
					`package.json: @zantarix/cursus version "${version}" in ${section} is a semver range. ` +
					'An exact version (e.g. "1.5.0") is required.',
				);
			}
			return String(version);
		}
	}

	throw new Error(
		'package.json: @zantarix/cursus not found in ' +
		'dependencies, devDependencies, or optionalDependencies.',
	);
}
