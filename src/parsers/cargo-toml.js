import { parse } from 'smol-toml';

const EXACT_VERSION_RE = /^=?(\d+\.\d+\.\d+)$/;

function parseExactVersion(v) {
	const m = EXACT_VERSION_RE.exec(v);
	return m ? m[1] : null;
}

export function parseCargoToml(content) {
	let doc;
	try {
		doc = parse(content);
	} catch (err) {
		throw new Error(`Cargo.toml: parse error: ${err.message}`);
	}

	const pkgVersion = doc.package?.metadata?.bin?.['cursus-bin']?.version;
	const wsVersion = doc.workspace?.metadata?.bin?.['cursus-bin']?.version;

	if (pkgVersion !== undefined && wsVersion !== undefined) {
		throw new Error(
			'Cargo.toml: cursus version is ambiguous — found in both ' +
			'[package.metadata.bin.cursus-bin] and [workspace.metadata.bin.cursus-bin]. ' +
			'Remove one of the two entries.',
		);
	}

	if (pkgVersion !== undefined) {
		const exact = parseExactVersion(String(pkgVersion));
		if (!exact) {
			throw new Error(
				`Cargo.toml: [package.metadata.bin.cursus-bin] version "${pkgVersion}" is a semver range. ` +
				'An exact version (e.g. "1.5.0" or "=1.5.0") is required.',
			);
		}
		return exact;
	}

	if (wsVersion !== undefined) {
		const exact = parseExactVersion(String(wsVersion));
		if (!exact) {
			throw new Error(
				`Cargo.toml: [workspace.metadata.bin.cursus-bin] version "${wsVersion}" is a semver range. ` +
				'An exact version (e.g. "1.5.0" or "=1.5.0") is required.',
			);
		}
		return exact;
	}

	// Fall through to [dependencies]
	const depEntry = doc.dependencies?.cursus;

	if (depEntry === undefined) {
		throw new Error(
			'Cargo.toml: cursus version not found. ' +
			'Add it under [package.metadata.bin.cursus-bin], ' +
			'[workspace.metadata.bin.cursus-bin], or [dependencies].',
		);
	}

	const depVersion = typeof depEntry === 'string'
		? depEntry
		: depEntry?.version;

	if (!depVersion) {
		throw new Error('Cargo.toml: [dependencies.cursus] has no version field.');
	}

	const exact = parseExactVersion(String(depVersion));
	if (!exact) {
		throw new Error(
			`Cargo.toml: [dependencies.cursus] version "${depVersion}" is a semver range. ` +
			'An exact version (e.g. "1.5.0" or "=1.5.0") is required.',
		);
	}

	return exact;
}
